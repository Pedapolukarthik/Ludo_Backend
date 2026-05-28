/**
 * Premium Ludo Game Engine (Core Logic)
 * 
 * Uses a normalized step-based coordinate system (0 to 57 steps):
 * - Step 0: In Yard (Home base)
 * - Steps 1-51: On the general loop track
 * - Steps 52-56: Inside the home stretch path
 * - Step 57: Inside the Goal (Home run!)
 */

const START_CELLS = {
  Red: 0,
  Green: 13,
  Yellow: 26,
  Blue: 39
};

const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];

/**
 * Maps step count to the general board cell index (0 to 51)
 * Returns null if the step count is in yard, home path, or goal.
 */
function getGeneralTrackIndex(color, stepCount) {
  if (stepCount < 1 || stepCount > 51) return null;
  const startCell = START_CELLS[color];
  return (startCell + stepCount - 1) % 52;
}

/**
 * Initializes a new game state based on a Room model
 */
function initializeGame(room) {
  const playerColors = room.players.map(p => p.color);
  
  // Starting color is usually Red or the first available player
  const startColor = playerColors.includes('Red') ? 'Red' : playerColors[0];

  const pawns = {};
  playerColors.forEach(color => {
    pawns[color] = [0, 0, 0, 0]; // 4 pawns, all at step 0 (yard)
  });

  return {
    roomCode: room.code,
    players: room.players.map(p => ({
      userId: p.user ? p.user.toString() : null,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      isBot: p.isBot,
      botDifficulty: p.botDifficulty,
      active: true
    })),
    colors: playerColors,
    activeColor: startColor,
    diceValue: null,
    rollState: 'idle', // 'idle' (waiting for roll), 'rolled' (waiting for move selection), 'moving' (animating)
    consecutiveSixes: 0,
    pawns,
    winner: null,
    history: []
  };
}

/**
 * Evaluates possible pawn moves for a player given a roll value
 */
function getPossibleMoves(gameState, color, rollValue) {
  const playerPawns = gameState.pawns[color];
  const moves = [];

  for (let i = 0; i < 4; i++) {
    const stepCount = playerPawns[i];

    // Case 1: Pawn in yard
    if (stepCount === 0) {
      if (rollValue === 6) {
        moves.push({ pawnId: i, type: 'unlock', from: 0, to: 1 });
      }
    }
    // Case 2: Pawn on track or home path
    else if (stepCount > 0 && stepCount < 57) {
      const nextStep = stepCount + rollValue;
      if (nextStep <= 57) {
        moves.push({
          pawnId: i,
          type: nextStep === 57 ? 'goal' : 'move',
          from: stepCount,
          to: nextStep
        });
      }
    }
  }

  return moves;
}

/**
 * Moves active turn to the next player
 */
function passTurn(gameState) {
  const currentIndex = gameState.colors.indexOf(gameState.activeColor);
  let nextIndex = (currentIndex + 1) % gameState.colors.length;
  
  // Reset consecutive sixes on turn pass
  gameState.consecutiveSixes = 0;
  gameState.diceValue = null;
  gameState.rollState = 'idle';
  gameState.activeColor = gameState.colors[nextIndex];
}

/**
 * Simulates a dice roll for the active player
 */
function handleDiceRoll(gameState, color, customRoll = null) {
  if (gameState.activeColor !== color) {
    throw new Error('Not your turn');
  }
  if (gameState.rollState !== 'idle') {
    throw new Error('Dice already rolled, make your move first');
  }

  const roll = customRoll || Math.floor(Math.random() * 6) + 1;
  gameState.diceValue = roll;
  gameState.rollState = 'rolled';

  if (roll === 6) {
    gameState.consecutiveSixes += 1;
    if (gameState.consecutiveSixes === 3) {
      // 3 consecutive sixes forfeits turn
      gameState.history.push({
        text: `${color} rolled three 6s in a row. Turn forfeited!`
      });
      passTurn(gameState);
      return { roll, forfeit: true, possibleMoves: [] };
    }
  } else {
    gameState.consecutiveSixes = 0;
  }

  const possibleMoves = getPossibleMoves(gameState, color, roll);
  
  // If no moves are possible, turn passes automatically (unless rolled 6, wait, if you roll 6 but have no moves?
  // Yes, if you roll 6 but have no moves, you would pass, but normally a 6 unlocks or moves.
  // If you can't move, pass turn.
  if (possibleMoves.length === 0) {
    gameState.history.push({
      text: `${color} rolled a ${roll} but has no moves.`
    });
    // Set timeout to pass turn after a small delay on clients
    setTimeoutPass(gameState);
  }

  return { roll, forfeit: false, possibleMoves };
}

function setTimeoutPass(gameState) {
  gameState.rollState = 'idle';
  passTurn(gameState);
}

/**
 * Processes a pawn movement selection
 */
function handlePawnMove(gameState, color, pawnId) {
  if (gameState.activeColor !== color) {
    throw new Error('Not your turn');
  }
  if (gameState.rollState !== 'rolled') {
    throw new Error('You must roll the dice first');
  }

  const roll = gameState.diceValue;
  const possibleMoves = getPossibleMoves(gameState, color, roll);
  const selectedMove = possibleMoves.find(m => m.pawnId === pawnId);

  if (!selectedMove) {
    throw new Error('Invalid move selection');
  }

  const prevStep = gameState.pawns[color][pawnId];
  const newStep = selectedMove.to;
  
  // Perform move
  gameState.pawns[color][pawnId] = newStep;
  gameState.rollState = 'idle';

  let hasKilled = false;
  let hasReachedGoal = (newStep === 57);

  // Check if we land on general track and kill an opponent
  if (newStep >= 1 && newStep <= 51) {
    const landingTrackIndex = getGeneralTrackIndex(color, newStep);
    
    // Check if landing track index is a safe zone
    if (!SAFE_ZONES.includes(landingTrackIndex)) {
      // Look for opponent pawns on the same track index
      Object.keys(gameState.pawns).forEach(oppColor => {
        if (oppColor === color) return; // Skip self

        for (let i = 0; i < 4; i++) {
          const oppStep = gameState.pawns[oppColor][i];
          const oppTrackIndex = getGeneralTrackIndex(oppColor, oppStep);
          
          if (oppTrackIndex === landingTrackIndex) {
            // Kill opponent pawn! Send back to yard (step 0)
            gameState.pawns[oppColor][i] = 0;
            hasKilled = true;
            gameState.history.push({
              text: `${color} killed ${oppColor}'s pawn!`
            });
          }
        }
      });
    }
  }

  // Check if player won the game (all 4 pawns reached step 57)
  const allInGoal = gameState.pawns[color].every(step => step === 57);
  if (allInGoal) {
    gameState.winner = color;
    gameState.history.push({
      text: `${color} won the match!`
    });
    return {
      move: selectedMove,
      isKill: hasKilled,
      isGoal: hasReachedGoal,
      gameEnded: true,
      nextTurnColor: null
    };
  }

  // Extra turn logic:
  // - Roll 6
  // - Killed opponent
  // - Reached goal
  const getExtraTurn = (roll === 6 || hasKilled || hasReachedGoal);

  if (getExtraTurn) {
    gameState.diceValue = null;
    gameState.rollState = 'idle';
    gameState.history.push({
      text: `${color} gets an extra roll!`
    });
  } else {
    passTurn(gameState);
  }

  return {
    move: selectedMove,
    isKill: hasKilled,
    isGoal: hasReachedGoal,
    gameEnded: false,
    nextTurnColor: gameState.activeColor
  };
}

module.exports = {
  initializeGame,
  getPossibleMoves,
  handleDiceRoll,
  handlePawnMove,
  getGeneralTrackIndex,
  SAFE_ZONES
};
