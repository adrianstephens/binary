import * as utils from './utils';
export * as utils from './utils';

export interface _stream {
	be?: boolean;
	remaining(): number;
	remainder(): any;
	tell(): number;
	seek(offset: number): void;
	skip(offset: number): void;
	align(align: number): void;
	dataview(len: number): DataView;
	read_buffer(len: number): any;
	write_buffer(value: Uint8Array): void;
}

export interface TypeReaderT<T> { get(s: _stream, obj?: any): T }
interface TypeWriterT<T> { put(s: _stream, v: T): void }
export type TypeT<T>	= TypeReaderT<T> & TypeWriterT<T>;

export type TypeReader	= TypeReaderT<any> | { [key: string]: TypeReader; }
export type TypeWriter	= TypeWriterT<any> | { [key: string]: TypeWriter; }
export type Type 		= TypeT<any> | { [key: string]: Type; }

interface MergeType<T> { merge: T; }

export type ReadType<T> = T extends TypeReaderT<infer R> ? R : 
	{[K in keyof T]: T[K] extends TypeReaderT<infer R> ? (R extends MergeType<infer _U> ? never : R) : never}
&	{[K in keyof T as T[K] extends TypeReaderT<infer _R extends MergeType<infer U>> ? keyof U : never]: T[K] extends TypeReaderT<infer _R extends MergeType<infer U>> ? U[keyof U] : never};

export function ReadClass<T extends TypeReader>(spec: T) {
	return class ReadStruct {
		static get(s: _stream) {
			return new this(s);
		}
		constructor(s: _stream) {
			return Object.assign(this, read(s, spec));
		}
	} as (new(s: _stream) => ReadType<T>) & {
		get:(s: _stream) => ReadType<T>
	};
}

export function Class<T extends Type>(spec: T) {
	return class ReadWriteStruct {
		static get(s: _stream) {
			return new this(s);
		}
		static put(s: _stream, v: ReadWriteStruct) {
			write(s, spec, v);
		}
		constructor(s: _stream) {
			Object.assign(this, read(s, spec));
		}
		write(s: _stream) 	{
			write(s, spec, this);
		}
	} as (new(s: _stream) => ReadType<T> & { write(w: _stream): void}) & {
		get:(s: _stream) => ReadType<T>,
		put:(s: _stream, v: any) => void
	};
}

export function isReader(type: any): type is TypeReaderT<any> {
	return typeof type.get === 'function';
}
export function isWriter(type: any): type is TypeWriterT<any> {
	return typeof type.put === 'function';
}
export function isType(type: any): type is TypeT<any> {
	return isReader(type) && isWriter(type);
}

export function read<T extends TypeReader>(s: _stream, spec: T, obj?: any) : ReadType<T> {
	return isReader(spec)
		? spec.get(s, obj)
		: Object.entries(spec).reduce((obj, [k, t]) => (obj[k] = read(s, t, obj), obj), {obj} as any);
}

export function read_more<T extends TypeReader, O extends Record<string, any>>(s: _stream, specs: T, obj: O) : ReadType<T> & O {
	return Object.entries(specs).reduce((obj, spec) => {
		obj[spec[0]] = isReader(spec[1])
			? spec[1].get(s, obj)
			: read_more(s, spec[1] as TypeReader, obj[spec[0]]);
		return obj;
	}, obj as any);
}

export function write(s: _stream, type: TypeWriter, value: any) : void {
	if (isWriter(type))
		type.put(s, value);
	else
		Object.entries(type).map(([k, t]) => write(s, t, value[k]));
}

export type TypeX<T>	= TypeT<T> | ((obj: any)=>T) | T;

function readx<T extends object | number | string | boolean>(s: _stream, type: TypeX<T>, obj: any): T {
	return typeof type === 'function' ? type(obj)
		:	isReader(type) ?	type.get(s, obj)
		:	type;
}
function writex<T extends object | number | string>(s: _stream, type: TypeX<T>, value: T) {
	if (isWriter(type))
		type.put(s, value);
}

//-----------------------------------------------------------------------------
//	stream
//-----------------------------------------------------------------------------

export class stream implements _stream {
	protected buffer: ArrayBuffer;
	public offset0:	number;
	public offset:	number;
	public end:		number;

	constructor(data: Uint8Array) {
		this.buffer = data.buffer;
		this.offset = this.offset0 = data.byteOffset;
		this.end	= data.byteOffset + data.byteLength;
	}
	public remaining() {
		return this.end - this.offset;
	}
	public remainder() {
		return new Uint8Array(this.buffer, this.offset);
	}
	public tell() {
		return this.offset - this.offset0;
	}
	public seek(offset: number) {
		this.offset = this.offset0 + offset;
		return this;
	}
	public skip(offset: number) {
		this.offset += offset;
		return this;
	}
	public align(align: number) {
		const offset = this.tell() % align;
		if (offset)
			this.skip(align - offset);
	}
	public dataview(len: number) {
		if (this.offset + len > this.end)
			throw new Error('stream: out of bounds');
		const dv = new DataView(this.buffer, this.offset);
		this.offset += len;
		return dv;
	}
	public buffer_at(offset: number, len?: number) {
		return new Uint8Array(this.buffer, this.offset0 + offset, len ?? this.end - (this.offset0 + offset));
	}
	public read_buffer(len: number) {
		const offset = this.offset;
		this.offset = Math.min(this.end, offset + len);
		return new Uint8Array(this.buffer, offset, this.offset - offset);
	}
	public write_buffer(v: Uint8Array) {
		const dv = this.dataview(v.length);
		let offset = 0;
		for (const i of v)
			dv.setUint8(offset++, v[i]);
	}
}

export class growingStream extends stream {
	constructor(data?: Uint8Array) {
		super(data ?? new Uint8Array(1024));
	}
	public checksize(len: number) {
		if (this.offset + len > this.buffer.byteLength) {
			const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
			new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
			this.buffer	= newBuffer;
			this.offset	-= this.offset0;
			this.offset0 = 0;
		}
	}
	public dataview(len: number) {
		this.checksize(len);
		return super.dataview(len);
	}
	public buffer_at(offset: number, len: number) {
		this.checksize(offset + len - this.offset);
		return super.buffer_at(offset, len);
	}
	public read_buffer(len: number) {
		this.checksize(len);
		return super.read_buffer(len);
	}
	public write_buffer(v: Uint8Array) {
		this.checksize(v.length);
		super.write_buffer(v);
	}

	terminate() {
		return new Uint8Array(this.buffer, this.offset0, this.offset - this.offset0);
	}
}

export class endianStream extends stream {
	constructor(data: Uint8Array, public be: boolean) {
		super(data);
	}
}

//-----------------------------------------------------------------------------
//	dummy reader for calculating sizes
//-----------------------------------------------------------------------------

class dummy_dataview implements DataView {
	readonly buffer!: ArrayBuffer;
	readonly byteLength!: number;
	readonly byteOffset!: number;
	readonly [Symbol.toStringTag]!: string;
	constructor(public offset: number) {}

	getFloat32(_byteOffset: number, _littleEndian?: boolean): number	{ return this.offset; }
	getFloat64(_byteOffset: number, _littleEndian?: boolean): number	{ return this.offset; }
	getInt8(_byteOffset: number): number 						  		{ return this.offset; }
	getInt16(_byteOffset: number, _littleEndian?: boolean): number  	{ return this.offset; }
	getInt32(_byteOffset: number, _littleEndian?: boolean): number  	{ return this.offset; }
	getUint8(_byteOffset: number): number						  		{ return this.offset; }
	getUint16(_byteOffset: number, _littleEndian?: boolean): number 	{ return this.offset; }
	getUint32(_byteOffset: number, _littleEndian?: boolean): number 	{ return this.offset; }
	getBigInt64(_byteOffset: number, _littleEndian?: boolean): bigint	{ return BigInt(this.offset); }
	getBigUint64(_byteOffset: number, _littleEndian?: boolean): bigint	{ return BigInt(this.offset); }

	setFloat32(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setFloat64(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setInt8(_byteOffset: number, _value: number): void								{}
	setInt16(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setInt32(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setUint8(_byteOffset: number, _value: number): void								{}
	setUint16(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setUint32(_byteOffset: number, _value: number, _littleEndian?: boolean): void	{}
	setBigInt64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {}
	setBigUint64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {}
}

export class dummy implements _stream {
	public offset = 0;
	public remaining() 				{ return 0; }
	public remainder() 				{ return this.offset; }
	public tell() 					{ return this.offset; }
	public seek(offset: number) 	{ this.offset = offset; }
	public skip(offset: number) 	{ this.offset += offset; }
	public align(align: number) 	{ const offset = this.tell() % align; if (offset) this.skip(align - offset); }

	public dataview(len: number)	{
		const dv = new dummy_dataview(this.offset);
		this.offset += len;
		return dv;
	}
	public read_buffer(len: number) {
		const offset = this.offset;
		this.offset += len;
		return offset;
	}
	public write_buffer(_v: Uint8Array)		{}
}

//-----------------------------------------------------------------------------
//	numeric types
//-----------------------------------------------------------------------------

type TypeNumber<T extends number> = T extends 8 | 16 | 24 | 32 | 40 | 48 | 56
        ? TypeT<number>
        : TypeT<bigint>;

function endian_from_stream<T extends number | bigint>(type: (be?: boolean)=>TypeT<T>): TypeT<T> {
	return {
		get(s: _stream) 		{ return type(s.be).get(s); },
		put(s: _stream, v: T)	{ type(s.be).put(s, v); }
	};
}

function endian<T extends number | bigint>(type: (be?: boolean)=>TypeT<T>, be?: boolean) {
	return be === undefined ? endian_from_stream(type) : type(be);
}


//8 bit
export const UINT8: TypeT<number> = {
	get(s: _stream) 			{ return s.dataview(1).getUint8(0); },
	put(s: _stream, v: number)	{ s.dataview(1).setUint8(0, v); }
};
export const INT8: TypeT<number> = {
	get(s: _stream) 			{ return s.dataview(1).getInt8(0); },
	put(s: _stream, v: number)	{ s.dataview(1).setInt8(0, v); }
};

//16 bit
function _UINT16(be?: boolean): TypeT<number> { return {
	get(s: _stream, ) 			{ return s.dataview(2).getUint16(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(2).setUint16(0, v, !be); }
};}
function _INT16(be?: boolean): TypeT<number> { return {
	get(s: _stream, ) 			{ return s.dataview(2).getInt16(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(2).setInt16(0, v, !be); }
};}
export const UINT16_LE	= _UINT16(false);
export const UINT16_BE	= _UINT16(true);
export const INT16_LE	= _INT16(false);
export const INT16_BE 	= _INT16(true);
export const UINT16		= endian_from_stream(_UINT16);
export const INT16		= endian_from_stream(_INT16);

//32 bit
function _UINT32(be?: boolean): TypeT<number> { return {
	get(s: _stream, ) 			{ return s.dataview(4).getUint32(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(4).setUint32(0, v, !be); }
};}
function _INT32(be?: boolean): TypeT<number> { return {
	get(s: _stream, ) 			{ return s.dataview(4).getInt32(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(4).setInt32(0, v, !be); }
};}
export const UINT32_LE	= _UINT32(false);
export const UINT32_BE	= _UINT32(true);
export const INT32_LE	= _INT32(false);
export const INT32_BE 	= _INT32(true);
export const UINT32 	= endian_from_stream(_UINT32);
export const INT32 		= endian_from_stream(_INT32);

//64 bit 
function _UINT64(be?: boolean): TypeT<bigint> { return {
	get(s: _stream, ) 			{ return utils.getBigUint(s.dataview(8), 8, !be); },
	put(s: _stream, v: bigint)	{ utils.putBigUint(s.dataview(8), v, 8, !be); }
};}
function _INT64(be?: boolean): TypeT<bigint> { return {
	get(s: _stream, ) 			{ return utils.getBigInt(s.dataview(8), 8, !be); },
	put(s: _stream, v: bigint)	{ utils.putBigUint(s.dataview(8), v, 8, !be); }
};}

export const UINT64_LE	= _UINT64(false);
export const UINT64_BE	= _UINT64(true);
export const INT64_LE	= _INT64(false);
export const INT64_BE	= _INT64(true);
export const UINT64		= endian_from_stream(_UINT64);
export const INT64		= endian_from_stream(_INT64);

//computed int
export function UINT<T extends number>(bits: T, be?: boolean): TypeNumber<T> {
	if (bits & 7)
		throw new Error('bits must be multiple of 8');

	return bits === 8 ? UINT8 as TypeNumber<T>
		: bits > 56
		? endian((be?: boolean) => ({
			get(s: _stream) 			{ return utils.getBigUint(s.dataview(bits / 8), bits / 8, !be); },
			put(s: _stream, v: bigint)	{ utils.putBigUint(s.dataview(bits / 8), v, bits / 8, !be); }
		}), be) as TypeNumber<T>
		: endian(bits == 16 ? _UINT16 : bits == 32 ? _UINT32 :
		(be?: boolean) => ({
			get(s: _stream) 			{ return utils.getUint(s.dataview(bits / 8), bits / 8, !be); },
			put(s: _stream, v: number)	{ utils.putUint(s.dataview(bits / 8), v, bits / 8, !be); }
		}), be) as TypeNumber<T>;
}

export function INT<T extends number>(bits: T, be?: boolean): TypeNumber<T> {
	if (bits & 7)
		throw new Error('bits must be multiple of 8');

	return bits === 8 ? UINT8 as TypeNumber<T>
		: bits > 56
		? endian((be?: boolean) => ({
			get(s: _stream) 			{ return utils.getBigInt(s.dataview(bits / 8), bits / 8, !be); },
			put(s: _stream, v: bigint)	{ utils.putBigUint(s.dataview(bits / 8), v, bits / 8, !be); }
		}), be) as TypeNumber<T>
		: endian(bits == 16 ? _INT16 : bits == 32 ? _INT32 :
		(be?: boolean) => ({
			get(s: _stream) 			{ return utils.getInt(s.dataview(bits / 8), bits / 8, !be); },
			put(s: _stream, v: number)	{ utils.putUint(s.dataview(bits / 8), v, bits / 8, !be); }
		}), be) as TypeNumber<T>;
}

//float
function _Float32(be?: boolean): TypeT<number> { return {
	get(s: _stream) 			{ return s.dataview(4).getFloat32(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(4).setFloat32(0, v, !be); }
};}
function _Float64(be?: boolean): TypeT<number> { return {
	get(s: _stream) 			{ return s.dataview(8).getFloat64(0, !be); },
	put(s: _stream, v: number)	{ s.dataview(8).setFloat64(0, v, !be); }
};}
export const Float32_LE = _Float32(false);
export const Float32_BE = _Float32(true);
export const Float64_LE = _Float64(false);
export const Float64_BE = _Float64(true);
export const Float32	= endian_from_stream(_Float32);
export const Float64	= endian_from_stream(_Float64);


//leb128
export const ULEB128: TypeT<number|bigint> = {
	get(s: _stream) {
		const buffer = s.remainder();
		let t = 0;
		let	i = 0;
		let b;
		while ((b = buffer[i]) & 0x80 && i < 6)
			t |= (b & 0x7f) << (i++ * 7);

		if (!(b & 0x80)) {
			s.skip(i);
			return t;
		}
		let tn = BigInt(t);
		while ((b = buffer[i]) & 0x80)
			tn |= BigInt(b & 0x7f) << BigInt(i++ * 7);
		tn |= BigInt(b) << BigInt(i++ * 7);
		s.skip(i);
		return tn;
	},
	put(s: _stream, v: number | bigint) {
		const n = utils.highestSetIndex(v) / 7 + 1;
		const buffer = new Uint8Array(n);
		let i = 0;
		if (typeof v === 'number') {
			while (v > 127) {
				buffer[i++] = (v & 0x7f) | 0x80;
				v >>= 7;
			}
		} else {
			while (v > 127) {
				buffer[i++] = Number(v & 0x7fn) | 0x80;
				v >>= 7n;
			}
		}
		buffer[i++] = Number(v);
		s.write_buffer(buffer);
	}
};

//-----------------------------------------------------------------------------
//	string types
//-----------------------------------------------------------------------------

export function StringType(len: TypeX<number>, encoding: utils.TextEncoding = 'utf8', zeroTerminated = false, lenScale?: number): TypeT<string> {
	const lenScale2 = lenScale ?? (encoding == 'utf8' ? 1 : 2);
	return {
		get(s: _stream, obj?: any) 	{
			const len2	= readx(s, len, obj);
			const v 	= utils.decodeText(s.read_buffer(len2 * lenScale2), encoding);
			return zeroTerminated ? v.slice(0, -1) : v;
		},
		put(s: _stream, v: string) {
			if (zeroTerminated)
				v += '\0';
			writex(s, len, v.length * 2 / lenScale2);
			utils.encodeTextInto(v, s.read_buffer(v.length * lenScale2), encoding);
		}
	};
}

export const NullTerminatedStringType: TypeT<string> = {
	get(s: _stream) 	{
		const buf: number[] = [];
		let b;
		while ((b = s.dataview(1).getUint8(0)) != 0)
			buf.push(b);
		return String.fromCharCode(...buf);
	},
	put(s: _stream, v: string) {
		return utils.encodeTextInto(v + '\0', s.read_buffer(v.length + 1), 'utf8');
	}
};

export function RemainingStringType(encoding: utils.TextEncoding = 'utf8', zeroTerminated = false): TypeT<string> {
	return {
		get(s: _stream) 			{ return utils.decodeText(s.remainder(), encoding); },
		put(s: _stream, v: string) {
			if (zeroTerminated)
				v += '\0';
			utils.encodeTextInto(v, s.remainder(), encoding);
		}
	};
}

//-----------------------------------------------------------------------------
//	array types
//-----------------------------------------------------------------------------

export function readn<T extends TypeReader>(s: _stream, type: T, n: number, obj?: any) : ReadType<T>[] {
	const result: ReadType<T>[] = [];
	for (let i = 0; i < n; i++)
		result.push(read(s, type, obj));
	return result;
}

export function writen(s: _stream, type: TypeWriter, v: any) {
	for (const i of v)
		write(s, type, i);
}

export function ArrayType<T extends Type>(len: TypeX<number>, type: T): TypeT<ReadType<T>[]> {
	return {
		get: (s: _stream, obj?: any): ReadType<T>[] => readn(s, type, readx(s, len, obj), obj),
		put: (s: _stream, v: T[]) => { writex(s, len, v.length); writen(s, type, v); }
	};
}

export function RemainingArrayType<T extends Type>(type: T): TypeT<ReadType<T>[]> {
	return {
		get: (s: _stream, obj?: any) => {
			const result: ReadType<T>[] = [];
			try {
				let value;
				while (s.remaining() && (value = read(s, type, obj)) !== undefined)
					result.push(value);
			} catch (_) {
				//meh
			}
			return result;
		},
		put: (s: _stream, v: T[]) => writen(s, type, v)
	};
}

export function withNames<T>(array: T[], func:(v: T, i: number)=>string) : [string, T][] {
	return array.map((v, i) => [func(v, i) ?? `#${i}`, v] as [string, T]);
}

export const field = (field: string) 	=> (v: any) => v[field];
export const names = (names: string[])	=> (v: any, i: number) => names[i];

export function arrayWithNames<T extends Type>(type: T, func:(v: any, i: number)=>string): TypeT<[string, ReadType<T> extends Array<infer E> ? E : never][]> {
	return {
		get: (s: _stream) => withNames(read(s, type), func),
		put: (s: _stream, v: [string, any][]) => write(s, type, v.map(([, v]) => v))
	};
}

export function objectWithNames<T extends Type>(type: T, func:(v: any, i: number)=>string): TypeT<Record<string, ReadType<T> extends Array<infer E> ? E : never>> {
	return {
		get: (s: _stream) => Object.fromEntries(withNames(read(s, type), func)),
		put: (s: _stream, v: Record<string, any>) => write(s, type, Object.values(v))
	};
}

//-----------------------------------------------------------------------------
//	other types
//-----------------------------------------------------------------------------

function clone<T extends object>(obj: T) : T {
	return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj);
}

export function Struct<T extends Type>(spec: T): TypeT<ReadType<T>> {
	return {
		get:(s: _stream, obj?: any) 	=> read(s, spec, obj),
		put:(s: _stream, v: any)		=> write(s, spec, v)
	};
}

export const Remainder: TypeT<Uint8Array> = {
	get:(s: _stream)					=> s.remainder(),
	put:(s: _stream, v: Uint8Array)		=> s.write_buffer(v)
};

export function Buffer(len: TypeX<number>): TypeT<Uint8Array> {
	return {
		get:(s: _stream, obj?: any)		=> s.read_buffer(readx(s, len, obj)),
		put:(s: _stream, v: Uint8Array)	=> { writex(s, len, v.length); s.write_buffer(v); }
	};
}

export function SkipType(len: number): TypeT<void> {
	return {
		get: (s: _stream) 				=> s.skip(len),
		put: (s: _stream)				=> s.skip(len)
	};
}

export function AlignType(align: number): TypeT<void> {
	return {
		get: (s: _stream) 				=> s.align(align),
		put: (s: _stream)				=> s.align(align)
	};
}

export function Discard(type: Type): TypeT<undefined> {
	return {
		get(s: _stream) : undefined	{ read(s, type); return undefined; },
		put(_s: _stream)	{}
	};
}

export function DontRead<T>(): TypeT<T|undefined> {
	return {
		get(_s: _stream) : T | undefined	{ return undefined; },
		put(_s: _stream, _v: T)			{}
	};
}

export function SizeType<T extends Type>(len: TypeX<number>, type: T): TypeT<ReadType<T>> {
	return {
		get(s: _stream, obj: any) {
			const size	= readx(s, len, obj);
			const s2	= clone(s) as stream;
			s2.end		= s2.offset + size;
			return read(s2, type, obj);
		},
		put(_s: _stream) {}
	};
}

export function OffsetType<T extends Type>(offset: TypeX<number>, type: T): TypeT<ReadType<T>> {
	return {
		get(s: _stream, obj: any) {
			const off	= readx(s, offset, obj);
			const s2	= clone(s) as stream;
			s2.offset	= s2.offset0 += off;
			return read(s2, type, obj);
		},
		put(_s: _stream) {}
	};
}

export function MaybeOffsetType<T extends Type>(offset: TypeX<number>, type: T): TypeT<ReadType<T> | undefined> {
	return {
		get(s: _stream, obj: any) {
			const off = readx(s, offset, obj);
			if (off) {
				const s2	= clone(s) as stream;
				s2.offset	= s2.offset0 += off;
				return read(s2, type, obj);
			}
		},
		put(_s: _stream) {}
	};
}

export function Const<T>(t: T): TypeT<T> {
	return {
		get(_s: _stream)			{ return t; },
		put(_s: _stream, _v: any)	{}
	};
}

export function Func<T>(func: (obj?: any)=>T): TypeT<T> {
	return {
		get(s: _stream, obj: any)	{ return func(obj); },
		put(_s: _stream, _v: any)	{}
	};
}

export function FuncType<T extends Type>(func: (obj?: any)=>T): TypeT<ReadType<T>> {
	return {
		get(s: _stream, obj: any)	{ return read(s, func(obj), obj); },
		put(_s: _stream, _v: any)	{}
	};
}

export function If<T extends Type, F extends Type | undefined>(test: TypeX<boolean | number>, true_type: T, false_type?: F) {
	type R = ReadType<T | F>;
	return {
		get(s: _stream, obj: any) 	{
			const x = readx(s, test, obj);
			if (false_type)
				read_more(s, x ? true_type : false_type, obj);
			else if (x)
				read_more(s, true_type, obj);
			return {} as MergeType<R>;
		},
		put(_s: _stream, _v?: R)	{}
	};
}

export function Optional<T extends Type>(test: TypeX<boolean | number>, type: T): TypeT<ReadType<T> | undefined> {
	type R = ReadType<T>;
	return {
		get(s: _stream, obj: any) 	{ return readx(s, test, obj) ? read(s, type) : undefined; },
		put(_s: _stream, _v?: R)	{}
	};
}

export function Switch<T extends Record<string | number, Type>>(test: TypeX<string | number>, switches: T): TypeT<ReadType<T[keyof T]>> {
	return {
		get(s: _stream, obj: any)	{ const t = switches[readx(s, test, obj)]; return (t && read(s, t, obj)); },
		put(_s: _stream, _v: T)		{}// writex(s, test, )}// write(s, switches[test(obj)], v); }
	};
}

//-----------------------------------------------------------------------------
//	AS - read as one type, return another
//-----------------------------------------------------------------------------

type Constructor<T, D, O=void>		= new (arg: T, opt: O) => D;
type Factory<T, D, O=void>			= (arg: T, opt: O) => D;
type ClassOrFactory<T, D, O=void>	= Constructor<T, D, O> | Factory<T, D, O>;

function isConstructor<T, D, O>(maker: ClassOrFactory<T,D,O>): maker is Constructor<T,D,O> {
	return maker.prototype?.constructor.name;
}

function make<T, D, O>(maker: ClassOrFactory<T,D,O>, arg: T, opt?: O) {
	return isConstructor(maker) ? new maker(arg, opt as O) : maker(arg, opt as O);
}

export function as<T extends Type, D>(type: T, maker: ClassOrFactory<ReadType<T>, D, any>) : TypeT<D> {
	return {
		get(s: _stream, obj: any)	{ return make(maker, read(s, type), obj); },
		put(s: _stream, v: D)		{ write(s, type, v); }
	};
}

export class hex<T extends number | bigint> {
	constructor(public value: T) {}
	valueOf()	{ return this.value; }
	toString()	{ return '0x' + this.value.toString(16); }
};

export function asHex<T extends TypeT<number | bigint>>(type: T) {
	return as(type, hex);
}

export function asInt<T extends TypeT<string>>(type: T, radix = 10) {
	return as(type, x => parseInt(x.trim(), radix));
}

export function asFixed<T extends TypeT<number>>(type: T, fracbits: number) {
	const scale = 1 / (1 << fracbits);
	return as(type, x => x * scale);
}

// enum types

export type EnumType = {
	[key: string]:	string | number;
	[value: number]: string;
} | {[key: string]:	number};

export function EnumV<T extends EnumType>(_: T) {
	return (x: number) => x as T[keyof T] & number;
}

export function Enum(e: EnumType) {
	const e1 = (Object.entries(e).filter(([, v]) => typeof v === 'number') as [string, number][]).sort(([, v1], [, v2]) => v2 - v1);
	const e2 = Object.fromEntries(e1.map(([k, v]) => [v, k]));

	function split_enum(x: number) {
		const results: string[] = [];
		for (const k of e1) {
			if (k[1] === 0) {
				if (x == 0)
					return k[0];
				break;
			}
			const n = Math.floor(x / k[1]);
			if (n) {
				results.push(n > 1 ? `${k[0]}*${n}` : k[0]);
				x %= k[1];
				if (!x)
					break;
			}
		}
		if (results.length == 0)
			return x.toString();

		if (x)
			results.push(x.toString());
		return results.join('+');
	}
	
	return (x: number | bigint) => e2[Number(x)] ?? split_enum(Number(x));
}

export function Flags(e: EnumType, noFalse: boolean) {
	const e1 = Object.entries(e).filter(([, v]) => typeof v === 'number') as [string, number][];

	return (x: number | bigint) => typeof x === 'bigint'
	?	e1.reduce((obj, [k, v]) => {
		const y = x & BigInt(v);
		if (y || !noFalse)
			obj[k] = !utils.isPow2(v) ? y / BigInt(utils.lowestSet(v)) : !!y;
		return obj;
	}, {} as Record<string, bigint | boolean>)
	:	e1.reduce((obj, [k, v]) => {
		const y = x & v;
		if (y || !noFalse)
			obj[k] = !utils.isPow2(v) ? y / utils.lowestSet(v) : !!y;
		return obj;
	}, {} as Record<string, number | boolean>);

}

export type BitField<D> = [number, ClassOrFactory<number, D>];

export function BitFields<T extends Record<string, number | BitField<any>>>(bitfields: T) {
	return <V extends number | bigint>(x: V): {[K in keyof T]: T[K] extends BitField<infer D> ? D : V;} => {
		if (typeof x === 'bigint') {
			let y: bigint = x;
			const obj = {} as Record<string, bigint>;
			for (const i in bitfields) {
				const bf	= bitfields[i];
				const bits	= typeof bf === 'number' ? bf : bf[0];
				const v		= y & ((1n << BigInt(bits)) - 1n);
				y >>= BigInt(bits);
				obj[i] = typeof bf === 'number' ? v : make(bf[1], Number(v));
			}
			return obj as any;
		} else {
			const obj = {} as Record<string, number>;
			let y: number = x;
			for (const i in bitfields) {
				const bf	= bitfields[i];
				const bits	= typeof bf === 'number' ? bf : bf[0];
				const v		= y & ((1 << bits) - 1);
				y >>= bits;
				obj[i] = typeof bf === 'number' ? v : make(bf[1], v);
			}
			return obj as any;
		}
	};
}

//shortcuts
export function asEnum<T extends TypeT<number | bigint>, E extends EnumType>(type: T, e: E) {
	return as(type, Enum(e));
}
export function asFlags<T extends TypeT<number | bigint>, E extends EnumType>(type: T, e: E, noFalse = true) {
	return as(type, Flags(e, noFalse));
}

//-----------------------------------------------------------------------------
//	memory utilities
//-----------------------------------------------------------------------------

export interface memory {
	length?: bigint;
	get(address: bigint, len: number): Uint8Array | Promise<Uint8Array>;
}

export const enum MEM {
	NONE     	= 0,	// No permissions
	READ     	= 1,	// Read permission
	WRITE    	= 2,	// Write permission
	EXECUTE  	= 4,	// Execute permission
	RELATIVE	= 8,	// address is relative to dll base
}
export class MappedMemory {
	constructor(public data: Uint8Array, public address: number, public flags: number) {}
	resolveAddress(_base: number)		{ return this.address; }
	slice(begin: number, end?: number)	{ return new MappedMemory(this.data.subarray(begin, end), this.address + begin, this.flags); }
	at(begin: number, length?: number)	{ return this.slice(begin - this.address, length && (begin - this.address + length)); }
}
