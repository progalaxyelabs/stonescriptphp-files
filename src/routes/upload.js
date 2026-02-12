import express from 'express';
import multer from 'multer';

/**
 * Upload router factory
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @param {number} maxFileSize - Maximum file size in bytes (default: 100MB)
 * @returns {express.Router} Express router for upload endpoint
 */
export function createUploadRouter(storage, maxFileSize = 100 * 1024 * 1024) {
  const router = express.Router();

  // Configure multer for memory storage (files stored in RAM before Azure upload)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize,
      files: 1 // Single file upload
    },
    fileFilter: (req, file, cb) => {
      // Optional: Add file type validation here
      // For now, accept all file types
      cb(null, true);
    }
  });

  /**
   * POST /upload
   * Upload file to Azure Blob Storage
   * Requires: JWT authentication (applied by parent app)
   * Body: multipart/form-data with 'file' field
   */
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      // Validate file was uploaded
      if (!req.file) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'No file uploaded'
        });
      }

      const userId = req.user.id;
      const tenantId = req.user.tenantId;
      const { buffer, originalname, mimetype } = req.file;

      // Upload to Azure Blob Storage
      const fileMetadata = await storage.uploadFile(tenantId, userId, buffer, originalname, mimetype);

      // Build response
      const fileResponse = {
        id: fileMetadata.fileId,
        name: fileMetadata.originalFilename,
        contentType: fileMetadata.contentType,
        size: fileMetadata.size,
        uploadedAt: fileMetadata.uploadedAt
      };

      // Include tenantId in response if present
      if (tenantId) {
        fileResponse.tenantId = tenantId;
      }

      // Return success response
      res.status(201).json({
        success: true,
        file: fileResponse
      });
    } catch (error) {
      console.error('Upload error:', error);

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Payload Too Large',
          message: `File size exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit`
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
        message: 'Failed to upload file'
      });
    }
  });

  return router;
}
