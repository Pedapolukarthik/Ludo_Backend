const Room = require('../models/Room');
const User = require('../models/User');
const Match = require('../models/Match');
const Chat = require('../models/Chat');
const { initializeGame, handleDiceRoll, handlePawnMove } = require('../services/gameEngine');
const { selectBotMove } = require('../services/botService');
const { generateVoiceToken } = require('../services/livekitService');
const livekitConfig = require('../config/livekit');
const jwt = require('jsonwebtoken');
const { incrementMissionProgressHelper } = require('../controllers/rewardController');

// Memory store for active games in progress
const activeGames = new Map();
// Simple queue for matchmaking: stores user objects
let matchmakingQueue = [];

function registerGameSocket(io) {
  io.use(async (socket, next) => {
    // Authenticate socket connection
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_ludo_jwt_key_123');
      const user = await User.findById(decoded.id).select('name email avatar coins rank level');
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }
      socket.user = user;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected to Socket.IO: ${socket.user.name} (${socket.id})`);

    // --- Lobby & Chat Events ---
    
    // Join room / matchmaking queue
    socket.on('join_matchmaking', async ({ mode, maxPlayers }) => {
      console.log(`${socket.user.name} joined matchmaking for ${maxPlayers}p game.`);
      
      // Prevent duplicates
      matchmakingQueue = matchmakingQueue.filter(p => p.userId !== socket.user._id.toString());
      
      matchmakingQueue.push({
        socketId: socket.id,
        userId: socket.user._id.toString(),
        name: socket.user.name,
        avatar: socket.user.avatar,
        coins: socket.user.coins,
        maxPlayers: parseInt(maxPlayers) || 2
      });

      // Match check
      const candidates = matchmakingQueue.filter(p => p.maxPlayers === maxPlayers);
      
      if (candidates.length >= maxPlayers) {
        // We have enough players! Create a Matchmaking Room
        const matched = candidates.slice(0, maxPlayers);
        
        // Remove matched players from queue
        matchmakingQueue = matchmakingQueue.filter(p => !matched.find(m => m.socketId === p.socketId));

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const colors = ['Red', 'Green', 'Yellow', 'Blue'];

        try {
          const room = new Room({
            code: roomCode,
            host: matched[0].userId,
            players: matched.map((p, idx) => ({
              user: p.userId,
              name: p.name,
              avatar: p.avatar,
              color: colors[idx],
              ready: true
            })),
            type: 'public',
            maxPlayers: maxPlayers,
            status: 'playing',
            entryFee: 100
          });

          await room.save();

          // Deduct entry fee
          for (const p of matched) {
            await User.findByIdAndUpdate(p.userId, { $inc: { coins: -100 } });
          }

          // Initialize game state in memory
          const gameState = initializeGame(room);
          activeGames.set(roomCode, gameState);

          // Tell all matched players to join the socket room and start the game
          matched.forEach(p => {
            const clientSocket = io.sockets.sockets.get(p.socketId);
            if (clientSocket) {
              clientSocket.join(roomCode);
            }
          });

          io.to(roomCode).emit('match_found', {
            roomCode,
            players: room.players,
            gameState
          });

          console.log(`Match created: Room ${roomCode}`);
        } catch (err) {
          console.error('Matchmaking database error:', err.message);
        }
      } else {
        socket.emit('matchmaking_status', { status: 'waiting', count: candidates.length });
      }
    });

    socket.on('leave_matchmaking', () => {
      matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
      socket.emit('matchmaking_status', { status: 'idle' });
    });

    // Create custom private room
    socket.on('create_room', async ({ maxPlayers, entryFee }) => {
      const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      try {
        const room = new Room({
          code: roomCode,
          host: socket.user._id,
          players: [{
            user: socket.user._id,
            name: socket.user.name,
            avatar: socket.user.avatar,
            color: 'Red',
            ready: true
          }],
          type: 'private',
          maxPlayers: parseInt(maxPlayers) || 4,
          entryFee: parseInt(entryFee) || 100,
          status: 'waiting'
        });

        await room.save();
        socket.join(roomCode);
        socket.emit('room_created', room);
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Join custom private room
    socket.on('join_room', async ({ code }) => {
      try {
        const room = await Room.findOne({ code: code.toUpperCase(), status: 'waiting' });
        if (!room) {
          return socket.emit('error', 'Room not found or game already started');
        }

        if (room.players.length >= room.maxPlayers) {
          return socket.emit('error', 'Room is full');
        }

        // Prevent joining twice
        const alreadyJoined = room.players.find(p => p.user && p.user.toString() === socket.user._id.toString());
        if (alreadyJoined) {
          socket.join(room.code);
          return socket.emit('room_joined', room);
        }

        // Assign next available color
        const assignedColors = room.players.map(p => p.color);
        const allColors = ['Red', 'Green', 'Yellow', 'Blue'];
        const freeColor = allColors.find(c => !assignedColors.includes(c));

        room.players.push({
          user: socket.user._id,
          name: socket.user.name,
          avatar: socket.user.avatar,
          color: freeColor,
          ready: false
        });

        await room.save();
        socket.join(room.code);
        
        io.to(room.code).emit('player_joined', room);
        socket.emit('room_joined', room);
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Ready trigger in custom lobby
    socket.on('toggle_ready', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ code: roomCode });
        if (!room) return;

        const playerIdx = room.players.findIndex(p => p.user && p.user.toString() === socket.user._id.toString());
        if (playerIdx !== -1) {
          room.players[playerIdx].ready = !room.players[playerIdx].ready;
          await room.save();
          io.to(roomCode).emit('room_updated', room);
        }
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Host manually launches custom game (and populates remaining slots with bots if not full)
    socket.on('start_game', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ code: roomCode });
        if (!room) return;

        if (room.host.toString() !== socket.user._id.toString()) {
          return socket.emit('error', 'Only host can start the game');
        }

        // Fill remaining slots with AI Bots
        const assignedColors = room.players.map(p => p.color);
        const allColors = ['Red', 'Green', 'Yellow', 'Blue'];
        
        while (room.players.length < room.maxPlayers) {
          const freeColor = allColors.find(c => !assignedColors.includes(c));
          const botDiff = 'medium';
          room.players.push({
            user: null,
            name: `Bot ${freeColor}`,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=Bot${freeColor}`,
            color: freeColor,
            ready: true,
            isBot: true,
            botDifficulty: botDiff
          });
          assignedColors.push(freeColor);
        }

        room.status = 'playing';
        await room.save();

        // Initialize game in memory
        const gameState = initializeGame(room);
        activeGames.set(roomCode, gameState);

        io.to(roomCode).emit('game_started', gameState);

        // Check if starting color is a bot!
        if (isColorBot(gameState, gameState.activeColor)) {
          triggerBotTurn(io, roomCode);
        }
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // --- In-Game Play Sockets ---

    // Handle Dice Roll Command
    socket.on('roll_dice', async ({ roomCode }) => {
      const gameState = activeGames.get(roomCode);
      if (!gameState) return socket.emit('error', 'Game state not found');

      try {
        const activePlayer = gameState.players.find(p => p.color === gameState.activeColor);
        if (!activePlayer || activePlayer.userId !== socket.user._id.toString()) {
          return socket.emit('error', 'Not your turn');
        }

        const { roll, forfeit, possibleMoves } = handleDiceRoll(gameState, gameState.activeColor);
        
        io.to(roomCode).emit('dice_rolled', {
          color: gameState.activeColor,
          value: roll,
          forfeit,
          possibleMoves,
          gameState
        });

        // If turn has been forfeited or no moves exist, turn passed automatically
        if (forfeit || possibleMoves.length === 0) {
          setTimeout(() => {
            io.to(roomCode).emit('turn_changed', {
              activeColor: gameState.activeColor,
              gameState
            });
            
            // Check next turn if bot
            if (isColorBot(gameState, gameState.activeColor)) {
              triggerBotTurn(io, roomCode);
            }
          }, 1500);
        }
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Handle Pawn Move Command
    socket.on('move_pawn', async ({ roomCode, pawnId }) => {
      const gameState = activeGames.get(roomCode);
      if (!gameState) return socket.emit('error', 'Game state not found');

      try {
        const activePlayer = gameState.players.find(p => p.color === gameState.activeColor);
        if (!activePlayer || activePlayer.userId !== socket.user._id.toString()) {
          return socket.emit('error', 'Not your turn');
        }

        const result = handlePawnMove(gameState, gameState.activeColor, parseInt(pawnId));
        
        io.to(roomCode).emit('pawn_moved', {
          color: gameState.activeColor,
          pawnId,
          move: result.move,
          isKill: result.isKill,
          isGoal: result.isGoal,
          gameEnded: result.gameEnded,
          gameState
        });

        if (result.gameEnded) {
          await finalizeGameEnd(io, roomCode, gameState);
        } else {
          io.to(roomCode).emit('turn_changed', {
            activeColor: gameState.activeColor,
            gameState
          });

          // Check if next turn is bot
          if (isColorBot(gameState, gameState.activeColor)) {
            triggerBotTurn(io, roomCode);
          }
        }
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // --- Chat & Emoji Reactions ---
    
    socket.on('send_message', async ({ roomCode, text }) => {
      io.to(roomCode).emit('chat_message', {
        senderId: socket.user._id,
        senderName: socket.user.name,
        text,
        timestamp: new Date()
      });
    });

    socket.on('send_reaction', ({ roomCode, reactionId }) => {
      io.to(roomCode).emit('emoji_reaction', {
        senderColor: socket.user.name, // or resolve color in game
        reactionId
      });
    });

    socket.on('request_voice_token', async ({ roomCode }) => {
      console.log(`[Voice Socket] User ${socket.user?.name || 'Unknown'} (${socket.user?._id}) requesting voice token for room ${roomCode}`);
      try {
        if (!livekitConfig.isConfigured) {
          throw new Error('LiveKit is not configured on the server (missing API key/secret)');
        }

        const normalizedRoom = (roomCode || '').toString().trim().toUpperCase();
        if (!normalizedRoom) {
          throw new Error('Room code is required');
        }

        if (livekitConfig.credentialsValid === false) {
          throw new Error(
            'LiveKit credentials invalid on server — fix LIVEKIT_API_KEY and LIVEKIT_API_SECRET'
          );
        }

        const { token, roomName, expiresIn } = await generateVoiceToken(
          normalizedRoom,
          socket.user._id.toString(),
          socket.user.name
        );

        console.log(
          `[Voice Socket] Token issued for ${roomName} (ttl=${expiresIn}), host: ${livekitConfig.wsUrl}`
        );
        socket.emit('voice_token', {
          token,
          url: livekitConfig.wsUrl,
          roomName,
          expiresIn,
        });
      } catch (err) {
        console.error(`[Voice Socket] Voice token generation failed for room ${roomCode}: ${err.message}`);
        socket.emit('voice_token_error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.name} (${socket.id})`);
      matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
    });
  });
}

/**
 * Utility checks if the active color in game is bot-controlled
 */
function isColorBot(gameState, color) {
  const p = gameState.players.find(pl => pl.color === color);
  return p ? p.isBot : false;
}

/**
 * Triggers automated AI Bot turn
 */
function triggerBotTurn(io, roomCode) {
  // Simulate delay for thinking
  setTimeout(() => {
    const gameState = activeGames.get(roomCode);
    if (!gameState || gameState.winner) return;

    const botColor = gameState.activeColor;
    const botPlayer = gameState.players.find(p => p.color === botColor);
    
    try {
      // 1. Roll dice for bot
      const { roll, forfeit, possibleMoves } = handleDiceRoll(gameState, botColor);
      
      io.to(roomCode).emit('dice_rolled', {
        color: botColor,
        value: roll,
        forfeit,
        possibleMoves,
        gameState
      });

      if (forfeit || possibleMoves.length === 0) {
        setTimeout(() => {
          io.to(roomCode).emit('turn_changed', {
            activeColor: gameState.activeColor,
            gameState
          });
          if (isColorBot(gameState, gameState.activeColor)) {
            triggerBotTurn(io, roomCode);
          }
        }, 1500);
        return;
      }

      // 2. Select bot pawn move
      setTimeout(() => {
        const chosenPawnId = selectBotMove(gameState, botColor, possibleMoves, botPlayer.botDifficulty);
        const result = handlePawnMove(gameState, botColor, chosenPawnId);

        io.to(roomCode).emit('pawn_moved', {
          color: botColor,
          pawnId: chosenPawnId,
          move: result.move,
          isKill: result.isKill,
          isGoal: result.isGoal,
          gameEnded: result.gameEnded,
          gameState
        });

        if (result.gameEnded) {
          finalizeGameEnd(io, roomCode, gameState);
        } else {
          io.to(roomCode).emit('turn_changed', {
            activeColor: gameState.activeColor,
            gameState
          });

          // Check if next turn is bot
          if (isColorBot(gameState, gameState.activeColor)) {
            triggerBotTurn(io, roomCode);
          }
        }
      }, 1500);

    } catch (err) {
      console.error('Bot turn failed:', err.message);
    }
  }, 1000);
}

/**
 * Saves completed match results to database
 */
async function finalizeGameEnd(io, roomCode, gameState) {
  try {
    const room = await Room.findOne({ code: roomCode });
    if (!room) return;

    room.status = 'completed';
    const winningPlayer = gameState.players.find(p => p.color === gameState.winner);
    
    if (winningPlayer && winningPlayer.userId) {
      const winnerId = winningPlayer.userId;
      room.winner = winnerId;
      await room.save();

      // Award coins and XP, update stats and missions
      const winnerUser = await User.findById(winnerId);
      if (winnerUser) {
        const winnings = room.entryFee * room.maxPlayers;
        winnerUser.coins += winnings;
        winnerUser.xp += 300;
        winnerUser.totalWins += 1;
        winnerUser.totalGames += 1;
        
        // Streak updates
        winnerUser.currentWinStreak = (winnerUser.currentWinStreak || 0) + 1;
        winnerUser.highestWinStreak = Math.max(winnerUser.highestWinStreak || 0, winnerUser.currentWinStreak);
        
        // Daily mission increments
        await incrementMissionProgressHelper(winnerUser, 'play_matches', 1);
        await incrementMissionProgressHelper(winnerUser, 'win_matches', 1);

        // Mark badge milestones
        if (winnerUser.totalWins === 1) winnerUser.achievements.push('First Victory');
        if (winnerUser.totalWins === 10) winnerUser.achievements.push('Ludo Master');

        await winnerUser.save();
      }

      // Save match logs
      const match = new Match({
        roomCode: roomCode,
        players: room.players.map(p => ({
          user: p.user,
          name: p.name,
          avatar: p.avatar,
          color: p.color,
          isBot: p.isBot
        })),
        winner: {
          user: winnerId,
          name: winningPlayer.name
        },
        entryFee: room.entryFee,
        prizePool: room.entryFee * room.maxPlayers
      });

      await match.save();

      // Update loser games counts, statistics, and daily missions
      for (const p of room.players) {
        if (p.user && p.user.toString() !== winnerId) {
          const loserUser = await User.findById(p.user);
          if (loserUser) {
            loserUser.totalGames += 1;
            loserUser.losses = (loserUser.losses || 0) + 1;
            loserUser.currentWinStreak = 0; // Streak resets on loss
            loserUser.xp += 50; // Consolation XP

            // Daily mission play increment
            await incrementMissionProgressHelper(loserUser, 'play_matches', 1);

            await loserUser.save();
          }
        }
      }
    }

    io.to(roomCode).emit('game_ended', {
      winnerColor: gameState.winner,
      winnerName: winningPlayer.name,
      gameState
    });

    activeGames.delete(roomCode);
  } catch (err) {
    console.error('Failed to finalize game end:', err.message);
  }
}

module.exports = {
  registerGameSocket,
  activeGames
};
