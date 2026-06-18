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

class Room extends Model {
  get _id() {
    return String(this.id);
  }
  toJSON() {
    const values = Object.assign({}, this.get());
    values._id = String(values.id);
    values.id = String(values.id);
    if (values.hostId) values.hostId = String(values.hostId);
    if (values.winnerId) values.winnerId = String(values.winnerId);
    values.host = values.hostId;
    values.winner = values.winnerId;
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
    return values;
  }
}

Room.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    set(val) {
      this.setDataValue('code', val ? val.toString().trim().toUpperCase() : val);
    }
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  players: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('players'));
    }
  },
  type: {
    type: DataTypes.ENUM('public', 'private'),
    defaultValue: 'public',
  },
  gameType: {
    type: DataTypes.ENUM('ludo', 'snake_ladder', 'chess', 'bike_race', 'uno'),
    defaultValue: 'ludo',
  },
  gameMode: {
    type: DataTypes.STRING,
    defaultValue: 'standard',
  },
  gameState: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
    get() {
      const val = this.getDataValue('gameState');
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) {}
      }
      return val;
    }
  },
  maxPlayers: {
    type: DataTypes.INTEGER,
    defaultValue: 4,
    validate: {
      isIn: [[2, 4]]
    }
  },
  status: {
    type: DataTypes.ENUM('waiting', 'playing', 'completed'),
    defaultValue: 'waiting',
  },
  entryFee: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  winnerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  }
}, {
  sequelize,
  modelName: 'Room',
  indexes: [
    {
      fields: ['status']
    },
    {
      fields: ['gameType']
    },
    {
      fields: ['type']
    }
  ]
});

// Getter and setter virtual properties to maintain compatibility with Mongoose's host and winner properties
Object.defineProperty(Room.prototype, 'host', {
  get() {
    return this.hostId;
  },
  set(val) {
    this.hostId = val;
  }
});

Object.defineProperty(Room.prototype, 'winner', {
  get() {
    return this.winnerId;
  },
  set(val) {
    this.winnerId = val;
  }
});

module.exports = Room;
