import jwt from 'jsonwebtoken';

const ALLOWED_ALGORITHMS = ['RS256', 'ES256'];

/**
 * JWT validation middleware factory (public key / PEM).
 * Creates a middleware that validates JWT tokens using an asymmetric public key.
 *
 * Only RS256 and ES256 are accepted. HS256 and alg=none are explicitly rejected.
 *
 * @param {string} publicKey - PEM-encoded RSA or EC public key
 * @param {Object} [options]
 * @param {string} [options.issuer]   - Expected JWT issuer (JWT_ISSUER env var). Required when set.
 * @param {string} [options.audience] - Expected JWT audience (JWT_AUDIENCE env var). Required when set.
 * @returns {Function} Express middleware function
 */
export function createAuthMiddleware(publicKey, options = {}) {
  if (!publicKey) {
    throw new Error('JWT public key is required');
  }

  const issuer  = options.issuer   || process.env.JWT_ISSUER   || undefined;
  const audience = options.audience || process.env.JWT_AUDIENCE || undefined;

  return function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Reject alg=none and any other unexpected algorithm before verification
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Malformed token' });
      }
      if (!ALLOWED_ALGORITHMS.includes(decoded.header.alg)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: `Token algorithm '${decoded.header.alg}' is not allowed. Only RS256 and ES256 are accepted.`
        });
      }
    } catch (_) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Malformed token' });
    }

    try {
      const verifyOptions = {
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: 60  // 60 seconds maximum clock skew
      };
      if (issuer)   verifyOptions.issuer   = issuer;
      if (audience) verifyOptions.audience = audience;

      const decoded = jwt.verify(token, publicKey, verifyOptions);

      // Extract user_id from token — common JWT claims
      const userId = decoded.sub || decoded.user_id || decoded.userId || decoded.id;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token missing user identifier'
        });
      }

      const tenantId = decoded.tenant_id || decoded.tid || decoded.tenant_uuid || null;

      req.user = {
        id: userId,
        tenantId,
        email: decoded.email,
        roles: decoded.roles || [],
        ...decoded
      };

      next();
    } catch (error) {
      console.error('JWT validation error:', error.message);

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Token expired' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
      }
      return res.status(401).json({ error: 'Unauthorized', message: 'Token validation failed' });
    }
  };
}

/**
 * JWKS-based JWT validation middleware factory.
 * Creates a middleware that validates JWT tokens using JWKS (JSON Web Key Sets).
 *
 * Only RS256 and ES256 are accepted. HS256 and alg=none are explicitly rejected.
 *
 * @param {JwksClient} jwksClient - JWKS client instance for key retrieval
 * @param {Object} [options]
 * @param {string} [options.issuer]   - Expected JWT issuer (JWT_ISSUER env var)
 * @param {string} [options.audience] - Expected JWT audience (JWT_AUDIENCE env var)
 * @returns {Function} Express middleware function
 */
export function createJwksAuthMiddleware(jwksClient, options = {}) {
  if (!jwksClient) {
    throw new Error('JWKS client is required');
  }

  const issuer   = options.issuer   || process.env.JWT_ISSUER   || undefined;
  const audience = options.audience || process.env.JWT_AUDIENCE || undefined;

  return async function authenticateJwks(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Reject disallowed algorithms before JWKS lookup
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Malformed token' });
      }
      if (!ALLOWED_ALGORITHMS.includes(decoded.header.alg)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: `Token algorithm '${decoded.header.alg}' is not allowed. Only RS256 and ES256 are accepted.`
        });
      }
    } catch (_) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Malformed token' });
    }

    try {
      const { key, algorithm } = await jwksClient.getSigningKey(token);

      // Double-check algorithm returned by JWKS client is still allowed
      if (!ALLOWED_ALGORITHMS.includes(algorithm)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: `Token algorithm '${algorithm}' is not allowed. Only RS256 and ES256 are accepted.`
        });
      }

      const verifyOptions = {
        algorithms: [algorithm],
        clockTolerance: 60  // 60 seconds maximum clock skew
      };
      if (issuer)   verifyOptions.issuer   = issuer;
      if (audience) verifyOptions.audience = audience;

      const decoded = jwt.verify(token, key, verifyOptions);

      const userId = decoded.sub || decoded.user_id || decoded.userId || decoded.id;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token missing user identifier'
        });
      }

      const tenantId = decoded.tenant_id || decoded.tid || decoded.tenant_uuid || null;

      req.user = {
        id: userId,
        tenantId,
        email: decoded.email,
        roles: decoded.roles || [],
        ...decoded
      };

      next();
    } catch (error) {
      console.error('JWKS JWT validation error:', error.message);

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Token expired' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
      }
      return res.status(401).json({ error: 'Unauthorized', message: 'Token validation failed' });
    }
  };
}

/**
 * Optional: Role-based authorization middleware factory.
 * Use after authentication middleware to restrict access to specific roles.
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    }

    const userRoles = req.user.roles || [];
    const hasRole = allowedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient permissions' });
    }

    next();
  };
}
