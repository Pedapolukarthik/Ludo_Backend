const express = require('express');
const router = express.Router();
const {
  getAnalytics,
  listUsers,
  toggleBanUser,
  adjustCoins,
  broadcastNotification,
  getActiveMatches,
  getMatchHistory,
  updateTournament,
  deleteTournament,
  getSystemConfigs,
  updateSystemConfig,
  exportUsers
} = require('../controllers/adminController');
const { protect, admin } = require('../middlewares/authMiddleware');

router.get('/analytics', protect, admin, getAnalytics);
router.get('/users', protect, admin, listUsers);
router.get('/users/export', protect, admin, exportUsers);
router.put('/users/:id/ban', protect, admin, toggleBanUser);
router.put('/users/:id/reward', protect, admin, adjustCoins);
router.post('/broadcast', protect, admin, broadcastNotification);

// New match monitoring and tournament management routes
router.get('/matches/active', protect, admin, getActiveMatches);
router.get('/matches/history', protect, admin, getMatchHistory);
router.put('/tournaments/:id', protect, admin, updateTournament);
router.delete('/tournaments/:id', protect, admin, deleteTournament);

// Configuration management
router.get('/config', protect, admin, getSystemConfigs);
router.put('/config', protect, admin, updateSystemConfig);

module.exports = router;
