const jwt = require('jsonwebtoken');
const { verifyFirebaseToken } = require('../config/firebase');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'super_secret_ludo_jwt_key_123', {
    expiresIn: '30d',
  });
};

/**
 * @desc    Auth with Firebase token (Google Sign-In)
 * @route   POST /api/auth/google
 * @access  Public
 */
const googleAuth = async (req, res) => {
  const { idToken, referralCode } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'ID Token is required' });
  }

  try {
    // 1. Verify token
    const payload = await verifyFirebaseToken(idToken);
    
    // 2. Check if user already exists
    let user = await User.findOne({ email: payload.email });

    if (!user) {
      // Create new user
      let referredByUser = null;
      if (referralCode) {
        referredByUser = await User.findOne({ referralCode });
      }

      user = new User({
        name: payload.name,
        email: payload.email,
        avatar: payload.avatar,
        coins: referredByUser ? 1200 : 1000, // Reward new user with extra coins if referred
      });

      await user.save();

      // Reward the referrer
      if (referredByUser) {
        referredByUser.coins += 500;
        referredByUser.xp += 100;
        referredByUser.achievements.push('Referrer Master');
        await referredByUser.save();
      }
    } else {
      // Update login info and handle daily streak update
      const now = new Date();
      const diffTime = Math.abs(now - user.lastLogin);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        user.loginStreak += 1;
      } else if (diffDays > 1) {
        user.loginStreak = 1; // Reset streak if missed a day
      }
      user.lastLogin = now;
      await user.save();
    }

    if (user.banned) {
      return res.status(403).json({ success: false, message: 'This account has been suspended.' });
    }

    res.status(200).json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        coins: user.coins,
        xp: user.xp,
        level: user.level,
        rank: user.rank,
        totalWins: user.totalWins,
        totalGames: user.totalGames,
        loginStreak: user.loginStreak,
        achievements: user.achievements,
        referralCode: user.referralCode,
        friends: user.friends,
      }
    });

  } catch (error) {
    console.error('Google Auth Error:', error.message);
    res.status(500).json({ success: false, message: 'Server Authentication Failed' });
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('friends', 'name avatar coins rank');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const today = new Date().toDateString();
    if (!user.dailyMissions) {
      user.dailyMissions = {
        winMatchesCount: 0,
        playMatchesCount: 0,
        spunWheelCount: 0,
        winMatchesClaimed: false,
        playMatchesClaimed: false,
        spunWheelClaimed: false,
        lastResetDate: today
      };
      await user.save();
    } else if (user.dailyMissions.lastResetDate !== today) {
      user.dailyMissions.winMatchesCount = 0;
      user.dailyMissions.playMatchesCount = 0;
      user.dailyMissions.spunWheelCount = 0;
      user.dailyMissions.winMatchesClaimed = false;
      user.dailyMissions.playMatchesClaimed = false;
      user.dailyMissions.spunWheelClaimed = false;
      user.dailyMissions.lastResetDate = today;
      await user.save();
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  googleAuth,
  getMe,
};
