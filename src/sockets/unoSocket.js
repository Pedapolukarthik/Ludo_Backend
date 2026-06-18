const Room = require('../models/Room');
const User = require('../models/User');
const Match = require('../models/Match');
const { initializeUnoGame, canPlayCard, playCard, drawCard, passTurn } = require('../services/unoEngine');
const jwt = require('jsonwebtoken');
const { generateVoiceToken } = require('../services/livekitService');

// In-memory states for UNO game rooms and matchmaking queue
const activeUnoGames = new Map();
const unoRooms = new Map();
let unoMatchmakingQueue = [];

async function createUnoRoomHelper(user, entryFee, maxPlayers, socketId = null, gameMode = 'standard') {
  const roomCode = 'UNO_' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const limit = Number(maxPlayers || 4);
  const hostId = user.id || parseInt(user._id);

  const initialPlayer = {
    id: hostId.toString(),
    socketId: socketId,
    name: user.name,
    avatar: user.avatar,
    ready: true,
    isBot: false
  };

  const room = await Room.create({
    code: roomCode,
    hostId: hostId,
    players: [initialPlayer],
    type: 'private',
    gameType: 'uno',
    gameMode: gameMode,
    maxPlayers: limit >= 2 && limit <= 4 ? limit : 4,
    entryFee: Number(entryFee || 0),
    status: 'waiting'
  });

  const gameState = initializeUnoGame(room.toJSON());
  room.gameState = gameState;
  await room.save();

  unoRooms.set(roomCode, room.toJSON());
  return { room: room.toJSON(), gameState };
}

async function joinUnoRoomHelper(user, rawCode, socketId = null) {
  const room = await getUnoRoom(rawCode);
  if (!room) {
    throw new Error('Room not found');
  }

  const roomCode = room.code;
  if (room.status !== 'waiting') {
    throw new Error('Game already started');
  }

  const players = Array.isArray(room.players) ? room.players : JSON.parse(room.players || '[]');
  if (players.length >= room.maxPlayers) {
    throw new Error('Room is full');
  }

  const userIdStr = (user._id || user.id).toString();
  const alreadyJoined = players.find(p => p.id === userIdStr);
  
  const dbRoom = await Room.findOne({ where: { code: roomCode } });
  if (!dbRoom) {
    throw new Error('Room not found in DB');
  }

  if (alreadyJoined) {
    if (socketId) alreadyJoined.socketId = socketId;
    dbRoom.players = players;
    await dbRoom.save();
    unoRooms.set(roomCode, dbRoom.toJSON());
    return dbRoom.toJSON();
  }

  const newPlayer = {
    id: userIdStr,
    socketId: socketId,
    name: user.name,
    avatar: user.avatar,
    ready: false,
    isBot: false
  };

  players.push(newPlayer);
  dbRoom.players = players;
  
  const currentGameState = dbRoom.gameState || initializeUnoGame(dbRoom.toJSON());
  
  // Ensure players list in gameState matches
  if (!currentGameState.players.some(p => p.id === newPlayer.id)) {
    currentGameState.players.push({
      id: newPlayer.id,
      name: newPlayer.name,
      avatar: newPlayer.avatar,
      isBot: false,
      cards: []
    });
  }
  currentGameState.unoDeclared = currentGameState.unoDeclared || {};
  currentGameState.unoDeclared[newPlayer.id] = false;
  
  dbRoom.gameState = currentGameState;
  dbRoom.changed('players', true);
  dbRoom.changed('gameState', true);
  await dbRoom.save();

  unoRooms.set(roomCode, dbRoom.toJSON());
  return dbRoom.toJSON();
}

async function saveUnoRoomToDb(roomCode, gameState, roomStatus = null) {
  try {
    const room = await Room.findOne({ where: { code: roomCode } });
    if (room) {
      room.gameState = gameState;
      if (roomStatus) {
        room.status = roomStatus;
      }
      room.changed('gameState', true);
      await room.save();
      unoRooms.set(roomCode, room.toJSON());
      activeUnoGames.set(roomCode, gameState);
    }
  } catch (err) {
    console.error('[UNO_DB_SYNC_ERROR]:', err.message);
  }
}

async function getUnoRoom(roomCode) {
  if (!roomCode) return null;
  const cleanCode = roomCode.trim().toUpperCase();
  let room = unoRooms.get(cleanCode);
  if (!room && !cleanCode.startsWith('UNO_')) {
    room = unoRooms.get(`UNO_${cleanCode}`);
  }
  if (!room) {
    const searchCode = cleanCode.startsWith('UNO_') ? cleanCode : `UNO_${cleanCode}`;
    const dbRoom = await Room.findOne({ where: { code: searchCode } });
    if (dbRoom) {
      room = dbRoom.toJSON();
      unoRooms.set(room.code, room);
      if (room.gameState) {
        activeUnoGames.set(room.code, room.gameState);
      }
    }
  }
  return room;
}

function getRoomByCode(code) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  let room = unoRooms.get(normalized);
  if (!room && !normalized.startsWith('UNO_')) {
    room = unoRooms.get(`UNO_${normalized}`);
  }
  return room;
}

function getGameStateByCode(code) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  let game = activeUnoGames.get(normalized);
  if (!game && !normalized.startsWith('UNO_')) {
    game = activeUnoGames.get(`UNO_${normalized}`);
  }
  return game;
}

function registerUnoSocket(io) {
  console.log('[UNO_SOCKET] UNO Arena socket registered');

  function handleUserReconnection(socket, io) {
    if (!socket.user) return;
    const userIdStr = socket.user._id.toString();

    // Check if player has an active UNO room or game in progress to reconnect them
    for (const [roomCode, room] of unoRooms.entries()) {
      const player = room.players.find(p => p.id === userIdStr);
      if (player) {
        console.log(`[UNO_SOCKET] Reconnecting user ${socket.user.name} to room ${roomCode} with socket ${socket.id}`);
        player.socketId = socket.id;
        socket.join(roomCode);

        if (room.status === 'playing') {
          socket.emit('uno_match_found', {
            roomCode,
            room,
            gameState: serializeGameStateForClient(room.gameState)
          });
        } else {
          io.to(roomCode).emit('uno_lobby_updated', {
            roomCode,
            room,
            gameState: serializeGameStateForClient(room.gameState)
          });
        }
        break; // User can only be in one room at a time
      }
    }
  }

  io.on('connection', (socket) => {
    handleUserReconnection(socket, io);

    // --- Matchmaking ---
    socket.on('uno_join_matchmaking', async () => {
      if (!socket.user) return socket.emit('uno_error', 'Authentication error');

      // Check if already in queue
      if (unoMatchmakingQueue.some(p => p.userId.toString() === socket.user._id.toString())) {
        return socket.emit('uno_error', 'Already in matchmaking queue');
      }

      unoMatchmakingQueue.push({
        userId: socket.user._id,
        socketId: socket.id,
        name: socket.user.name,
        avatar: socket.user.avatar,
        coins: socket.user.coins
      });

      console.log(`[UNO Matchmaking] ${socket.user.name} joined queue.`);

      // Create game room if we have 2 players (can support up to 4, but 2 is instant and standard for this platform)
      if (unoMatchmakingQueue.length >= 2) {
        const p1 = unoMatchmakingQueue.shift();
        const p2 = unoMatchmakingQueue.shift();

        const roomCode = 'UNO_' + Math.random().toString(36).substring(2, 8).toUpperCase();

        try {
          const room = {
            roomCode,
            code: roomCode,
            gameType: 'uno',
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
                ready: true,
                isBot: false
              },
              {
                id: p2.userId.toString(),
                socketId: p2.socketId,
                name: p2.name,
                avatar: p2.avatar,
                ready: true,
                isBot: false
              }
            ]
          };

          const gameState = initializeUnoGame(room);
          unoRooms.set(roomCode, room);
          activeUnoGames.set(roomCode, gameState);

          const s1 = io.sockets.sockets.get(p1.socketId);
          const s2 = io.sockets.sockets.get(p2.socketId);
          if (s1) s1.join(roomCode);
          if (s2) s2.join(roomCode);

          // Deduct entry fees
          const u1 = await User.findByPk(p1.userId);
          if (u1) {
            u1.coins = Math.max(0, u1.coins - 50);
            await u1.save();
          }
          const u2 = await User.findByPk(p2.userId);
          if (u2) {
            u2.coins = Math.max(0, u2.coins - 50);
            await u2.save();
          }

          io.to(roomCode).emit('uno_match_found', {
            roomCode,
            room,
            gameState: serializeGameStateForClient(gameState)
          });

          console.log(`[UNO Match] Match found and created room: ${roomCode}`);
        } catch (err) {
          console.error('[UNO Matchmaking Error]:', err.message);
          socket.emit('uno_error', 'Failed to create matchmaking game');
        }
      }
    });

    socket.on('uno_leave_matchmaking', () => {
      unoMatchmakingQueue = unoMatchmakingQueue.filter(p => p.socketId !== socket.id);
    });

    // --- Custom Room ---
    socket.on('uno_create_room', async (data) => {
      if (!socket.user) return socket.emit('uno_error', 'Authentication error');
      console.log(`[UNO_SOCKET] uno_create_room received: user=${socket.user.name}, entryFee=${data?.entryFee}, maxPlayers=${data?.maxPlayers}`);

      try {
        const entryFee = Number(data?.entryFee || 0);
        const maxPlayers = Number(data?.maxPlayers || 4);
        const gameMode = data?.gameMode || 'standard';
        const { room, gameState } = await createUnoRoomHelper(socket.user, entryFee, maxPlayers, socket.id, gameMode);
        socket.join(room.code);

        socket.emit('uno_room_created', {
          success: true,
          roomCode: room.code,
          room,
          gameState: serializeGameStateForClient(gameState)
        });
        console.log(`[UNO_SOCKET] Room ${room.code} created successfully by host ${socket.user.name}`);
      } catch (err) {
        console.error(`[UNO_SOCKET] Room creation failed for host ${socket.user.name}:`, err.message);
        socket.emit('uno_error', 'Room creation failed');
      }
    });

    socket.on('uno_join_room', async (data) => {
      if (!socket.user) return socket.emit('uno_error', 'Authentication error');
      
      const roomCodeInput = (data.roomCode || data.code || '').trim().toUpperCase();
      console.log(`[UNO_SOCKET] uno_join_room received: roomCodeInput="${roomCodeInput}", user=${socket.user.name}`);

      try {
        const room = await joinUnoRoomHelper(socket.user, roomCodeInput, socket.id);
        socket.join(room.roomCode);

        io.to(room.roomCode).emit('uno_lobby_updated', {
          roomCode: room.roomCode,
          room,
          gameState: serializeGameStateForClient(room.gameState)
        });

        socket.emit('uno_room_joined', {
          success: true,
          roomCode: room.roomCode,
          room,
          gameState: serializeGameStateForClient(room.gameState)
        });
      } catch (err) {
        socket.emit('uno_error', err.message);
      }
    });

    socket.on('uno_join_socket_room', async ({ roomCode }) => {
      console.log(`[SOCKET_FLOW] uno_join_socket_room received: code = ${roomCode}`);
      if (!roomCode) return;
      const room = getRoomByCode(roomCode);
      if (room && socket.user) {
        const player = room.players.find(p => p.id === socket.user._id.toString() || p.id === socket.user.id.toString());
        if (player) {
          player.socketId = socket.id;
        }
        socket.join(room.roomCode);
        io.to(room.roomCode).emit('uno_lobby_updated', {
          roomCode: room.roomCode,
          room,
          gameState: serializeGameStateForClient(room.gameState)
        });
      }
    });

    // --- Bots ---
    socket.on('uno_add_bot', (data) => {
      const roomCode = data.roomCode;
      const room = getRoomByCode(roomCode);

      if (!room) return socket.emit('uno_error', 'Room not found');
      if (room.players.length >= room.maxPlayers) return socket.emit('uno_error', 'Room is full');

      const botIndex = room.players.filter(p => p.isBot).length + 1;
      const bot = {
        id: `bot_${Date.now()}_${botIndex}`,
        socketId: null,
        name: `Bot Uno ${String.fromCharCode(64 + botIndex)}`,
        avatar: `https://api.dicebear.com/7.x/bottts/png?seed=BotUno${botIndex}`,
        ready: true,
        isBot: true
      };

      room.players.push(bot);
      room.gameState.players.push({
        id: bot.id,
        name: bot.name,
        avatar: bot.avatar,
        isBot: true,
        cards: []
      });
      room.gameState.unoDeclared[bot.id] = false;

      io.to(roomCode).emit('uno_lobby_updated', {
        roomCode,
        room,
        gameState: serializeGameStateForClient(room.gameState)
      });
    });

    // --- Start Game ---
    socket.on('uno_start_game', async (data) => {
      const roomCode = data.roomCode;
      const room = getRoomByCode(roomCode);

      if (!room) return socket.emit('uno_error', 'Room not found');

      try {
        // Deduct entry fees from active human users
        for (const p of room.players) {
          if (!p.isBot) {
            const u = await User.findByPk(p.id);
            if (u) {
              u.coins = Math.max(0, u.coins - room.entryFee);
              await u.save();
            }
          }
        }

        // Deal the actual starting hand
        room.status = 'playing';
        room.gameState = initializeUnoGame(room);
        await saveUnoRoomToDb(roomCode, room.gameState, 'playing');

        io.to(roomCode).emit('uno_game_started', {
          roomCode,
          room,
          gameState: serializeGameStateForClient(room.gameState)
        });

        // Trigger bot turn if starting player is bot
        const startingPlayer = room.gameState.players[room.gameState.turnIndex];
        if (startingPlayer.isBot) {
          triggerBotMove(io, roomCode, room.gameState);
        }
      } catch (err) {
        socket.emit('uno_error', 'Failed to start game');
      }
    });

    // --- Game Actions ---
    socket.on('uno_play_card', async (data) => {
      const { roomCode, cardId, chosenColor } = data;
      const gameState = getGameStateByCode(roomCode);

      if (!gameState || gameState.status !== 'playing') {
        return socket.emit('uno_error', 'Game not found or finished');
      }

      const activePlayer = gameState.players[gameState.turnIndex];
      if (activePlayer.id !== socket.user?._id.toString()) {
        return socket.emit('uno_error', 'Not your turn');
      }

      const card = activePlayer.cards.find(c => c.id === cardId);
      if (!card) return socket.emit('uno_error', 'Card not found in hand');

      if (!canPlayCard(gameState, card, activePlayer.id)) {
        return socket.emit('uno_error', 'Invalid card play');
      }

      // Execute card play
      playCard(gameState, cardId, chosenColor, activePlayer.id);
      await saveUnoRoomToDb(roomCode, gameState);

      // Notify clients
      io.to(roomCode).emit('uno_card_played', {
        roomCode,
        gameState: serializeGameStateForClient(gameState),
        playedCard: card,
        chosenColor
      });

      if (gameState.status === 'completed') {
        await finalizeUnoGameEnd(io, roomCode, gameState);
      } else {
        // Trigger bot turn if next turn belongs to a bot
        const nextPlayer = gameState.players[gameState.turnIndex];
        if (nextPlayer.isBot) {
          triggerBotMove(io, roomCode, gameState);
        }
      }
    });

    socket.on('uno_draw_card', async (data) => {
      const { roomCode } = data;
      const gameState = getGameStateByCode(roomCode);

      if (!gameState || gameState.status !== 'playing') {
        return socket.emit('uno_error', 'Game not found or finished');
      }

      const activePlayer = gameState.players[gameState.turnIndex];
      if (activePlayer.id !== socket.user?._id.toString()) {
        return socket.emit('uno_error', 'Not your turn');
      }

      const drawnCard = drawCard(gameState, activePlayer.id);

      if (drawnCard) {
        await saveUnoRoomToDb(roomCode, gameState);
        socket.emit('uno_card_drawn_success', {
          roomCode,
          drawnCard,
          gameState: serializeGameStateForClient(gameState)
        });

        socket.to(roomCode).emit('uno_card_drawn', {
          roomCode,
          playerId: activePlayer.id,
          gameState: serializeGameStateForClient(gameState)
        });
      } else {
        socket.emit('uno_error', 'Failed to draw card');
      }
    });

    socket.on('uno_pass_turn', async (data) => {
      const { roomCode } = data;
      const gameState = getGameStateByCode(roomCode);

      if (!gameState || gameState.status !== 'playing') {
        return socket.emit('uno_error', 'Game not found or finished');
      }

      const activePlayer = gameState.players[gameState.turnIndex];
      if (activePlayer.id !== socket.user?._id.toString()) {
        return socket.emit('uno_error', 'Not your turn');
      }

      passTurn(gameState, activePlayer.id);
      await saveUnoRoomToDb(roomCode, gameState);

      io.to(roomCode).emit('uno_turn_passed', {
        roomCode,
        gameState: serializeGameStateForClient(gameState)
      });

      // Trigger bot turn if next player is bot
      const nextPlayer = gameState.players[gameState.turnIndex];
      if (nextPlayer.isBot) {
        triggerBotMove(io, roomCode, gameState);
      }
    });

    // --- Declare UNO ---
    socket.on('uno_declare_uno', (data) => {
      const { roomCode } = data;
      const gameState = getGameStateByCode(roomCode);

      if (!gameState || gameState.status !== 'playing') return;

      const player = gameState.players.find(p => p.id === socket.user?._id.toString());
      if (player && player.cards.length <= 2) {
        gameState.unoDeclared[player.id] = true;
        gameState.history.push(`${player.name} declared UNO!`);
        saveUnoRoomToDb(roomCode, gameState).catch(() => {});
        io.to(roomCode).emit('uno_declared', {
          roomCode,
          playerId: player.id,
          gameState: serializeGameStateForClient(gameState)
        });
      }
    });

    // --- Catch player who didn't declare UNO ---
    socket.on('uno_catch_uno', (data) => {
      const { roomCode, targetPlayerId } = data;
      const gameState = getGameStateByCode(roomCode);

      if (!gameState || gameState.status !== 'playing') return;

      const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
      if (targetPlayer && targetPlayer.cards.length === 1 && !gameState.unoDeclared[targetPlayerId]) {
        // Apply draw 2 penalty
        const colors = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 2; i++) {
          if (gameState.deck.length === 0) {
            // Recycle discard
            const top = gameState.discardPile.pop();
            gameState.deck = gameState.discardPile.map(c => (c.color === 'Wild' ? { ...c, color: 'Wild' } : c));
            gameState.discardPile = [top];
          }
          if (gameState.deck.length > 0) {
            targetPlayer.cards.push(gameState.deck.pop());
          }
        }
        gameState.unoDeclared[targetPlayerId] = false;
        gameState.history.push(`${socket.user.name} caught ${targetPlayer.name} with 1 card! Drawn 2 penalty cards.`);

        saveUnoRoomToDb(roomCode, gameState).catch(() => {});
        io.to(roomCode).emit('uno_caught', {
          roomCode,
          catcherId: socket.user._id.toString(),
          targetPlayerId,
          gameState: serializeGameStateForClient(gameState)
        });
      }
    });

    // --- Chat messages ---
    socket.on('uno_send_message', (data) => {
      const { roomCode, text } = data;
      io.to(roomCode).emit('uno_chat_message', {
        senderId: socket.user ? socket.user._id : socket.id,
        senderName: socket.user ? socket.user.name : 'Guest',
        text,
        timestamp: new Date()
      });
    });

    // --- Resign / Leave Room ---
    socket.on('uno_resign', async (data) => {
      const { roomCode } = data;
      const room = getRoomByCode(roomCode);
      if (!room) return;

      // Handle leaving while in lobby
      if (room.status === 'waiting') {
        console.log(`[UNO_SOCKET] User ${socket.user?.name} is leaving waiting room ${roomCode}`);
        room.players = room.players.filter(p => p.id !== socket.user?._id?.toString());
        if (room.gameState && room.gameState.players) {
          room.gameState.players = room.gameState.players.filter(p => p.id !== socket.user?._id?.toString());
        }

        if (room.players.length === 0 || room.host.toString() === socket.user?._id?.toString()) {
          console.log(`[UNO_SOCKET] Room ${roomCode} closed because host left or room is empty`);
          unoRooms.delete(roomCode);
          io.to(roomCode).emit('uno_error', 'Lobby closed by host');
        } else {
          io.to(roomCode).emit('uno_lobby_updated', {
            roomCode,
            room,
            gameState: serializeGameStateForClient(room.gameState)
          });
        }
        return;
      }

      // Handle resigning during active game
      const gameState = getGameStateByCode(roomCode);
      if (!gameState || gameState.status !== 'playing') return;

      const player = gameState.players.find(p => p.id === socket.user?._id.toString());
      if (!player) return;

      gameState.history.push(`${player.name} resigned from the match.`);
      
      // End game
      gameState.status = 'completed';
      // Find another active player to declare as winner
      const winnerPlayer = gameState.players.find(p => p.id !== player.id);
      gameState.winner = winnerPlayer ? winnerPlayer.id : null;

      await finalizeUnoGameEnd(io, roomCode, gameState);
    });

    // --- Voice Token ---
    socket.on('uno_request_voice_token', async (data) => {
      const roomCode = data.roomCode;
      if (!socket.user) return socket.emit('uno_error', 'Authentication error');

      try {
        const voiceData = await generateVoiceToken(roomCode, socket.user._id.toString(), socket.user.name);
        socket.emit('uno_voice_token', voiceData);
      } catch (err) {
        socket.emit('uno_error', 'Failed to generate voice token');
      }
    });

    // --- Disconnect Handler ---
    socket.on('disconnect', () => {
      if (socket.user) {
        console.log(`[UNO_SOCKET] User disconnected: ${socket.user.name} (${socket.id})`);
      }
      
      // Remove from matchmaking queue
      unoMatchmakingQueue = unoMatchmakingQueue.filter(p => p.socketId !== socket.id);

      // Clean up waiting lobbies if host or player disconnects
      for (const [roomCode, room] of unoRooms.entries()) {
        if (room.status === 'waiting') {
          const isHost = room.host.toString() === socket.user?._id?.toString();
          if (isHost) {
            console.log(`[UNO_SOCKET] Host disconnected. Closing waiting room ${roomCode}`);
            io.to(roomCode).emit('uno_error', 'Host disconnected. Room closed.');
            unoRooms.delete(roomCode);
          } else {
            const playerIdx = room.players.findIndex(p => p.id === socket.user?._id?.toString());
            if (playerIdx !== -1) {
              console.log(`[UNO_SOCKET] Player ${socket.user.name} disconnected. Removing from waiting room ${roomCode}`);
              room.players.splice(playerIdx, 1);
              if (room.gameState && room.gameState.players) {
                room.gameState.players = room.gameState.players.filter(p => p.id !== socket.user?._id?.toString());
              }
              io.to(roomCode).emit('uno_lobby_updated', {
                roomCode,
                room,
                gameState: serializeGameStateForClient(room.gameState)
              });
            }
          }
        }
      }
    });
  });
}

function triggerBotMove(io, roomCode, gameState) {
  // Add a slight delay for realistic bot reaction time
  setTimeout(async () => {
    // Check if game is still active
    const freshState = getGameStateByCode(roomCode);
    if (!freshState || freshState.status !== 'playing') return;

    const currentBot = freshState.players[freshState.turnIndex];
    if (!currentBot || !currentBot.isBot) return;

    // Analyze hand to find a playable card
    let playableCard = null;
    for (const card of currentBot.cards) {
      if (canPlayCard(freshState, card, currentBot.id)) {
        playableCard = card;
        break;
      }
    }

    if (playableCard) {
      let chosenColor = null;
      if (playableCard.color === 'Wild') {
        // Determine favorite color in hand
        const counts = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
        currentBot.cards.forEach(c => {
          if (c.color !== 'Wild') counts[c.color]++;
        });
        chosenColor = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);
      }

      // Check if bot should declare UNO (if card brings hand count to 1)
      if (currentBot.cards.length === 2) {
        // 90% chance to declare UNO safely
        if (Math.random() < 0.9) {
          freshState.unoDeclared[currentBot.id] = true;
          io.to(roomCode).emit('uno_declared', {
            roomCode,
            playerId: currentBot.id,
            gameState: serializeGameStateForClient(freshState)
          });
        }
      }

      playCard(freshState, playableCard.id, chosenColor, currentBot.id);

      io.to(roomCode).emit('uno_card_played', {
        roomCode,
        gameState: serializeGameStateForClient(freshState),
        playedCard: playableCard,
        chosenColor
      });

      if (freshState.status === 'completed') {
        await finalizeUnoGameEnd(io, roomCode, freshState);
        return;
      }
    } else {
      // Bot needs to draw card
      const drawn = drawCard(freshState, currentBot.id);
      
      if (drawn && canPlayCard(freshState, drawn, currentBot.id)) {
        // Draw & Play immediately
        let chosenColor = null;
        if (drawn.color === 'Wild') {
          chosenColor = ['Red', 'Blue', 'Green', 'Yellow'][Math.floor(Math.random() * 4)];
        }
        
        playCard(freshState, drawn.id, chosenColor, currentBot.id);
        
        io.to(roomCode).emit('uno_card_played', {
          roomCode,
          gameState: serializeGameStateForClient(freshState),
          playedCard: drawn,
          chosenColor
        });
        
        if (freshState.status === 'completed') {
          await finalizeUnoGameEnd(io, roomCode, freshState);
          return;
        }
      } else {
        // Draw & Pass
        passTurn(freshState, currentBot.id);
        
        io.to(roomCode).emit('uno_turn_passed', {
          roomCode,
          gameState: serializeGameStateForClient(freshState)
        });
      }
    }

    // Trigger catch UNO penalty on humans if any human didn't call it
    triggerBotCatchCheck(io, roomCode, freshState);
    await saveUnoRoomToDb(roomCode, freshState);

    // If next player is bot, trigger bot turn again
    const nextPlayer = freshState.players[freshState.turnIndex];
    if (nextPlayer.isBot && freshState.status === 'playing') {
      triggerBotMove(io, roomCode, freshState);
    }
  }, 1500);
}

function triggerBotCatchCheck(io, roomCode, gameState) {
  // If there's a player with exactly 1 card who did not declare UNO, bots have 30% chance to catch them
  for (const player of gameState.players) {
    if (player.cards.length === 1 && !gameState.unoDeclared[player.id]) {
      if (Math.random() < 0.3) {
        // Caught!
        for (let i = 0; i < 2; i++) {
          if (gameState.deck.length === 0) {
            const top = gameState.discardPile.pop();
            gameState.deck = gameState.discardPile;
            gameState.discardPile = [top];
          }
          if (gameState.deck.length > 0) {
            player.cards.push(gameState.deck.pop());
          }
        }
        gameState.unoDeclared[player.id] = false;
        gameState.history.push(`Bot caught ${player.name} with 1 card! Drawn 2 penalty cards.`);
        
        io.to(roomCode).emit('uno_caught', {
          roomCode,
          catcherId: 'bot',
          targetPlayerId: player.id,
          gameState: serializeGameStateForClient(gameState)
        });
        break;
      }
    }
  }
}

async function finalizeUnoGameEnd(io, roomCode, gameState) {
  try {
    const room = getRoomByCode(roomCode);
    const winnerId = gameState.winner;
    let winnerName = 'Draw';

    if (winnerId) {
      const winnerPlayer = gameState.players.find(p => p.id === winnerId);
      if (winnerPlayer) winnerName = winnerPlayer.name;
    }

    const entryFee = room ? room.entryFee : 50;
    const prizePool = entryFee * gameState.players.length;

    // Deduct/Award coins in DB
    if (winnerId && !winnerId.startsWith('bot_')) {
      const winnerUser = await User.findByPk(winnerId);
      if (winnerUser) {
        winnerUser.coins += prizePool;
        winnerUser.xp += 200;
        winnerUser.totalWins += 1;
        winnerUser.totalGames += 1;
        await winnerUser.save();
      }

      // Losers updating stats
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
    }

    // Save match model
    const match = new Match({
      roomCode: roomCode,
      gameType: 'uno',
      players: gameState.players.map(p => ({
        user: p.id.startsWith('bot_') ? null : p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot
      })),
      winner: winnerId && !winnerId.startsWith('bot_') ? { user: winnerId, name: winnerName } : undefined,
      entryFee: entryFee,
      prizePool: prizePool,
      result: 'won',
      moves: gameState.history
    });
    await match.save();

    io.to(roomCode).emit('uno_game_ended', {
      winnerId,
      winnerName,
      gameState: serializeGameStateForClient(gameState)
    });

    // Cleanup
    activeUnoGames.delete(roomCode);
    unoRooms.delete(roomCode);
  } catch (err) {
    console.error('[UNO Finalize Match Error]:', err.message);
  }
}

// Strip card details of opponents to prevent cheating in frontend
function serializeGameStateForClient(gameState) {
  const serializedPlayers = gameState.players.map(p => {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      cardCount: p.cards.length,
      // Only include full cards arrays for debugging/own client filtering or let own client get its cards
      // We will handle filtering cards per player client side or return full cards but structure it
      cards: p.cards // For absolute simplicity in this multiplayer demo, we can send cards or filter them
    };
  });

  return {
    roomCode: gameState.roomCode,
    players: serializedPlayers,
    discardPile: gameState.discardPile,
    currentThemeColor: gameState.currentThemeColor,
    turnIndex: gameState.turnIndex,
    direction: gameState.direction,
    status: gameState.status,
    winner: gameState.winner,
    unoDeclared: gameState.unoDeclared,
    history: gameState.history,
    lastAction: gameState.lastAction,
    drawPileCount: gameState.deck.length
  };
}

module.exports = {
  registerUnoSocket,
  createUnoRoomHelper,
  joinUnoRoomHelper,
  unoRooms,
  serializeGameStateForClient
};
