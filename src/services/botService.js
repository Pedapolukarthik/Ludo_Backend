const { getGeneralTrackIndex, SAFE_ZONES } = require('./gameEngine');

/**
 * Calculates if a pawn is under threat at its current position.
 * Threat means an opponent pawn is within 6 steps behind it.
 */
function isUnderThreat(gameState, botColor, pawnStep) {
  if (pawnStep < 1 || pawnStep > 51) return false;
  const botTrackIndex = getGeneralTrackIndex(botColor, pawnStep);
  if (SAFE_ZONES.includes(botTrackIndex)) return false;

  let threatFound = false;

  Object.keys(gameState.pawns).forEach(oppColor => {
    if (oppColor === botColor) return;

    gameState.pawns[oppColor].forEach(oppStep => {
      if (oppStep < 1 || oppStep > 51) return;
      const oppTrackIndex = getGeneralTrackIndex(oppColor, oppStep);

      // Check distance along the track
      // General track has 52 cells. If opp is within 6 steps behind bot
      const dist = (botTrackIndex - oppTrackIndex + 52) % 52;
      if (dist > 0 && dist <= 6) {
        threatFound = true;
      }
    });
  });

  return threatFound;
}

/**
 * Selects the best pawn move for the AI bot based on difficulty level
 * @param {Object} gameState 
 * @param {string} botColor 
 * @param {Array} possibleMoves 
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @returns {number} selected pawnId
 */
function selectBotMove(gameState, botColor, possibleMoves, difficulty = 'medium') {
  if (!possibleMoves || possibleMoves.length === 0) return null;
  if (possibleMoves.length === 1) return possibleMoves[0].pawnId;

  // --- EASY DIFFICULTY ---
  // Just select a random move
  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * possibleMoves.length);
    return possibleMoves[randomIndex].pawnId;
  }

  // --- MEDIUM DIFFICULTY ---
  // Simple prioritizations:
  // 1. Goal moves (scoring)
  // 2. Unlock moves (getting pawns on board)
  // 3. standard moves
  if (difficulty === 'medium') {
    const goalMove = possibleMoves.find(m => m.type === 'goal');
    if (goalMove) return goalMove.pawnId;

    const unlockMove = possibleMoves.find(m => m.type === 'unlock');
    if (unlockMove) return unlockMove.pawnId;

    // Default to the pawn that is furthest along the track
    let bestMove = possibleMoves[0];
    possibleMoves.forEach(m => {
      if (m.from > bestMove.from) {
        bestMove = m;
      }
    });
    return bestMove.pawnId;
  }

  // --- HARD DIFFICULTY ---
  // Advanced decision hierarchy
  if (difficulty === 'hard') {
    // 1. Prioritize scoring a pawn (goal move)
    const goalMove = possibleMoves.find(m => m.type === 'goal');
    if (goalMove) return goalMove.pawnId;

    // Precalculate detailed options
    const moveScores = possibleMoves.map(move => {
      let score = 0;
      const targetStep = move.to;
      const currentStep = move.from;
      const targetTrackIndex = getGeneralTrackIndex(botColor, targetStep);
      const currentTrackIndex = getGeneralTrackIndex(botColor, currentStep);

      // A. Check if this move kills an opponent
      let isKill = false;
      if (targetTrackIndex !== null && !SAFE_ZONES.includes(targetTrackIndex)) {
        Object.keys(gameState.pawns).forEach(oppColor => {
          if (oppColor === botColor) return;
          gameState.pawns[oppColor].forEach(oppStep => {
            if (getGeneralTrackIndex(oppColor, oppStep) === targetTrackIndex) {
              isKill = true;
            }
          });
        });
      }
      if (isKill) score += 1000; // Extremely high weight for kills!

      // B. Check if this pawn is currently under threat and we are moving it away
      if (isUnderThreat(gameState, botColor, currentStep)) {
        score += 300; // Evade danger weight
      }

      // C. Check if the landing position is safe
      if (targetTrackIndex !== null && SAFE_ZONES.includes(targetTrackIndex)) {
        score += 150; // Landing in safe zone weight
      }

      // D. Check if moving here puts the pawn in danger
      if (targetTrackIndex !== null && !SAFE_ZONES.includes(targetTrackIndex)) {
        // If an opponent pawn is close behind the landing spot
        let threatAfterMove = false;
        Object.keys(gameState.pawns).forEach(oppColor => {
          if (oppColor === botColor) return;
          gameState.pawns[oppColor].forEach(oppStep => {
            const oppIndex = getGeneralTrackIndex(oppColor, oppStep);
            if (oppIndex !== null) {
              const distance = (targetTrackIndex - oppIndex + 52) % 52;
              if (distance > 0 && distance <= 6) {
                threatAfterMove = true;
              }
            }
          });
        });
        if (threatAfterMove) {
          score -= 100; // Penalize placing pawn in danger
        }
      }

      // E. Unlock move priority
      if (move.type === 'unlock') {
        score += 200; // Good priority to bring pawns into play
      }

      // F. Rushing priority: Prefer moving pawns that are already far along the path
      score += (currentStep * 2);

      return { pawnId: move.pawnId, score };
    });

    // Find move with highest score
    moveScores.sort((a, b) => b.score - a.score);
    return moveScores[0].pawnId;
  }

  return possibleMoves[0].pawnId;
}

module.exports = {
  selectBotMove
};
