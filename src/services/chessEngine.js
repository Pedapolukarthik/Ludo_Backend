/**
 * Chess Engine Service
 * Handles chess board representation, move validation, and game rules.
 */

function createInitialBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRow = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

  // Black pieces (Row 0 and 1)
  for (let col = 0; col < 8; col++) {
    board[0][col] = { type: backRow[col], color: 'b' };
    board[1][col] = { type: 'p', color: 'b' };
  }

  // White pieces (Row 6 and 7)
  for (let col = 0; col < 8; col++) {
    board[6][col] = { type: 'p', color: 'w' };
    board[7][col] = { type: backRow[col], color: 'w' };
  }

  return board;
}

function initializeChessGame(room) {
  return {
    roomCode: room.code || room.roomCode,
    maxPlayers: 2,
    entryFee: room.entryFee || 0,
    status: 'waiting',
    activeColor: 'White', // 'White' or 'Black'
    turn: 'w', // 'w' or 'b'
    board: createInitialBoard(),
    players: room.players || [],
    history: [], // moves list (FEN or algebraic notation, e.g. "e4", "Nf3")
    moveHistory: [], // detailed logs e.g. { from, to, piece }
    castlingRights: {
      w: { kingSide: true, queenSide: true },
      b: { kingSide: true, queenSide: true }
    },
    kingPositions: {
      w: { row: 7, col: 4 },
      b: { row: 0, col: 4 }
    },
    gameMode: room.gameMode || 'standard',
    checkCount: { w: 0, b: 0 },
    winner: null,
    result: null, // 'checkmate', 'resign', 'stalemate', 'draw'
    isCheck: false,
    logs: []
  };
}

function isInsideBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

// Check if square is attacked by opponent
function isSquareAttacked(board, row, col, attackerColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === attackerColor) {
        // Compute pseudo-legal moves for this piece
        const moves = getPseudoLegalMoves(board, r, c, {
          castlingRights: null // prevent recursion by disabling castling checks
        });
        if (moves.some(m => m.row === row && m.col === col)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Compute moves without checking if it exposes king to check
function getPseudoLegalMoves(board, row, col, state = {}) {
  const piece = board[row][col];
  if (!piece) return [];

  const moves = [];
  const color = piece.color;
  const opponentColor = color === 'w' ? 'b' : 'w';

  switch (piece.type) {
    case 'p': {
      const direction = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;

      // 1 step forward
      const nextRow = row + direction;
      if (isInsideBoard(nextRow, col) && !board[nextRow][col]) {
        moves.push({ row: nextRow, col });
        // 2 steps forward
        const doubleRow = row + 2 * direction;
        if (row === startRow && isInsideBoard(doubleRow, col) && !board[doubleRow][col]) {
          moves.push({ row: doubleRow, col });
        }
      }

      // Diagonal captures
      const captureCols = [col - 1, col + 1];
      for (const cCol of captureCols) {
        if (isInsideBoard(nextRow, cCol)) {
          const target = board[nextRow][cCol];
          if (target && target.color === opponentColor) {
            moves.push({ row: nextRow, col: cCol });
          }
        }
      }
      break;
    }

    case 'n': {
      const offsets = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1]
      ];
      for (const [dr, dc] of offsets) {
        const nr = row + dr;
        const nc = col + dc;
        if (isInsideBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!target || target.color === opponentColor) {
            moves.push({ row: nr, col: nc });
          }
        }
      }
      break;
    }

    case 'b':
    case 'r':
    case 'q': {
      const directions = [];
      if (piece.type === 'r' || piece.type === 'q') {
        directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      if (piece.type === 'b' || piece.type === 'q') {
        directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }

      for (const [dr, dc] of directions) {
        let nr = row + dr;
        let nc = col + dc;
        while (isInsideBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!target) {
            moves.push({ row: nr, col: nc });
          } else {
            if (target.color === opponentColor) {
              moves.push({ row: nr, col: nc });
            }
            break; // path blocked
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    }

    case 'k': {
      const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of directions) {
        const nr = row + dr;
        const nc = col + dc;
        if (isInsideBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!target || target.color === opponentColor) {
            moves.push({ row: nr, col: nc });
          }
        }
      }

      // Castling (if allowed in rights, and not recursive helper run)
      const rights = (!state.skipCastling && state.castlingRights) ? state.castlingRights[color] : null;
      if (rights && (rights.kingSide || rights.queenSide)) {
        const kingRow = color === 'w' ? 7 : 0;
        const oppColor = color === 'w' ? 'b' : 'w';

        // Check if King is currently in check
        if (row === kingRow && col === 4 && !isSquareAttacked(board, kingRow, 4, oppColor)) {
          // King side castle
          if (rights.kingSide && !board[kingRow][5] && !board[kingRow][6]) {
            if (!isSquareAttacked(board, kingRow, 5, oppColor) && !isSquareAttacked(board, kingRow, 6, oppColor)) {
              moves.push({ row: kingRow, col: 6, isCastle: true });
            }
          }
          // Queen side castle
          if (rights.queenSide && !board[kingRow][1] && !board[kingRow][2] && !board[kingRow][3]) {
            if (!isSquareAttacked(board, kingRow, 3, oppColor) && !isSquareAttacked(board, kingRow, 2, oppColor)) {
              moves.push({ row: kingRow, col: 2, isCastle: true });
            }
          }
        }
      }
      break;
    }
  }

  return moves;
}

// Filter pseudo-legal moves to get only moves that do not leave the King in check
function getLegalMoves(board, row, col, state) {
  const piece = board[row][col];
  if (!piece) return [];

  const pseudoMoves = getPseudoLegalMoves(board, row, col, state);
  const legalMoves = [];

  for (const move of pseudoMoves) {
    // Clone board
    const tempBoard = board.map(r => r.map(c => c ? { ...c } : null));
    // Apply move on temp board
    tempBoard[move.row][move.col] = tempBoard[row][col];
    tempBoard[row][col] = null;

    // Handle special castle movement for temp checking
    if (piece.type === 'k' && Math.abs(move.col - col) === 2) {
      const kingRow = piece.color === 'w' ? 7 : 0;
      if (move.col === 6) { // King Side
        tempBoard[kingRow][5] = tempBoard[kingRow][7];
        tempBoard[kingRow][7] = null;
      } else if (move.col === 2) { // Queen Side
        tempBoard[kingRow][3] = tempBoard[kingRow][0];
        tempBoard[kingRow][0] = null;
      }
    }

    // Find the King's position on the temp board
    let kingRow = -1;
    let kingCol = -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = tempBoard[r][c];
        if (p && p.type === 'k' && p.color === piece.color) {
          kingRow = r;
          kingCol = c;
          break;
        }
      }
    }

    const opponentColor = piece.color === 'w' ? 'b' : 'w';
    if (kingRow !== -1 && !isSquareAttacked(tempBoard, kingRow, kingCol, opponentColor)) {
      legalMoves.push(move);
    }
  }

  return legalMoves;
}

function isKingInCheck(board, color) {
  let kingRow = -1;
  let kingCol = -1;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) {
        kingRow = r;
        kingCol = c;
        break;
      }
    }
  }

  if (kingRow === -1) return false;
  const opponentColor = color === 'w' ? 'b' : 'w';
  return isSquareAttacked(board, kingRow, kingCol, opponentColor);
}

function hasLegalMoves(board, color, state) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) {
        const moves = getLegalMoves(board, r, c, state);
        if (moves.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

function makeMove(gameState, from, to, promotion = 'q') {
  if (gameState.status === 'completed') {
    throw new Error('Game already completed');
  }

  const { board, turn } = gameState;
  const piece = board[from.row][from.col];

  if (!piece) {
    throw new Error('No piece at the source position');
  }

  if (piece.color !== turn) {
    throw new Error('Not your turn');
  }

  const legalMoves = getLegalMoves(board, from.row, from.col, gameState);
  const isLegal = legalMoves.some(m => m.row === to.row && m.col === to.col);

  if (!isLegal) {
    throw new Error('Illegal move');
  }

  const targetPiece = board[to.row][to.col];
  let isCastleMove = false;
  let isPromotion = false;

  // Handle Castling
  if (piece.type === 'k' && Math.abs(to.col - from.col) === 2) {
    isCastleMove = true;
    const kingRow = piece.color === 'w' ? 7 : 0;
    if (to.col === 6) { // King Side
      board[kingRow][5] = board[kingRow][7];
      board[kingRow][7] = null;
    } else if (to.col === 2) { // Queen Side
      board[kingRow][3] = board[kingRow][0];
      board[kingRow][0] = null;
    }
  }

  // Handle Promotion
  if (piece.type === 'p' && (to.row === 0 || to.row === 7)) {
    isPromotion = true;
    board[to.row][to.col] = { type: promotion.toLowerCase(), color: turn };
  } else {
    board[to.row][to.col] = piece;
  }
  board[from.row][from.col] = null;

  // Update Castling Rights
  if (piece.type === 'k') {
    gameState.castlingRights[turn].kingSide = false;
    gameState.castlingRights[turn].queenSide = false;
  }
  if (piece.type === 'r') {
    if (from.col === 0) gameState.castlingRights[turn].queenSide = false;
    if (from.col === 7) gameState.castlingRights[turn].kingSide = false;
  }

  // Update King position
  if (piece.type === 'k') {
    gameState.kingPositions[turn] = { row: to.row, col: to.col };
  }

  // King of the Hill victory condition
  if (gameState.gameMode === 'king_of_the_hill' && piece.type === 'k') {
    const centerSquares = [
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      { row: 4, col: 3 },
      { row: 4, col: 4 }
    ];
    const reachedCenter = centerSquares.some(sq => sq.row === to.row && sq.col === to.col);
    if (reachedCenter) {
      gameState.status = 'completed';
      gameState.winner = turn === 'w' ? 'White' : 'Black';
      gameState.result = 'won';
      gameState.logs.push(`${gameState.winner} won by reaching the center (King of the Hill)!`);
      
      gameState.moveHistory.push({
        from,
        to,
        piece: piece.type,
        color: turn,
        captured: targetPiece ? targetPiece.type : null,
        notation: 'K-Center'
      });
      return gameState;
    }
  }

  // Record Move Notation
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const pieceNames = { p: '', r: 'R', n: 'N', b: 'B', q: 'Q', k: 'K' };
  
  let moveNotation = '';
  if (isCastleMove) {
    moveNotation = to.col === 6 ? 'O-O' : 'O-O-O';
  } else {
    moveNotation = `${pieceNames[piece.type]}${files[from.col]}${ranks[from.row]}${targetPiece ? 'x' : '-'}${files[to.col]}${ranks[to.row]}`;
    if (isPromotion) {
      moveNotation += `=${promotion.toUpperCase()}`;
    }
  }

  gameState.history.push(moveNotation);
  gameState.moveHistory.push({
    from,
    to,
    piece: piece.type,
    color: turn,
    captured: targetPiece ? targetPiece.type : null,
    notation: moveNotation
  });

  // Switch Turn
  gameState.turn = turn === 'w' ? 'b' : 'w';
  gameState.activeColor = gameState.turn === 'w' ? 'White' : 'Black';

  // Check Check, Checkmate, Stalemate
  const nextColor = gameState.turn;
  const isNextInCheck = isKingInCheck(board, nextColor);
  gameState.isCheck = isNextInCheck;

  const nextHasMoves = hasLegalMoves(board, nextColor, gameState);

  if (isNextInCheck) {
    if (gameState.gameMode === 'three_check') {
      gameState.checkCount[turn] = (gameState.checkCount[turn] || 0) + 1;
      gameState.logs.push(`${turn === 'w' ? 'White' : 'Black'} checked ${gameState.checkCount[turn]} times.`);
      if (gameState.checkCount[turn] >= 3) {
        gameState.status = 'completed';
        gameState.winner = turn === 'w' ? 'White' : 'Black';
        gameState.result = 'won';
        gameState.logs.push(`${gameState.winner} won by checking 3 times (3-Check)!`);
        return gameState;
      }
    }
    
    if (!nextHasMoves) {
      // Checkmate
      gameState.status = 'completed';
      gameState.winner = turn === 'w' ? 'White' : 'Black';
      gameState.result = 'checkmate';
    } else {
      // Check only
      gameState.logs.push(`${gameState.activeColor} King is in check!`);
    }
  } else {
    if (!nextHasMoves) {
      // Stalemate
      gameState.status = 'completed';
      gameState.winner = 'Draw';
      gameState.result = 'stalemate';
    }
  }

  return gameState;
}

function undoLastMove(gameState, steps = 1) {
  if (gameState.moveHistory.length < steps) {
    return gameState;
  }
  
  const originalRoom = {
    code: gameState.roomCode,
    entryFee: gameState.entryFee,
    players: gameState.players
  };
  const freshState = initializeChessGame(originalRoom);
  freshState.status = 'playing';
  
  const historyToReplay = gameState.moveHistory.slice(0, gameState.moveHistory.length - steps);
  
  for (const move of historyToReplay) {
    let promotion = 'q';
    if (move.notation && move.notation.includes('=')) {
      promotion = move.notation.split('=').pop().toLowerCase();
    }
    makeMove(freshState, move.from, move.to, promotion);
  }
  
  return freshState;
}

module.exports = {
  initializeChessGame,
  getLegalMoves,
  makeMove,
  isKingInCheck,
  hasLegalMoves,
  undoLastMove
};
