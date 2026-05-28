const { registerGameSocket } = require('./gameSocket');

function initSockets(io) {
  registerGameSocket(io);
}

module.exports = {
  initSockets
};
