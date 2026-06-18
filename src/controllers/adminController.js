const User = require('../models/User');
const Match = require('../models/Match');
const Room = require('../models/Room');
const Tournament = require('../models/Tournament');
const { activeGames } = require('../sockets/gameSocket');
const { sendMulticastNotification } = require('../config/firebase');

/**
 * @desc    Get dashboard metrics & analytics
 * @route   GET /api/admin/analytics
 * @access  Private/Admin
 */
const getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const totalMatches = await Match.count();
    const totalActiveRooms = await Room.count({ where: { status: 'playing' } });
    
    // Aggregation of total coin balances
    const activeCoins = await User.sum('coins') || 0;

    res.status(200).json({
      success: true,
      analytics: {
        totalUsers,
        totalMatches,
        totalActiveRooms,
        activeCoinsInEconomy: activeCoins,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    List all users (paginated)
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
const listUsers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const total = await User.count();
    const users = await User.findAll({
      offset: (page - 1) * limit,
      limit: limit,
      attributes: { exclude: ['firebaseToken'] }
    });

    res.status(200).json({
      success: true,
      users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Ban or Unban a user
 * @route   PUT /api/admin/users/:id/ban
 * @access  Private/Admin
 */
const toggleBanUser = async (req, res) => {
  const userId = req.params.id;
  const { ban } = req.body;

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.banned = (ban === true);
    await user.save();

    res.status(200).json({
      success: true,
      message: `User has been successfully ${user.banned ? 'banned' : 'unbanned'}.`,
      user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Adjust user rewards manually
 * @route   PUT /api/admin/users/:id/reward
 * @access  Private/Admin
 */
const adjustCoins = async (req, res) => {
  const userId = req.params.id;
  const { coins, xp } = req.body;

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (coins !== undefined) user.coins += parseInt(coins);
    if (xp !== undefined) user.xp += parseInt(xp);

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User balance successfully modified.',
      user: {
        _id: user.id,
        name: user.name,
        coins: user.coins,
        xp: user.xp
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Broadcast a system alert / notification (Mock)
 * @route   POST /api/admin/broadcast
 * @access  Private/Admin
 */
const broadcastNotification = async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Please provide title and body.' });
  }

  try {
    const users = await User.findAll({
      where: {
        firebaseToken: {
          [require('sequelize').Op.ne]: null
        }
      },
      attributes: ['firebaseToken']
    });

    const tokens = users.map(u => u.firebaseToken).filter(Boolean);
    
    if (tokens.length > 0) {
      await sendMulticastNotification(tokens, title, body, { type: 'broadcast' });
    }

    console.log(`[Push Notification Broadcast] Title: "${title}" | Body: "${body}" | Sent to ${tokens.length} tokens.`);

    res.status(200).json({
      success: true,
      message: `Broadcast notification successfully sent to ${tokens.length} devices.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get live active matches
 * @route   GET /api/admin/matches/active
 * @access  Private/Admin
 */
const getActiveMatches = async (req, res) => {
  try {
    const activeRooms = await Room.findAll({ where: { status: 'playing' } });
    const list = activeRooms.map(room => {
      const state = room.gameState || {};
      return {
        roomCode: room.code,
        gameType: room.gameType || 'ludo',
        players: room.players,
        status: room.status,
        entryFee: room.entryFee,
        winnerId: room.winnerId,
        gameState: state
      };
    });
    res.status(200).json({ success: true, activeMatches: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get match history (paginated)
 * @route   GET /api/admin/matches/history
 * @access  Private/Admin
 */
const getMatchHistory = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const total = await Match.count();
    const matches = await Match.findAll({
      order: [['createdAt', 'DESC']],
      offset: (page - 1) * limit,
      limit: limit
    });

    res.status(200).json({
      success: true,
      matches,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update tournament (Admin Only)
 * @route   PUT /api/admin/tournaments/:id
 * @access  Private/Admin
 */
const updateTournament = async (req, res) => {
  const tournamentId = req.params.id;
  const { title, entryFee, prizePool, startTime, status, winner } = req.body;

  try {
    const tournament = await Tournament.findByPk(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    if (title !== undefined) tournament.title = title;
    if (entryFee !== undefined) tournament.entryFee = entryFee;
    if (prizePool !== undefined) tournament.prizePool = prizePool;
    if (startTime !== undefined) tournament.startTime = new Date(startTime);
    if (status !== undefined) tournament.status = status;
    if (winner !== undefined) tournament.winner = winner;

    await tournament.save();
    res.status(200).json({ success: true, message: 'Tournament updated successfully', tournament });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const SystemConfig = require('../models/SystemConfig');

/**
 * @desc    Get all system configurations (Admin Only)
 * @route   GET /api/admin/config
 * @access  Private/Admin
 */
const getSystemConfigs = async (req, res) => {
  try {
    const configs = await SystemConfig.findAll();
    res.status(200).json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update a specific system configuration (Admin Only)
 * @route   PUT /api/admin/config
 * @access  Private/Admin
 */
const updateSystemConfig = async (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Key is required' });
  }
  try {
    const config = await SystemConfig.setVal(key, value);
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Delete tournament (Admin Only)
 * @route   DELETE /api/admin/tournaments/:id
 * @access  Private/Admin
 */
const deleteTournament = async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const deleted = await Tournament.destroy({ where: { id: tournamentId } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    res.status(200).json({ success: true, message: 'Tournament deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Export all users as CSV data
 * @route   GET /api/admin/users/export
 * @access  Private/Admin
 */
const exportUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      order: [['id', 'ASC']]
    });

    const headers = [
      'ID', 'Name', 'Email', 'Coins', 'XP', 'Level', 'Rank',
      'Total Wins', 'Total Games', 'Losses', 'Current Streak',
      'Highest Streak', 'Login Streak', 'Referred By', 'Referral Code',
      'Allow Spectating', 'Banned', 'Registered At'
    ];

    const rows = users.map(u => [
      u.id,
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${(u.email || '').replace(/"/g, '""')}"`,
      u.coins,
      u.xp,
      u.level,
      u.rank,
      u.totalWins,
      u.totalGames,
      u.losses,
      u.currentWinStreak,
      u.highestWinStreak,
      u.loginStreak,
      `"${(u.referredBy || '').replace(/"/g, '""')}"`,
      `"${(u.referralCode || '').replace(/"/g, '""')}"`,
      u.allowSpectating,
      u.banned,
      u.createdAt ? u.createdAt.toISOString() : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users_export.csv"');
    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
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
};
