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

class Chat extends Model {
  get _id() {
    return String(this.id);
  }
  toJSON() {
    const values = Object.assign({}, this.get());
    values._id = String(values.id);
    values.id = String(values.id);
    values.messages = parseJsonArray(values.messages).map(m => {
      if (m) {
        const newM = { ...m };
        if (newM.sender) newM.sender = String(newM.sender);
        return newM;
      }
      return m;
    });
    return values;
  }
}

Chat.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  roomCode: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  messages: {
    type: DataTypes.JSON,
    defaultValue: [],
    get() {
      return parseJsonArray(this.getDataValue('messages'));
    }
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  }
}, {
  sequelize,
  modelName: 'Chat',
  indexes: [
    {
      unique: false,
      fields: ['roomCode']
    }
  ]
});

module.exports = Chat;
