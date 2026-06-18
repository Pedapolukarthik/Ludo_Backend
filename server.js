require('dotenv').config();
require('./src/config/logger');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const http = require('http');
const { Server } = require('socket.io');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { initSockets } = require('./src/sockets');
const { validateLiveKitCredentials } = require('./src/config/livekit');

const PORT = process.env.PORT || 5000;

// Connect to MongoDB Database
connectDB();

const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

// Create HTTP Server
const server = http.createServer(app);

// Initialize Socket.io Server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Configure Redis Socket.io Adapter if REDIS_HOST is provided
if (process.env.REDIS_HOST) {
  const redisPort = process.env.REDIS_PORT || 6379;
  const redisPassword = process.env.REDIS_PASSWORD;
  const redisUser = process.env.REDIS_USER;
  const useTls = process.env.REDIS_USE_TLS === 'true';
  
  let redisUrl = useTls ? 'rediss://' : 'redis://';
  if (redisUser && redisPassword) {
    redisUrl += `${redisUser}:${redisPassword}@`;
  } else if (redisPassword) {
    redisUrl += `:${redisPassword}@`;
  }
  redisUrl += `${process.env.REDIS_HOST}:${redisPort}`;
  
  console.log(`[Redis] Connecting to ${process.env.REDIS_HOST}:${redisPort}...`);
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  
  pubClient.on('error', (err) => console.error('[Redis Pub Client Error]', err));
  subClient.on('error', (err) => console.error('[Redis Sub Client Error]', err));
  
  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Redis] Socket.io Redis adapter integrated successfully.');
  }).catch((err) => {
    console.error('[Redis] Failed to connect Redis clients, falling back to memory adapter.', err);
  });
} else {
  console.log('[Redis] REDIS_HOST not set. Using default in-memory Socket.io adapter.');
}

// Configure Socket events
initSockets(io);

// Validate LiveKit credentials at startup (non-blocking)
validateLiveKitCredentials().catch(() => {});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Force nodemon reload to pick up correct LIVEKIT_HOST, SDK Token, and new credentials from .env