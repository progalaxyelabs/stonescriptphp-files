# @progalaxyelabs/stonescriptphp-files

Zero-config Express file server with Azure Blob Storage and JWT authentication

## Installation

```bash
npm install express @progalaxyelabs/stonescriptphp-files
```

## Quick Start

```javascript
import { createFilesServer } from '@progalaxyelabs/stonescriptphp-files';

// Zero-config setup (uses environment variables)
createFilesServer().listen();
```

## Environment Variables

```bash
AZURE_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_CONTAINER_NAME=platform-files  # optional, defaults to 'platform-files'
JWT_PUBLIC_KEY=your_jwt_public_key
PORT=3000  # optional, defaults to 3000
```

## Advanced Configuration

```javascript
import { createFilesServer } from '@progalaxyelabs/stonescriptphp-files';

const server = createFilesServer({
  port: 3000,
  containerName: 'my-files',
  azureConnectionString: 'your_connection_string',
  jwtPublicKey: 'your_public_key',
  maxFileSize: 100 * 1024 * 1024,  // 100MB
  corsOrigins: '*'  // or ['https://example.com']
});

server.listen();
```

## API Endpoints

### POST /upload
Upload a file (requires JWT authentication)

**Request:** multipart/form-data with `file` field
**Response:**
```json
{
  "success": true,
  "file": {
    "id": "uuid-here",
    "name": "filename.pdf",
    "contentType": "application/pdf",
    "size": 12345,
    "uploadedAt": "2025-02-07T12:00:00.000Z"
  }
}
```

### GET /files/:id
Download a file (requires JWT authentication, validates ownership)

### GET /files
List all files for authenticated user

### DELETE /files/:id
Delete a file (requires JWT authentication, validates ownership)

### GET /health
Health check endpoint (no authentication required)

## Composable Usage

```javascript
import express from 'express';
import {
  AzureStorageClient,
  createAuthMiddleware,
  createUploadRouter,
  createDownloadRouter
} from '@progalaxyelabs/stonescriptphp-files';

const app = express();
const storage = new AzureStorageClient(connectionString, containerName);
const authenticate = createAuthMiddleware(publicKey);

await storage.initialize();

app.use(authenticate, createUploadRouter(storage));
app.use(authenticate, createDownloadRouter(storage));

app.listen(3000);
```

## Features

- ✅ Azure Blob Storage integration
- ✅ JWT Bearer token authentication (RS256/ES256/HS256)
- ✅ File ownership validation
- ✅ Streaming uploads and downloads
- ✅ Configurable file size limits
- ✅ CORS support
- ✅ Graceful shutdown handling
- ✅ Health check endpoint
- ✅ ESM module support

## Requirements

- Node.js >=24.0.0
- Express ^5.0.0 (peer dependency)

## License

MIT
