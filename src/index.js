import express from 'express';
import cors from 'cors';
import { AzureStorageClient } from './azure-storage.js';
import { createAuthMiddleware } from './auth.js';
import { createUploadRouter } from './routes/upload.js';
import { createDownloadRouter } from './routes/download.js';
import { createListRouter } from './routes/list.js';
import { createDeleteRouter } from './routes/delete.js';
import { createHealthRouter } from './routes/health.js';

/**
 * Create a configured files server
 * @param {Object} config - Configuration options
 * @param {number} config.port - Server port (default: process.env.PORT || 3000)
 * @param {string} config.containerName - Azure container name (default: process.env.AZURE_CONTAINER_NAME || 'platform-files')
 * @param {string} config.azureConnectionString - Azure storage connection string (default: process.env.AZURE_STORAGE_CONNECTION_STRING)
 * @param {string} config.jwtPublicKey - JWT public key for auth (default: process.env.JWT_PUBLIC_KEY)
 * @param {number} config.maxFileSize - Max file size in bytes (default: 100MB)
 * @param {string|string[]} config.corsOrigins - CORS allowed origins (default: '*')
 * @returns {Object} Server object with app, storage, and listen() method
 */
export function createFilesServer(config = {}) {
  const port = config.port || process.env.PORT || 3000;
  const containerName = config.containerName || process.env.AZURE_CONTAINER_NAME || 'platform-files';
  const connectionString = config.azureConnectionString || process.env.AZURE_STORAGE_CONNECTION_STRING;
  const jwtPublicKey = config.jwtPublicKey || process.env.JWT_PUBLIC_KEY;
  const maxFileSize = config.maxFileSize || 100 * 1024 * 1024;
  const corsOrigins = config.corsOrigins || '*';

  // Create storage client
  const storage = new AzureStorageClient(connectionString, containerName);

  // Create auth middleware
  const authenticate = createAuthMiddleware(jwtPublicKey);

  // Create Express app
  const app = express();

  // Configure CORS
  app.use(cors({ origin: corsOrigins }));

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  // Routes
  app.use(createHealthRouter());
  app.use(authenticate, createUploadRouter(storage, maxFileSize));
  app.use(authenticate, createDownloadRouter(storage));
  app.use(authenticate, createListRouter(storage));
  app.use(authenticate, createDeleteRouter(storage));

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested endpoint does not exist'
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
  });

  // Server object with listen method
  const server = {
    app,
    storage,
    listen: () => {
      return storage.initialize().then(() => {
        const httpServer = app.listen(port, () => {
          console.log(`Files server listening on port ${port}`);
          console.log(`Health check: http://localhost:${port}/health`);
        });

        // Graceful shutdown
        const shutdown = () => {
          console.log('Shutting down gracefully...');
          httpServer.close(() => {
            console.log('Server closed');
            process.exit(0);
          });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

        return httpServer;
      });
    }
  };

  return server;
}

// Named exports for advanced/composable usage
export { AzureStorageClient } from './azure-storage.js';
export { createAuthMiddleware } from './auth.js';
export { createUploadRouter } from './routes/upload.js';
export { createDownloadRouter } from './routes/download.js';
export { createListRouter } from './routes/list.js';
export { createDeleteRouter } from './routes/delete.js';
export { createHealthRouter } from './routes/health.js';
