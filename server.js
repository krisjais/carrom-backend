require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./src/config/db');
const errorHandler = require('./src/middleware/errorHandler');

// Import Route Handlers
const authRoutes = require('./src/routes/authRoutes');
const tournamentRoutes = require('./src/routes/tournamentRoutes');
const registrationRoutes = require('./src/routes/registrationRoutes');
const teamRoutes = require('./src/routes/teamRoutes');
const drawRoutes = require('./src/routes/drawRoutes');
const matchRoutes = require('./src/routes/matchRoutes');
const announcementRoutes = require('./src/routes/announcementRoutes');
const statsRoutes = require('./src/routes/statsRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('[Server] Starting...');
console.log(`[Server] Environment: ${NODE_ENV}`);
console.log(`[Server] Port: ${PORT}`);

// Middlewares
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://carrom-frontend.vercel.app',
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(s => s.trim().replace(/\/$/, '')) : []),
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(s => s.trim().replace(/\/$/, '')) : [])
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or Postman)
    if (!origin) return callback(null, true);

    const isAllowed = 
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1');

    if (isAllowed) {
      return callback(null, true);
    }
    // Return true to avoid blocking, or specify allowed origin
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Root endpoint (for Render & UptimeRobot keep-alive pings)
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Carrom Tournament Management API is running',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint (Readiness & Liveness)
app.get('/api/health', (req, res) => {
  const dbStatus = connectDB.getDBStatus ? connectDB.getDBStatus() : { connected: false, state: 'unknown' };
  if (dbStatus.connected) {
    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      initialized: dbStatus.initialized
    });
  } else {
    return res.status(503).json({
      status: 'error',
      database: dbStatus.state || 'disconnected',
      hasRemoteUri: dbStatus.hasRemoteUri,
      reason: dbStatus.lastError || 'Database connection pending'
    });
  }
});

// Middleware ensuring MongoDB is connected before executing Carrom DB queries
const requireDB = async (req, res, next) => {
  try {
    const ready = await connectDB.ensureDBConnected();
    if (!ready) {
      const dbStatus = connectDB.getDBStatus ? connectDB.getDBStatus() : {};
      return res.status(503).json({
        success: false,
        code: 'DB_UNAVAILABLE',
        message: dbStatus.hasRemoteUri === false && NODE_ENV === 'production'
          ? 'Database is not configured on the server (MONGODB_URI missing).'
          : 'Server is waking up and connecting to the database. Please try again in a few seconds.'
      });
    }
    return next();
  } catch (err) {
    return res.status(503).json({
      success: false,
      code: 'DB_UNAVAILABLE',
      message: 'Database connection is temporarily unavailable. Please try again shortly.'
    });
  }
};

const chessRoutes = require('./src/routes/chessRoutes');
const adminChessRoutes = require('./src/routes/adminChessRoutes');
const boardRoutes = require('./src/routes/boardRoutes');

// Mount Routes
app.use('/api/auth', requireDB, authRoutes);
app.use('/api/tournaments', requireDB, tournamentRoutes);
app.use('/api/registrations', requireDB, registrationRoutes);
app.use('/api/teams', requireDB, teamRoutes);
app.use('/api/draws', requireDB, drawRoutes);
app.use('/api/matches', requireDB, matchRoutes);
app.use('/api/boards', requireDB, boardRoutes);
app.use('/api/announcements', requireDB, announcementRoutes);
app.use('/api/stats', requireDB, statsRoutes);
app.use('/api/chess', chessRoutes);
app.use('/api/chess/admin', adminChessRoutes);
app.use('/api/admin', adminChessRoutes);

// Fallback Route Mounts (in case client environment variable omitted /api)
app.use('/auth', requireDB, authRoutes);
app.use('/tournaments', requireDB, tournamentRoutes);
app.use('/registrations', requireDB, registrationRoutes);
app.use('/teams', requireDB, teamRoutes);
app.use('/draws', requireDB, drawRoutes);
app.use('/matches', requireDB, matchRoutes);
app.use('/boards', requireDB, boardRoutes);
app.use('/announcements', requireDB, announcementRoutes);
app.use('/stats', requireDB, statsRoutes);
app.use('/chess', chessRoutes);
app.use('/chess/admin', adminChessRoutes);
app.use('/admin', adminChessRoutes);

// 404 Route Handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.originalUrl}`
  });
});

// Global Error Handler
app.use(errorHandler);

const http = require('http');
const { initSocket } = require('./src/socket');

// Create HTTP server & initialize Socket.io
const server = http.createServer(app);
const io = initSocket(server);
app.set('io', io);

// Start HTTP & WebSocket server immediately on 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Listening on 0.0.0.0:${PORT} (HTTP + Socket.io WebSocket)`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);

  // Connect to Database asynchronously (incoming requests await completion via requireDB)
  connectDB().then((conn) => {
    if (conn) {
      console.log('[Server] Ready');
    } else {
      console.warn('[Server] Running in degraded mode: MongoDB connection pending/failed (will auto-retry)');
    }
  });
});

module.exports = app;

