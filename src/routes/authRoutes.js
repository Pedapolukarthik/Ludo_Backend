const express = require('express');
const router = express.Router();
const { googleAuth, getMe } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

router.post('/google', authLimiter, googleAuth);
router.get('/me', protect, getMe);

module.exports = router;
