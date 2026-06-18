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

class Tournament extends Model {
  get _id() {
    return String(this.id);
  }
  toJSON() {
    const values = Object.assign({}, this.get());
    values._id = String(values.id);
    values.id = String(values.id);
    if (values.winnerId) values.winnerId = String(values.winnerId);
    values.winner = values.winnerId;
    values.participants = parseJsonArray(values.participants).map(p => String(p));
    values.brackets = parseJsonArray(values.brackets).map(b => {
      if (b) {
        const newB = { ...b };
        if (newB.matches) {
          newB.matches = parseJsonArray(newB.matches).map(m => String(m));
        }
        return newB;
      }
      return b;
    });
    return values;
  }
}

Tournament.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  entryFee: {
    type: DataTypes.INTEGER,
    defaultValue: 200,
  },
  prizePool: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('upcoming', 'ongoing', 'completed'),
    defaultValue: 'upcoming',
  },
  participants: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('participants'));
    }
  },
  brackets: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('brackets'));
    }
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
  modelName: 'Tournament',
});

Object.defineProperty(Tournament.prototype, 'winner', {
  get() {
    return this.winnerId;
  },
  set(val) {
    this.winnerId = val;
  }
});

module.exports = Tournament;
