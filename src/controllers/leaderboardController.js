const User = require('../models/User');

/**
 * @desc    Get rankings sorted by Wins or XP
 * @route   GET /api/leaderboard
 * @access  Private
 */
const getLeaderboard = async (req, res) => {
  const sortBy = req.query.sortBy || 'wins'; // 'wins' or 'xp'
  const limit = parseInt(req.query.limit) || 20;

  try {
    const sortField = sortBy === 'xp' ? 'xp' : 'totalWins';

    const leaderboard = await User.findAll({
      where: { banned: false },
      order: [[sortField, 'DESC']],
      limit: limit,
      attributes: ['id', 'name', 'avatar', 'coins', 'xp', 'level', 'rank', 'totalWins', 'totalGames']
    });

    // Find current user rank
    const allUsers = await User.findAll({
      where: { banned: false },
      order: [[sortField, 'DESC']],
      attributes: ['id']
    });

    const myRankIndex = allUsers.findIndex(
      (u) => u.id.toString() === req.user.id.toString()
    );

    res.status(200).json({
      success: true,
      leaderboard,
      myRank: myRankIndex !== -1 ? myRankIndex + 1 : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getLeaderboard,
};
