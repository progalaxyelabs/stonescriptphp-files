import rateLimit from 'express-rate-limit';

export function createRateLimiters(config = {}) {
  const windowMs = config.rateLimitWindowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
  const uploadMax = config.rateLimitUpload || parseInt(process.env.RATE_LIMIT_UPLOAD) || 10;
  const downloadMax = config.rateLimitDownload || parseInt(process.env.RATE_LIMIT_DOWNLOAD) || 60;

  const keyGenerator = (req) => req.user?.id || req.ip;

  const uploadLimiter = rateLimit({
    windowMs,
    max: uploadMax,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too Many Requests', message: 'Upload rate limit exceeded. Try again later.' }
  });

  const downloadLimiter = rateLimit({
    windowMs,
    max: downloadMax,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too Many Requests', message: 'Rate limit exceeded. Try again later.' }
  });

  return { uploadLimiter, downloadLimiter };
}
