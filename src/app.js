const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const rewardRoutes = require('./routes/rewardRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const voiceRoutes = require('./routes/voiceRoutes');
const roomRoutes = require('./routes/roomRoutes');

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
console.log('[Route Load] Registering /api room proxy routes');
app.use('/api', roomRoutes);

const SystemConfig = require('./models/SystemConfig');

// Public config endpoint for mobile client
app.get('/api/config', async (req, res) => {
  try {
    const keys = [
      'video_ads_enabled',
      'admob_app_id_android',
      'admob_app_id_ios',
      'admob_banner_ad_unit_id_android',
      'admob_banner_ad_unit_id_ios',
      'admob_rewarded_ad_unit_id_android',
      'admob_rewarded_ad_unit_id_ios'
    ];
    const configs = await SystemConfig.findAll({
      where: { key: keys }
    });
    
    const configMap = {};
    // Seed default fallback just in case
    configMap['video_ads_enabled'] = true;
    configs.forEach(c => {
      let parsedVal = c.value;
      if (c.value === 'true') parsedVal = true;
      else if (c.value === 'false') parsedVal = false;
      configMap[c.key] = parsedVal;
    });

    res.status(200).json({ success: true, data: configMap });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Ludo Kingdom Backend Running'
  });
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
