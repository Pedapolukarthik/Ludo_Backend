const config = {
  apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  host: process.env.LIVEKIT_HOST || 'http://localhost:7880',
};

module.exports = config;
