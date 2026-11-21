// In-memory database fallback when local MongoDB daemon is not running

const memoryStore = {
  players: [],
  matches: [],
  rounds: [],
  boards: [
    {
      _id: 'mem_cb_1',
      boardNumber: 1,
      name: 'Chess Board 1 - Main Desk',
      status: 'available',
      currentMatchId: null,
      adminInCharge: ''
    },
    {
      _id: 'mem_cb_2',
      boardNumber: 2,
      name: 'Chess Board 2',
      status: 'available',
      currentMatchId: null,
      adminInCharge: ''
    }
  ],
  configuration: {
    tournamentName: 'Chess Championship 2026',
    tournamentTagline: 'Think ahead. Play smart. Finish strong.',
    matchDuration: 10,
    piecePoints: { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 },
    tournamentPoints: { win: 3, draw: 1, loss: 0 },
    currentRound: 1,
    registrationOpen: true
  }
};

module.exports = memoryStore;
