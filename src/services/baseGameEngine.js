/**
 * Base class defining the common interface and shared helper functions for all game engines.
 */
class BaseGameEngine {
  /**
   * Initializes the game state using room details.
   * @param {Object} room - The Sequelize Room instance or custom room object.
   * @returns {Object} The initial game state.
   */
  initializeGame(room) {
    throw new Error('initializeGame method must be implemented by subclasses');
  }

  /**
   * Updates game state timer or physics tick (for games like Bike Race).
   * @param {Object} gameState - Current state of the game.
   * @param {number} deltaTime - Time elapsed since last tick.
   * @returns {Object} Updated game state.
   */
  updateState(gameState, deltaTime) {
    return gameState; // Optional override
  }

  /**
   * Serializes the game state for safe delivery to a client (e.g., hiding opponent's cards in Uno).
   * @param {Object} gameState - Core game state.
   * @param {string} playerId - Target player ID receiving the update.
   * @returns {Object} Sanitized game state.
   */
  serializeStateForClient(gameState, playerId) {
    return gameState; // Default is returning the state as-is
  }
}

module.exports = BaseGameEngine;
