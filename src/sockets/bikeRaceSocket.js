const Room = require('../models/Room');
const User = require('../models/User');
const Match = require('../models/Match');
const { initializeGame, updateGameState } = require('../services/bikeRaceEngine');
const jwt = require('jsonwebtoken');

// Memory store for active game loops
const activeGames = new Map();
const activeIntervals = new Map();
const matchmakingQueue = [];

async function createBikeRoomHelper(user, maxPlayers, entryFee, socketId = null) {
  const fee = parseInt(entryFee) || 100;
  const limit = parseInt(maxPlayers) || 4;
  const roomCode = 'BR_' + Math.random().toString(36).substring(2, 8).toUpperCase();

  const room = await Room.create({
    code: roomCode,
    hostId: user.id,
    players: [{
      user: user.id.toString(),
      name: user.name,
      avatar: user.avatar,
      color: 'Red',
      ready: true,
      socketId: socketId
    }],
    type: 'private',
    maxPlayers: limit,
    entryFee: fee,
    status: 'waiting'
  });

  return { room, gameState: initializeGame(room) };
}

async function joinBikeRoomHelper(user, code, socketId = null) {
  const roomCode = (code || '').trim().toUpperCase();
  const room = await Room.findOne({ where: { code: roomCode, status: 'waiting' } });
  if (!room) {
    throw new Error('Room not found or game already started');
  }

  if (room.players.length >= room.maxPlayers) {
    throw new Error('Room is full');
  }

  const alreadyJoined = room.players.find(p => p.user && p.user.toString() === user.id.toString());
  if (alreadyJoined) {
    if (socketId) alreadyJoined.socketId = socketId;
    return room;
  }

  const assignedColors = room.players.map(p => p.color);
  const allColors = ['Red', 'Green', 'Yellow', 'Blue'];
  const freeColor = allColors.find(c => !assignedColors.includes(c)) || 'Blue';

  room.players = [...room.players, {
    user: user.id.toString(),
    name: user.name,
    avatar: user.avatar,
    color: freeColor,
    ready: false,
    socketId: socketId
  }];
  room.changed('players', true);
  await room.save();

  return room;
}

function registerBikeRaceSocket(io) {
  console.log('[BIKE_RACE_SOCKET] Bike Racing socket handler registered');

  io.on('connection', (socket) => {
    console.log('[BIKE_SOCKET] client connected');

    const sendError = (msg) => {
      console.log('[BIKE_SOCKET] error emitted:', msg);
      socket.emit('br_error', msg);
    };

    // --- Matchmaking ---
    socket.on('br_join_matchmaking', async ({ maxPlayers }) => {
      if (!socket.user) return sendError('Authentication error');
      
      const reqPlayers = parseInt(maxPlayers) || 2;
      console.log(`[Bike Matchmaking] ${socket.user.name} joined queue for ${reqPlayers}p.`);

      // Prevent duplicates
      const index = matchmakingQueue.findIndex(p => p.userId.toString() === socket.user.id.toString());
      if (index !== -1) {
        matchmakingQueue.splice(index, 1);
      }

      matchmakingQueue.push({
        socketId: socket.id,
        userId: socket.user.id.toString(),
        name: socket.user.name,
        avatar: socket.user.avatar,
        coins: socket.user.coins,
        maxPlayers: reqPlayers
      });

      const candidates = matchmakingQueue.filter(p => p.maxPlayers === reqPlayers);

      if (candidates.length >= reqPlayers) {
        const matched = candidates.slice(0, reqPlayers);
        
        // Remove from queue
        matched.forEach(m => {
          const idx = matchmakingQueue.findIndex(p => p.socketId === m.socketId);
          if (idx !== -1) matchmakingQueue.splice(idx, 1);
        });

        const roomCode = 'BR_' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const colors = ['Red', 'Green', 'Yellow', 'Blue'];

        try {
          const room = await Room.create({
            code: roomCode,
            hostId: parseInt(matched[0].userId),
            players: matched.map((p, idx) => ({
              user: p.userId,
              name: p.name,
              avatar: p.avatar,
              color: colors[idx],
              ready: true
            })),
            type: 'public',
            maxPlayers: reqPlayers,
            entryFee: 100,
            status: 'playing'
          });

          // Deduct entry fee
          for (const p of matched) {
            const u = await User.findByPk(p.userId);
            if (u) {
              u.coins -= 100;
              await u.save();
            }
          }

          // Let sockets join room
          matched.forEach(p => {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.join(roomCode);
          });

          // Initialize game loop
          const gameState = initializeGame(room);
          activeGames.set(roomCode, gameState);

          console.log(`[BIKE_SOCKET] raceStarted emitted for matchmaking: ${roomCode}`);
          io.to(roomCode).emit('br_match_found', {
            roomCode,
            room,
            gameState
          });

          // Start the Tick Interval
          startGameLoop(io, roomCode);

          console.log(`[Bike Match] Created matchmaking room: ${roomCode}`);
        } catch (err) {
          console.error('[Bike Matchmaking Error]:', err.message);
          sendError('Failed to create matchmaking game');
        }
      } else {
        socket.emit('br_matchmaking_status', { status: 'waiting', count: candidates.length });
      }
    });

    socket.on('br_leave_matchmaking', () => {
      const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);
      socket.emit('br_matchmaking_status', { status: 'idle' });
    });

    // --- Custom Room ---
    socket.on('br_create_room', async ({ maxPlayers, entryFee }) => {
      console.log('[BIKE_SOCKET] createRoom received');
      if (!socket.user) return sendError('Authentication error');

      try {
        const { room, gameState } = await createBikeRoomHelper(socket.user, maxPlayers, entryFee, socket.id);
        socket.join(room.code);
        console.log('[BIKE_SOCKET] roomCreated emitted');
        socket.emit('br_room_created', {
          success: true,
          roomCode: room.code,
          room,
          gameState
        });
      } catch (err) {
        sendError(err.message);
      }
    });

    socket.on('br_join_room', async ({ code }) => {
      console.log('[BIKE_SOCKET] joinRoom received');
      if (!socket.user) return sendError('Authentication error');

      try {
        const room = await joinBikeRoomHelper(socket.user, code, socket.id);
        socket.join(room.code);

        console.log('[BIKE_SOCKET] playerJoined emitted');
        io.to(room.code).emit('br_lobby_updated', {
          roomCode: room.code,
          room,
          gameState: initializeGame(room)
        });

        socket.emit('br_room_joined', {
          success: true,
          roomCode: room.code,
          room,
          gameState: initializeGame(room)
        });
      } catch (err) {
        sendError(err.message);
      }
    });

    socket.on('br_join_socket_room', async ({ roomCode }) => {
      console.log(`[SOCKET_FLOW] br_join_socket_room received: code = ${roomCode}`);
      if (!roomCode) return;
      const code = roomCode.trim().toUpperCase();
      socket.join(code);
      const room = await Room.findOne({ where: { code } });
      if (room) {
        const playersList = [...room.players];
        const idx = playersList.findIndex(p => p.user && p.user.toString() === socket.user.id.toString());
        if (idx !== -1) {
          playersList[idx].socketId = socket.id;
          room.players = playersList;
          room.changed('players', true);
          await room.save();
        }
        io.to(code).emit('br_lobby_updated', {
          roomCode: code,
          room,
          gameState: initializeGame(room)
        });
      }
    });

    socket.on('br_toggle_ready', async ({ roomCode }) => {
      if (!socket.user) return;
      try {
        const room = await Room.findOne({ where: { code: roomCode } });
        if (!room) return;

        const playersList = [...room.players];
        const idx = playersList.findIndex(p => p.user && p.user.toString() === socket.user.id.toString());
        if (idx !== -1) {
          playersList[idx].ready = !playersList[idx].ready;
          room.players = playersList;
          room.changed('players', true);
          await room.save();

          console.log(`[BIKE_SOCKET] playerStateUpdate received (toggle ready) for ${socket.user.name}`);
          io.to(roomCode).emit('br_lobby_updated', {
            roomCode,
            room,
            gameState: initializeGame(room)
          });
        }
      } catch (err) {
        sendError(err.message);
      }
    });

    socket.on('br_add_bot', async ({ roomCode }) => {
      if (!socket.user) return;
      try {
        const room = await Room.findOne({ where: { code: roomCode } });
        if (!room) return;

        if (room.hostId !== socket.user.id) {
          return sendError('Only the host can add bots');
        }

        if (room.players.length >= room.maxPlayers) {
          return sendError('Room is full');
        }

        const assignedColors = room.players.map(p => p.color);
        const allColors = ['Red', 'Green', 'Yellow', 'Blue'];
        const freeColor = allColors.find(c => !assignedColors.includes(c)) || 'Blue';

        room.players = [...room.players, {
          user: null,
          id: `bot_${Date.now()}`,
          name: `Bot ${freeColor}`,
          avatar: `https://api.dicebear.com/7.x/bottts/png?seed=Bot${freeColor}`,
          color: freeColor,
          ready: true,
          isBot: true
        }];
        room.changed('players', true);
        await room.save();

        console.log(`[BIKE_SOCKET] playerStateUpdate received (add bot) in room ${roomCode}`);
        io.to(roomCode).emit('br_lobby_updated', {
          roomCode,
          room,
          gameState: initializeGame(room)
        });
      } catch (err) {
        sendError(err.message);
      }
    });

    socket.on('br_start_game', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ where: { code: roomCode } });
        if (!room) return;

        if (room.hostId !== socket.user.id) {
          return sendError('Only the host can start the game');
        }

        // Deduct entry fees
        for (const p of room.players) {
          if (!p.isBot && p.user) {
            const u = await User.findByPk(p.user);
            if (u) {
              u.coins -= room.entryFee;
              await u.save();
            }
          }
        }

        room.status = 'playing';
        await room.save();

        const gameState = initializeGame(room);
        activeGames.set(roomCode, gameState);

        console.log(`[BIKE_SOCKET] raceStarted emitted for room ${roomCode}`);
        io.to(roomCode).emit('br_game_started', {
          roomCode,
          room,
          gameState
        });

        // Start Loop Ticks
        startGameLoop(io, roomCode);
      } catch (err) {
        sendError(err.message);
      }
    });

    // --- In-Game Inputs ---
    socket.on('br_change_lane', ({ roomCode, lane }) => {
      const state = activeGames.get(roomCode);
      if (!state || !socket.user) return;

      const player = state.players.find(p => p.id === socket.user.id.toString());
      if (player && !player.crashed && !player.finished) {
        player.lane = Math.max(0, Math.min(2, parseInt(lane)));
        console.log(`[BIKE_SOCKET] playerStateUpdate received (lane change: ${lane}) for ${socket.user.name}`);
      }
    });

    socket.on('br_jump', ({ roomCode }) => {
      const state = activeGames.get(roomCode);
      if (!state || !socket.user) return;

      const player = state.players.find(p => p.id === socket.user.id.toString());
      if (player && !player.crashed && !player.finished && player.jumpProgress === 0.0) {
        player.jumpProgress = 1.0; // trigger jump arc
        console.log(`[BIKE_SOCKET] playerStateUpdate received (jump) for ${socket.user.name}`);
      }
    });

    socket.on('br_use_boost', ({ roomCode }) => {
      const state = activeGames.get(roomCode);
      if (!state || !socket.user) return;

      const player = state.players.find(p => p.id === socket.user.id.toString());
      if (player && !player.crashed && !player.finished) {
        player.boostDuration = 2.0;
        console.log(`[BIKE_SOCKET] playerStateUpdate received (boost) for ${socket.user.name}`);
      }
    });
  });
}

function startGameLoop(io, roomCode) {
  // Step intervals of 50ms (20hz tickrate)
  const deltaTime = 0.05;
  const interval = setInterval(async () => {
    let state = activeGames.get(roomCode);
    if (!state) {
      clearInterval(interval);
      return;
    }

    state = updateGameState(state, deltaTime);
    activeGames.set(roomCode, state);

    if (state.status === 'completed') {
      clearInterval(interval);
      await finalizeGame(io, roomCode, state);
    } else {
      console.log(`[BIKE_SOCKET] raceState broadcasted for room ${roomCode}`);
      io.to(roomCode).emit('br_tick_sync', state);
    }
  }, 50);

  activeIntervals.set(roomCode, interval);
}

async function finalizeGame(io, roomCode, gameState) {
  try {
    const room = await Room.findOne({ where: { code: roomCode } });
    if (!room) return;

    room.status = 'completed';
    const winningPlayer = gameState.winner;

    if (winningPlayer && winningPlayer.id && !winningPlayer.id.startsWith('bot_')) {
      const winnerId = parseInt(winningPlayer.id);
      room.winnerId = winnerId;
      await room.save();

      const prizePool = room.entryFee * room.maxPlayers;
      const winnerUser = await User.findByPk(winnerId);
      if (winnerUser) {
        winnerUser.coins += prizePool;
        winnerUser.xp += 250; // Race rewards
        winnerUser.totalWins += 1;
        winnerUser.totalGames += 1;
        await winnerUser.save();
      }

      // Losers
      for (const p of room.players) {
        if (p.user && p.user.toString() !== winnerId.toString()) {
          const loserUser = await User.findByPk(p.user);
          if (loserUser) {
            loserUser.losses += 1;
            loserUser.totalGames += 1;
            loserUser.xp += 50;
            await loserUser.save();
          }
        }
      }
    }

    // Save Match logs
    const match = await Match.create({
      roomCode,
      gameType: 'bike_race',
      players: room.players.map(p => ({
        user: p.user,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        isBot: p.isBot
      })),
      winner: winningPlayer ? {
        user: winningPlayer.id.startsWith('bot_') ? null : winningPlayer.id,
        name: winningPlayer.name
      } : null,
      entryFee: room.entryFee,
      prizePool: room.entryFee * room.maxPlayers,
      result: 'checkmate' // Fallback checkmate/draw category
    });

    console.log(`[BIKE_SOCKET] raceFinished saved for room ${roomCode}`);

    io.to(roomCode).emit('br_game_ended', {
      winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
      winnerId: winningPlayer ? winningPlayer.id : null,
      gameState
    });

    // Cleanup
    activeGames.delete(roomCode);
    activeIntervals.delete(roomCode);
  } catch (err) {
    console.error('[Bike End Game Loop Error]:', err.message);
  }
}

module.exports = {
  registerBikeRaceSocket,
  createBikeRoomHelper,
  joinBikeRoomHelper
};
