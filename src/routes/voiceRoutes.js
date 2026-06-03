const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const livekitConfig = require('../config/livekit');
const { generateVoiceToken } = require('../services/livekitService');

const router = express.Router();

/** Public health check — no secrets exposed */
router.get('/health', (req, res) => {
  console.log('[Voice API] GET /health requested');
  res.json({
    success: true,
    configured: livekitConfig.isConfigured,
    credentialsValid: livekitConfig.credentialsValid === true,
    wsUrl: livekitConfig.wsUrl,
    usingEnvCredentials: livekitConfig.usingEnvCredentials,
  });
});

/** REST fallback for voice token (same grants as Socket.IO) */
router.post('/token', protect, async (req, res) => {
  const userIdentifier = req.user ? `${req.user.name} (${req.user._id})` : 'Unknown User';
  console.log(`[Voice API] POST /token requested by ${userIdentifier} for room: ${req.body.roomCode}`);
  
  try {
    const roomCode = (req.body.roomCode || '').toString().trim().toUpperCase();
    if (!roomCode) {
      console.warn('[Voice API] Token request failed: roomCode is missing');
      return res.status(400).json({ success: false, message: 'roomCode is required' });
    }

    if (!livekitConfig.isConfigured) {
      console.warn('[Voice API] Token request failed: LiveKit is not configured');
      return res.status(503).json({
        success: false,
        message: 'LiveKit is not configured on the server',
      });
    }

    const { token, roomName, expiresIn } = await generateVoiceToken(
      roomCode,
      req.user._id.toString(),
      req.user.name
    );

    console.log(`[Voice API] Token generated successfully for room ${roomName} for user ${userIdentifier}`);
    
    res.json({
      success: true,
      token,
      url: livekitConfig.wsUrl,
      roomName,
      expiresIn,
    });
  } catch (err) {
    console.error(`[Voice API] Token generation API failure for user ${userIdentifier}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
