import express from 'express';

/**
 * Delete file router factory
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @returns {express.Router} Express router for delete endpoint
 */
export function createDeleteRouter(storage) {
  const router = express.Router();

  /**
   * DELETE /files/:id
   * Delete file from Azure Blob Storage
   * Requires: JWT authentication (applied by parent app)
   * Validates: User owns the file
   */
  router.delete('/files/:id', async (req, res) => {
    try {
      const fileId = req.params.id;
      const userId = req.user.id;

      // Validate file ID format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(fileId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid file ID format'
        });
      }

      // Delete file from Azure (validates ownership)
      await storage.deleteFile(fileId, userId);

      res.status(200).json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      console.error('Delete error:', error);

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

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to delete file'
      });
    }
  });

  return router;
}
