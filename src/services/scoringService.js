const mongoose = require('mongoose');
const ChessConfiguration = require('../models/ChessConfiguration');
const memoryStore = require('../utils/chessMemoryDb');

const getConfiguration = async () => {
  if (mongoose.connection.readyState === 1) {
    let config = await ChessConfiguration.findOne();
    if (!config) {
      config = await ChessConfiguration.create(memoryStore.configuration);
    }
    return config;
  }
  return memoryStore.configuration;
};

const calculateMaterialScore = (captured = {}, config = null) => {
  const piecePoints = config?.piecePoints || { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
  
  const pawns = (captured.pawns || 0) * (piecePoints.pawn ?? 1);
  const knights = (captured.knights || 0) * (piecePoints.knight ?? 3);
  const bishops = (captured.bishops || 0) * (piecePoints.bishop ?? 3);
  const rooks = (captured.rooks || 0) * (piecePoints.rook ?? 5);
  const queens = (captured.queens || 0) * (piecePoints.queen ?? 9);
  // King capture is illegal in chess; always 0 points
  const kings = 0;

  return pawns + knights + bishops + rooks + queens + kings;
};

const calculateTournamentPoints = (wins = 0, draws = 0, config = null) => {
  const tPts = config?.tournamentPoints || { win: 3, draw: 1, loss: 0 };
  return (wins * (tPts.win ?? 3)) + (draws * (tPts.draw ?? 1));
};

module.exports = {
  getConfiguration,
  calculateMaterialScore,
  calculateTournamentPoints
};
