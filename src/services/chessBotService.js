/**
 * Chess Bot Service
 * Computes moves for bots (Easy/Medium) in Chess games.
 */
const { getLegalMoves } = require('./chessEngine');

function getBotMove(gameState, botColorCode) {
  const { board } = gameState;
  const legalMoves = [];

  // 1. Gather all legal moves for the bot's pieces
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === botColorCode) {
        const moves = getLegalMoves(board, r, c, gameState);
        for (const move of moves) {
          legalMoves.push({
            from: { row: r, col: c },
            to: { row: move.row, col: move.col },
            piece: piece.type,
            captured: board[move.row][move.col] ? board[move.row][move.col].type : null
          });
        }
      }
    }
  }

  if (legalMoves.length === 0) return null;

  // Find bot difficulty
  // Look up player configuration in players array
  const botPlayer = gameState.players.find(p => p.isBot && p.colorCode === botColorCode);
  const difficulty = botPlayer ? (botPlayer.difficulty || 'easy') : 'easy';

  if (difficulty === 'medium') {
    // Medium bot: Prefer captures
    const captureMoves = legalMoves.filter(m => m.captured !== null);
    if (captureMoves.length > 0) {
      const randomIndex = Math.floor(Math.random() * captureMoves.length);
      return captureMoves[randomIndex];
    }
  }

  // Easy bot or no capture moves: Choose a random legal move
  const randomIndex = Math.floor(Math.random() * legalMoves.length);
  return legalMoves[randomIndex];
}

module.exports = {
  getBotMove
};
