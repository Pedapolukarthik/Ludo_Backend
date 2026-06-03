const { AccessToken } = require('livekit-server-sdk');
const config = require('../config/livekit');

const TOKEN_TTL = '6h';

function formatVoiceRoomName(roomCode) {
  const normalized = (roomCode || '').toString().trim().toUpperCase();
  if (!normalized) {
    throw new Error('Room code is required for voice chat');
  }
  return `voice_${normalized}`;
}

function sanitizeIdentity(identity) {
  const id = (identity || '').toString().trim();
  if (!id) {
    throw new Error('Participant identity is required for voice chat');
  }
  return id.replace(/[^a-zA-Z0-9_\-@.]/g, '_').slice(0, 128);
}

/**
 * @returns {Promise<{ token: string, roomName: string, expiresIn: string }>}
 */
async function generateVoiceToken(roomCode, identity, name) {
  try {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('LiveKit API credentials are not configured');
    }

    if (config.credentialsValid === false) {
      throw new Error(
        'LiveKit API credentials are invalid — update LIVEKIT_API_KEY and LIVEKIT_API_SECRET'
      );
    }

    const roomName = formatVoiceRoomName(roomCode);
    const participantIdentity = sanitizeIdentity(identity);
    const participantName = (name || 'Player').toString().trim().slice(0, 64) || 'Player';

    console.log(
      `[LiveKit Service] Generating token. Room: ${roomName}, Identity: ${participantIdentity}`
    );

    const at = new AccessToken(config.apiKey, config.apiSecret, {
      identity: participantIdentity,
      name: participantName,
      ttl: TOKEN_TTL,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    if (!token || typeof token !== 'string' || !token.startsWith('eyJ')) {
      throw new Error('LiveKit SDK returned an invalid JWT');
    }

    try {
      const grants = await config.verifyAccessToken(token);
      if (!grants.video?.roomJoin || !grants.video?.canPublish || !grants.video?.canSubscribe) {
        throw new Error('Generated token missing required grants');
      }
      if (grants.video.room !== roomName) {
        throw new Error(`Token room mismatch: expected ${roomName}, got ${grants.video.room}`);
      }
    } catch (verifyErr) {
      console.error('[LiveKit Service] Token self-verification failed:', verifyErr.message);
      throw new Error(`Failed to verify generated LiveKit token: ${verifyErr.message}`);
    }

    console.log(`[LiveKit Service] Token OK for ${roomName} (len=${token.length}, ttl=${TOKEN_TTL})`);
    return { token, roomName, expiresIn: TOKEN_TTL };
  } catch (error) {
    console.error('[LiveKit Service] Error during LiveKit Token generation:', error);
    throw error;
  }
}

module.exports = {
  generateVoiceToken,
  formatVoiceRoomName,
};
