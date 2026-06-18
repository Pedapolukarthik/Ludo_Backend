// Pure UNO Game Rules Engine

function createDeck() {
  const colors = ['Red', 'Blue', 'Green', 'Yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw_Two'];
  const deck = [];
  let cardId = 1;

  for (const color of colors) {
    for (const value of values) {
      // One '0' per color, two of every other number and action card
      const count = value === '0' ? 1 : 2;
      for (let i = 0; i < count; i++) {
        deck.push({
          id: `card_${cardId++}`,
          color,
          value
        });
      }
    }
  }

  // Add Wilds and Wild Draw Fours
  for (let i = 0; i < 4; i++) {
    deck.push({
      id: `card_${cardId++}`,
      color: 'Wild',
      value: 'Wild'
    });
    deck.push({
      id: `card_${cardId++}`,
      color: 'Wild',
      value: 'Wild_Draw_Four'
    });
  }

  return deck;
}

function shuffle(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function initializeUnoGame(room) {
  let deck = createDeck();
  deck = shuffle(deck);

  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    isBot: p.isBot || false,
    cards: []
  }));

  // Deal 7 cards to each player
  for (let i = 0; i < 7; i++) {
    for (const player of players) {
      if (deck.length > 0) {
        player.cards.push(deck.pop());
      }
    }
  }

  // Find a starting discard card that is a standard number card
  let startingCardIdx = deck.findIndex(card => card.color !== 'Wild' && !['Skip', 'Reverse', 'Draw_Two'].includes(card.value));
  if (startingCardIdx === -1) {
    startingCardIdx = deck.length - 1; // Fallback
  }
  const startingCard = deck.splice(startingCardIdx, 1)[0];

  const unoDeclared = {};
  for (const p of players) {
    unoDeclared[p.id] = false;
  }

  return {
    roomCode: room.roomCode || room.code,
    players,
    deck,
    discardPile: [startingCard],
    currentThemeColor: startingCard.color,
    turnIndex: 0,
    direction: 1, // 1 for clockwise, -1 for counter-clockwise
    status: 'playing',
    winner: null,
    unoDeclared,
    gameMode: room.gameMode || 'standard',
    pendingDrawCount: 0,
    history: [`Game started with ${startingCard.color} ${startingCard.value}`],
    lastAction: null // Tracks action type for notifications
  };
}

function canPlayCard(gameState, card, playerId) {
  // Check if turn
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (currentPlayer.id !== playerId) return false;

  // Check if player has card
  const playerHasCard = currentPlayer.cards.some(c => c.id === card.id);
  if (!playerHasCard) return false;

  // Stacking rule check: Player must continue the stack with a draw card
  if (gameState.gameMode === 'draw_stacking' && gameState.pendingDrawCount > 0) {
    return card.value === 'Draw_Two' || card.value === 'Wild_Draw_Four';
  }

  const topCard = gameState.discardPile[gameState.discardPile.length - 1];

  // Wild cards are always playable
  if (card.color === 'Wild') return true;

  // Match color or value (e.g. Red, Blue, etc. OR value like '0', 'Skip', etc.)
  if (card.color === gameState.currentThemeColor) return true;
  if (card.value === topCard.value) return true;

  return false;
}

function getNextTurnIndex(currentIndex, direction, numPlayers, offset = 1) {
  let nextIndex = (currentIndex + direction * offset) % numPlayers;
  if (nextIndex < 0) {
    nextIndex += numPlayers;
  }
  return nextIndex;
}

function recycleDeckIfNeeded(gameState, requiredCount = 1) {
  if (gameState.deck.length < requiredCount) {
    const topCard = gameState.discardPile.pop();
    const restOfDiscards = gameState.discardPile;
    gameState.discardPile = [topCard];
    
    // Shuffle the rest of discards to become new deck
    // Also reset wild colors back to 'Wild'
    const recycledCards = restOfDiscards.map(c => {
      if (c.value === 'Wild' || c.value === 'Wild_Draw_Four') {
        return { ...c, color: 'Wild' };
      }
      return c;
    });

    gameState.deck = [...gameState.deck, ...shuffle(recycledCards)];
    gameState.history.push('Discard pile recycled into draw deck.');
  }
}

function playCard(gameState, cardId, chosenColor, playerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
  const card = currentPlayer.cards[cardIndex];

  // Remove card from hand
  currentPlayer.cards.splice(cardIndex, 1);
  gameState.discardPile.push(card);

  const numPlayers = gameState.players.length;
  let nextTurnOffset = 1;
  let actionMessage = `${currentPlayer.name} played ${card.color} ${card.value}`;

  // Reset UNO declaration flag for this player if they draw/play down, 
  // but standard rule: when you play your 2nd to last card, we check if you clicked UNO.
  // If player did not declare UNO, they remain vulnerable. We'll check that.

  // Apply card mechanics
  if (gameState.gameMode === 'draw_stacking' && (card.value === 'Draw_Two' || card.value === 'Wild_Draw_Four')) {
    if (card.value === 'Draw_Two') {
      gameState.currentThemeColor = card.color;
      gameState.pendingDrawCount += 2;
      actionMessage += ` - pending draw stack is now ${gameState.pendingDrawCount}`;
      gameState.lastAction = { type: 'draw_two', pending: gameState.pendingDrawCount };
      nextTurnOffset = 1; // Do not skip, let next player respond or draw!
    } else {
      gameState.currentThemeColor = chosenColor || 'Red';
      gameState.pendingDrawCount += 4;
      actionMessage = `${currentPlayer.name} played Wild Draw 4 and chose ${gameState.currentThemeColor} - pending draw stack is now ${gameState.pendingDrawCount}`;
      gameState.lastAction = { type: 'wild_draw_four', color: gameState.currentThemeColor, pending: gameState.pendingDrawCount };
      nextTurnOffset = 1;
    }
  } else if (card.value === 'Skip') {
    gameState.currentThemeColor = card.color;
    nextTurnOffset = 2; // Skip next player
    const skippedPlayer = gameState.players[getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, 1)];
    actionMessage += ` - skipping ${skippedPlayer.name}`;
    gameState.lastAction = { type: 'skip', target: skippedPlayer.name };
  } else if (card.value === 'Reverse') {
    gameState.currentThemeColor = card.color;
    if (numPlayers === 2) {
      nextTurnOffset = 2; // Acts like Skip in 2-player game
      const skippedPlayer = gameState.players[getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, 1)];
      actionMessage += ` - reversing flow (skips ${skippedPlayer.name})`;
      gameState.lastAction = { type: 'skip', target: skippedPlayer.name };
    } else {
      gameState.direction *= -1;
      actionMessage += ` - direction reversed`;
      gameState.lastAction = { type: 'reverse' };
    }
  } else if (card.value === 'Draw_Two') {
    gameState.currentThemeColor = card.color;
    const targetPlayerIndex = getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, 1);
    const targetPlayer = gameState.players[targetPlayerIndex];
    
    recycleDeckIfNeeded(gameState, 2);
    for (let i = 0; i < 2; i++) {
      if (gameState.deck.length > 0) {
        targetPlayer.cards.push(gameState.deck.pop());
      }
    }
    
    // Skip target player's turn
    nextTurnOffset = 2;
    // Turn off UNO status for the target player since they just drew cards
    gameState.unoDeclared[targetPlayer.id] = false;
    actionMessage += ` - ${targetPlayer.name} draws 2 and is skipped`;
    gameState.lastAction = { type: 'draw_two', target: targetPlayer.name };
  } else if (card.value === 'Wild') {
    gameState.currentThemeColor = chosenColor || 'Red';
    actionMessage = `${currentPlayer.name} played Wild and chose ${gameState.currentThemeColor}`;
    gameState.lastAction = { type: 'wild', color: gameState.currentThemeColor };
  } else if (card.value === 'Wild_Draw_Four') {
    gameState.currentThemeColor = chosenColor || 'Red';
    const targetPlayerIndex = getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, 1);
    const targetPlayer = gameState.players[targetPlayerIndex];

    recycleDeckIfNeeded(gameState, 4);
    for (let i = 0; i < 4; i++) {
      if (gameState.deck.length > 0) {
        targetPlayer.cards.push(gameState.deck.pop());
      }
    }

    // Skip target player's turn
    nextTurnOffset = 2;
    gameState.unoDeclared[targetPlayer.id] = false;
    actionMessage = `${currentPlayer.name} played Wild Draw 4 and chose ${gameState.currentThemeColor} - ${targetPlayer.name} draws 4 and is skipped`;
    gameState.lastAction = { type: 'wild_four', target: targetPlayer.name, color: gameState.currentThemeColor };
  } else {
    // Normal card
    gameState.currentThemeColor = card.color;
    gameState.lastAction = { type: 'play' };
  }

  // Check win condition
  if (currentPlayer.cards.length === 0) {
    gameState.status = 'completed';
    gameState.winner = currentPlayer.id;
    gameState.history.push(`${currentPlayer.name} wins the match!`);
    return gameState;
  }

  // Check if player failed to declare UNO when they have 1 card left
  if (currentPlayer.cards.length === 1 && !gameState.unoDeclared[currentPlayer.id]) {
    // Player is vulnerable. If someone calls them out, they draw 2 cards.
    actionMessage += ` (Didn't declare UNO!)`;
  }

  // Advance turn
  gameState.turnIndex = getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, nextTurnOffset);
  gameState.history.push(actionMessage);

  return gameState;
}

function drawCard(gameState, playerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (currentPlayer.id !== playerId) return null;

  const numPlayers = gameState.players.length;

  // Draw Stacking Resolution
  if (gameState.gameMode === 'draw_stacking' && gameState.pendingDrawCount > 0) {
    const toDraw = gameState.pendingDrawCount;
    recycleDeckIfNeeded(gameState, toDraw);

    const cardsDrawn = [];
    for (let i = 0; i < toDraw; i++) {
      if (gameState.deck.length > 0) {
        const drawn = gameState.deck.pop();
        currentPlayer.cards.push(drawn);
        cardsDrawn.push(drawn);
      }
    }

    gameState.unoDeclared[playerId] = false;
    gameState.history.push(`${currentPlayer.name} drew ${toDraw} cards from stacking penalty`);
    gameState.pendingDrawCount = 0; // reset stacking count

    // Advance turn and skip player
    gameState.turnIndex = getNextTurnIndex(gameState.turnIndex, gameState.direction, numPlayers, 1);
    gameState.lastAction = { type: 'draw_stacking_penalty', amount: toDraw };
    
    return cardsDrawn.length > 0 ? cardsDrawn[0] : null;
  }

  recycleDeckIfNeeded(gameState, 1);

  if (gameState.deck.length > 0) {
    const drawn = gameState.deck.pop();
    currentPlayer.cards.push(drawn);
    
    // Clear UNO safe flag since card was drawn
    gameState.unoDeclared[playerId] = false;
    
    gameState.history.push(`${currentPlayer.name} drew a card`);
    gameState.lastAction = { type: 'draw' };
    
    return drawn;
  }
  return null;
}

function passTurn(gameState, playerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (currentPlayer.id !== playerId) return false;

  gameState.turnIndex = getNextTurnIndex(gameState.turnIndex, gameState.direction, gameState.players.length, 1);
  gameState.history.push(`${currentPlayer.name} passed turn`);
  gameState.lastAction = { type: 'pass' };
  return true;
}

module.exports = {
  initializeUnoGame,
  canPlayCard,
  playCard,
  drawCard,
  passTurn
};
