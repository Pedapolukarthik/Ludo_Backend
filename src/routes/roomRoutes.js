const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const Room = require('../models/Room');

// Helpers from socket modules
const { createLudoRoomHelper, joinLudoRoomHelper } = require('../sockets/gameSocket');
const { createSnakeRoomHelper, joinSnakeRoomHelper } = require('../sockets/snakeLadderSocket');
const { createChessRoomHelper, joinChessRoomHelper } = require('../sockets/chessSocket');
const { createUnoRoomHelper, joinUnoRoomHelper, serializeGameStateForClient } = require('../sockets/unoSocket');
const { createBikeRoomHelper, joinBikeRoomHelper } = require('../sockets/bikeRaceSocket');

// Ludo Room REST Endpoints
router.post('/ludo/rooms/create', protect, async (req, res) => {
  console.log('[REST_PROXY] create room received - Ludo');
  try {
    const { maxPlayers, entryFee } = req.body;
    const room = await createLudoRoomHelper(req.user, maxPlayers, entryFee);
    console.log('[REST_PROXY] room created - Ludo:', room.code);
    return res.status(200).json({
      success: true,
      room: room.toJSON(),
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Ludo Create:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/ludo/rooms/join', protect, async (req, res) => {
  console.log('[REST_PROXY] join room received - Ludo');
  try {
    const { roomCode, code } = req.body;
    const targetCode = String(roomCode || code || '').trim().toUpperCase();
    const room = await joinLudoRoomHelper(req.user, targetCode);
    console.log('[REST_PROXY] room joined - Ludo:', room.code);
    return res.status(200).json({
      success: true,
      room: room.toJSON(),
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Ludo Join:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/ludo/rooms/:code', protect, async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const room = await Room.findOne({ where: { code } });
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    return res.status(200).json({
      success: true,
      room: room.toJSON()
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Snake & Ladder REST Endpoints
router.post('/snake-ladder/rooms/create', protect, async (req, res) => {
  console.log('[REST_PROXY] create room received - Snake & Ladder');
  try {
    const { maxPlayers, entryFee } = req.body;
    const { room, gameState } = await createSnakeRoomHelper(req.user, maxPlayers, entryFee);
    console.log('[REST_PROXY] room created - Snake & Ladder:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState,
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Snake & Ladder Create:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/snake-ladder/rooms/join', protect, async (req, res) => {
  console.log('[REST_PROXY] join room received - Snake & Ladder');
  try {
    const { roomCode, code } = req.body;
    const targetCode = String(roomCode || code || '').trim().toUpperCase();
    const room = await joinSnakeRoomHelper(req.user, targetCode);
    console.log('[REST_PROXY] room joined - Snake & Ladder:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState: room.gameState,
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Snake & Ladder Join:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Chess REST Endpoints
router.post('/chess/rooms/create', protect, async (req, res) => {
  console.log('[REST_PROXY] create room received - Chess');
  try {
    const { entryFee } = req.body;
    const { room, gameState } = await createChessRoomHelper(req.user, entryFee);
    console.log('[REST_PROXY] room created - Chess:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState,
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Chess Create:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/chess/rooms/join', protect, async (req, res) => {
  console.log('[REST_PROXY] join room received - Chess');
  try {
    const { roomCode, code } = req.body;
    const targetCode = String(roomCode || code || '').trim().toUpperCase();
    const room = await joinChessRoomHelper(req.user, targetCode);
    console.log('[REST_PROXY] room joined - Chess:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState: room.gameState,
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Chess Join:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// UNO REST Endpoints
router.post('/uno/rooms/create', protect, async (req, res) => {
  console.log('[REST_PROXY] create room received - UNO');
  try {
    const { entryFee, maxPlayers } = req.body;
    const { room, gameState } = await createUnoRoomHelper(req.user, entryFee, maxPlayers);
    console.log('[REST_PROXY] room created - UNO:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState: serializeGameStateForClient(gameState),
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - UNO Create:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/uno/rooms/join', protect, async (req, res) => {
  console.log('[REST_PROXY] join room received - UNO');
  try {
    const { roomCode, code } = req.body;
    const targetCode = String(roomCode || code || '').trim().toUpperCase();
    const room = await joinUnoRoomHelper(req.user, targetCode);
    console.log('[REST_PROXY] room joined - UNO:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState: serializeGameStateForClient(room.gameState),
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - UNO Join:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Bike Race REST Endpoints
router.post('/bike-race/rooms/create', protect, async (req, res) => {
  console.log('[REST_PROXY] create room received - Bike Racing');
  try {
    const { maxPlayers, entryFee } = req.body;
    const { room, gameState } = await createBikeRoomHelper(req.user, maxPlayers, entryFee);
    console.log('[REST_PROXY] room created - Bike Racing:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState,
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Bike Racing Create:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/bike-race/rooms/join', protect, async (req, res) => {
  console.log('[REST_PROXY] join room received - Bike Racing');
  try {
    const { roomCode, code } = req.body;
    const targetCode = String(roomCode || code || '').trim().toUpperCase();
    const room = await joinBikeRoomHelper(req.user, targetCode);
    console.log('[REST_PROXY] room joined - Bike Racing:', room.code);
    return res.status(200).json({
      success: true,
      room,
      gameState: room.gameState, // Since joinBikeRoomHelper returns room but initializeGame is used
      code: room.code
    });
  } catch (err) {
    console.error('[REST_PROXY] error - Bike Racing Join:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Get live public rooms for TV mode
const User = require('../models/User');
router.get('/tv/live', protect, async (req, res) => {
  try {
    const activeRooms = await Room.findAll({
      where: {
        status: 'playing',
        type: 'public'
      }
    });

    if (activeRooms.length === 0) {
      return res.status(200).json({ success: true, rooms: [] });
    }

    const hostIds = [...new Set(activeRooms.map(r => r.hostId))];
    const allowedHosts = await User.findAll({
      where: {
        id: hostIds,
        allowSpectating: true
      },
      attributes: ['id', 'name', 'avatar']
    });

    const allowedHostIdsSet = new Set(allowedHosts.map(h => h.id));

    const filteredRooms = activeRooms
      .filter(room => allowedHostIdsSet.has(room.hostId))
      .map(room => {
        const roomJson = room.toJSON();
        const hostInfo = allowedHosts.find(h => h.id === room.hostId);
        roomJson.hostInfo = hostInfo ? hostInfo.toJSON() : null;
        return roomJson;
      });

    return res.status(200).json({
      success: true,
      rooms: filteredRooms
    });
  } catch (err) {
    console.error('[REST_PROXY] error - TV Live:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
