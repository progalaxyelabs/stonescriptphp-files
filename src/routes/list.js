import express from 'express';

/**
 * List files router factory.
 *
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @param {Object} [hooks={}] - Plugin hooks
 * @param {Function} [hooks.resolveTenant] - (req, user) => blobPrefix string
 * @returns {express.Router}
 */
export function createListRouter(storage, hooks = {}) {
  const router = express.Router();

  router.get('/files', async (req, res) => {
    try {
      const user = req.user;
      const userId = user.id;
      const tenantId = user.tenantId;
      const scope = req.fileScope || 'user';

      const blobPrefix = hooks.resolveTenant
        ? await hooks.resolveTenant(req, user)
        : null;

      const files = await storage.listFiles(tenantId, userId, scope, blobPrefix);

      res.status(200).json({ success: true, count: files.length, files });
    } catch (error) {
      console.error('List files error:', error);

      if (error.statusCode === 503) {
        return res.status(503).json({ error: 'Service Unavailable', message: error.message });
      }

      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list files' });
    }
  });

  return router;
}
