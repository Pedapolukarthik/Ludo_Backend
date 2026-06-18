/**
 * Snake and Ladder Bot Service
 * Handles simple AI roll logic (deciding to roll the dice since there are no branching moves).
 */

function selectBotAction(gameState, botColor) {
  // In Snake and Ladder, the only action a player has is to roll the dice.
  // We can return a default delay in milliseconds before the bot rolls.
  return {
    action: 'roll',
    delayMs: 1200
  };
}

module.exports = {
  selectBotAction
};
