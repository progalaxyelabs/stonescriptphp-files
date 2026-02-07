# @progalaxyelabs/stonescriptphp-files — High Level Design

**Version**: 1.0.0
**Last Updated**: 2026-02-07

## Overview

A shared npm package that provides a ready-to-use Express file server with Azure Blob Storage and JWT authentication.

### Developer Experience
```bash
mkdir files && cd files
npm init -y
npm i express @progalaxyelabs/stonescriptphp-files
```

```js
// index.js
import 'dotenv/config';
import { createFilesServer } from '@progalaxyelabs/stonescriptphp-files';
createFilesServer().listen();
```

## Architecture

### Package Exports

```
@progalaxyelabs/stonescriptphp-files
├── createFilesServer(config?)    // Factory: returns configured Express app
├── AzureStorageClient            // Class: Azure Blob Storage operations
├── createAuthMiddleware          // Middleware factory: JWT Bearer token validation
├── createUploadRouter            // Express Router factory: POST /upload
├── createDownloadRouter          // Express Router factory: GET /files/:id
├── createListRouter              // Express Router factory: GET /files
├── createDeleteRouter            // Express Router factory: DELETE /files/:id
└── createHealthRouter            // Express Router factory: GET /health
```

### `createFilesServer(config?)` Factory

```js
createFilesServer({
  port: process.env.PORT || 3000,
  containerName: process.env.AZURE_CONTAINER_NAME || 'platform-files',
  azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  jwtPublicKey: process.env.JWT_PUBLIC_KEY,
  maxFileSize: 100 * 1024 * 1024,  // 100MB default
  corsOrigins: '*',
});
```

All config is optional — defaults to environment variables so the minimal setup works with zero arguments.

### Request Flow

```
Client
  │
  ├─ POST /upload (multipart/form-data)
  │   → JWT auth middleware
  │   → multer (memory storage)
  │   → AzureStorageClient.uploadFile()
  │   → Returns { success, file: { id, name, size, contentType, uploadedAt } }
  │
  ├─ GET /files/:id
  │   → JWT auth middleware
  │   → AzureStorageClient.downloadFile()
  │   → Streams blob to response (Content-Type, Content-Disposition)
  │
  ├─ GET /files
  │   → JWT auth middleware
  │   → AzureStorageClient.listFiles(userId)
  │   → Returns { success, count, files: [...] }
  │
  ├─ DELETE /files/:id
  │   → JWT auth middleware
  │   → AzureStorageClient.deleteFile()
  │   → Returns { success, message }
  │
  └─ GET /health
      → No auth
      → Returns { status: "healthy", service: "files-service", timestamp }
```

## Components

### createFilesServer (factory)
Main export. Creates and returns a configured Express app with all routes, middleware, and graceful shutdown. Accepts optional config object, defaults to env vars.

### AzureStorageClient (class)
Wraps `@azure/storage-blob` SDK. Methods: `initialize()`, `uploadFile(userId, buffer, filename, contentType)`, `downloadFile(fileId, userId)`, `listFiles(userId)`, `deleteFile(fileId, userId)`. Auto-creates container on init with private access.

### createAuthMiddleware (middleware factory)
Express middleware factory. Validates Bearer token, extracts user identity from standard JWT claims (`sub`, `user_id`, `userId`, `id`), attaches to `req.user`. Supports RS256/ES256/HS256.

### Route handlers (router factories)
Express Router factory functions for upload, download, list, delete, health. Can be used individually for custom mounting or composed via `createFilesServer`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 24+ |
| Framework | Express 5.x (peerDependency) |
| Language | JavaScript (ESM) |
| Storage | Azure Blob Storage (`@azure/storage-blob` ^12.24.0) |
| Auth | JWT (`jsonwebtoken` ^9.0.2) |
| Upload | `multer` ^1.4.5-lts.1 |
| Module type | ESM (`"type": "module"`) |

## Storage Design

- **SDK:** `@azure/storage-blob` v12.x
- **Auth:** Connection string (env var)
- **Container:** auto-created on startup with private access
- **Blob path:** `{userId}/{uuid}.{extension}`
- **Metadata:** original_name, user_id, content_type, uploaded_at, file_id

## JWT Authentication

- **Algorithms:** RS256, ES256, HS256
- **Token source:** `Authorization: Bearer <token>` header
- **User ID extraction:** `sub` | `user_id` | `userId` | `id` claim
- **Ownership:** files are scoped to the authenticated user's ID
- **Health endpoint:** excluded from auth
- **Role-based auth:** optional `requireRole()` middleware export

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | — | Azure Storage connection string |
| `AZURE_CONTAINER_NAME` | No | `platform-files` | Blob container name |
| `JWT_PUBLIC_KEY` | Yes | — | Public key for JWT verification |
| `PORT` | No | `3000` | Server listen port |

## Requirements

### Functional
- Upload files via multipart/form-data to Azure Blob Storage
- Download files with ownership verification and proper headers
- List all files belonging to the authenticated user
- Delete files with ownership verification
- JWT Bearer token authentication on all file operations
- Health check endpoint (unauthenticated)
- Auto-create Azure Blob container on startup
- Graceful shutdown on SIGTERM/SIGINT
- 100MB default file size limit (configurable)
- CORS support (configurable origins)

### Non-Functional
- Zero-config startup (all settings from env vars)
- No platform-specific code — fully generic and reusable
- ESM module (`"type": "module"`)
- Node.js 24+ engine requirement
- Express 5.x as peer dependency

### Developer Experience
- Setup in 3 commands: `npm init`, `npm i express @progalaxyelabs/stonescriptphp-files`, create index.js
- Consumer service has only 2 dependencies: `express` and this package
- All config via env vars with sensible defaults
- Composable exports for advanced/custom usage

## Constraints

- Must work with any JWT issuer (RS256/ES256/HS256)
- No breaking changes to Docker environment variables
- Published to npm as `@progalaxyelabs/stonescriptphp-files` (scoped, public)
- Source: https://github.com/progalaxyelabs/stonescriptphp-files
