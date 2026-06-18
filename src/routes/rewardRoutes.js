const express = require('express');
const router = express.Router();
const { claimDailyReward, claimSpinWheel, claimAdSpinWheel, getDailyMissions } = require('../controllers/rewardController');
const { protect } = require('../middlewares/authMiddleware');
const { rewardLimiter } = require('../middlewares/rateLimiter');

router.post('/daily', protect, rewardLimiter, claimDailyReward);
router.post('/spin', protect, rewardLimiter, claimSpinWheel);
router.post('/spin-ad', protect, rewardLimiter, claimAdSpinWheel);
router.get('/missions', protect, getDailyMissions);

module.exports = router;
