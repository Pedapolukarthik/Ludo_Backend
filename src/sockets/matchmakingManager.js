const Room = require('../models/Room');
const { createChessRoomHelper } = require('./chessSocket');
const { createUnoRoomHelper } = require('./unoSocket');
const { createLudoRoomHelper } = require('./gameSocket');
const { createSnakeRoomHelper } = require('./snakeLadderSocket');
const { createBikeRoomHelper } = require('./bikeRaceSocket');

// Matchmaking queues maps: keys are "gameType:gameMode"
const matchmakingQueues = new Map();

function getQueueKey(gameType, gameMode) {
  return `${gameType}:${gameMode || 'standard'}`;
}

function handleJoinQueue(socket, data) {
  const { gameType, gameMode } = data;
  if (!gameType) return socket.emit('matchmaking_error', 'Game type is required');

  const queueKey = getQueueKey(gameType, gameMode);
  if (!matchmakingQueues.has(queueKey)) {
    matchmakingQueues.set(queueKey, []);
  }

  const queue = matchmakingQueues.get(queueKey);
  
  const exists = queue.some(p => p.socket.id === socket.id);
  if (exists) return;

  const playerObj = { socket, user: socket.user };
  queue.push(playerObj);
  console.log(`[Matchmaking] User ${socket.user.name} joined queue for ${queueKey}. Queue size: ${queue.length}`);
  socket.emit('matchmaking_queued', { success: true, gameType, gameMode });

  checkAndMatch(queueKey);
}

function handleLeaveQueue(socket) {
  for (const [key, queue] of matchmakingQueues.entries()) {
    const originalLen = queue.length;
    matchmakingQueues.set(key, queue.filter(p => p.socket.id !== socket.id));
    if (matchmakingQueues.get(key).length !== originalLen) {
      console.log(`[Matchmaking] User removed from queue ${key}. New size: ${matchmakingQueues.get(key).length}`);
      socket.emit('matchmaking_left', { success: true });
    }
  }
}

async function checkAndMatch(queueKey) {
  const queue = matchmakingQueues.get(queueKey) || [];
  const parts = queueKey.split(':');
  const gameType = parts[0];
  const gameMode = parts[1] || 'standard';

  const requiredPlayers = 2;

  if (queue.length >= requiredPlayers) {
    const playerA = queue.shift();
    const playerB = queue.shift();

    console.log(`[Matchmaking] Match found for ${queueKey}: ${playerA.user.name} vs ${playerB.user.name}`);

    try {
      let room;
      
      if (gameType === 'chess') {
        const result = await createChessRoomHelper(playerA.user, 0, playerA.socket.id, gameMode);
        room = result.room;
        
        const dbRoom = await Room.findOne({ where: { code: room.code } });
        const players = dbRoom.players;
        players.push({
          id: String(playerB.user.id),
          userId: String(playerB.user.id),
          socketId: playerB.socket.id,
          name: playerB.user.name,
          avatar: playerB.user.avatar,
          color: 'Black',
          colorCode: 'b',
          ready: true,
          isBot: false
        });
        dbRoom.players = players;
        dbRoom.status = 'playing';
        
        const { activeChessGames } = require('./chessSocket');
        const currentGameState = dbRoom.gameState;
        currentGameState.players = players;
        currentGameState.status = 'playing';
        dbRoom.gameState = currentGameState;
        await dbRoom.save();
        
        if (activeChessGames) {
          activeChessGames.set(room.code, currentGameState);
        }
        room = dbRoom.toJSON();
      } else if (gameType === 'uno') {
        const result = await createUnoRoomHelper(playerA.user, 0, 2, playerA.socket.id, gameMode);
        room = result.room;
        
        const dbRoom = await Room.findOne({ where: { code: room.code } });
        const players = dbRoom.players;
        players.push({
          id: String(playerB.user.id),
          socketId: playerB.socket.id,
          name: playerB.user.name,
          avatar: playerB.user.avatar,
          ready: true,
          isBot: false
        });
        dbRoom.players = players;
        dbRoom.status = 'playing';
        
        const { initializeUnoGame } = require('../services/unoEngine');
        const completeGameState = initializeUnoGame(dbRoom.toJSON());
        dbRoom.gameState = completeGameState;
        await dbRoom.save();
        room = dbRoom.toJSON();
      } else if (gameType === 'snake_ladder') {
        const result = await createSnakeRoomHelper(playerA.user, 2, 0, playerA.socket.id);
        room = result.room;

        const dbRoom = await Room.findOne({ where: { code: room.code } });
        const players = dbRoom.players;
        players.push({
          id: String(playerB.user.id),
          user: String(playerB.user.id),
          userId: String(playerB.user.id),
          socketId: playerB.socket.id,
          name: playerB.user.name,
          avatar: playerB.user.avatar,
          position: 1,
          ready: true,
          isBot: false,
          color: 'Green'
        });
        dbRoom.players = players;
        dbRoom.status = 'playing';

        const { initializeGame } = require('../services/snakeLadderEngine');
        const completeGameState = initializeGame(dbRoom.toJSON());
        dbRoom.gameState = completeGameState;
        await dbRoom.save();

        const { activeGames } = require('./snakeLadderSocket');
        if (activeGames) {
          activeGames.set(room.code, completeGameState);
        }
        room = dbRoom.toJSON();
      } else if (gameType === 'bike_race') {
        const result = await createBikeRoomHelper(playerA.user, 2, 0, playerA.socket.id);
        room = result.room;

        const dbRoom = await Room.findOne({ where: { code: room.code } });
        const players = dbRoom.players;
        players.push({
          user: String(playerB.user.id),
          name: playerB.user.name,
          avatar: playerB.user.avatar,
          color: 'Green',
          ready: true,
          socketId: playerB.socket.id
        });
        dbRoom.players = players;
        dbRoom.status = 'playing';

        const { initializeGame } = require('../services/bikeRaceEngine');
        const completeGameState = initializeGame(dbRoom);
        dbRoom.gameState = completeGameState;
        await dbRoom.save();

        const { activeGames } = require('./bikeRaceSocket');
        if (activeGames) {
          activeGames.set(room.code, completeGameState);
        }
        room = dbRoom.toJSON();
      } else {
        const dbRoom = await createLudoRoomHelper(playerA.user, 2, 0);
        dbRoom.gameMode = gameMode;
        
        const players = dbRoom.players;
        players.push({
          user: String(playerB.user.id),
          userId: String(playerB.user.id),
          name: playerB.user.name,
          avatar: playerB.user.avatar,
          color: 'Green',
          ready: true
        });
        dbRoom.players = players;
        dbRoom.status = 'playing';
        
        const { initializeGame } = require('../services/gameEngine');
        const completeGameState = initializeGame(dbRoom.toJSON());
        dbRoom.gameState = completeGameState;
        await dbRoom.save();
        
        const { activeGames } = require('./gameSocket');
        if (activeGames) {
          activeGames.set(dbRoom.code, completeGameState);
        }
        room = dbRoom.toJSON();
      }

      playerA.socket.join(room.code);
      playerB.socket.join(room.code);

      const payload = { success: true, roomCode: room.code, room };
      
      // Emit generic match_found
      playerA.socket.emit('match_found', payload);
      playerB.socket.emit('match_found', payload);

      // Emit game-specific match_found for specific providers
      playerA.socket.emit(`${gameType}_match_found`, payload);
      playerB.socket.emit(`${gameType}_match_found`, payload);

      // Trigger push notifications
      const { sendPushNotification } = require('../config/firebase');
      if (playerA.user && playerA.user.firebaseToken) {
        sendPushNotification(playerA.user.firebaseToken, 'Match Found! 🎮', `Your ${gameType.toUpperCase()} battle is ready!`, { roomCode: room.code, gameType });
      }
      if (playerB.user && playerB.user.firebaseToken) {
        sendPushNotification(playerB.user.firebaseToken, 'Match Found! 🎮', `Your ${gameType.toUpperCase()} battle is ready!`, { roomCode: room.code, gameType });
      }

    } catch (err) {
      console.error('[Matchmaking] Failed to establish room match:', err);
      playerA.socket.emit('matchmaking_error', 'Failed to establish game room');
      playerB.socket.emit('matchmaking_error', 'Failed to establish game room');
    }
  }
}

module.exports = {
  handleJoinQueue,
  handleLeaveQueue
};
