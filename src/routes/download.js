import express from 'express';

/**
 * Download router factory.
 *
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @param {Object} [hooks={}] - Plugin hooks
 * @param {Function} [hooks.resolveTenant] - (req, user) => blobPrefix string
 * @param {Function} [hooks.onDownload]    - async (meta) => void  (called after successful download)
 * @returns {express.Router}
 */
export function createDownloadRouter(storage, hooks = {}) {
  const router = express.Router();

  router.get('/files/:id', async (req, res) => {
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

      const { stream, metadata } = await storage.downloadFile(fileId, tenantId, userId, scope, blobPrefix);

      // Call onDownload hook (non-blocking)
      if (hooks.onDownload) {
        try {
          await hooks.onDownload({ fileId, userId, tenantId, ...metadata, req });
        } catch (hookErr) {
          console.error('onDownload hook error (non-fatal):', hookErr.message);
        }
      }

      res.setHeader('Content-Type', metadata.contentType);
      res.setHeader('Content-Length', metadata.size);
      res.setHeader('Content-Disposition', `attachment; filename="${metadata.fileName}"`);

      stream.pipe(res);

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'Failed to stream file' });
        }
      });
    } catch (error) {
      console.error('Download error:', error);

      if (error.message === 'File not found') {
        return res.status(404).json({ error: 'Not Found', message: 'File not found' });
      }

      if (error.message.startsWith('Unauthorized:')) {
        return res.status(403).json({ error: 'Forbidden', message: error.message });
      }

      if (error.statusCode === 503) {
        return res.status(503).json({ error: 'Service Unavailable', message: error.message });
      }

      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to download file' });
    }
  });

  return router;
}
