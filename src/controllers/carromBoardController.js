const mongoose = require('mongoose');
const CarromBoard = require('../models/CarromBoard');
const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');

/**
 * Get all Carrom Boards for a tournament
 * Auto-initializes Board 1 and Board 2 if no boards exist yet.
 * Synchronizes board live status with active Match records.
 */
const getBoards = async (req, res, next) => {
  try {
    let tournId = req.query.tournamentId;
    if (!tournId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournId = activeTourn._id;
    }

    if (!tournId) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    let boards = await CarromBoard.find({ tournamentId: tournId }).sort({ boardNumber: 1 });

    // Seed default boards if none exist yet
    if (boards.length === 0) {
      const defaultBoards = [
        {
          tournamentId: tournId,
          boardNumber: 1,
          name: 'Carrom Board 1 - Main Court',
          status: 'available',
          assignedCategory: 'all'
        },
        {
          tournamentId: tournId,
          boardNumber: 2,
          name: 'Carrom Board 2',
          status: 'available',
          assignedCategory: 'all'
        }
      ];
      boards = await CarromBoard.insertMany(defaultBoards);
    }

    // Find all currently live matches in this tournament
    const liveMatches = await Match.find({
      tournamentId: tournId,
      status: 'live'
    })
      .populate({
        path: 'team1',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      })
      .populate({
        path: 'team2',
        populate: [{ path: 'player1' }, { path: 'player2' }]
      });

    const liveMatchByBoardNum = new Map();
    liveMatches.forEach((m) => {
      liveMatchByBoardNum.set(m.carromBoardNumber || 1, m);
    });

    // Sync board status and attach live match payload
    const populatedBoards = await Promise.all(
      boards.map(async (b) => {
        const liveMatch = liveMatchByBoardNum.get(b.boardNumber);
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

    res.json({
      success: true,
      boards: populatedBoards,
      totalBoards: populatedBoards.length,
      liveBoardsCount: populatedBoards.filter((b) => b.status === 'live').length,
      availableBoardsCount: populatedBoards.filter((b) => b.status === 'available').length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Create a new Carrom Board
 */
const createBoard = async (req, res, next) => {
  try {
    let { tournamentId, boardNumber, name, assignedCategory, adminInCharge } = req.body || {};

    if (!tournamentId) {
      const activeTourn = await Tournament.findOne().sort({ createdAt: -1 });
      if (activeTourn) tournamentId = activeTourn._id;
    }

    if (!tournamentId) {
      return res.status(400).json({ success: false, message: 'Tournament ID is required.' });
    }

    // If boardNumber is omitted, pick max + 1
    if (!boardNumber) {
      const existingBoards = await CarromBoard.find({ tournamentId });
      const maxNum = existingBoards.reduce((max, b) => Math.max(max, b.boardNumber || 0), 0);
      boardNumber = maxNum + 1;
    } else {
      boardNumber = Number(boardNumber);
      const existing = await CarromBoard.findOne({ tournamentId, boardNumber });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Board #${boardNumber} already exists with name "${existing.name}". Please pick a different number.`
        });
      }
    }

    const boardName = (name && name.trim()) || `Carrom Board ${boardNumber}`;

    const newBoard = await CarromBoard.create({
      tournamentId,
      boardNumber,
      name: boardName,
      status: 'available',
      assignedCategory: assignedCategory || 'all',
      adminInCharge: adminInCharge || ''
    });

    if (req.user) {
      await AuditLog.create({
        action: 'CREATE_CARROM_BOARD',
        performedBy: req.user._id,
        performedByName: req.user.fullName || 'Admin',
        entityType: 'Tournament',
        entityId: tournamentId.toString(),
        details: { boardNumber, name: boardName, assignedCategory },
        reason: `Added new ${boardName} (Board #${boardNumber}) for multi-court management.`
      });
    }

    res.status(201).json({
      success: true,
      message: `${boardName} created successfully.`,
      board: newBoard
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Update Carrom Board details
 */
const updateBoard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, assignedCategory, status, adminInCharge } = req.body || {};

    const board = await CarromBoard.findById(id);
    if (!board) {
      return res.status(404).json({ success: false, message: 'Carrom Board not found.' });
    }

    if (name !== undefined) board.name = name.trim();
    if (assignedCategory !== undefined) board.assignedCategory = assignedCategory;
    if (status !== undefined && ['available', 'maintenance'].includes(status)) {
      if (board.status === 'live') {
        return res.status(400).json({
          success: false,
          message: 'Cannot manually change status while a match is LIVE on this board.'
        });
      }
      board.status = status;
    }
    if (adminInCharge !== undefined) board.adminInCharge = adminInCharge.trim();

    await board.save();

    res.json({
      success: true,
      message: `Board updated successfully.`,
      board
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Delete a Carrom Board
 */
const deleteBoard = async (req, res, next) => {
  try {
    const { id } = req.params;

    const board = await CarromBoard.findById(id);
    if (!board) {
      return res.status(404).json({ success: false, message: 'Carrom Board not found.' });
    }

    // Guard: Check if match is currently live on this board
    const liveMatch = await Match.findOne({
      tournamentId: board.tournamentId,
      carromBoardNumber: board.boardNumber,
      status: 'live'
    });

    if (liveMatch) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete ${board.name} because Match #${liveMatch.matchNumber} is currently LIVE on it. Complete or stop the match first.`
      });
    }

    const totalBoardsCount = await CarromBoard.countDocuments({ tournamentId: board.tournamentId });
    if (totalBoardsCount <= 1) {
      return res.status(400).json({
        success: false,
        message: 'At least 1 Carrom Board must remain in the tournament.'
      });
    }

    await CarromBoard.findByIdAndDelete(id);

    if (req.user) {
      await AuditLog.create({
        action: 'DELETE_CARROM_BOARD',
        performedBy: req.user._id,
        performedByName: req.user.fullName || 'Admin',
        entityType: 'Tournament',
        entityId: board.tournamentId.toString(),
        details: { boardNumber: board.boardNumber, name: board.name },
        reason: `Deleted ${board.name} from tournament boards.`
      });
    }

    res.json({
      success: true,
      message: `${board.name} was deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard
};
