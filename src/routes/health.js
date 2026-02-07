import express from 'express';

/**
 * Health check router factory
 * @returns {express.Router} Express router for health endpoint
 */
export function createHealthRouter() {
  const router = express.Router();

  /**
   * GET /health
   * Public health check endpoint (no authentication required)
   */
  router.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      service: 'files-service',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
