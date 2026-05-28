const express = require('express');
const router = express.Router();
const { googleAuth, getMe } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/google', googleAuth);
router.get('/me', protect, getMe);

module.exports = router;
