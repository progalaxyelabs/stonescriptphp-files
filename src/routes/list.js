import express from 'express';

/**
 * List files router factory
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @returns {express.Router} Express router for list endpoint
 */
export function createListRouter(storage) {
  const router = express.Router();

  /**
   * GET /files
   * List user's files from Azure Blob Storage
   * Requires: JWT authentication (applied by parent app)
   * Returns: Array of file metadata for current user
   */
  router.get('/files', async (req, res) => {
    try {
      const userId = req.user.id;
      const tenantId = req.user.tenantId;

      // List files for current user
      const files = await storage.listFiles(tenantId, userId);

      res.status(200).json({
        success: true,
        count: files.length,
        files: files
      });
    } catch (error) {
      console.error('List files error:', error);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list files'
      });
    }
  });

  return router;
}
