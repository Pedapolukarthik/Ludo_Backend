const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  players: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      default: 'Guest',
    },
    avatar: {
      type: String,
      default: '',
    },
    color: {
      type: String,
      enum: ['Red', 'Green', 'Yellow', 'Blue'],
      required: true,
    },
    ready: {
      type: Boolean,
      default: false,
    },
    isBot: {
      type: Boolean,
      default: false,
    },
    botDifficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    }
  }],
  type: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
  },
  maxPlayers: {
    type: Number,
    enum: [2, 4],
    default: 4,
  },
  status: {
    type: String,
    enum: ['waiting', 'playing', 'completed'],
    default: 'waiting',
  },
  entryFee: {
    type: Number,
    default: 100,
  },
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400, // Automatically delete rooms after 24 hours
  }
});

module.exports = mongoose.model('Room', RoomSchema);
