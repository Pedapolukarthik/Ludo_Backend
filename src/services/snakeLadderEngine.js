/**
 * Snake and Ladder Game Engine
 * Board size: 100 cells (1 to 100).
 * Players start at position 0.
 */

const LADDERS = {
  4: 14,
  9: 31,
  20: 38,
  28: 84,
  40: 59,
  63: 81,
  71: 91
};

const SNAKES = {
  17: 7,
  54: 34,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  99: 78
};

function initializeGame(room) {
  const colors = ['Red', 'Green', 'Yellow', 'Blue'];
  const players = room.players.map((p, idx) => ({
    userId: (p.user || p.id || p.userId) ? (p.user || p.id || p.userId).toString() : null,
    socketId: p.socketId || null,
    name: p.name,
    avatar: p.avatar,
    color: p.color || colors[idx],
    isBot: p.isBot || false,
    botDifficulty: p.botDifficulty || 'medium',
    active: true,
    position: 0 // Start off the board
  }));

  const activeColor = players[0].color;

  return {
    roomCode: room.code,
    players,
    colors: players.map(p => p.color),
    activeColor,
    activePlayerIndex: 0,
    diceValue: null,
    rollState: 'idle', // 'idle', 'rolled', 'moving'
    winner: null,
    consecutiveSixes: 0,
    history: []
  };
}

function getPossibleMoves(gameState, color, rollValue) {
  const player = gameState.players.find(p => p.color === color);
  if (!player || gameState.winner) return [];

  const currentPos = player.position;
  const nextPos = currentPos + rollValue;

  // Exact roll required to reach 100
  if (nextPos <= 100) {
    return [{
      type: nextPos === 100 ? 'goal' : 'move',
      from: currentPos,
      to: nextPos,
      roll: rollValue
    }];
  }

  // No moves possible if roll exceeds 100
  return [];
}

function passTurn(gameState) {
  const currentIndex = gameState.colors.indexOf(gameState.activeColor);
  const nextIndex = (currentIndex + 1) % gameState.colors.length;
  gameState.diceValue = null;
  gameState.rollState = 'idle';
  gameState.activeColor = gameState.colors[nextIndex];
  gameState.activePlayerIndex = nextIndex;
  gameState.consecutiveSixes = 0;
  gameState.hasRolledDice = false;
  gameState.pendingMove = false;
}

function handleDiceRoll(gameState, color, customRoll = null) {
  if (gameState.activeColor !== color) {
    throw new Error('Not your turn');
  }
  if (gameState.rollState !== 'idle' || gameState.hasRolledDice === true) {
    throw new Error('Dice already rolled');
  }

  const roll = customRoll || Math.floor(Math.random() * 6) + 1;
  gameState.diceValue = roll;
  gameState.rollState = 'rolled';

  const player = gameState.players.find(p => p.color === color);
  const playerName = player ? player.name : color;

  console.log("[SL_OVERSHOOT]", player?.name, player?.position, roll);

  if (player && player.position + roll > 100) {
    gameState.message = `${player.name} needs exact roll to finish`;
    gameState.diceValue = null;
    gameState.hasRolledDice = false;
    gameState.diceRolled = false;
    gameState.pendingMove = false;
    gameState.rollState = "idle";

    const oldColor = gameState.activeColor;
    passTurn(gameState);
    const newColor = gameState.activeColor;

    console.log("[SL_TURN_PASS]", oldColor, "->", newColor);
    console.log("[SL_STATE_RESET]", gameState.hasRolledDice, gameState.pendingMove, gameState.rollState);

    return {
      roll,
      forfeit: true,
      possibleMoves: [],
      overshoot: true,
      skipped: true,
      message: `${player.name} needs exact roll to finish`,
      gameState
    };
  }

  if (roll === 6) {
    gameState.consecutiveSixes += 1;
    if (gameState.consecutiveSixes === 3) {
      gameState.history.push({
        text: `${playerName} rolled three 6s. Turn forfeited!`
      });
      passTurn(gameState);
      return { roll, forfeit: true, possibleMoves: [] };
    }
  } else {
    gameState.consecutiveSixes = 0;
  }

  const possibleMoves = getPossibleMoves(gameState, color, roll);

  if (possibleMoves.length === 0) {
    gameState.history.push({
      text: `${playerName} rolled a ${roll} but needs an exact roll to land on 100.`
    });
    // Forfeit turn and pass to next player
    passTurn(gameState);
  } else {
    gameState.history.push({
      text: `${playerName} rolled a ${roll}`
    });
  }

  return { roll, forfeit: false, possibleMoves };
}

function handlePlayerMove(gameState, color) {
  if (gameState.activeColor !== color) {
    throw new Error('Not your turn');
  }
  if (gameState.rollState !== 'rolled') {
    throw new Error('You must roll the dice first');
  }

  const roll = gameState.diceValue;
  const player = gameState.players.find(p => p.color === color);
  if (!player) throw new Error('Player not found');

  const startPos = player.position;
  let targetPos = startPos + roll;
  let effect = null; // 'snake' or 'ladder' or null

  // Check for ladders
  if (LADDERS[targetPos]) {
    targetPos = LADDERS[targetPos];
    effect = 'ladder';
    gameState.history.push({
      text: `${player.name} climbed a ladder to cell ${targetPos}!`
    });
  }
  // Check for snakes
  else if (SNAKES[targetPos]) {
    targetPos = SNAKES[targetPos];
    effect = 'snake';
    gameState.history.push({
      text: `${player.name} bit by a snake and slid down to cell ${targetPos}!`
    });
  }

  player.position = targetPos;
  gameState.rollState = 'idle';

  let gameEnded = false;
  if (targetPos === 100) {
    gameState.winner = color;
    gameEnded = true;
    gameState.history.push({
      text: `${player.name} won the Snake & Ladder match!`
    });
  }

  // Extra turn if player rolled a 6 (and didn't win)
  const getExtraTurn = (roll === 6 && !gameEnded);
  if (getExtraTurn) {
    gameState.diceValue = null;
    gameState.rollState = 'idle';
    gameState.hasRolledDice = false;
    gameState.pendingMove = false;
    gameState.history.push({
      text: `${player.name} gets an extra roll for rolling a 6!`
    });
  } else if (!gameEnded) {
    passTurn(gameState);
  }

  return {
    from: startPos,
    to: targetPos,
    effect,
    gameEnded,
    nextTurnColor: gameEnded ? null : gameState.activeColor
  };
}

module.exports = {
  initializeGame,
  getPossibleMoves,
  handleDiceRoll,
  handlePlayerMove,
  LADDERS,
  SNAKES
};
