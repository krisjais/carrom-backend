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
  const isReady = connectDB.isDBReady();
  if (isReady) {
    return res.status(200).json({
      status: 'ok',
      database: 'connected'
    });
  } else {
    return res.status(503).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/draws', drawRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/stats', statsRoutes);

// 404 Route Handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.originalUrl}`
  });
});

// Global Error Handler
app.use(errorHandler);

// Start HTTP server immediately on 0.0.0.0 without waiting for MongoDB
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Listening on 0.0.0.0:${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);

  // Connect to Database asynchronously
  connectDB().then(async (conn) => {
    if (conn) {
      console.log('[Server] Ready');
      // Auto-ensure admin user exists in DB
      try {
        const User = require('./src/models/User');
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
    } else {
      console.warn('[Server] Running in degraded mode: MongoDB connection pending/failed');
    }
  });
});

module.exports = app;

