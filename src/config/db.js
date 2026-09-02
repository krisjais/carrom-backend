const mongoose = require('mongoose');

let isListenersAttached = false;

const attachConnectionListeners = () => {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('connected', () => {
    console.log('[MongoDB] Connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    console.error(`[MongoDB] Connection error: ${err.message || 'Unknown error'}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] Reconnected successfully');
  });
};

const isDBReady = () => {
  return mongoose.connection.readyState === 1;
};

// Disable Mongoose buffering so queries don't hang when MongoDB daemon is not running
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  attachConnectionListeners();

  console.log('[MongoDB] Connecting...');

  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carrom_tournament';
  const options = {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  };

  try {
    const conn = await mongoose.connect(mongoURI, options);
    
    // Drop legacy unique indexes on participants collection if they exist
    try {
      const participantsCollection = mongoose.connection.collection('participants');
      const indexes = await participantsCollection.indexes();
      for (const idx of indexes) {
        if (idx.name === 'studentId_1' || idx.name === 'email_1') {
          await participantsCollection.dropIndex(idx.name);
          console.log(`[MongoDB] Dropped legacy unique index: ${idx.name}`);
        }
      }
    } catch (err) {
      // Collection or index might not exist yet; safe to ignore
    }

    return conn;
  } catch (error) {
    console.warn(`[MongoDB] Notice: Database connection unavailable (${error.message}). Running in fallback mode.`);
    return null;
  }
};

connectDB.isDBReady = isDBReady;
connectDB.connectDB = connectDB;

module.exports = connectDB;


