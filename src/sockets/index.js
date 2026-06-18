const { registerGameSocket } = require('./gameSocket');
const { registerSnakeLadderSocket } = require('./snakeLadderSocket');
const { registerChessSocket } = require('./chessSocket');
const { registerBikeRaceSocket } = require('./bikeRaceSocket');
const { registerUnoSocket } = require('./unoSocket');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function initSockets(io) {
  // Global Socket.io middleware for JWT authentication
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_ludo_jwt_key_123');
      const user = await User.findByPk(decoded.id, { 
        attributes: ['id', 'name', 'email', 'avatar', 'coins', 'rank', 'level'] 
      });
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }
      socket.user = user;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  registerGameSocket(io);
  registerSnakeLadderSocket(io);
  registerChessSocket(io);
  registerBikeRaceSocket(io);
  registerUnoSocket(io);

  const { handleJoinQueue, handleLeaveQueue } = require('./matchmakingManager');
  io.on('connection', (socket) => {
    socket.on('join_matchmaking', (data) => {
      handleJoinQueue(socket, data);
    });
    socket.on('leave_matchmaking', () => {
      handleLeaveQueue(socket);
    });
    socket.on('disconnect', () => {
      handleLeaveQueue(socket);
    });
  });
}

module.exports = {
  initSockets
};
