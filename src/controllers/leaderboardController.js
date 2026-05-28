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
    let sortQuery = {};
    if (sortBy === 'xp') {
      sortQuery = { xp: -1 };
    } else {
      sortQuery = { totalWins: -1 };
    }

    const leaderboard = await User.find({ banned: false })
      .sort(sortQuery)
      .limit(limit)
      .select('name avatar coins xp level rank totalWins totalGames');

    // Find current user rank
    const allUsers = await User.find({ banned: false }).sort(sortQuery);
    const myRankIndex = allUsers.findIndex(
      (u) => u._id.toString() === req.user._id.toString()
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
