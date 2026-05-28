const express = require('express');
const router = express.Router();
const { getTournaments, registerTournament, createTournament } = require('../controllers/tournamentController');
const { protect, admin } = require('../middlewares/authMiddleware');

router.get('/', protect, getTournaments);
router.post('/register/:id', protect, registerTournament);
router.post('/create', protect, admin, createTournament);

module.exports = router;
