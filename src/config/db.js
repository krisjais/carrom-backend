const mongoose = require('mongoose');

let isListenersAttached = false;
let activeConnectionPromise = null;
let isPostConnectInitialized = false;
let lastConnectionError = null;
let lastAttemptTime = 0;
let reconnectTimer = null;

const getMongoURI = () => {
  const raw =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    '';
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  return cleaned || 'mongodb://127.0.0.1:27017/carrom_tournament';
};

const hasRemoteMongoURI = () => {
  const uri = getMongoURI();
  return !uri.includes('127.0.0.1') && !uri.includes('localhost');
};

const attachConnectionListeners = () => {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('connected', () => {
    lastConnectionError = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    console.log('[MongoDB] Connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    lastConnectionError = err.message || 'Unknown connection error';
    console.error(`[MongoDB] Connection error: ${lastConnectionError}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    lastConnectionError = null;
    console.log('[MongoDB] Reconnected successfully');
  });
};

const isDBReady = () => {
  return mongoose.connection.readyState === 1;
};

const getDBStatus = () => {
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  const readyState = mongoose.connection.readyState;
  return {
    connected: readyState === 1,
    readyState,
    state: stateMap[readyState] || 'unknown',
    hasRemoteUri: hasRemoteMongoURI(),
    initialized: isPostConnectInitialized,
    lastError: readyState === 1 ? null : lastConnectionError
  };
};

// Disable Mongoose buffering so queries don't hang silently when MongoDB is unreachable
mongoose.set('bufferCommands', false);

const runPostConnectTasks = async () => {
  if (isPostConnectInitialized) return;

  // 1. Drop legacy unique indexes on participants collection if they exist
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

  // 2. Migration Safety: Sanitize invalid partner values from legacy registrations without removing valid divisions
  try {
    const registrationsCollection = mongoose.connection.collection('registrations');
    const invalidPartnerRegex = /^(no|yes|true|false|0|1|none|n\/a|na|-|nil|null|undefined)$/i;

    const cursor = registrationsCollection.find({
      $or: [
        { doublesPartnerName: { $regex: invalidPartnerRegex } },
        { mixedDoublesPartnerName: { $regex: invalidPartnerRegex } }
      ]
    });

    const docs = await cursor.toArray();
    if (docs.length > 0) {
      console.log(`[Migration] Found ${docs.length} registration(s) with invalid partner names. Sanitizing...`);
      for (const doc of docs) {
        const update = {};
        if (doc.doublesPartnerName && invalidPartnerRegex.test(String(doc.doublesPartnerName).trim())) {
          update.doublesPartnerName = '';
          if (doc.participateDoubles === undefined || doc.participateDoubles === null) {
            update.participateDoubles = false;
          }
        }
        if (doc.mixedDoublesPartnerName && invalidPartnerRegex.test(String(doc.mixedDoublesPartnerName).trim())) {
          update.mixedDoublesPartnerName = '';
          if (doc.participateMixedDoubles === undefined || doc.participateMixedDoubles === null) {
            update.participateMixedDoubles = false;
          }
        }
        if (Object.keys(update).length > 0) {
          await registrationsCollection.updateOne({ _id: doc._id }, { $set: update });
        }
      }
      console.log('[Migration] Successfully sanitized legacy registration partner fields.');
    }
  } catch (err) {
    console.warn('[Migration] Safe partner sanitization notice:', err.message);
  }

  // 3. Auto-ensure admin user exists and matches configured credentials
  try {
    const User = require('../models/User');
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@carrom.edu').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admincarrom2026';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      await User.create({
        username: 'admin',
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        fullName: process.env.ADMIN_NAME || 'Tournament Director'
      });
      console.log(`[Server] Admin account initialized: ${adminEmail}`);
    } else {
      let updated = false;
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        updated = true;
      }
      const isMatch = await admin.comparePassword(adminPassword);
      if (!isMatch) {
        admin.password = adminPassword;
        updated = true;
      }
      if (updated) {
        await admin.save();
        console.log(`[Server] Admin credentials synchronized: ${adminEmail}`);
      }
    }
  } catch (adminErr) {
    console.warn('[Server] Note on admin user check:', adminErr.message);
  }

  isPostConnectInitialized = true;
};

const scheduleReconnect = () => {
  if (reconnectTimer || isDBReady()) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isDBReady() && !activeConnectionPromise) {
      console.log('[MongoDB] Retrying database connection in background...');
      connectDB();
    }
  }, 10000);
  if (typeof reconnectTimer.unref === 'function') {
    reconnectTimer.unref();
  }
};

const connectDB = async () => {
  attachConnectionListeners();

  // Already connected and initialized
  if (mongoose.connection.readyState === 1) {
    if (!isPostConnectInitialized) {
      await runPostConnectTasks();
    }
    return mongoose.connection;
  }

  // Deduplicate concurrent connection attempts
  if (activeConnectionPromise) {
    return activeConnectionPromise;
  }

  const mongoURI = getMongoURI();
  const isRemote = hasRemoteMongoURI();

  if (process.env.NODE_ENV === 'production' && !isRemote) {
    console.error('[MongoDB] WARNING: Running in production without MONGODB_URI set! Falling back to localhost will fail on Render.');
  }

  console.log(`[MongoDB] Connecting (${isRemote ? 'remote cluster' : 'localhost'})...`);
  lastAttemptTime = Date.now();

  const options = {
    serverSelectionTimeoutMS: isRemote ? 15000 : 5000,
    connectTimeoutMS: isRemote ? 20000 : 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    family: 4
  };

  activeConnectionPromise = (async () => {
    try {
      const conn = await mongoose.connect(mongoURI, options);
      lastConnectionError = null;
      await runPostConnectTasks();
      return conn;
    } catch (error) {
      lastConnectionError = error.message || 'Unknown MongoDB connection error';
      console.warn(`[MongoDB] Notice: Database connection unavailable (${lastConnectionError}).`);
      scheduleReconnect();
      return null;
    } finally {
      activeConnectionPromise = null;
    }
  })();

  return activeConnectionPromise;
};

/**
 * Ensures MongoDB is connected before executing queries.
 * - Returns immediately if already connected & initialized.
 * - Awaits any in-flight connection attempt (e.g. Render cold start).
 * - Triggers an on-demand reconnect if disconnected.
 */
const ensureDBConnected = async () => {
  if (mongoose.connection.readyState === 1 && isPostConnectInitialized) {
    return true;
  }

  if (activeConnectionPromise) {
    const conn = await activeConnectionPromise;
    return Boolean(conn) && mongoose.connection.readyState === 1;
  }

  // Avoid hammering an unreachable DB multiple times within 2 seconds
  if (Date.now() - lastAttemptTime < 2000 && mongoose.connection.readyState === 0) {
    return false;
  }

  const conn = await connectDB();
  return Boolean(conn) && mongoose.connection.readyState === 1;
};

connectDB.isDBReady = isDBReady;
connectDB.getDBStatus = getDBStatus;
connectDB.ensureDBConnected = ensureDBConnected;
connectDB.connectDB = connectDB;

module.exports = connectDB;
