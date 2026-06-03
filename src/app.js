const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const rewardRoutes = require('./routes/rewardRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const voiceRoutes = require('./routes/voiceRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// REST Routes
console.log('[Route Load] Registering /api/auth routes');
app.use('/api/auth', authRoutes);
console.log('[Route Load] Registering /api/users routes');
app.use('/api/users', userRoutes);
console.log('[Route Load] Registering /api/leaderboard routes');
app.use('/api/leaderboard', leaderboardRoutes);
console.log('[Route Load] Registering /api/rewards routes');
app.use('/api/rewards', rewardRoutes);
console.log('[Route Load] Registering /api/tournaments routes');
app.use('/api/tournaments', tournamentRoutes);
console.log('[Route Load] Registering /api/admin routes');
app.use('/api/admin', adminRoutes);
console.log('[Route Load] Registering /api/voice routes');
console.log('Voice routes loaded');
console.log('/api/voice routes active');
app.use('/api/voice', voiceRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = app;
