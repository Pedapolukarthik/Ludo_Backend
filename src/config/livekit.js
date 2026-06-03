const { RoomServiceClient, TokenVerifier } = require('livekit-server-sdk');

const DEFAULT_WS_URL = 'wss://ludo-game-0ahtd6si.livekit.cloud';

/** Strip whitespace, quotes, and BOM from env values (common Render copy-paste issues). */
function sanitizeCredential(value) {
  if (value == null) return '';
  let v = String(value).trim();
  if (v.charCodeAt(0) === 0xfeff) v = v.slice(1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function normalizeLiveKitWsUrl(rawUrl) {
  const trimmed = sanitizeCredential(rawUrl);
  if (!trimmed) return DEFAULT_WS_URL;
  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }
  return trimmed;
}

function normalizeLiveKitApiHost(wsUrl) {
  if (wsUrl.startsWith('wss://')) {
    return `https://${wsUrl.slice('wss://'.length)}`;
  }
  if (wsUrl.startsWith('ws://')) {
    return `http://${wsUrl.slice('ws://'.length)}`;
  }
  return wsUrl;
}

const apiKey = sanitizeCredential(process.env.LIVEKIT_API_KEY);
const apiSecret = sanitizeCredential(process.env.LIVEKIT_API_SECRET);
const hostRaw = sanitizeCredential(
  process.env.LIVEKIT_URL || process.env.LIVEKIT_HOST || ''
);

const config = {
  apiKey: apiKey || 'APIcNdXFqaCe72A',
  apiSecret: apiSecret || 'Yrlol5MkXzFT2bHOxFxY7KGFVZpPvAe2n4ftLtIFgOs',
  wsUrl: normalizeLiveKitWsUrl(hostRaw || DEFAULT_WS_URL),
  isConfigured: Boolean(apiKey && apiSecret),
  usingEnvCredentials: Boolean(apiKey && apiSecret),
  credentialsValid: null,
};

config.apiHost = normalizeLiveKitApiHost(config.wsUrl);

let _roomServiceClient = null;
function getRoomServiceClient() {
  if (!_roomServiceClient) {
    _roomServiceClient = new RoomServiceClient(
      config.apiHost,
      config.apiKey,
      config.apiSecret
    );
  }
  return _roomServiceClient;
}

/**
 * Validates API key/secret against LiveKit Cloud (list rooms).
 * Sets config.credentialsValid and returns boolean.
 */
async function validateLiveKitCredentials() {
  try {
    const svc = getRoomServiceClient();
    await svc.listRooms();
    config.credentialsValid = true;
    console.log(`[LiveKit] Credentials verified with LiveKit Cloud (${config.wsUrl})`);
    return true;
  } catch (err) {
    config.credentialsValid = false;
    console.error(
      `[LiveKit] Credential verification FAILED: ${err.message}. ` +
        'Voice tokens will be rejected. Fix LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Render/.env.'
    );
    return false;
  }
}

/**
 * Verifies a JWT was signed with our configured secret.
 */
async function verifyAccessToken(token) {
  const verifier = new TokenVerifier(config.apiKey, config.apiSecret);
  return verifier.verify(token);
}

if (!config.usingEnvCredentials) {
  console.warn(
    '[LiveKit] LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set — using built-in dev credentials.'
  );
} else {
  console.log(
    `[LiveKit] Loaded env credentials (key: ${config.apiKey.substring(0, 6)}..., host: ${config.wsUrl})`
  );
}

config.sanitizeCredential = sanitizeCredential;
config.normalizeLiveKitWsUrl = normalizeLiveKitWsUrl;
config.validateLiveKitCredentials = validateLiveKitCredentials;
config.verifyAccessToken = verifyAccessToken;
config.getRoomServiceClient = getRoomServiceClient;

module.exports = config;
