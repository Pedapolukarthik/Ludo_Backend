const User = require('../models/User');
const Match = require('../models/Match');
const Room = require('../models/Room');
const Tournament = require('../models/Tournament');
const { activeGames } = require('../sockets/gameSocket');

/**
 * @desc    Get dashboard metrics & analytics
 * @route   GET /api/admin/analytics
 * @access  Private/Admin
 */
const getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMatches = await Match.countDocuments();
    const totalActiveRooms = await Room.countDocuments({ status: 'playing' });
    
    // Aggregation of total coin balances
    const coinStats = await User.aggregate([
      { $group: { _id: null, totalCoins: { $sum: '$coins' } } }
    ]);

    const activeCoins = coinStats.length > 0 ? coinStats[0].totalCoins : 0;

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
    const total = await User.countDocuments();
    const users = await User.find({})
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-firebaseToken');

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
    const user = await User.findById(userId);
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
    const user = await User.findById(userId);
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
        _id: user._id,
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
    // In production, we'd trigger FCM admin SDK multicasts
    console.log(`[Push Notification Broadcast] Title: "${title}" | Body: "${body}"`);

    res.status(200).json({
      success: true,
      message: 'Broadcast notification triggered successfully.'
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
    const list = [];
    if (activeGames) {
      activeGames.forEach((gameState, roomCode) => {
        list.push({
          roomCode,
          players: gameState.players,
          colors: gameState.colors,
          activeColor: gameState.activeColor,
          diceValue: gameState.diceValue,
          rollState: gameState.rollState,
          winner: gameState.winner
        });
      });
    }
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
    const total = await Match.countDocuments();
    const matches = await Match.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

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
    const tournament = await Tournament.findById(tournamentId);
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

/**
 * @desc    Delete tournament (Admin Only)
 * @route   DELETE /api/admin/tournaments/:id
 * @access  Private/Admin
 */
const deleteTournament = async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const tournament = await Tournament.findByIdAndDelete(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    res.status(200).json({ success: true, message: 'Tournament deleted successfully' });
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
  deleteTournament
};
