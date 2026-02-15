/**
 * Optional authorization middleware for stonescriptphp-files.
 *
 * When AUTHORIZATION_URL is configured, calls the platform API to check
 * if the current user is allowed to perform the file operation.
 * The API acts as an authorization oracle — it knows about business entities
 * and role hierarchies. The files service stays generic.
 *
 * When AUTHORIZATION_URL is NOT set, this is a no-op pass-through.
 */

/**
 * Create authorization middleware
 * @param {string|null} authorizationUrl - URL to call for auth checks (e.g., "http://api:9100/files/authorize")
 * @param {number} timeout - Request timeout in ms (default: 3000)
 * @returns {Function} Express middleware
 */
export function createAuthorizationMiddleware(authorizationUrl, timeout = 3000) {
  if (!authorizationUrl) {
    // No authorization configured — pass through (backwards compat)
    return (req, res, next) => {
      req.fileScope = 'user';
      next();
    };
  }

  console.log(`Authorization middleware enabled: ${authorizationUrl}`);

  return async (req, res, next) => {
    try {
      // Determine action from HTTP method + path
      let action;
      if (req.method === 'POST' && req.path === '/upload') {
        action = 'upload';
      } else if (req.method === 'GET' && req.path.startsWith('/files/')) {
        action = 'download';
      } else if (req.method === 'DELETE' && req.path.startsWith('/files/')) {
        action = 'delete';
      } else {
        // Not a file operation route (e.g., /health, /list) — pass through
        req.fileScope = 'user';
        return next();
      }

      // Build authorization request body
      const body = { action };

      if ((action === 'download' || action === 'delete') && req.params.id) {
        body.file_id = req.params.id;
      }

      if (action === 'upload') {
        body.resource_type = req.body?.resource_type || null;
        body.resource_id = req.body?.resource_id ? parseInt(req.body.resource_id) : null;
      }

      // Forward the user's JWT token
      const authHeader = req.headers.authorization;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(authorizationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorRaw = await response.json().catch(() => ({}));
        const errorBody = errorRaw.data || errorRaw;

        if (response.status === 403) {
          console.warn(`Authorization denied: user=${req.user?.id} action=${action} reason=${errorBody.reason || errorRaw.message || 'unknown'}`);
          return res.status(403).json({
            error: 'Forbidden',
            message: errorBody.reason || errorRaw.message || 'Access denied'
          });
        }

        console.error(`Authorization service error: status=${response.status} body=${JSON.stringify(errorBody)}`);
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Authorization service returned an error'
        });
      }

      const raw = await response.json();
      // Unwrap StoneScriptPHP {status, message, data} wrapper if present
      const authResult = raw.data || raw;

      if (!authResult.allowed) {
        console.warn(`Authorization denied: user=${req.user?.id} action=${action} reason=${authResult.reason || 'unknown'}`);
        return res.status(403).json({
          error: 'Forbidden',
          message: authResult.reason || 'Access denied'
        });
      }

      // Set scope on request for route handlers
      req.fileScope = authResult.scope || 'user';
      next();

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`Authorization timeout: url=${authorizationUrl} timeout=${timeout}ms`);
      } else {
        console.error(`Authorization error: ${error.message}`);
      }

      // Fail closed — deny access when authorization service is unavailable
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Authorization service unavailable'
      });
    }
  };
}
