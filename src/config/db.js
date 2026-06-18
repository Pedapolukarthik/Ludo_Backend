const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'mysql';

const sequelize = dialect === 'sqlite'
  ? new Sequelize({
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || ':memory:',
      logging: false,
    })
  : new Sequelize(
      process.env.DB_NAME || 'game02_playstation',
      process.env.DB_USER || 'game02_game02',
      process.env.DB_PASSWORD || 'Playstation@123',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: false,
        pool: {
          max: parseInt(process.env.DB_POOL_MAX) || 50,
          min: parseInt(process.env.DB_POOL_MIN) || 10,
          acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
          idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
        },
      }
    );

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('MySQL Connected successfully.');
    
    // Sync all models safely
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
    } else {
      await sequelize.sync();
    }
    console.log('All MySQL tables synchronized.');

    // Seed default system configs
    const SystemConfig = require('../models/SystemConfig');
    await SystemConfig.findOrCreate({ where: { key: 'video_ads_enabled' }, defaults: { value: 'true', description: 'Enable/Disable in-app video/rewarded ads globally' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_app_id_android' }, defaults: { value: 'ca-app-pub-3940256099942544~3347511713', description: 'Google AdMob App ID for Android (Test ID)' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_app_id_ios' }, defaults: { value: 'ca-app-pub-3940256099942544~1458002511', description: 'Google AdMob App ID for iOS (Test ID)' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_banner_ad_unit_id_android' }, defaults: { value: 'ca-app-pub-3940256099942544/6300978111', description: 'Banner Ad Unit ID for Android (Test ID)' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_banner_ad_unit_id_ios' }, defaults: { value: 'ca-app-pub-3940256099942544/2934735716', description: 'Banner Ad Unit ID for iOS (Test ID)' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_rewarded_ad_unit_id_android' }, defaults: { value: 'ca-app-pub-3940256099942544/5224354917', description: 'Rewarded Ad Unit ID for Android (Test ID)' } });
    await SystemConfig.findOrCreate({ where: { key: 'admob_rewarded_ad_unit_id_ios' }, defaults: { value: 'ca-app-pub-3940256099942544/1712485313', description: 'Rewarded Ad Unit ID for iOS (Test ID)' } });
    console.log('System configurations seeded.');
  } catch (error) {
    console.error('MySQL Connection Error:', error);
    process.exit(1);
  }
};

connectDB.sequelize = sequelize;
module.exports = connectDB;
