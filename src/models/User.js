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

class User extends Model {
  get _id() {
    return String(this.id);
  }
  toJSON() {
    const values = Object.assign({}, this.get());
    values._id = String(values.id);
    values.id = String(values.id);
    values.friends = parseJsonArray(values.friends).map(f => String(f));
    values.friendRequests = parseJsonArray(values.friendRequests).map(r => String(r));
    return values;
  }
}

User.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  avatar: {
    type: DataTypes.STRING,
    defaultValue: 'https://api.dicebear.com/7.x/pixel-art/svg',
  },
  coins: {
    type: DataTypes.INTEGER,
    defaultValue: 1000,
  },
  xp: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  level: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  rank: {
    type: DataTypes.ENUM('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'),
    defaultValue: 'Bronze',
  },
  totalWins: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalGames: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  losses: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  currentWinStreak: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  highestWinStreak: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  dailyMissions: {
    type: DataTypes.JSON,
    defaultValue: () => ({
      winMatchesCount: 0,
      playMatchesCount: 0,
      spunWheelCount: 0,
      winMatchesClaimed: false,
      playMatchesClaimed: false,
      spunWheelClaimed: false,
      lastResetDate: new Date().toDateString()
    }),
    get() {
      const val = this.getDataValue('dailyMissions');
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) {}
      }
      return val || {};
    }
  },
  loginStreak: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  lastLogin: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  firebaseToken: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  banned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  referralCode: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true,
  },
  referredBy: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  achievements: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('achievements'));
    }
  },
  friends: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('friends'));
    }
  },
  friendRequests: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('friendRequests'));
    }
  },
  allowSpectating: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  }
}, {
  sequelize,
  modelName: 'User',
  indexes: [
    {
      fields: ['coins']
    },
    {
      fields: ['xp']
    }
  ],
  hooks: {
    beforeCreate: (user) => {
      if (!user.referralCode) {
        user.referralCode = 'LUDO' + Math.random().toString(36).substring(2, 8).toUpperCase();
      }
    }
  }
});

module.exports = User;
