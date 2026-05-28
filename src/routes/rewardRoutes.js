const express = require('express');
const router = express.Router();
const { claimDailyReward, claimSpinWheel } = require('../controllers/rewardController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/daily', protect, claimDailyReward);
router.post('/spin', protect, claimSpinWheel);

module.exports = router;
