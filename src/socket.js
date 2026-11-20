const { Server } = require('socket.io');

let io = null;

/**
 * Initialize Socket.io on the HTTP server
 */
function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all client origins (Vercel, localhost, custom domains)
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 25000
  });

  io.on('connection', (socket) => {
    // Join specific match room (Carrom or Chess match)
    socket.on('join_match', (matchId) => {
      if (!matchId) return;
      const room = `match_${matchId}`;
      socket.join(room);
    });

    socket.on('leave_match', (matchId) => {
      if (!matchId) return;
      const room = `match_${matchId}`;
      socket.leave(room);
    });

    // Join general tournament arena channels
    socket.on('join_carrom_live', () => {
      socket.join('carrom_live');
    });

    socket.on('join_chess_live', () => {
      socket.join('chess_live');
    });

    // Chess: Instant phone-to-phone turn switch & clock sync
    socket.on('chess:turn_switch', (payload) => {
      const matchId = payload?.matchId;
      if (matchId) {
        socket.to(`match_${matchId}`).emit('chess:turn_switch', payload);
      }
      io.to('chess_live').emit('chess:match_updated', payload);
    });

    socket.on('chess:clock_tick', (payload) => {
      const matchId = payload?.matchId;
      if (matchId) {
        socket.to(`match_${matchId}`).emit('chess:clock_tick', payload);
      }
    });

    // Carrom: Live referee score desk updates
    socket.on('carrom:score_change', (payload) => {
      const matchId = payload?.matchId;
      if (matchId) {
        socket.to(`match_${matchId}`).emit('carrom:score_change', payload);
      }
      io.to('carrom_live').emit('carrom:match_updated', payload);
    });

    socket.on('disconnect', () => {
      // Disconnected cleanly
    });
  });

  console.log('[Socket.io] Real-time WebSocket server initialized.');
  return io;
}

/**
 * Get the current io instance
 */
function getIO() {
  return io;
}

/**
 * Helper to emit an update to a specific match and arena channel
 */
function emitMatchUpdate(matchId, event, data) {
  if (!io) return;
  if (matchId) {
    io.to(`match_${matchId}`).emit(event, data);
  }
}

/**
 * Emit Carrom live arena update
 */
function emitCarromLive(event, data) {
  if (!io) return;
  io.to('carrom_live').emit(event, data);
}

/**
 * Emit Chess live arena update
 */
function emitChessLive(event, data) {
  if (!io) return;
  io.to('chess_live').emit(event, data);
}

module.exports = {
  initSocket,
  getIO,
  emitMatchUpdate,
  emitCarromLive,
  emitChessLive
};
