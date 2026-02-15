import express from 'express';
import cors from 'cors';
import { AzureStorageClient } from './azure-storage.js';
import { createAuthMiddleware, createJwksAuthMiddleware } from './auth.js';
import { JwksClient } from './jwks-client.js';
import { createAuthorizationMiddleware } from './authorization.js';
import { createRateLimiters } from './rate-limit.js';
import { createUploadRouter } from './routes/upload.js';
import { createDownloadRouter } from './routes/download.js';
import { createListRouter } from './routes/list.js';
import { createDeleteRouter } from './routes/delete.js';
import { createHealthRouter } from './routes/health.js';

/**
 * Resolve the authentication middleware based on configuration priority.
 * Priority: authServers > jwksUrl > jwtPublicKey
 * If no auth is configured, returns a pass-through middleware that logs a warning.
 *
 * @param {Object} config - Configuration options
 * @returns {Function} Express middleware function for authentication
 */
function resolveAuthMiddleware(config) {
  const authServersJson = config.authServers || (process.env.AUTH_SERVERS ? JSON.parse(process.env.AUTH_SERVERS) : null);
  const jwksUrl = config.jwksUrl || process.env.JWKS_URL;
  const jwtPublicKey = config.jwtPublicKey || process.env.JWT_PUBLIC_KEY;
  const cacheTtl = config.jwksCacheTtl || parseInt(process.env.JWKS_CACHE_TTL) || 3600;

  if (authServersJson) {
    const jwksClient = new JwksClient(authServersJson.map(s => ({ ...s, cacheTtl })));
    return createJwksAuthMiddleware(jwksClient);
  }

  if (jwksUrl) {
    const jwksClient = new JwksClient([{ issuer: '*', jwksUrl, cacheTtl }]);
    return createJwksAuthMiddleware(jwksClient);
  }

  if (jwtPublicKey) {
    return createAuthMiddleware(jwtPublicKey);
  }

  // No auth configured - return pass-through middleware with warning
  console.warn('⚠️  No authentication configured — all endpoints will fail with 503');
  return (req, res, next) => {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Authentication not configured'
    });
  };
}

/**
 * Create a configured files server
 * @param {Object} config - Configuration options
 * @param {number} config.port - Server port (default: process.env.PORT || 3000)
 * @param {string} config.containerName - Azure container name (default: process.env.AZURE_CONTAINER_NAME || 'platform-files')
 * @param {string} config.azureConnectionString - Azure storage connection string (default: process.env.AZURE_STORAGE_CONNECTION_STRING)
 * @param {string} config.jwtPublicKey - JWT public key for auth (default: process.env.JWT_PUBLIC_KEY)
 * @param {Array} config.authServers - Array of auth server configs [{issuer, jwksUrl, cacheTtl?}]
 * @param {string} config.jwksUrl - Single JWKS URL for key retrieval
 * @param {number} config.jwksCacheTtl - JWKS cache TTL in seconds (default: 3600)
 * @param {boolean} config.tenantScoped - Enable tenant-scoped file isolation (default: true)
 * @param {string} config.authorizationUrl - URL for authorization checks (default: process.env.AUTHORIZATION_URL). When set, files service calls this URL before upload/download/delete.
 * @param {number} config.authorizationTimeout - Authorization request timeout in ms (default: 3000)
 * @param {number} config.maxFileSize - Max file size in bytes (default: 100MB)
 * @param {string|string[]} config.corsOrigins - CORS allowed origins (default: '*')
 * @param {number} config.rateLimitWindowMs - Rate limit window in ms (default: 60000)
 * @param {number} config.rateLimitUpload - Max uploads per window (default: 10)
 * @param {number} config.rateLimitDownload - Max downloads per window (default: 60)
 * @returns {Object} Server object with app, storage, and listen() method
 */
export function createFilesServer(config = {}) {
  const port = config.port || process.env.PORT || 3000;
  const containerName = config.containerName || process.env.AZURE_CONTAINER_NAME || 'platform-files';
  const connectionString = config.azureConnectionString || process.env.AZURE_STORAGE_CONNECTION_STRING;
  const maxFileSize = config.maxFileSize || 100 * 1024 * 1024;
  const corsOrigins = config.corsOrigins || '*';
  const tenantScoped = config.tenantScoped !== undefined ? config.tenantScoped : (process.env.TENANT_SCOPED !== 'false');

  // Create storage client
  const storage = new AzureStorageClient(connectionString, containerName);

  // Resolve auth middleware based on config priority
  const authenticate = resolveAuthMiddleware(config);

  // Resolve authorization middleware (optional — no-op when URL not set)
  const authorizationUrl = config.authorizationUrl || process.env.AUTHORIZATION_URL || null;
  const authorizationTimeout = config.authorizationTimeout || parseInt(process.env.AUTHORIZATION_TIMEOUT) || 3000;
  const authorize = createAuthorizationMiddleware(authorizationUrl, authorizationTimeout);

  // Create rate limiters
  const { uploadLimiter, downloadLimiter } = createRateLimiters(config);

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

  // Routes with rate limiters and optional authorization
  app.use(createHealthRouter());
  app.use(authenticate, authorize, uploadLimiter, createUploadRouter(storage, maxFileSize));
  app.use(authenticate, authorize, downloadLimiter, createDownloadRouter(storage));
  app.use(authenticate, downloadLimiter, createListRouter(storage));
  app.use(authenticate, authorize, downloadLimiter, createDeleteRouter(storage));

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
export { createAuthMiddleware, createJwksAuthMiddleware } from './auth.js';
export { createAuthorizationMiddleware } from './authorization.js';
export { JwksClient } from './jwks-client.js';
export { createRateLimiters } from './rate-limit.js';
export { createUploadRouter } from './routes/upload.js';
export { createDownloadRouter } from './routes/download.js';
export { createListRouter } from './routes/list.js';
export { createDeleteRouter } from './routes/delete.js';
export { createHealthRouter } from './routes/health.js';
