# @isopodlabs/binary

This package provides a set of utilities for reading and writing binary data in TypeScript.

## Usage

Here is a basic example of how to use the package:

```typescript
import * as binary from '@isopodlabs/binary';

// Define an object to specify how to read a structure
const StructSpec = {
    // Define your structure here
};

// Create a new stream from a Uint8Array
const data = new Uint8Array([/* binary data */]);
const stream = new binary.stream(data);

// Read data from the stream
const myData = binary.read(stream, StructSpec);

// Create a new stream for output
const stream2 = new binary.growingStream;

// Write data back to a stream
binary.write(stream2, myData);

// Extract written data as a Uint8Array
const data2 = stream2.terminate();

```

## Key Features

- **Interfaces**: 
  - `_stream`: Base interface for stream handling.
  - `TypeReaderT`, `TypeWriterT`, `TypeT`: Types for reading and writing binary data.
  - `ReadType`: Type for reading structured data.

- **Functions**:
  - `ReadStruct`: Create a reader for a specific structure.
  - `WriteStruct`: Create a writer for a specific structure.
  - `read`, `write`: Functions for reading and writing binary data.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.