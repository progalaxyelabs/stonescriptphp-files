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
 * Default resolveTenant hook: returns a user-scoped blob prefix.
 * tenantId is used when present, otherwise falls back to userId-only prefix.
 *
 * @param {import('express').Request} req
 * @param {{ id: string, tenantId: string|null }} user
 * @returns {string} blob prefix (with trailing slash)
 */
function defaultResolveTenant(req, user) {
  const { tenantId, id: userId } = user;
  return tenantId ? `${tenantId}/${userId}/` : `${userId}/`;
}

/**
 * Wrap a plugin authenticateRequest(req) hook into an Express middleware.
 * The hook must return { userId, tenantId?, ... } or throw on failure.
 *
 * @param {Function} authenticateRequest - (req) => Promise<{ userId, tenantId, ... }>
 * @returns {Function} Express middleware
 */
function wrapAuthHook(authenticateRequest) {
  return async (req, res, next) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || !user.userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'authenticateRequest hook returned no userId'
        });
      }
      req.user = {
        id: user.userId,
        tenantId: user.tenantId || null,
        ...user
      };
      next();
    } catch (error) {
      const status = error.statusCode || 401;
      return res.status(status).json({
        error: status === 403 ? 'Forbidden' : 'Unauthorized',
        message: error.message || 'Authentication failed'
      });
    }
  };
}

/**
 * Resolve auth middleware from config.
 * Priority: hooks.authenticateRequest > authServers > jwksUrl > jwtPublicKey
 * Falls back to a 503 pass-through when nothing is configured.
 *
 * @param {Object} config - createFilesServer config
 * @returns {Function} Express middleware
 */
function resolveAuthMiddleware(config) {
  // 1. Consumer-supplied hook (highest priority)
  if (config.hooks && config.hooks.authenticateRequest) {
    return wrapAuthHook(config.hooks.authenticateRequest);
  }

  const authServersJson = config.authServers || (process.env.AUTH_SERVERS ? JSON.parse(process.env.AUTH_SERVERS) : null);
  const jwksUrl = config.jwksUrl || process.env.JWKS_URL;
  const jwtPublicKey = config.jwtPublicKey || process.env.JWT_PUBLIC_KEY;
  const cacheTtl = config.jwksCacheTtl || parseInt(process.env.JWKS_CACHE_TTL) || 3600;

  const authOptions = {
    issuer:   config.jwtIssuer   || process.env.JWT_ISSUER   || undefined,
    audience: config.jwtAudience || process.env.JWT_AUDIENCE || undefined
  };

  if (authServersJson) {
    const jwksClient = new JwksClient(authServersJson.map(s => ({ ...s, cacheTtl })));
    return createJwksAuthMiddleware(jwksClient, authOptions);
  }

  if (jwksUrl) {
    const jwksClient = new JwksClient([{ issuer: '*', jwksUrl, cacheTtl }]);
    return createJwksAuthMiddleware(jwksClient, authOptions);
  }

  if (jwtPublicKey) {
    return createAuthMiddleware(jwtPublicKey, authOptions);
  }

  // No auth configured
  console.warn('⚠️  No authentication configured — all endpoints will fail with 503');
  return (req, res) => {
    res.status(503).json({ error: 'Service Unavailable', message: 'Authentication not configured' });
  };
}

/**
 * Create a configured files server.
 *
 * ## Environment variables (all optional — have sensible defaults)
 *
 * | Variable                         | Default          | Description                              |
 * |----------------------------------|------------------|------------------------------------------|
 * | `AZURE_STORAGE_CONNECTION_STRING`| —                | Azure Blob Storage connection string     |
 * | `BLOB_CONTAINER`                 | `files`          | Blob container name                      |
 * | `JWKS_URL`                       | —                | JWKS endpoint for JWT key retrieval      |
 * | `JWT_PUBLIC_KEY`                 | —                | PEM public key (alternative to JWKS_URL) |
 * | `JWT_ISSUER`                     | —                | Required JWT issuer claim                |
 * | `JWT_AUDIENCE`                   | —                | Required JWT audience claim              |
 * | `PORT`                           | `3000`           | HTTP listen port                         |
 * | `CORS_ORIGINS`                   | `*`              | Comma-separated allowed origins          |
 * | `LOG_LEVEL`                      | `info`           | Log verbosity (info / warn / error)      |
 * | `MAX_UPLOAD_BYTES`               | 104857600 (100MB)| Maximum upload size in bytes             |
 *
 * Legacy: `AZURE_CONTAINER_NAME` still accepted as fallback for `BLOB_CONTAINER`.
 *
 * ## Plugin hooks (all optional)
 *
 * Pass via `config.hooks`:
 *
 * ```js
 * createFilesServer({
 *   hooks: {
 *     // Replace built-in JWT auth entirely. Must return { userId, tenantId?, ... } or throw.
 *     authenticateRequest: async (req) => { ... },
 *
 *     // Return the blob prefix for this user/request. Default: "{tenantId}/{userId}/"
 *     resolveTenant: (req, user) => `${user.tenantId}/${user.id}/`,
 *
 *     // Called after a successful upload (errors are logged but don't fail the upload).
 *     onUpload: async (meta) => { await db.insertFileRecord(meta); },
 *
 *     // Called after a successful download.
 *     onDownload: async (meta) => { await db.logDownload(meta); },
 *   }
 * });
 * ```
 *
 * @param {Object} [config={}] - Configuration options (all optional, env vars as defaults)
 * @param {number}            [config.port]               - Server port
 * @param {string}            [config.containerName]      - Azure container name (BLOB_CONTAINER)
 * @param {string}            [config.azureConnectionString] - Azure connection string
 * @param {string}            [config.jwtPublicKey]       - PEM public key for JWT verification
 * @param {string}            [config.jwksUrl]            - Single JWKS URL
 * @param {Array}             [config.authServers]        - Array of { issuer, jwksUrl } entries
 * @param {number}            [config.jwksCacheTtl]       - JWKS cache TTL in seconds
 * @param {string}            [config.jwtIssuer]          - Expected JWT issuer
 * @param {string}            [config.jwtAudience]        - Expected JWT audience
 * @param {boolean}           [config.tenantScoped]       - Enable tenant-scoped isolation (default true)
 * @param {string}            [config.authorizationUrl]   - URL for per-request authorization checks
 * @param {number}            [config.authorizationTimeout] - Authorization timeout ms
 * @param {number}            [config.maxFileSize]        - Max upload bytes (MAX_UPLOAD_BYTES env)
 * @param {string|string[]}   [config.corsOrigins]        - CORS allowed origins (CORS_ORIGINS env)
 * @param {number}            [config.rateLimitWindowMs]  - Rate limit window ms
 * @param {number}            [config.rateLimitUpload]    - Max uploads per window
 * @param {number}            [config.rateLimitDownload]  - Max downloads per window
 * @param {Object}            [config.hooks]              - Plugin hooks (see above)
 * @returns {{ app: express.Application, storage: AzureStorageClient, listen: Function }}
 */
export function createFilesServer(config = {}) {
  const port = config.port || parseInt(process.env.PORT) || 3000;

  // BLOB_CONTAINER takes precedence; AZURE_CONTAINER_NAME kept for backward compat
  const containerName = config.containerName
    || process.env.BLOB_CONTAINER
    || process.env.AZURE_CONTAINER_NAME
    || 'files';

  const connectionString = config.azureConnectionString
    || process.env.AZURE_STORAGE_CONNECTION_STRING;

  const maxFileSize = config.maxFileSize
    || parseInt(process.env.MAX_UPLOAD_BYTES)
    || 100 * 1024 * 1024;  // 100MB

  // CORS_ORIGINS env: comma-separated list or '*'
  let corsOrigins = config.corsOrigins;
  if (!corsOrigins) {
    const raw = process.env.CORS_ORIGINS || '*';
    corsOrigins = raw.includes(',') ? raw.split(',').map(s => s.trim()) : raw;
  }

  const logLevel = process.env.LOG_LEVEL || 'info';

  // Hooks
  const hooks = config.hooks || {};
  // Merge in the default resolveTenant only if not supplied by consumer
  if (!hooks.resolveTenant) {
    hooks.resolveTenant = defaultResolveTenant;
  }

  const storage = new AzureStorageClient(connectionString, containerName);

  const authenticate = resolveAuthMiddleware(config);

  const authorizationUrl = config.authorizationUrl || process.env.AUTHORIZATION_URL || null;
  const authorizationTimeout = config.authorizationTimeout || parseInt(process.env.AUTHORIZATION_TIMEOUT) || 3000;
  const authorize = createAuthorizationMiddleware(authorizationUrl, authorizationTimeout);

  const { uploadLimiter, downloadLimiter } = createRateLimiters(config);

  const app = express();

  app.use(cors({ origin: corsOrigins }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging (respects LOG_LEVEL)
  if (logLevel !== 'error') {
    app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
      next();
    });
  }

  // Routes
  app.use(createHealthRouter());
  app.use(authenticate, authorize, uploadLimiter,  createUploadRouter(storage, maxFileSize, hooks));
  app.use(authenticate, authorize, downloadLimiter, createDownloadRouter(storage, hooks));
  app.use(authenticate, downloadLimiter,            createListRouter(storage, hooks));
  app.use(authenticate, authorize, downloadLimiter, createDeleteRouter(storage, hooks));

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'The requested endpoint does not exist' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
  });

  const server = {
    app,
    storage,
    listen: () => {
      return storage.initialize().then(() => {
        const httpServer = app.listen(port, () => {
          if (logLevel !== 'error') {
            console.log(`Files server listening on port ${port}`);
            console.log(`Health check: http://localhost:${port}/health`);
          }
        });

        const shutdown = () => {
          if (logLevel !== 'error') console.log('Shutting down gracefully...');
          httpServer.close(() => {
            if (logLevel !== 'error') console.log('Server closed');
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
