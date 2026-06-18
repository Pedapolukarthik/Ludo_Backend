const { DataTypes, Model } = require('sequelize');
const connectDB = require('../config/db');
const sequelize = connectDB.sequelize;

function parseJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }
  return [];
}

class Match extends Model {
  get _id() {
    return String(this.id);
  }
  toJSON() {
    const values = Object.assign({}, this.get());
    values._id = String(values.id);
    values.id = String(values.id);
    values.players = parseJsonArray(values.players).map(p => {
      if (p) {
        const newP = { ...p };
        if (newP.user) newP.user = String(newP.user);
        if (newP.id) newP.id = String(newP.id);
        if (newP.userId) newP.userId = String(newP.userId);
        return newP;
      }
      return p;
    });
    if (values.winner) {
      const newWinner = { ...values.winner };
      if (newWinner.user) newWinner.user = String(newWinner.user);
      if (newWinner.id) newWinner.id = String(newWinner.id);
      values.winner = newWinner;
    }
    return values;
  }
}

Match.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  roomCode: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  gameType: {
    type: DataTypes.ENUM('ludo', 'snake_ladder', 'chess', 'bike_race', 'uno'),
    defaultValue: 'ludo',
  },
  players: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('players'));
    }
  },
  winner: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
    get() {
      const val = this.getDataValue('winner');
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) {}
      }
      return val;
    }
  },
  entryFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  prizePool: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  result: {
    type: DataTypes.ENUM('checkmate', 'resign', 'stalemate', 'draw', 'won'),
    allowNull: true,
  },
  moves: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('moves'));
    }
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  }
}, {
  sequelize,
  modelName: 'Match',
});

module.exports = Match;
