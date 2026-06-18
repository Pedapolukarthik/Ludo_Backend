const Room = require('../models/Room');
const User = require('../models/User');
const Match = require('../models/Match');
const Chat = require('../models/Chat');
const { initializeChessGame, makeMove, undoLastMove } = require('../services/chessEngine');
const { getBotMove } = require('../services/chessBotService');
const jwt = require('jsonwebtoken');
const { generateVoiceToken } = require('../services/livekitService');

// Memory store for active games and matchmaking
const activeChessGames = new Map();
const chessRooms = new Map();
let chessMatchmakingQueue = [];

async function createChessRoomHelper(user, entryFee, socketId = null, gameMode = 'standard') {
  const roomCode = 'CHESS_' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const hostId = user.id || parseInt(user._id);

  const initialPlayer = {
    id: String(user._id || user.id),
    userId: String(user._id || user.id),
    socketId: socketId,
    name: user.name,
    avatar: user.avatar,
    color: 'White',
    colorCode: 'w',
    ready: true,
    isBot: false
  };

  const room = await Room.create({
    code: roomCode,
    hostId: hostId,
    players: [initialPlayer],
    type: 'private',
    gameType: 'chess',
    gameMode: gameMode,
    maxPlayers: 2,
    entryFee: Number(entryFee || 0),
    status: 'waiting'
  });

  const gameState = initializeChessGame(room.toJSON());
  room.gameState = gameState;
  await room.save();

  // Cache in local Map for backwards-compatibility/performance
  chessRooms.set(roomCode, room.toJSON());
  activeChessGames.set(roomCode, gameState);

  return { room: room.toJSON(), gameState };
}

async function joinChessRoomHelper(user, rawCode, socketId = null) {
  let roomCode = (rawCode || '').trim().toUpperCase();
  if (roomCode && !roomCode.startsWith('CHESS_')) {
    roomCode = 'CHESS_' + roomCode;
  }

  const room = await Room.findOne({ where: { code: roomCode } });
  if (!room) {
    throw new Error('Room not found');
  }

  if (room.status !== 'waiting') {
    throw new Error('Game already started');
  }

  const players = Array.isArray(room.players) ? room.players : JSON.parse(room.players || '[]');
  if (players.length >= room.maxPlayers) {
    throw new Error('Room is full');
  }

  const userIdStr = (user._id || user.id).toString();
  const alreadyJoined = players.find(p => p.id === userIdStr);
  if (alreadyJoined) {
    if (socketId) alreadyJoined.socketId = socketId;
    return room.toJSON();
  }

  const hostPlayer = players.find(p => p.id === room.hostId.toString()) || players[0];
  const guestColorCode = hostPlayer.colorCode === 'w' ? 'b' : 'w';
  const guestColorName = guestColorCode === 'w' ? 'White' : 'Black';

  const newPlayer = {
    id: userIdStr,
    userId: userIdStr,
    socketId: socketId,
    name: user.name,
    avatar: user.avatar,
    color: guestColorName,
    colorCode: guestColorCode,
    ready: false,
    isBot: false
  };

  players.push(newPlayer);
  room.players = players;
  
  const currentGameState = room.gameState || initializeChessGame(room.toJSON());
  currentGameState.players = players;
  room.gameState = currentGameState;
  room.changed('players', true);
  room.changed('gameState', true);
  await room.save();

  chessRooms.set(roomCode, room.toJSON());
  activeChessGames.set(roomCode, currentGameState);

  return room.toJSON();
}

async function saveChessRoomToDb(roomCode, gameState, roomStatus = null) {
  try {
    const room = await Room.findOne({ where: { code: roomCode } });
    if (room) {
      room.gameState = gameState;
      if (roomStatus) {
        room.status = roomStatus;
      }
      room.changed('gameState', true);
      await room.save();
      chessRooms.set(roomCode, room.toJSON());
      activeChessGames.set(roomCode, gameState);
    }
  } catch (err) {
    console.error('[CHESS_DB_SYNC_ERROR]:', err.message);
  }
}

function registerChessSocket(io) {
  console.log('[CHESS_SOCKET] Chess socket registered');

  io.on('connection', (socket) => {
    // --- Matchmaking ---
    socket.on('chess_join_matchmaking', async () => {
      if (!socket.user) return socket.emit('chess_error', 'Authentication error');

      // Check if already in queue
      if (chessMatchmakingQueue.some(p => p.userId.toString() === socket.user._id.toString())) {
        return socket.emit('chess_error', 'Already in matchmaking queue');
      }

      chessMatchmakingQueue.push({
        userId: socket.user._id,
        socketId: socket.id,
        name: socket.user.name,
        avatar: socket.user.avatar,
        coins: socket.user.coins
      });

      console.log(`[Chess Matchmaking] ${socket.user.name} joined queue.`);

      if (chessMatchmakingQueue.length >= 2) {
        const p1 = chessMatchmakingQueue.shift();
        const p2 = chessMatchmakingQueue.shift();

        const roomCode = 'CHESS_' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        try {
          const room = {
            roomCode,
            code: roomCode,
            gameType: 'chess',
            maxPlayers: 2,
            entryFee: 50,
            status: 'playing',
            host: p1.userId,
            players: [
              {
                id: p1.userId.toString(),
                socketId: p1.socketId,
                name: p1.name,
                avatar: p1.avatar,
                color: 'White',
                colorCode: 'w',
                ready: true,
                isBot: false
              },
              {
                id: p2.userId.toString(),
                socketId: p2.socketId,
                name: p2.name,
                avatar: p2.avatar,
                color: 'Black',
                colorCode: 'b',
                ready: true,
                isBot: false
              }
            ]
          };

          const gameState = initializeChessGame(room);
          gameState.status = 'playing';

          chessRooms.set(roomCode, room);
          activeChessGames.set(roomCode, gameState);

          // Join sockets to room
          const s1 = io.sockets.sockets.get(p1.socketId);
          const s2 = io.sockets.sockets.get(p2.socketId);
          if (s1) s1.join(roomCode);
          if (s2) s2.join(roomCode);

          // Deduct entry fees
          const u1 = await User.findByPk(p1.userId);
          if (u1) {
            u1.coins -= 50;
            await u1.save();
          }
          const u2 = await User.findByPk(p2.userId);
          if (u2) {
            u2.coins -= 50;
            await u2.save();
          }

          io.to(roomCode).emit('chess_match_found', {
            roomCode,
            room,
            gameState
          });

          console.log(`[Chess Match] Match found and created room: ${roomCode}`);
        } catch (err) {
          console.error('[Chess Matchmaking DB Error]:', err.message);
          socket.emit('chess_error', 'Failed to create matchmaking game');
        }
      }
    });

    socket.on('chess_leave_matchmaking', () => {
      chessMatchmakingQueue = chessMatchmakingQueue.filter(p => p.socketId !== socket.id);
    });

    // --- Custom Room ---
    socket.on('chess_create_room', async (data) => {
      if (!socket.user) return socket.emit('chess_error', 'Authentication error');

      try {
        const entryFee = Number(data?.entryFee || 0);
        const gameMode = data?.gameMode || 'standard';
        const { room, gameState } = await createChessRoomHelper(socket.user, entryFee, socket.id, gameMode);
        socket.join(room.code);

        console.log(`[CHESS_ROOM] CREATE_ROOM → code=${room.code}`);
        console.log(`[CHESS_ROOM] Room details:`, { room, gameState });

        socket.emit('chess_room_created', {
          success: true,
          roomCode: room.code,
          room,
          gameState
        });
      } catch (err) {
        console.error('[CHESS_ROOM] Room creation failed:', err.message);
        socket.emit('chess_error', 'Room creation failed');
      }
    });

    socket.on('chess_join_room', async (data) => {
      if (!socket.user) return socket.emit('chess_error', 'Authentication error');

      let roomCode = (data.roomCode || data.code || '').trim().toUpperCase();
      console.log(`[CHESS_ROOM] JOIN_REQUEST → requested=${roomCode}`);

      try {
        const room = await joinChessRoomHelper(socket.user, roomCode, socket.id);
        socket.join(room.code);

        io.to(room.code).emit('chess_lobby_updated', {
          roomCode: room.code,
          room,
          gameState: room.gameState
        });

        socket.emit('chess_room_joined', {
          success: true,
          roomCode: room.code,
          room,
          gameState: room.gameState
        });
      } catch (err) {
        socket.emit('chess_error', err.message);
      }
    });

    socket.on('chess_join_socket_room', async ({ roomCode }) => {
      console.log(`[SOCKET_FLOW] chess_join_socket_room received: code = ${roomCode}`);
      if (!roomCode) return;
      let cleanCode = roomCode.trim().toUpperCase();
      if (cleanCode && !cleanCode.startsWith('CHESS_')) {
        cleanCode = 'CHESS_' + cleanCode;
      }
      socket.join(cleanCode);
      const room = chessRooms.get(cleanCode);
      if (room && socket.user) {
        const player = room.players.find(p => p.id === socket.user._id.toString() || p.id === socket.user.id.toString());
        if (player) {
          player.socketId = socket.id;
        }
        io.to(cleanCode).emit('chess_lobby_updated', {
          roomCode: cleanCode,
          room,
          gameState: room.gameState
        });
      }
    });

    // --- Bots ---
    socket.on('chess_add_bot', async (data) => {
      const roomCode = data.roomCode;
      const room = chessRooms.get(roomCode);

      if (!room) return socket.emit('chess_error', 'Room not found');
      if (room.players.length >= room.maxPlayers) return socket.emit('chess_error', 'Room is full');

      const hostPlayer = room.players.find(p => p.id === room.host.toString()) || room.players[0];
      const botColorCode = hostPlayer.colorCode === 'w' ? 'b' : 'w';
      const botColorName = botColorCode === 'w' ? 'White' : 'Black';

      const bot = {
        id: `bot_${Date.now()}`,
        socketId: null,
        name: `Bot Chess`,
        avatar: 'https://api.dicebear.com/7.x/bottts/png?seed=BotChess',
        color: botColorName,
        colorCode: botColorCode,
        ready: true,
        isBot: true,
        difficulty: data.difficulty || 'easy' // 'easy' or 'medium'
      };

      room.players.push(bot);
      room.gameState.players = room.players;
      await saveChessRoomToDb(roomCode, room.gameState);

      io.to(roomCode).emit('chess_lobby_updated', {
        roomCode,
        room,
        gameState: room.gameState
      });
    });

    // --- Switch Color ---
    socket.on('chess_switch_color', async (data) => {
      const roomCode = data.roomCode;
      const room = chessRooms.get(roomCode);

      if (!room) return socket.emit('chess_error', 'Room not found');
      if (room.status !== 'waiting') return socket.emit('chess_error', 'Cannot switch color during game');

      if (room.host.toString() !== socket.user._id.toString()) {
        return socket.emit('chess_error', 'Only the host can switch color');
      }

      room.players.forEach(p => {
        if (p.colorCode === 'w') {
          p.color = 'Black';
          p.colorCode = 'b';
        } else {
          p.color = 'White';
          p.colorCode = 'w';
        }
      });

      room.gameState.players = room.players;
      room.gameState.turn = 'w';
      room.gameState.activeColor = 'White';
      await saveChessRoomToDb(roomCode, room.gameState);

      io.to(roomCode).emit('chess_lobby_updated', {
        roomCode,
        room,
        gameState: room.gameState
      });
    });

    // --- Game Controls ---
    socket.on('chess_start_game', async (data) => {
      const roomCode = data.roomCode;
      const room = chessRooms.get(roomCode);

      if (!room) return socket.emit('chess_error', 'Room not found');

      try {
        // Deduct entry fees
        for (const p of room.players) {
          if (!p.isBot) {
            const u = await User.findByPk(p.id);
            if (u) {
              u.coins -= room.entryFee;
              await u.save();
            }
          }
        }

        room.status = 'playing';
        room.gameState.status = 'playing';
        await saveChessRoomToDb(roomCode, room.gameState, 'playing');

        io.to(roomCode).emit('chess_game_started', {
          roomCode,
          room,
          gameState: room.gameState
        });
      } catch (err) {
        socket.emit('chess_error', 'Failed to start game');
      }
    });

    // --- Move Piece ---
    socket.on('chess_move_piece', async (data) => {
      console.log(`[CHESS_SOCKET] Human move received in room ${data.roomCode}: from (${data.from.row}, ${data.from.col}) to (${data.to.row}, ${data.to.col})`);
      const room = chessRooms.get(data.roomCode);
      const gameState = activeChessGames.get(data.roomCode) || (room ? room.gameState : null);

      if (!gameState) {
        console.error(`[CHESS_SOCKET] Game or room not found for roomCode: ${data.roomCode}`);
        return socket.emit('chess_error', 'Game or room not found');
      }

      if (gameState.status === 'completed') {
        console.log(`[CHESS_SOCKET] Move rejected: game already completed in room ${data.roomCode}`);
        return socket.emit('chess_error', 'Game already completed');
      }

      const { from, to } = data;
      const piece = gameState.board[from.row][from.col];

      try {
        const nextState = makeMove(gameState, from, to, data.promotion || 'q');
        
        console.log(`[CHESS_SOCKET] Board updated. Turn changed to: ${nextState.turn} (${nextState.activeColor})`);
        
        await saveChessRoomToDb(data.roomCode, nextState);

        io.to(data.roomCode).emit('chess_piece_moved', {
          roomCode: data.roomCode,
          board: nextState.board,
          gameState: nextState,
          from,
          to,
          piece
        });

        console.log(`[CHESS_SOCKET] Game-over checks: status=${nextState.status}, result=${nextState.result}`);

        if (nextState.status === 'completed') {
          await finalizeChessGameEnd(io, data.roomCode, nextState);
          return;
        }

        // Trigger bot if playing vs bot
        const nextActivePlayer = nextState.players.find(p => p.colorCode === nextState.turn);
        if (nextActivePlayer && nextActivePlayer.isBot) {
          console.log(`[CHESS_SOCKET] Bot trigger invoked for room ${data.roomCode}, color ${nextActivePlayer.colorCode}`);
          triggerBotMove(io, data.roomCode, nextState, nextActivePlayer.colorCode);
        }
      } catch (err) {
        console.error('[CHESS_SOCKET] Human move failed validation:', err.message);
        socket.emit('chess_error', err.message);
      }
    });

    // --- Undo Move (Practice vs Bot) ---
    socket.on('chess_undo_move', async (data) => {
      console.log(`[CHESS_SOCKET] Undo move requested for room ${data.roomCode}`);
      const room = chessRooms.get(data.roomCode);
      const gameState = activeChessGames.get(data.roomCode) || (room ? room.gameState : null);
      if (!gameState) return socket.emit('chess_error', 'Game not found');

      const hasBot = gameState.players.some(p => p.isBot);
      if (!hasBot) {
        return socket.emit('chess_error', 'Undo is only allowed in single player practice vs bot');
      }

      try {
        const steps = gameState.moveHistory.length >= 2 ? 2 : (gameState.moveHistory.length === 1 ? 1 : 0);
        if (steps === 0) {
          return socket.emit('chess_error', 'No moves to undo');
        }

        const nextState = undoLastMove(gameState, steps);
        
        if (room) {
          room.gameState = nextState;
          chessRooms.set(data.roomCode, room);
        }
        activeChessGames.set(data.roomCode, nextState);
        await saveChessRoomToDb(data.roomCode, nextState);

        io.to(data.roomCode).emit('chess_piece_moved', {
          roomCode: data.roomCode,
          board: nextState.board,
          gameState: nextState,
          from: null,
          to: null,
          piece: null
        });
      } catch (err) {
        console.error('[CHESS_SOCKET] Undo failed:', err.message);
        socket.emit('chess_error', err.message);
      }
    });

    // --- Resign ---
    socket.on('chess_resign', async (data) => {
      const roomCode = data.roomCode;
      const gameState = activeChessGames.get(roomCode);

      if (!gameState) return socket.emit('chess_error', 'Game not found');

      const activeColor = gameState.players.find(p => p.id === socket.user?._id.toString())?.color;
      if (!activeColor) return;

      gameState.status = 'completed';
      gameState.winner = activeColor === 'White' ? 'Black' : 'White';
      gameState.result = 'resign';

      await finalizeChessGameEnd(io, roomCode, gameState);
    });

    // --- In-game Chat ---
    socket.on('chess_send_message', (data) => {
      const { roomCode, text } = data;
      io.to(roomCode).emit('chess_chat_message', {
        senderId: socket.user ? socket.user._id : socket.id,
        senderName: socket.user ? socket.user.name : 'Guest',
        text,
        timestamp: new Date()
      });
    });

    // --- Voice Token ---
    socket.on('chess_request_voice_token', async (data) => {
      const roomCode = data.roomCode;
      if (!socket.user) return socket.emit('chess_error', 'Authentication error');

      try {
        const voiceData = await generateVoiceToken(roomCode, socket.user._id.toString(), socket.user.name);
        socket.emit('chess_voice_token', voiceData);
      } catch (err) {
        socket.emit('chess_error', 'Failed to generate voice token');
      }
    });
  });
}

const botMoveQueue = new Set();

function triggerBotMove(io, roomCode, gameState, botColorCode) {
  if (botMoveQueue.has(roomCode)) {
    console.log(`[CHESS_BOT] Bot move already in progress for room ${roomCode}, skipping trigger.`);
    return;
  }
  botMoveQueue.add(roomCode);

  console.log(`[CHESS_BOT] Bot trigger invoked for room ${roomCode}, color ${botColorCode}`);

  setTimeout(async () => {
    try {
      const room = chessRooms.get(roomCode);
      const freshState = activeChessGames.get(roomCode) || (room ? room.gameState : null);

      if (!freshState) {
        console.log(`[CHESS_BOT] Game state not found for room ${roomCode}, exiting bot trigger.`);
        botMoveQueue.delete(roomCode);
        return;
      }

      if (freshState.status !== 'playing') {
        console.log(`[CHESS_BOT] Game status is ${freshState.status}, not playing. Exiting bot trigger.`);
        botMoveQueue.delete(roomCode);
        return;
      }

      if (freshState.turn !== botColorCode) {
        console.log(`[CHESS_BOT] Stale turn check. Turn is ${freshState.turn}, bot color is ${botColorCode}. Exiting bot trigger.`);
        botMoveQueue.delete(roomCode);
        return;
      }

      const botMove = getBotMove(freshState, botColorCode);
      if (!botMove) {
        console.log(`[CHESS_BOT] No legal moves for bot color ${botColorCode} (Stalemate/Checkmate checks).`);
        botMoveQueue.delete(roomCode);
        return;
      }

      console.log(`[CHESS_BOT] Bot move selected in room ${roomCode}: from (${botMove.from.row}, ${botMove.from.col}) to (${botMove.to.row}, ${botMove.to.col})`);

      const nextState = makeMove(freshState, botMove.from, botMove.to, 'q');
      
      // Save game state consistently
      activeChessGames.set(roomCode, nextState);
      if (room) {
        room.gameState = nextState;
      }

      console.log(`[CHESS_BOT] Bot move executed. Turn changed to: ${nextState.turn} (${nextState.activeColor})`);

      io.to(roomCode).emit('chess_piece_moved', {
        roomCode: roomCode,
        board: nextState.board,
        gameState: nextState,
        from: botMove.from,
        to: botMove.to,
        piece: nextState.board[botMove.to.row][botMove.to.col]
      });

      console.log(`[CHESS_BOT] Game status check after bot move: status=${nextState.status}, result=${nextState.result}`);
      if (nextState.status === 'completed') {
        await finalizeChessGameEnd(io, roomCode, nextState);
      }
    } catch (err) {
      console.error('[CHESS_BOT] Error during bot move execution:', err.message);
    } finally {
      botMoveQueue.delete(roomCode);
    }
  }, 1000);
}

async function finalizeChessGameEnd(io, roomCode, gameState) {
  try {
    const room = chessRooms.get(roomCode);
    
    // Save to Database
    const winnerColor = gameState.winner; // 'White', 'Black' or 'Draw'
    let winnerId = null;
    let winnerName = 'Draw';

    if (winnerColor !== 'Draw') {
      const winnerPlayer = gameState.players.find(p => p.color === winnerColor);
      if (winnerPlayer) {
        winnerId = winnerPlayer.id.startsWith('bot_') ? null : winnerPlayer.id;
        winnerName = winnerPlayer.name;
      }
    }

    const entryFee = gameState.entryFee || 0;
    const prizePool = entryFee * gameState.players.length;

    // Award coins and update user profiles
    if (winnerColor !== 'Draw' && winnerId) {
      const winnerUser = await User.findByPk(winnerId);
      if (winnerUser) {
        winnerUser.coins += prizePool;
        winnerUser.xp += 200;
        winnerUser.totalWins += 1;
        winnerUser.totalGames += 1;
        await winnerUser.save();
      }

      // Losers
      for (const p of gameState.players) {
        if (!p.isBot && p.id !== winnerId) {
          const loserUser = await User.findByPk(p.id);
          if (loserUser) {
            loserUser.losses += 1;
            loserUser.totalGames += 1;
            loserUser.xp += 40;
            await loserUser.save();
          }
        }
      }
    } else if (winnerColor === 'Draw') {
      // Refund entry fees on stalemate or draw
      for (const p of gameState.players) {
        if (!p.isBot) {
          const playerUser = await User.findByPk(p.id);
          if (playerUser) {
            playerUser.coins += entryFee;
            playerUser.totalGames += 1;
            playerUser.xp += 100;
            await playerUser.save();
          }
        }
      }
    }

    // Save match model
    const match = new Match({
      roomCode: roomCode,
      gameType: 'chess',
      players: gameState.players.map(p => ({
        user: p.id.startsWith('bot_') ? null : p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        isBot: p.isBot
      })),
      winner: winnerId ? { user: winnerId, name: winnerName } : undefined,
      entryFee: entryFee,
      prizePool: prizePool,
      result: gameState.result,
      moves: gameState.history
    });

    await match.save();

    io.to(roomCode).emit('chess_game_ended', {
      winnerColor,
      winnerName,
      winnerId,
      result: gameState.result,
      gameState
    });

    // Cleanup memory
    activeChessGames.delete(roomCode);
    chessRooms.delete(roomCode);
  } catch (err) {
    console.error('[Chess Finalize Match Error]:', err.message);
  }
}

module.exports = {
  registerChessSocket,
  createChessRoomHelper,
  joinChessRoomHelper,
  chessRooms,
  activeChessGames
};
