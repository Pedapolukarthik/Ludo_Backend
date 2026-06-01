const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  avatar: {
    type: String,
    default: 'https://api.dicebear.com/7.x/pixel-art/svg',
  },
  coins: {
    type: Number,
    default: 1000,
  },
  xp: {
    type: Number,
    default: 0,
  },
  level: {
    type: Number,
    default: 1,
  },
  rank: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'],
    default: 'Bronze',
  },
  totalWins: {
    type: Number,
    default: 0,
  },
  totalGames: {
    type: Number,
    default: 0,
  },
  losses: {
    type: Number,
    default: 0,
  },
  currentWinStreak: {
    type: Number,
    default: 0,
  },
  highestWinStreak: {
    type: Number,
    default: 0,
  },
  dailyMissions: {
    winMatchesCount: { type: Number, default: 0 },
    playMatchesCount: { type: Number, default: 0 },
    spunWheelCount: { type: Number, default: 0 },
    winMatchesClaimed: { type: Boolean, default: false },
    playMatchesClaimed: { type: Boolean, default: false },
    spunWheelClaimed: { type: Boolean, default: false },
    lastResetDate: { type: String, default: "" }
  },
  loginStreak: {
    type: Number,
    default: 1,
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  firebaseToken: {
    type: String,
    default: null,
  },
  banned: {
    type: Boolean,
    default: false,
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: String,
    default: null,
  },
  achievements: [{
    type: String,
  }],
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  friendRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

// Auto-generate referral code on creation
UserSchema.pre('save', function (next) {
  if (!this.referralCode) {
    this.referralCode = 'LUDO' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
