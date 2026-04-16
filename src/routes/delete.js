import express from 'express';

/**
 * Delete file router factory.
 *
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @param {Object} [hooks={}] - Plugin hooks
 * @param {Function} [hooks.resolveTenant] - (req, user) => blobPrefix string
 * @returns {express.Router}
 */
export function createDeleteRouter(storage, hooks = {}) {
  const router = express.Router();

  router.delete('/files/:id', async (req, res) => {
    try {
      const fileId = req.params.id;
      const user = req.user;
      const userId = user.id;
      const tenantId = user.tenantId;
      const scope = req.fileScope || 'user';

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(fileId)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid file ID format' });
      }

      const blobPrefix = hooks.resolveTenant
        ? await hooks.resolveTenant(req, user)
        : null;

      await storage.deleteFile(fileId, tenantId, userId, scope, blobPrefix);

      res.status(200).json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete error:', error);

      if (error.message === 'File not found') {
        return res.status(404).json({ error: 'Not Found', message: 'File not found' });
      }

      if (error.message.startsWith('Unauthorized:')) {
        return res.status(403).json({ error: 'Forbidden', message: error.message });
      }

      if (error.statusCode === 503) {
        return res.status(503).json({ error: 'Service Unavailable', message: error.message });
      }

      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete file' });
    }
  });

  return router;
}
