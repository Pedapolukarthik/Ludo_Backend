const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
  roomCode: {
    type: String,
    required: true,
  },
  players: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    name: {
      type: String,
      required: true,
    },
    avatar: {
      type: String,
    },
    color: {
      type: String,
      enum: ['Red', 'Green', 'Yellow', 'Blue'],
      required: true,
    },
    isBot: {
      type: Boolean,
      default: false,
    }
  }],
  winner: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    name: {
      type: String,
    }
  },
  entryFee: {
    type: Number,
    required: true,
  },
  prizePool: {
    type: Number,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('Match', MatchSchema);
