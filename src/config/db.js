const mongoose = require('mongoose');

// Disable Mongoose buffering so queries don't hang when MongoDB daemon is not running
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carrom_tournament', {
      serverSelectionTimeoutMS: 2000
    });
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.warn(`[MongoDB] Notice: Database connection unavailable (${error.message}). Running in API mode.`);
  }
};

module.exports = connectDB;
