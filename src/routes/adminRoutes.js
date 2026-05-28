const express = require('express');
const router = express.Router();
const {
  getAnalytics,
  listUsers,
  toggleBanUser,
  adjustCoins,
  broadcastNotification
} = require('../controllers/adminController');
const { protect, admin } = require('../middlewares/authMiddleware');

router.get('/analytics', protect, admin, getAnalytics);
router.get('/users', protect, admin, listUsers);
router.put('/users/:id/ban', protect, admin, toggleBanUser);
router.put('/users/:id/reward', protect, admin, adjustCoins);
router.post('/broadcast', protect, admin, broadcastNotification);

module.exports = router;
