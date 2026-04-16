import express from 'express';
import multer from 'multer';

/**
 * Upload router factory.
 *
 * @param {AzureStorageClient} storage - Azure storage client instance
 * @param {number} [maxFileSize=100MB] - Maximum file size in bytes
 * @param {Object} [hooks={}] - Plugin hooks
 * @param {Function} [hooks.resolveTenant] - (req, user) => blobPrefix string
 * @param {Function} [hooks.onUpload]      - async (meta) => void  (called after successful upload)
 * @returns {express.Router}
 */
export function createUploadRouter(storage, maxFileSize = 100 * 1024 * 1024, hooks = {}) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize, files: 1 },
    fileFilter: (req, file, cb) => cb(null, true)
  });

  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Bad Request', message: 'No file uploaded' });
      }

      const user = req.user;
      const userId = user.id;
      const tenantId = user.tenantId;
      const { buffer, originalname, mimetype } = req.file;

      // Resolve blob prefix via hook or fall back to scope-based default
      const blobPrefix = hooks.resolveTenant
        ? await hooks.resolveTenant(req, user)
        : null;

      const scope = req.fileScope || 'user';

      const fileMetadata = await storage.uploadFile(tenantId, userId, buffer, originalname, mimetype, scope, blobPrefix);

      // Call onUpload hook if provided (non-blocking — errors are logged but don't fail the request)
      if (hooks.onUpload) {
        try {
          await hooks.onUpload({ ...fileMetadata, req });
        } catch (hookErr) {
          console.error('onUpload hook error (non-fatal):', hookErr.message);
        }
      }

      const fileResponse = {
        id: fileMetadata.fileId,
        name: fileMetadata.originalFilename,
        contentType: fileMetadata.contentType,
        size: fileMetadata.size,
        uploadedAt: fileMetadata.uploadedAt
      };

      if (tenantId) {
        fileResponse.tenantId = tenantId;
      }

      res.status(201).json({ success: true, file: fileResponse });
    } catch (error) {
      console.error('Upload error:', error);

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Payload Too Large',
          message: `File size exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit`
        });
      }

      if (error.statusCode === 503) {
        return res.status(503).json({ error: 'Service Unavailable', message: error.message });
      }

      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to upload file' });
    }
  });

  return router;
}
