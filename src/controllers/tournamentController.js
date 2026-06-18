const Tournament = require('../models/Tournament');
const User = require('../models/User');

/**
 * @desc    Get all tournaments
 * @route   GET /api/tournaments
 * @access  Private
 */
const getTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.findAll({
      order: [['startTime', 'ASC']]
    });
    res.status(200).json({ success: true, tournaments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Register for a tournament
 * @route   POST /api/tournaments/register/:id
 * @access  Private
 */
const registerTournament = async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const tournament = await Tournament.findByPk(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    if (tournament.status !== 'upcoming') {
      return res.status(400).json({ success: false, message: 'Registration closed for this tournament' });
    }

    const participantsList = tournament.participants || [];
    if (participantsList.some(p => p.toString() === req.user.id.toString())) {
      return res.status(400).json({ success: false, message: 'Already registered for this tournament' });
    }

    const user = await User.findByPk(req.user.id);
    if (user.coins < tournament.entryFee) {
      return res.status(400).json({ success: false, message: 'Insufficient coins to register' });
    }

    // Deduct coins & Add participant
    user.coins -= tournament.entryFee;
    await user.save();

    tournament.participants = [...participantsList, user.id];
    tournament.changed('participants', true);
    await tournament.save();

    res.status(200).json({
      success: true,
      message: 'Successfully registered for tournament!',
      tournament,
      userCoins: user.coins
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Create a tournament (Admin Only)
 * @route   POST /api/tournaments/create
 * @access  Private/Admin
 */
const createTournament = async (req, res) => {
  const { title, entryFee, prizePool, startTime } = req.body;

  if (!title || !prizePool || !startTime) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  try {
    const tournament = await Tournament.create({
      title,
      entryFee: entryFee || 0,
      prizePool,
      startTime: new Date(startTime),
    });

    res.status(201).json({ success: true, tournament });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTournaments,
  registerTournament,
  createTournament,
};
