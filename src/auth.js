import jwt from 'jsonwebtoken';

/**
 * JWT validation middleware factory
 * Creates a middleware that validates JWT tokens and extracts user_id for authorization
 *
 * @param {string} publicKey - JWT public key for token verification (RS256/ES256/HS256)
 * @returns {Function} Express middleware function
 */
export function createAuthMiddleware(publicKey) {
  if (!publicKey) {
    throw new Error('JWT public key is required');
  }

  return function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Verify token with public key
      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256', 'ES256', 'HS256']
      });

      // Extract user_id from token
      // Common JWT claims: sub, user_id, userId, id
      const userId = decoded.sub || decoded.user_id || decoded.userId || decoded.id;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token missing user identifier'
        });
      }

      // Attach user info to request
      req.user = {
        id: userId,
        email: decoded.email,
        roles: decoded.roles || [],
        ...decoded
      };

      next();
    } catch (error) {
      console.error('JWT validation error:', error.message);

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token expired'
        });
      }

      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token'
        });
      }

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token validation failed'
      });
    }
  };
}

/**
 * Optional: Role-based authorization middleware factory
 * Use after authenticateJWT to check for specific roles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const userRoles = req.user.roles || [];
    const hasRole = allowedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
}
