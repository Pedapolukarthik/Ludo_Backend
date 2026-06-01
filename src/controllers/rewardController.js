const User = require('../models/User');

/**
 * @desc    Claim Daily Login Reward
 * @route   POST /api/rewards/daily
 * @access  Private
 */
const claimDailyReward = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const today = new Date().toDateString();
    // Use achievements or special last login checking
    // Since streak is updated during login, we can store a custom claimed flag or check if already claimed today
    // For simplicity, let's check if the last claimed date is today
    const claimedTodayKey = 'DailyClaim_' + today;
    
    if (user.achievements.includes(claimedTodayKey)) {
      return res.status(400).json({ success: false, message: 'Daily reward already claimed today.' });
    }

    // Base reward = 100 coins, bonus = streak * 20 coins
    const baseCoins = 100;
    const bonusCoins = user.loginStreak * 20;
    const totalRewardCoins = baseCoins + bonusCoins;
    const gainedXp = 50;

    user.coins += totalRewardCoins;
    user.xp += gainedXp;
    user.achievements.push(claimedTodayKey);

    // Level up calculation (every 1000 XP is a level)
    const newLevel = Math.floor(user.xp / 1000) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
      // Upgrade rank based on level
      if (newLevel >= 25) user.rank = 'Legend';
      else if (newLevel >= 20) user.rank = 'Diamond';
      else if (newLevel >= 15) user.rank = 'Platinum';
      else if (newLevel >= 10) user.rank = 'Gold';
      else if (newLevel >= 5) user.rank = 'Silver';
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Daily reward claimed successfully!',
      coinsAwarded: totalRewardCoins,
      xpAwarded: gainedXp,
      user: {
        coins: user.coins,
        xp: user.xp,
        level: user.level,
        rank: user.rank,
        loginStreak: user.loginStreak,
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Spin Wheel Reward
 * @route   POST /api/rewards/spin
 * @access  Private
 */
const claimSpinWheel = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const today = new Date().toDateString();
    const spinKey = 'SpinClaim_' + today;

    if (user.achievements.includes(spinKey)) {
      return res.status(400).json({ success: false, message: 'You have already spun the wheel today.' });
    }

    // Spin outcomes
    const outcomes = [
      { type: 'coins', amount: 50, label: '50 Coins' },
      { type: 'coins', amount: 100, label: '100 Coins' },
      { type: 'coins', amount: 200, label: '200 Coins' },
      { type: 'coins', amount: 500, label: '500 Coins' },
      { type: 'xp', amount: 150, label: '150 XP' },
      { type: 'coins', amount: 1000, label: 'JACKPOT! 1000 Coins' },
    ];

    const randomOutcome = outcomes[Math.floor(Math.random() * outcomes.length)];

    if (randomOutcome.type === 'coins') {
      user.coins += randomOutcome.amount;
    } else if (randomOutcome.type === 'xp') {
      user.xp += randomOutcome.amount;
      // Level up calculation
      const newLevel = Math.floor(user.xp / 1000) + 1;
      if (newLevel > user.level) {
        user.level = newLevel;
      }
    }

    user.achievements.push(spinKey);
    
    // Increment daily mission spin progress
    await incrementMissionProgressHelper(user, 'spin_wheel', 1);
    
    await user.save();

    res.status(200).json({
      success: true,
      message: `You won ${randomOutcome.label}!`,
      outcome: randomOutcome,
      user: {
        coins: user.coins,
        xp: user.xp,
        level: user.level,
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const incrementMissionProgressHelper = async (user, missionType, incrementAmount = 1) => {
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
  } else if (user.dailyMissions.lastResetDate !== today) {
    user.dailyMissions.winMatchesCount = 0;
    user.dailyMissions.playMatchesCount = 0;
    user.dailyMissions.spunWheelCount = 0;
    user.dailyMissions.winMatchesClaimed = false;
    user.dailyMissions.playMatchesClaimed = false;
    user.dailyMissions.spunWheelClaimed = false;
    user.dailyMissions.lastResetDate = today;
  }

  let coinsReward = 0;
  let xpReward = 0;

  if (missionType === 'win_matches') {
    user.dailyMissions.winMatchesCount += incrementAmount;
    if (user.dailyMissions.winMatchesCount >= 2 && !user.dailyMissions.winMatchesClaimed) {
      user.dailyMissions.winMatchesClaimed = true;
      coinsReward = 350;
      xpReward = 150;
    }
  } else if (missionType === 'play_matches') {
    user.dailyMissions.playMatchesCount += incrementAmount;
    if (user.dailyMissions.playMatchesCount >= 3 && !user.dailyMissions.playMatchesClaimed) {
      user.dailyMissions.playMatchesClaimed = true;
      coinsReward = 250;
      xpReward = 120;
    }
  } else if (missionType === 'spin_wheel') {
    user.dailyMissions.spunWheelCount += incrementAmount;
    if (user.dailyMissions.spunWheelCount >= 1 && !user.dailyMissions.spunWheelClaimed) {
      user.dailyMissions.spunWheelClaimed = true;
      coinsReward = 150;
      xpReward = 80;
    }
  }

  if (coinsReward > 0 || xpReward > 0) {
    user.coins += coinsReward;
    user.xp += xpReward;
    
    const newLevel = Math.floor(user.xp / 1000) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
      if (newLevel >= 25) user.rank = 'Legend';
      else if (newLevel >= 20) user.rank = 'Diamond';
      else if (newLevel >= 15) user.rank = 'Platinum';
      else if (newLevel >= 10) user.rank = 'Gold';
      else if (newLevel >= 5) user.rank = 'Silver';
    }
  }
};

const getDailyMissions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
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

    const dm = user.dailyMissions;
    const missions = [
      {
        id: 'win_matches',
        title: 'Win 2 Matches',
        description: 'Win 2 classic or quick matches online',
        progress: dm.winMatchesCount,
        goal: 2,
        coins: 350,
        xp: 150,
        completed: dm.winMatchesClaimed
      },
      {
        id: 'play_matches',
        title: 'Play 3 Games',
        description: 'Play 3 games to completion (vs online players or AI)',
        progress: dm.playMatchesCount,
        goal: 3,
        coins: 250,
        xp: 120,
        completed: dm.playMatchesClaimed
      },
      {
        id: 'spin_wheel',
        title: 'Spin Reward Wheel',
        description: 'Spin the rewards wheel once',
        progress: dm.spunWheelCount,
        goal: 1,
        coins: 150,
        xp: 80,
        completed: dm.spunWheelClaimed
      }
    ];

    res.status(200).json({ success: true, missions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  claimDailyReward,
  claimSpinWheel,
  getDailyMissions,
  incrementMissionProgressHelper,
};
