const mongoose = require('mongoose');
const ChessBoard = require('../models/ChessBoard');
const ChessMatch = require('../models/ChessMatch');
const memoryStore = require('../utils/chessMemoryDb');
const { emitMatchUpdate, emitChessLive } = require('../socket');
const { startMatch } = require('../services/matchService');

const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Get all Chess Boards
 * Auto-initializes Board 1 and Board 2 if no boards exist yet.
 * Synchronizes board live status with active Match records and dynamic live clocks.
 */
exports.getBoards = async (req, res, next) => {
  try {
    if (isDbConnected()) {
      let boards = await ChessBoard.find().sort({ boardNumber: 1 });

      // Seed default boards if none exist yet
      if (boards.length === 0) {
        const defaultBoards = [
          {
            boardNumber: 1,
            name: 'Chess Board 1 - Main Desk',
            status: 'available',
            adminInCharge: ''
          },
          {
            boardNumber: 2,
            name: 'Chess Board 2',
            status: 'available',
            adminInCharge: ''
          }
        ];
        boards = await ChessBoard.insertMany(defaultBoards);
      }

      // Find all currently live matches
      const liveMatches = await ChessMatch.find({ status: 'live' })
        .populate('player1', 'fullName playerId department rank')
        .populate('player2', 'fullName playerId department rank')
        .lean();

      // Compute dynamic up-to-the-second clock for running live matches
      const dynamicLiveMatches = liveMatches.map((m) => {
        if (m.isClockRunning !== false && m.lastClockUpdate) {
          const elapsed = Math.max(0, Math.floor((Date.now() - new Date(m.lastClockUpdate).getTime()) / 1000));
          const turn = m.activeTurn && m.activeTurn !== 'none' ? m.activeTurn : 'white';
          if (turn === 'white') {
            return {
              ...m,
              whiteTimeRemaining: Math.max(0, (m.whiteTimeRemaining || 600) - elapsed)
            };
          } else if (turn === 'black') {
            return {
              ...m,
              blackTimeRemaining: Math.max(0, (m.blackTimeRemaining || 600) - elapsed)
            };
          }
        }
        return m;
      });

      const liveMatchByBoardNum = new Map();
      const liveMatchById = new Map();
      dynamicLiveMatches.forEach((m) => {
        liveMatchByBoardNum.set(m.boardNumber || 1, m);
        liveMatchById.set(m._id.toString(), m);
      });

      // Sync board status and attach live match payload
      const populatedBoards = await Promise.all(
        boards.map(async (b) => {
          let liveMatch = null;
          if (b.currentMatchId) {
            liveMatch = liveMatchById.get(b.currentMatchId.toString());
          }
          if (!liveMatch) {
            liveMatch = liveMatchByBoardNum.get(b.boardNumber);
          }

          let updated = false;
          if (liveMatch) {
            if (b.status !== 'live' || String(b.currentMatchId) !== String(liveMatch._id)) {
              b.status = 'live';
              b.currentMatchId = liveMatch._id;
              updated = true;
            }
          } else if (b.status === 'live') {
            b.status = 'available';
            b.currentMatchId = null;
            updated = true;
          }

          if (updated) {
            await b.save();
          }

          const boardObj = b.toObject();
          boardObj.currentMatch = liveMatch || null;
          return boardObj;
        })
      );

      return res.json({
        success: true,
        boards: populatedBoards,
        totalBoards: populatedBoards.length,
        liveBoardsCount: populatedBoards.filter((b) => b.status === 'live').length,
        availableBoardsCount: populatedBoards.filter((b) => b.status === 'available').length
      });
    }

    // Memory Store Fallback
    if (!memoryStore.boards || memoryStore.boards.length === 0) {
      memoryStore.boards = [
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
      ];
    }

    const liveMatches = (memoryStore.matches || []).filter((m) => m.status === 'live');
    const populated = memoryStore.boards.map((b) => {
      const liveM = liveMatches.find((m) => m.boardNumber === b.boardNumber || m._id === b.currentMatchId);
      if (liveM) {
        b.status = 'live';
        b.currentMatchId = liveM._id;
      } else if (b.status === 'live') {
        b.status = 'available';
        b.currentMatchId = null;
      }
      return {
        ...b,
        currentMatch: liveM || null
      };
    });

    res.json({
      success: true,
      boards: populated,
      totalBoards: populated.length,
      liveBoardsCount: populated.filter((b) => b.status === 'live').length,
      availableBoardsCount: populated.filter((b) => b.status === 'available').length
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Create a new Chess Board
 */
exports.createBoard = async (req, res, next) => {
  try {
    let { boardNumber, name, adminInCharge } = req.body || {};

    if (isDbConnected()) {
      if (!boardNumber) {
        const existingBoards = await ChessBoard.find();
        const maxNum = existingBoards.reduce((max, b) => Math.max(max, b.boardNumber || 0), 0);
        boardNumber = maxNum + 1;
      } else {
        boardNumber = Number(boardNumber);
        const existing = await ChessBoard.findOne({ boardNumber });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: `Chess Board #${boardNumber} already exists with name "${existing.name}". Please pick a different number.`
          });
        }
      }

      const boardName = (name && name.trim()) || `Chess Board ${boardNumber}`;
      const newBoard = await ChessBoard.create({
        boardNumber,
        name: boardName,
        status: 'available',
        adminInCharge: adminInCharge || ''
      });

      emitChessLive('chess:board_updated', newBoard);

      return res.status(201).json({
        success: true,
        message: `${newBoard.name} created successfully.`,
        board: newBoard
      });
    }

    // Memory Store
    memoryStore.boards = memoryStore.boards || [];
    if (!boardNumber) {
      const maxNum = memoryStore.boards.reduce((max, b) => Math.max(max, b.boardNumber || 0), 0);
      boardNumber = maxNum + 1;
    } else {
      boardNumber = Number(boardNumber);
      const existing = memoryStore.boards.find((b) => b.boardNumber === boardNumber);
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Chess Board #${boardNumber} already exists. Please pick a different number.`
        });
      }
    }

    const boardName = (name && name.trim()) || `Chess Board ${boardNumber}`;
    const newBoard = {
      _id: `mem_cb_${Date.now()}`,
      boardNumber,
      name: boardName,
      status: 'available',
      currentMatchId: null,
      adminInCharge: adminInCharge || ''
    };
    memoryStore.boards.push(newBoard);

    emitChessLive('chess:board_updated', newBoard);

    res.status(201).json({
      success: true,
      message: `${newBoard.name} created successfully.`,
      board: newBoard
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Update Chess Board
 */
exports.updateBoard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, status, adminInCharge } = req.body || {};

    if (isDbConnected()) {
      const board = await ChessBoard.findById(id);
      if (!board) return res.status(404).json({ success: false, message: 'Board not found.' });

      if (name) board.name = name.trim();
      if (status) board.status = status;
      if (adminInCharge !== undefined) board.adminInCharge = adminInCharge;
      await board.save();

      emitChessLive('chess:board_updated', board);

      return res.json({
        success: true,
        message: `${board.name} updated successfully.`,
        board
      });
    }

    const board = (memoryStore.boards || []).find((b) => b._id === id || String(b.boardNumber) === id);
    if (!board) return res.status(404).json({ success: false, message: 'Board not found.' });

    if (name) board.name = name.trim();
    if (status) board.status = status;
    if (adminInCharge !== undefined) board.adminInCharge = adminInCharge;

    emitChessLive('chess:board_updated', board);

    res.json({
      success: true,
      message: `${board.name} updated successfully.`,
      board
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Delete Chess Board
 */
exports.deleteBoard = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      const board = await ChessBoard.findById(id);
      if (!board) return res.status(404).json({ success: false, message: 'Board not found.' });

      const totalBoards = await ChessBoard.countDocuments();
      if (totalBoards <= 1) {
        return res.status(400).json({
          success: false,
          message: 'At least one chess board must remain active in the arena.'
        });
      }

      if (board.status === 'live' && board.currentMatchId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete a board with an ongoing live match. Please vacate or complete the match first.'
        });
      }

      await ChessBoard.findByIdAndDelete(id);
      emitChessLive('chess:board_updated', { deletedId: id });

      return res.json({
        success: true,
        message: `${board.name} removed from tournament arena.`
      });
    }

    const totalBoards = (memoryStore.boards || []).length;
    if (totalBoards <= 1) {
      return res.status(400).json({
        success: false,
        message: 'At least one chess board must remain active in the arena.'
      });
    }

    const idx = (memoryStore.boards || []).findIndex((b) => b._id === id || String(b.boardNumber) === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Board not found.' });

    const deleted = memoryStore.boards.splice(idx, 1)[0];
    emitChessLive('chess:board_updated', { deletedId: id });

    res.json({
      success: true,
      message: `${deleted.name} removed from tournament arena.`
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Launch Match directly onto a Chess Board
 */
exports.launchMatchOnBoard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { matchId } = req.body || {};

    if (!matchId) {
      return res.status(400).json({ success: false, message: 'Match ID is required to launch.' });
    }

    let board = null;
    if (isDbConnected()) {
      board = await ChessBoard.findById(id);
      if (!board) board = await ChessBoard.findOne({ boardNumber: Number(id) });
    } else {
      board = (memoryStore.boards || []).find((b) => b._id === id || String(b.boardNumber) === id);
    }

    if (!board) return res.status(404).json({ success: false, message: 'Chess Board not found.' });

    // Start match with explicit board number and board name
    const match = await startMatch(matchId, board.boardNumber, board.name);

    if (isDbConnected()) {
      board.status = 'live';
      board.currentMatchId = match._id;
      await board.save();
    } else {
      board.status = 'live';
      board.currentMatchId = match._id;
    }

    emitMatchUpdate(match._id, 'chess:match_started', match);
    emitChessLive('chess:match_started', match);
    emitChessLive('chess:board_updated', board);

    res.json({
      success: true,
      message: `Match ${match.matchId} launched live on ${board.name}!`,
      board,
      match
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Vacate / Stop Match on a Chess Board
 */
exports.stopMatchOnBoard = async (req, res, next) => {
  try {
    const { id } = req.params;

    let board = null;
    if (isDbConnected()) {
      board = await ChessBoard.findById(id);
      if (!board) board = await ChessBoard.findOne({ boardNumber: Number(id) });
    } else {
      board = (memoryStore.boards || []).find((b) => b._id === id || String(b.boardNumber) === id);
    }

    if (!board) return res.status(404).json({ success: false, message: 'Chess Board not found.' });

    if (board.currentMatchId) {
      const matchId = board.currentMatchId;
      if (isDbConnected()) {
        const match = await ChessMatch.findById(matchId);
        if (match && match.status === 'live') {
          match.status = 'scheduled';
          match.isClockRunning = false;
          await match.save();
          emitMatchUpdate(match._id, 'chess:match_updated', match);
          emitChessLive('chess:match_updated', match);
        }
      } else {
        const match = (memoryStore.matches || []).find((m) => m._id === matchId);
        if (match && match.status === 'live') {
          match.status = 'scheduled';
          match.isClockRunning = false;
          emitMatchUpdate(match._id, 'chess:match_updated', match);
          emitChessLive('chess:match_updated', match);
        }
      }
    }

    board.status = 'available';
    board.currentMatchId = null;
    if (isDbConnected()) {
      await board.save();
    }

    emitChessLive('chess:board_updated', board);

    res.json({
      success: true,
      message: `${board.name} has been vacated and is now ready for the next match.`,
      board
    });
  } catch (err) {
    next(err);
  }
};
