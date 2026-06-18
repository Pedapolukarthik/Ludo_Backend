const rateLimit = require('express-rate-limit');

// Rate limiter for authentication endpoints
// Max 30 requests per 15 minutes per IP to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for rewards endpoints to prevent spamming/exploitation
// Max 10 requests per minute per IP
const rewardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    message: 'Too many reward claims from this IP, please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  rewardLimiter
};
