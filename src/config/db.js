const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carrom_tournament');
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}/${conn.connection.name}`);

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
  } catch (error) {
    console.error(`[MongoDB] Error connecting to database: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
