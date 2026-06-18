const { DataTypes, Model } = require('sequelize');
const connectDB = require('../config/db');
const sequelize = connectDB.sequelize;

class SystemConfig extends Model {
  static async getVal(key, defaultValue = null) {
    const config = await this.findByPk(key);
    if (!config) return defaultValue;
    try {
      return JSON.parse(config.value);
    } catch (e) {
      return config.value;
    }
  }

  static async setVal(key, value, description = null) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const [config, created] = await this.findOrCreate({
      where: { key },
      defaults: { value: stringValue, description }
    });
    if (!created) {
      config.value = stringValue;
      if (description !== null) config.description = description;
      await config.save();
    }
    return config;
  }
}

SystemConfig.init({
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    unique: true,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  sequelize,
  modelName: 'SystemConfig',
  tableName: 'SystemConfigs',
});

module.exports = SystemConfig;
