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

// Connect to Database
connectDB();

// Middlewares
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'Carrom Tournament Management API'
  });
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

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Carrom Tournament API Server running on port ${PORT} `);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'} `);
  console.log(` Health check: http://localhost:${PORT}/api/health `);
  console.log(`====================================================`);
});

module.exports = app;
