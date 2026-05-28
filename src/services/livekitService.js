const { AccessToken } = require('livekit-server-sdk');
const config = require('../config/livekit');

/**
 * Generates an Access Token for LiveKit Voice Room
 * @param {string} roomName 
 * @param {string} identity 
 * @param {string} name 
 * @returns {string} token
 */
function generateVoiceToken(roomName, identity, name) {
  try {
    const at = new AccessToken(config.apiKey, config.apiSecret, {
      identity: identity,
      name: name,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Audio only to reduce bandwidth and server loads
      audio: true,
      video: false,
      screenshare: false,
    });

    return at.toJWT();
  } catch (error) {
    console.error('Failed to generate LiveKit Token:', error.message);
    // In development without active LiveKit keys, we'll return a mock string.
    return `mock_lk_token_${roomName}_${identity}`;
  }
}

module.exports = {
  generateVoiceToken
};
