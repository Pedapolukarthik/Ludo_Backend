const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  entryFee: {
    type: Number,
    default: 200,
  },
  prizePool: {
    type: Number,
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['upcoming', 'ongoing', 'completed'],
    default: 'upcoming',
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  brackets: [{
    round: {
      type: Number,
      required: true,
    },
    matches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
    }]
  }],
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('Tournament', TournamentSchema);
