import express from 'express';

/**
 * Download router factory
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @returns {express.Router} Express router for download endpoint
 */
export function createDownloadRouter(storage) {
  const router = express.Router();

  /**
   * GET /files/:id
   * Download file from Azure Blob Storage
   * Requires: JWT authentication (applied by parent app)
   * Validates: User owns the file
   */
  router.get('/files/:id', async (req, res) => {
    try {
      const fileId = req.params.id;
      const userId = req.user.id;
      const tenantId = req.user.tenantId;

      // Validate file ID format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(fileId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid file ID format'
        });
      }

      // Download file from Azure (validates ownership)
      const { stream, metadata } = await storage.downloadFile(fileId, tenantId, userId);

      // Set response headers
      res.setHeader('Content-Type', metadata.contentType);
      res.setHeader('Content-Length', metadata.size);
      res.setHeader('Content-Disposition', `attachment; filename="${metadata.fileName}"`);

      // Stream file to response
      stream.pipe(res);

      // Handle stream errors
      stream.on('error', (error) => {
        console.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to stream file'
          });
        }
      });
    } catch (error) {
      console.error('Download error:', error);

      if (error.message === 'File not found') {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File not found'
        });
      }

      if (error.message.startsWith('Unauthorized:')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message
        });
      }

      if (error.statusCode === 503) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to download file'
      });
    }
  });

  return router;
}
