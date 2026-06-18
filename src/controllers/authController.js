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
  console.log(`[AUTH] googleAuth endpoint called. referralCode: ${referralCode || 'none'}`);

  if (!idToken) {
    console.warn('[AUTH] Missing idToken in request body');
    return res.status(400).json({ success: false, message: 'ID Token is required' });
  }

  try {
    console.log(`[AUTH] Starting Firebase token verification for token of length: ${idToken.length}`);
    // 1. Verify token
    const payload = await verifyFirebaseToken(idToken);
    console.log('[AUTH] Token verification success. Decoded user payload:', JSON.stringify(payload));
    
    // 2. Check if user already exists
    console.log(`[AUTH] Checking database for user email: ${payload.email}`);
    let user = await User.findOne({ where: { email: payload.email } });

    if (!user) {
      console.log(`[AUTH] User not found. Creating new user for: ${payload.email}`);
      // Create new user
      let referredByUser = null;
      if (referralCode) {
        console.log(`[AUTH] Processing referral code: ${referralCode}`);
        referredByUser = await User.findOne({ where: { referralCode } });
        if (referredByUser) {
          console.log(`[AUTH] Referral match found: ${referredByUser.name} (${referredByUser.email})`);
        } else {
          console.log(`[AUTH] Referral code ${referralCode} did not match any user.`);
        }
      }

      user = new User({
        name: payload.name,
        email: payload.email,
        avatar: payload.avatar,
        coins: referredByUser ? 1200 : 1000, // Reward new user with extra coins if referred
      });

      await user.save();
      console.log(`[AUTH] New user created successfully with ID: ${user._id}`);

      // Reward the referrer
      if (referredByUser) {
        referredByUser.coins += 500;
        referredByUser.xp += 100;
        referredByUser.achievements = [...(referredByUser.achievements || []), 'Referrer Master'];
        referredByUser.changed('achievements', true);
        await referredByUser.save();
        console.log(`[AUTH] Referrer ${referredByUser.name} rewarded successfully.`);
      }
    } else {
      console.log(`[AUTH] User exists. ID: ${user._id}. Updating login streak.`);
      // Update login info and handle daily streak update
      const now = new Date();
      const diffTime = Math.abs(now - user.lastLogin);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        user.loginStreak += 1;
        console.log(`[AUTH] Streak incremented. Current streak: ${user.loginStreak}`);
      } else if (diffDays > 1) {
        user.loginStreak = 1; // Reset streak if missed a day
        console.log('[AUTH] Streak reset to 1 day.');
      }
      user.lastLogin = now;
      await user.save();
    }

    if (user.banned) {
      console.warn(`[AUTH] User ${user.email} is banned. Authentication aborted.`);
      return res.status(403).json({ success: false, message: 'This account has been suspended.' });
    }

    const jwtToken = generateToken(user._id);
    console.log(`[AUTH] JWT Token generated successfully for user ID: ${user._id}`);

    res.status(200).json({
      success: true,
      token: jwtToken,
      user: {
        _id: String(user.id),
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
        friends: (user.friends || []).map(f => String(f)),
        allowSpectating: user.allowSpectating,
      }
    });

  } catch (error) {
    console.error('[AUTH] Google Auth Error:', error);
    res.status(500).json({ 
      success: false, 
      message: `Server Authentication Failed: ${error.message || error}` 
    });
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
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
      user.changed('dailyMissions', true);
      await user.save();
    } else if (user.dailyMissions.lastResetDate !== today) {
      user.dailyMissions.winMatchesCount = 0;
      user.dailyMissions.playMatchesCount = 0;
      user.dailyMissions.spunWheelCount = 0;
      user.dailyMissions.winMatchesClaimed = false;
      user.dailyMissions.playMatchesClaimed = false;
      user.dailyMissions.spunWheelClaimed = false;
      user.dailyMissions.lastResetDate = today;
      user.changed('dailyMissions', true);
      await user.save();
    }

    // Manual populate for friends array
    const friendIds = user.friends || [];
    const friendsDetails = await User.findAll({
      where: { id: friendIds },
      attributes: ['id', 'name', 'avatar', 'coins', 'rank']
    });

    const userJson = user.toJSON();
    userJson.friends = friendsDetails.map(f => f.toJSON());

    res.status(200).json({ success: true, user: userJson });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  googleAuth,
  getMe,
};
