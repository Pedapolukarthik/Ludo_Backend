const Room = require('../models/Room');
const User = require('../models/User');
const Match = require('../models/Match');
const Chat = require('../models/Chat');
const { initializeGame, handleDiceRoll, handlePlayerMove } = require('../services/snakeLadderEngine');
const { selectBotAction } = require('../services/snakeLadderBotService');
const jwt = require('jsonwebtoken');
const { incrementMissionProgressHelper } = require('../controllers/rewardController');

// Memory store for active games in progress
const activeGames = new Map();
const snakeLadderRooms = new Map();
// Simple queue for matchmaking: stores user objects
let matchmakingQueue = [];

async function createSnakeRoomHelper(user, maxPlayers, entryFee, socketId = null) {
  const roomCode = "SL_" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const hostId = user.id || parseInt(user._id);

  const initialPlayer = {
    id: hostId.toString(),
    user: hostId.toString(),
    userId: hostId.toString(),
    socketId: socketId,
    name: user.name || "Guest",
    position: 1,
    ready: true,
    isBot: false,
    color: 'Red'
  };

  const room = await Room.create({
    code: roomCode,
    hostId: hostId,
    players: [initialPlayer],
    type: 'private',
    gameType: 'snake_ladder',
    maxPlayers: Number(maxPlayers || 2),
    entryFee: Number(entryFee || 0),
    status: 'waiting'
  });

  const gameState = {
    roomCode,
    maxPlayers: room.maxPlayers,
    entryFee: room.entryFee,
    status: "waiting",
    activePlayerIndex: 0,
    diceValue: null,
    hasRolledDice: false,
    diceRolled: false,
    pendingMove: false,
    rollState: 'idle',
    activeColor: 'Red',
    colors: ['Red'],
    players: room.players,
    history: [],
    moveHistory: [],
    events: [],
    logs: [],
    messages: [],
    snakes: {
      17: 7,
      54: 34,
      62: 19,
      64: 60,
      87: 24,
      93: 73,
      95: 75,
      99: 78
    },
    ladders: {
      4: 14,
      9: 31,
      20: 38,
      28: 84,
      40: 59,
      63: 81,
      71: 91
    }
  };

  room.gameState = gameState;
  await room.save();

  snakeLadderRooms.set(roomCode, room.toJSON());
  return { room: room.toJSON(), gameState };
}

async function joinSnakeRoomHelper(user, rawCode, socketId = null) {
  let roomCode = rawCode.trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "");
  if (roomCode.length === 6 && !roomCode.startsWith('SL')) {
    roomCode = 'SL_' + roomCode;
  }

  const room = await Room.findOne({ where: { code: roomCode } });
  if (!room) {
    throw new Error("Room not found");
  }

  if (room.status !== "waiting") {
    throw new Error("Game already started");
  }

  const players = Array.isArray(room.players) ? room.players : JSON.parse(room.players || '[]');
  if (players.length >= room.maxPlayers) {
    throw new Error("Room is full");
  }

  const userIdStr = (user._id || user.id).toString();
  const alreadyJoined = players.find(p => p.id === userIdStr);
  if (alreadyJoined) {
    if (socketId) alreadyJoined.socketId = socketId;
    return room.toJSON();
  }

  const assignedColors = players.map(p => p.color);
  const allColors = ['Red', 'Green', 'Yellow', 'Blue'];
  const freeColor = allColors.find(c => !assignedColors.includes(c)) || 'Blue';

  const newPlayer = {
    id: userIdStr,
    user: userIdStr,
    userId: userIdStr,
    socketId: socketId,
    name: user.name || "Guest",
    avatar: user.avatar || "https://api.dicebear.com/7.x/bottts/png?seed=Guest",
    color: freeColor,
    position: 1,
    ready: false,
    isBot: false
  };

  players.push(newPlayer);
  room.players = players;
  
  const currentGameState = room.gameState || {};
  currentGameState.players = players;
  room.gameState = currentGameState;
  
  room.changed('players', true);
  room.changed('gameState', true);
  await room.save();

  snakeLadderRooms.set(roomCode, room.toJSON());
  return room.toJSON();
}

async function saveSnakeRoomToDb(roomCode, gameState, roomStatus = null) {
  try {
    const room = await Room.findOne({ where: { code: roomCode } });
    if (room) {
      room.gameState = gameState;
      if (roomStatus) {
        room.status = roomStatus;
      }
      room.changed('gameState', true);
      await room.save();
      snakeLadderRooms.set(roomCode, room.toJSON());
      activeGames.set(roomCode, gameState);
    }
  } catch (err) {
    console.error('[SL_DB_SYNC_ERROR]:', err.message);
  }
}

async function getSnakeRoom(roomCode) {
  if (!roomCode) return null;
  const cleanCode = roomCode.trim().toUpperCase();
  let room = snakeLadderRooms.get(cleanCode);
  if (!room) {
    const dbRoom = await Room.findOne({ where: { code: cleanCode } });
    if (dbRoom) {
      room = dbRoom.toJSON();
      snakeLadderRooms.set(cleanCode, room);
      if (room.gameState) {
        activeGames.set(cleanCode, room.gameState);
      }
    }
  }
  return room;
}

function registerSnakeLadderSocket(io) {
  console.log("[SL_SOCKET] Snake Ladder socket registered");
  io.on('connection', (socket) => {
    console.log("[SL_SOCKET] client connected:", socket.id);

    // --- Matchmaking Events ---
    socket.on('sl_join_matchmaking', async ({ maxPlayers }) => {
      if (!socket.user) {
        return socket.emit('sl_error', 'Authentication error');
      }
      
      console.log(`[SL Matchmaking] ${socket.user.name} joined queue.`);
      
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

      const candidates = matchmakingQueue.filter(p => p.maxPlayers === maxPlayers);
      
      if (candidates.length >= maxPlayers) {
        const matched = candidates.slice(0, maxPlayers);
        
        // Remove from queue
        matchmakingQueue = matchmakingQueue.filter(p => !matched.find(m => m.socketId === p.socketId));

        const roomCode = 'SL-' + Math.random().toString(36).substring(2, 8).toUpperCase();
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
            entryFee: 50, // default quick match fee
            status: 'playing'
          });

          await room.save();

          // Initialize game board coordinates
          const gameState = initializeGame(room);
          activeGames.set(roomCode, gameState);

          // Let sockets join room
          matched.forEach(p => {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.join(roomCode);
          });

          // Emit to all matched players
          io.to(roomCode).emit('sl_match_found', {
            roomCode,
            gameState
          });

          console.log(`[SL Match] Created: Room ${roomCode}`);
        } catch (err) {
          console.error('SL Matchmaking DB error:', err.message);
          socket.emit('sl_error', 'Database error starting match');
        }
      } else {
        socket.emit('sl_matchmaking_status', { status: 'waiting', count: candidates.length });
      }
    });

    socket.on('sl_leave_matchmaking', () => {
      matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
      socket.emit('sl_matchmaking_status', { status: 'idle' });
    });

    socket.on('sl_create_room', async (data) => {
      try {
        console.log("[SL_CREATE] received:", data);
        const maxPlayers = Number(data.maxPlayers || 2);
        const entryFee = Number(data.entryFee || 0);

        const user = socket.user || {
          _id: socket.id,
          id: socket.id,
          name: "Guest",
          coins: 99999,
          avatar: ""
        };

        const { room, gameState } = await createSnakeRoomHelper(user, maxPlayers, entryFee, socket.id);
        socket.join(room.code);
        console.log("[SL_CREATE] emitting sl_room_created:", room.code);

        socket.emit("sl_room_created", {
          success: true,
          roomCode: room.code,
          room,
          gameState
        });
      } catch (error) {
        console.error("[SL_CREATE] failed:", error);
        socket.emit("sl_error", {
          message: error.message || "Room creation failed"
        });
      }
    });

    socket.on('sl_join_room', async (data) => {
      if (!socket.user) return socket.emit('sl_error', { message: 'Authentication error' });
      
      const rawCode = data.roomCode || data.code || "";
      console.log("[SL_JOIN] raw data:", data);

      try {
        const room = await joinSnakeRoomHelper(socket.user, rawCode, socket.id);
        socket.join(room.code);
        
        io.to(room.code).emit('sl_lobby_updated', {
          roomCode: room.code,
          room,
          gameState: room.gameState
        });
        socket.emit('sl_room_joined', {
          success: true,
          roomCode: room.code,
          room,
          gameState: room.gameState
        });
      } catch (err) {
        socket.emit('sl_error', { message: err.message });
      }
    });

    socket.on('sl_join_socket_room', async ({ roomCode }) => {
      console.log(`[SOCKET_FLOW] sl_join_socket_room received: code = ${roomCode}`);
      if (!roomCode) return;
      let cleanCode = roomCode.trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "");
      if (cleanCode.length === 6 && !cleanCode.startsWith('SL')) {
        cleanCode = 'SL_' + cleanCode;
      }
      socket.join(cleanCode);
      const room = await getSnakeRoom(cleanCode);
      if (room && socket.user) {
        const player = room.players.find(p => p.id === socket.user._id.toString() || p.id === socket.user.id.toString());
        if (player) {
          player.socketId = socket.id;
        }
        io.to(cleanCode).emit('sl_lobby_updated', {
          roomCode: cleanCode,
          room,
          gameState: room.gameState
        });
      }
    });

    socket.on('sl_toggle_ready', async (data) => {
      console.log("[SL_READY] toggle ready received:", data);
      if (!socket.user) return;
      const roomCode = data.roomCode;
      try {
        const room = await getSnakeRoom(roomCode);
        if (!room) return;

        const user = socket.user;
        const playerIdx = room.players.findIndex(p => p.id === user._id.toString() || p.id === user.id);
        if (playerIdx !== -1) {
          room.players[playerIdx].ready = !room.players[playerIdx].ready;
          room.gameState.players = room.players;
          
          io.to(roomCode).emit('sl_lobby_updated', {
            roomCode,
            room,
            gameState: room.gameState
          });
        }
      } catch (err) {
        socket.emit('sl_error', { message: err.message });
      }
    });

    socket.on('sl_start_game', async (data) => {
      console.log("[SL_START] launch game received:", data);
      const roomCode = data ? data.roomCode : null;
      try {
        console.log("[SL_START] roomCode:", roomCode);
        console.log("[SL_START] socket.id:", socket.id);
        console.log("[SL_START] socket.user:", socket.user);

        const room = await getSnakeRoom(roomCode);
        if (!room) {
          return socket.emit("sl_error", { message: "Room not found" });
        }

        const requesterId = socket.user?.id || socket.user?._id || socket.id;

        const isPlayerInRoom = room.players.some(p =>
          p.id === requesterId || p.socketId === socket.id
        );

        if (!isPlayerInRoom) {
          return socket.emit("sl_error", {
            message: "You are not in this room"
          });
        }

        if (room.players.length >= room.maxPlayers) {
          room.status = 'playing';
          room.messages = [];
          room.chat = [];
          room.events = [];
          room.gameState.status = 'playing';
          room.gameState.players = room.players;
          room.gameState.activePlayerIndex = 0;
          room.gameState.activeColor = room.players[0].color || 'Red';
          room.gameState.colors = room.players.map(p => p.color);
          room.gameState.diceValue = null;
          room.gameState.hasRolledDice = false;
          room.gameState.diceRolled = false;
          room.gameState.pendingMove = false;
          room.gameState.rollState = 'idle';
          room.gameState.history = [];
          room.gameState.moveHistory = [];
          room.gameState.events = [];
          room.gameState.logs = [];
          room.gameState.messages = [];
          await saveSnakeRoomToDb(roomCode, room.gameState, 'playing');

          const activePlayer = room.gameState.players[room.gameState.activePlayerIndex];
          const activePlayerId = activePlayer ? (activePlayer.userId || activePlayer.id || activePlayer.user) : null;
          const activePlayerName = activePlayer ? activePlayer.name : "";

          console.log("[SL_START] emitting sl_game_started:", roomCode);
          io.to(roomCode).emit('sl_game_started', {
            roomCode,
            room,
            activePlayerIndex: room.gameState.activePlayerIndex,
            activePlayerId: activePlayerId,
            activePlayerName: activePlayerName,
            gameState: room.gameState
          });

          // Check if active color starts as bot
          if (isColorBot(room.gameState, room.gameState.players[0].color)) {
            triggerBotTurn(io, roomCode);
          }
        }
      } catch (err) {
        socket.emit('sl_error', { message: err.message });
      }
    });

    socket.on('sl_add_bot', async (data) => {
      try {
        console.log("[SL_ADD_BOT] received:", data);
        const roomCode = data.roomCode;
        const room = await getSnakeRoom(roomCode);

        if (!room) {
          console.log("[SL_ADD_BOT] room not found");
          return socket.emit("sl_error", { message: "Room not found" });
        }

        console.log("[SL_ADD_BOT] room found:", roomCode);

        if (room.players.length >= room.maxPlayers) {
          return socket.emit("sl_error", { message: "Room is full" });
        }

        const botNumber = room.players.length + 1;

        const bot = {
          id: `bot_${Date.now()}`,
          socketId: null,
          name: `Bot ${botNumber}`,
          avatar: "https://api.dicebear.com/7.x/bottts/png?seed=Bot" + botNumber,
          color: ["Red", "Green", "Yellow", "Blue"][room.players.length] || "Blue",
          position: 1,
          ready: true,
          isBot: true
        };

        room.players.push(bot);
        room.gameState.players = room.players;
        await saveSnakeRoomToDb(roomCode, room.gameState);

        console.log("[SL_ADD_BOT] bot added in room:", roomCode);
        console.log("[SL_ADD_BOT] emitting sl_lobby_updated");

        io.to(roomCode).emit("sl_lobby_updated", {
          roomCode,
          room,
          gameState: room.gameState
        });

      } catch (error) {
        console.error("[SL_ADD_BOT] failed:", error);
        socket.emit("sl_error", { message: error.message || "Add bot failed" });
      }
    });

    socket.on('sl_roll_dice', async (data) => {
      console.log("[SL_DICE] roll request received");
      const roomCode = data?.roomCode;
      const clientUserId = data?.userId;

      console.log("[SL_ROLL] roomCode:", roomCode);
      console.log("[SL_ROLL] socket.id:", socket.id);
      console.log("[SL_ROLL] socket.user:", socket.user);

      const gameState = activeGames.get(roomCode);
      if (!gameState) return socket.emit('sl_error', 'Game not found');

      try {
        gameState.history ??= [];
        gameState.moveHistory ??= [];
        gameState.events ??= [];
        gameState.logs ??= [];

        console.log("[SL_PUSH_CHECK]", {
          moveHistory: Array.isArray(gameState.moveHistory),
          events: Array.isArray(gameState.events),
          logs: Array.isArray(gameState.logs)
        });

        const requesterId =
          data?.userId?.toString() ||
          socket.user?._id?.toString() ||
          socket.user?.id?.toString() ||
          socket.id;

        const activePlayer =
          gameState.players[gameState.activePlayerIndex] ||
          gameState.players.find(p => p.color === gameState.activeColor);

        const isActivePlayer =
          requesterId == activePlayer.id ||
          requesterId == activePlayer.userId ||
          socket.id == activePlayer.socketId ||
          requesterId == (activePlayer.userId || activePlayer.id || activePlayer.user)?.toString();

        const activePlayerName = activePlayer ? activePlayer.name : "Player";
        if (!isActivePlayer) {
          return socket.emit("sl_error", {
            message: `Wait for ${activePlayerName}'s turn`
          });
        }

        if (gameState.hasRolledDice === true) {
          return socket.emit("sl_error", {
            message: "Dice already rolled"
          });
        }

        console.log("[SL_ROLL_STATE_BEFORE]", {
          diceValue: gameState.diceValue,
          hasRolledDice: gameState.hasRolledDice,
          activePlayerIndex: gameState.activePlayerIndex
        });

        const rollingColor = gameState.activeColor;
        const rollResult = handleDiceRoll(gameState, rollingColor);
        const { roll, forfeit, possibleMoves, overshoot, skipped, message } = rollResult;
        
        if (!overshoot && !skipped) {
          gameState.diceValue = roll;
          gameState.hasRolledDice = true;
        }
        console.log("[SL_ROLL] dice:", roll);

        io.to(roomCode).emit('sl_dice_rolled', {
          color: rollingColor,
          value: roll,
          forfeit,
          possibleMoves,
          gameState
        });

        if (overshoot || skipped) {
          const activePlayer = gameState.players.find(p => p.color === rollingColor);
          io.to(roomCode).emit("sl_move_skipped", {
            roomCode,
            playerId: activePlayer ? (activePlayer.userId || activePlayer.id || activePlayer.user) : null,
            playerName: activePlayer ? activePlayer.name : rollingColor,
            diceValue: roll,
            position: activePlayer ? activePlayer.position : 0,
            message: message || "Need exact roll to finish",
            gameState
          });

          setTimeout(() => {
            const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
            const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
            const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
            const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

            console.log("[SL_ROLL_STATE_AFTER_RESET]", {
              diceValue: gameState.diceValue,
              hasRolledDice: gameState.hasRolledDice
            });

            emitTurnChanged(io, roomCode, gameState);
            if (isColorBot(gameState, gameState.activeColor)) {
              triggerBotTurn(io, roomCode);
            }
          }, 1500);
          return;
        }

        if (forfeit || possibleMoves.length === 0) {
          // Automatic pass turn
          setTimeout(() => {
            const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
            const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
            const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
            const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

            console.log("[SL_ROLL_STATE_AFTER_RESET]", {
              diceValue: gameState.diceValue,
              hasRolledDice: gameState.hasRolledDice
            });

            emitTurnChanged(io, roomCode, gameState);
            if (isColorBot(gameState, gameState.activeColor)) {
              triggerBotTurn(io, roomCode);
            }
          }, 1500);
        } else {
          // In Snake & Ladder, the move follows immediately because there is no choice of pawns
          setTimeout(async () => {
            const result = handlePlayerMove(gameState, rollingColor);
            
            io.to(roomCode).emit('sl_player_moved', {
              color: rollingColor,
              from: result.from,
              to: result.to,
              effect: result.effect,
              gameEnded: result.gameEnded,
              isSnakeBite: result.effect === 'snake',
              playerId: activePlayer ? (activePlayer.userId || activePlayer.id || activePlayer.user)?.toString() : null,
              playerSocketId: activePlayer ? activePlayer.socketId : null,
              playerName: activePlayer ? activePlayer.name : rollingColor,
              snakeFrom: result.effect === 'snake' ? (result.from + roll) : null,
              snakeTo: result.effect === 'snake' ? result.to : null,
              gameState
            });

            if (result.gameEnded) {
              await finalizeGameEnd(io, roomCode, gameState);
            } else {
              const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
              const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
              const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
              const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

              console.log("[SL_ROLL_STATE_AFTER_RESET]", {
                diceValue: gameState.diceValue,
                hasRolledDice: gameState.hasRolledDice
              });

              emitTurnChanged(io, roomCode, gameState);
              if (isColorBot(gameState, gameState.activeColor)) {
                triggerBotTurn(io, roomCode);
              }
            }
          }, 1000);
        }
      } catch (error) {
        console.error("[SL_ROLL_ERROR]", error);
        socket.emit("sl_error", {
          message: error.message || "Roll dice failed"
        });
      }
    });

    socket.on('sl_send_message', async ({ roomCode, text }) => {
      if (!socket.user) return;
      io.to(roomCode).emit('sl_chat_message', {
        senderId: socket.user._id,
        senderName: socket.user.name,
        text,
        timestamp: new Date()
      });
    });
  });
}

function isColorBot(gameState, color) {
  const p = gameState.players.find(pl => pl.color === color);
  return p ? p.isBot : false;
}

function triggerBotTurn(io, roomCode) {
  const botAction = selectBotAction();
  setTimeout(() => {
    const gameState = activeGames.get(roomCode);
    if (!gameState || gameState.winner) return;

    const botColor = gameState.activeColor;
    try {
      const rollResult = handleDiceRoll(gameState, botColor);
      const { roll, forfeit, possibleMoves, overshoot, skipped, message } = rollResult;

      io.to(roomCode).emit('sl_dice_rolled', {
        color: botColor,
        value: roll,
        forfeit,
        possibleMoves,
        gameState
      });

      if (overshoot || skipped) {
        const activePlayer = gameState.players.find(p => p.color === botColor);
        io.to(roomCode).emit("sl_move_skipped", {
          roomCode,
          playerId: activePlayer ? (activePlayer.userId || activePlayer.id || activePlayer.user) : null,
          playerName: activePlayer ? activePlayer.name : botColor,
          diceValue: roll,
          position: activePlayer ? activePlayer.position : 0,
          message: message || "Need exact roll to finish",
          gameState
        });

        setTimeout(() => {
          const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
          const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
          const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
          const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

          emitTurnChanged(io, roomCode, gameState);
          if (isColorBot(gameState, gameState.activeColor)) {
            triggerBotTurn(io, roomCode);
          }
        }, 1500);
        return;
      }

      if (forfeit || possibleMoves.length === 0) {
        setTimeout(() => {
          const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
          const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
          const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
          const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

          emitTurnChanged(io, roomCode, gameState);
          if (isColorBot(gameState, gameState.activeColor)) {
            triggerBotTurn(io, roomCode);
          }
        }, 1500);
      } else {
        setTimeout(async () => {
          const result = handlePlayerMove(gameState, botColor);
          
          const activePlayer = gameState.players.find(p => p.color === botColor);
          io.to(io.to ? roomCode : roomCode).emit('sl_player_moved', {
            color: botColor,
            from: blockNormalize(result.from),
            to: blockNormalize(result.to),
            effect: result.effect,
            gameEnded: result.gameEnded,
            isSnakeBite: result.effect === 'snake',
            playerId: activePlayer ? (activePlayer.userId || activePlayer.id || activePlayer.user)?.toString() : null,
            playerSocketId: activePlayer ? activePlayer.socketId : null,
            playerName: activePlayer ? activePlayer.name : botColor,
            snakeFrom: result.effect === 'snake' ? (blockNormalize(result.from) + roll) : null,
            snakeTo: result.effect === 'snake' ? blockNormalize(result.to) : null,
            gameState
          });

          if (result.gameEnded) {
            await finalizeGameEnd(io, roomCode, gameState);
          } else {
            const nextActivePlayer = gameState.players.find(p => p.color === gameState.activeColor);
            const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
            const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
            const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);

            emitTurnChanged(io, roomCode, gameState);
            if (isColorBot(gameState, gameState.activeColor)) {
              triggerBotTurn(io, roomCode);
            }
          }
        }, 1000);
      }
    } catch (err) {
      console.error('[SL Bot Turn Error]:', err.message);
    }
  }, botAction.delayMs);
}

function blockNormalize(val) {
  return typeof val === 'number' ? val : 0;
}

async function finalizeGameEnd(io, roomCode, gameState) {
  try {
    const room = await Room.findOne({ where: { code: roomCode } });
    if (!room) return;

    room.status = 'completed';
    const winningPlayer = gameState.players.find(p => p.color === gameState.winner);
    
    if (winningPlayer && winningPlayer.userId) {
      const winnerId = winningPlayer.userId;
      room.winner = winnerId;
      await room.save();

      // Award coins and XP
      const winnerUser = await User.findByPk(winnerId);
      if (winnerUser) {
        const winnings = room.entryFee * room.maxPlayers;
        winnerUser.coins += winnings;
        winnerUser.xp += 200; // SL reward XP
        winnerUser.totalWins += 1;
        winnerUser.totalGames += 1;
        
        await winnerUser.save();
      }

      // Record Match
      const match = new Match({
        roomCode: roomCode,
        gameType: 'snake_ladder',
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

      // Record Losers counts
      for (const p of room.players) {
        if (p.user && p.user.toString() !== winnerId) {
          const loserUser = await User.findByPk(p.user);
          if (loserUser) {
            loserUser.totalGames += 1;
            loserUser.losses = (loserUser.losses || 0) + 1;
            loserUser.xp += 40;
            await loserUser.save();
          }
        }
      }
    }

    io.to(roomCode).emit('sl_game_ended', {
      winnerColor: gameState.winner,
      winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
      winnerId: winningPlayer ? (winningPlayer.userId || winningPlayer.id || winningPlayer.user)?.toString() : null,
      winnerSocketId: winningPlayer ? winningPlayer.socketId : null,
      gameState
    });

    activeGames.delete(roomCode);
  } catch (err) {
    console.error('[SL Finalize Match End Error]:', err.message);
  }
}

function emitTurnChanged(io, roomCode, gameState) {
  const previousIndex = gameState.activePlayerIndex;
  const nextActivePlayerIndex = gameState.players.findIndex(p => p.color === gameState.activeColor);
  
  // Ensure gameState.activePlayerIndex is updated before emitting
  gameState.activePlayerIndex = nextActivePlayerIndex;

  const previousPlayer = gameState.players[previousIndex];
  const nextActivePlayer = gameState.players[nextActivePlayerIndex];

  console.log('[SL_TURN_CHANGE]', {
    previousIndex,
    nextIndex: nextActivePlayerIndex,
    previousPlayer: previousPlayer ? previousPlayer.name : null,
    nextPlayer: nextActivePlayer ? nextActivePlayer.name : null,
    activePlayerIndex: gameState.activePlayerIndex
  });

  const nextActivePlayerId = nextActivePlayer ? (nextActivePlayer.userId || nextActivePlayer.id || nextActivePlayer.user) : null;
  const nextActivePlayerName = nextActivePlayer ? nextActivePlayer.name : "";
  const nextActivePlayerSocketId = nextActivePlayer ? nextActivePlayer.socketId : null;
  const nextActivePlayerColor = gameState.activeColor;

  io.to(roomCode).emit('sl_turn_changed', {
    roomCode,
    activePlayerIndex: nextActivePlayerIndex,
    activePlayerId: nextActivePlayerId,
    activePlayerSocketId: nextActivePlayerSocketId,
    activePlayerName: nextActivePlayerName,
    activePlayerColor: nextActivePlayerColor,
    gameState
  });

  saveSnakeRoomToDb(roomCode, gameState).catch(() => {});
}

module.exports = {
  registerSnakeLadderSocket,
  activeGames,
  createSnakeRoomHelper,
  joinSnakeRoomHelper,
  snakeLadderRooms
};
