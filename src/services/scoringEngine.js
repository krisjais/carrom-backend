const Match = require('../models/Match');
const AuditLog = require('../models/AuditLog');

/**
 * Calculates board score based on Tournament Rules:
 * - Coin = 1 pt
 * - Queen = 3 pts (if covered)
 * - Foul = -1 pt
 * - Max board score = 25
 */
const calculateBoardScore = (coins, queenPocketed, queenCovered, fouls) => {
  let score = Number(coins) || 0;
  if (queenPocketed && queenCovered) {
    score += 3;
  }
  score -= Number(fouls) || 0;
  return Math.min(25, Math.max(0, score));
};

/**
 * Validates board state according to Best of 3 rules:
 * - 2-0 or 2-1
 * - Board 3 can only be decided if Board 1 and Board 2 are 1-1
 */
const evaluateMatchBoards = (boards) => {
  let team1Wins = 0;
  let team2Wins = 0;

  const b1Winner = boards[0] ? boards[0].boardWinner : null;
  const b2Winner = boards[1] ? boards[1].boardWinner : null;
  const b3Winner = boards[2] ? boards[2].boardWinner : null;

  if (b1Winner === 'team1') team1Wins++;
  if (b1Winner === 'team2') team2Wins++;

  if (b2Winner === 'team1') team1Wins++;
  if (b2Winner === 'team2') team2Wins++;

  // Board 3 should only be considered if 1-1
  if (team1Wins === 1 && team2Wins === 1) {
    if (b3Winner === 'team1') team1Wins++;
    if (b3Winner === 'team2') team2Wins++;
  }

  let matchWinnerSlot = null;
  let isMatchDecided = false;

  if (team1Wins >= 2) {
    matchWinnerSlot = 'team1';
    isMatchDecided = true;
  } else if (team2Wins >= 2) {
    matchWinnerSlot = 'team2';
    isMatchDecided = true;
  }

  const isBoard3Required = team1Wins === 1 && team2Wins === 1 && !isMatchDecided;

  return {
    team1BoardsWon: team1Wins,
    team2BoardsWon: team2Wins,
    isMatchDecided,
    matchWinnerSlot,
    isBoard3Required
  };
};

/**
 * Updates a match's live board scoring and handles manual board winner selection
 */
const updateMatchLiveScore = async (matchId, scoreData, adminUser) => {
  const match = await Match.findById(matchId)
    .populate('team1')
    .populate('team2')
    .populate('winnerTeam');

  if (!match) {
    throw new Error('Match not found.');
  }

  if (match.isBye) {
    throw new Error('Cannot edit score for a bye match.');
  }

  const { boards, carromBoardNumber, scheduledTime, status } = scoreData;

  if (boards && Array.isArray(boards)) {
    for (let i = 0; i < Math.min(3, boards.length); i++) {
      const incoming = boards[i];
      if (incoming) {
        match.boards[i].team1Score = Math.min(25, Math.max(0, Number(incoming.team1Score) || 0));
        match.boards[i].team2Score = Math.min(25, Math.max(0, Number(incoming.team2Score) || 0));
        match.boards[i].queenPocketedBy = incoming.queenPocketedBy || 'none';
        match.boards[i].queenCovered = Boolean(incoming.queenCovered);
        match.boards[i].team1Fouls = Math.max(0, Number(incoming.team1Fouls) || 0);
        match.boards[i].team2Fouls = Math.max(0, Number(incoming.team2Fouls) || 0);
        match.boards[i].boardWinner = incoming.boardWinner || null;
        match.boards[i].notes = incoming.notes || '';
      }
    }
  }

  // Recalculate board wins
  const evaluation = evaluateMatchBoards(match.boards);
  match.finalScore = {
    team1BoardsWon: evaluation.team1BoardsWon,
    team2BoardsWon: evaluation.team2BoardsWon
  };

  if (carromBoardNumber !== undefined) {
    match.carromBoardNumber = carromBoardNumber;
  }
  if (scheduledTime !== undefined) {
    match.scheduledTime = scheduledTime;
  }

  if (status) {
    match.status = status;
  } else if (match.status === 'pending' || match.status === 'scheduled') {
    // If scoring has started, mark as live
    const hasAnyScore = match.boards.some(
      (b) => b.team1Score > 0 || b.team2Score > 0 || b.boardWinner !== null
    );
    if (hasAnyScore) {
      match.status = 'live';
    }
  }

  match.updatedBy = adminUser ? adminUser._id : null;
  await match.save();

  return match;
};

/**
 * Confirms match result, sets winner, and automatically advances winner to next round
 */
const confirmMatchWinner = async (matchId, adminUser) => {
  const match = await Match.findById(matchId)
    .populate('team1')
    .populate('team2');

  if (!match) {
    throw new Error('Match not found.');
  }

  if (!match.team1 || !match.team2) {
    throw new Error('Cannot confirm match: Both teams must be determined.');
  }

  const evaluation = evaluateMatchBoards(match.boards);
  if (!evaluation.isMatchDecided) {
    throw new Error(
      `Cannot confirm match winner: A team must win 2 boards (Best of 3). Current score: ${evaluation.team1BoardsWon} - ${evaluation.team2BoardsWon}.`
    );
  }

  const winningTeamId = evaluation.matchWinnerSlot === 'team1' ? match.team1._id : match.team2._id;
  const losingTeamId = evaluation.matchWinnerSlot === 'team1' ? match.team2._id : match.team1._id;

  match.winnerTeam = winningTeamId;
  match.status = 'completed';
  match.actualEndTime = new Date();
  match.queuePosition = null; // Removed from active READY queue
  match.isResultConfirmed = true;
  match.updatedBy = adminUser._id;
  await match.save();

  // Automatically check if all round matches are finished and advance category to next round
  const { progressCategoryToNextRound } = require('./drawEngine');
  await progressCategoryToNextRound(match.tournamentId, match.category, match.roundNumber);

  // Recalculate estimated start times for remaining READY matches from actual completion time
  const { recalculateEstimatedTimes } = require('./scheduleEngine');
  await recalculateEstimatedTimes(match.tournamentId);

  // Record audit log
  await AuditLog.create({
    action: 'CONFIRM_MATCH_WINNER',
    performedBy: adminUser._id,
    performedByName: adminUser.fullName || 'Admin',
    entityType: 'Match',
    entityId: match._id.toString(),
    details: {
      category: match.category,
      roundName: match.roundName,
      matchNumber: match.matchNumber,
      winnerTeam: winningTeamId,
      finalScore: match.finalScore,
      actualEndTime: match.actualEndTime
    },
    reason: `Confirmed match winner for Match #${match.matchNumber} (${evaluation.team1BoardsWon} - ${evaluation.team2BoardsWon}) on Main Carrom Board.`
  });

  return match;
};

/**
 * Corrections engine: Allows Admin to correct a previously entered score/winner with full audit tracking
 */
const correctMatchResult = async (matchId, correctedData, reason, adminUser) => {
  if (!reason || reason.trim().length === 0) {
    throw new Error('A reason is mandatory for correcting match results.');
  }

  const match = await Match.findById(matchId);
  if (!match) {
    throw new Error('Match not found.');
  }

  const previousWinner = match.winnerTeam;
  const previousFinalScore = { ...match.finalScore };

  // Update board details
  if (correctedData.boards && Array.isArray(correctedData.boards)) {
    for (let i = 0; i < Math.min(3, correctedData.boards.length); i++) {
      const incoming = correctedData.boards[i];
      if (incoming) {
        match.boards[i].team1Score = Math.min(25, Math.max(0, Number(incoming.team1Score) || 0));
        match.boards[i].team2Score = Math.min(25, Math.max(0, Number(incoming.team2Score) || 0));
        match.boards[i].queenPocketedBy = incoming.queenPocketedBy || 'none';
        match.boards[i].queenCovered = Boolean(incoming.queenCovered);
        match.boards[i].team1Fouls = Math.max(0, Number(incoming.team1Fouls) || 0);
        match.boards[i].team2Fouls = Math.max(0, Number(incoming.team2Fouls) || 0);
        match.boards[i].boardWinner = incoming.boardWinner || null;
      }
    }
  }

  const evaluation = evaluateMatchBoards(match.boards);
  match.finalScore = {
    team1BoardsWon: evaluation.team1BoardsWon,
    team2BoardsWon: evaluation.team2BoardsWon
  };

  let newWinnerId = null;
  if (evaluation.isMatchDecided) {
    newWinnerId = evaluation.matchWinnerSlot === 'team1' ? match.team1 : match.team2;
    match.winnerTeam = newWinnerId;
    match.status = 'completed';
    match.isResultConfirmed = true;
  } else {
    match.winnerTeam = null;
    match.status = 'live';
    match.isResultConfirmed = false;
  }

  match.updatedBy = adminUser._id;
  await match.save();

  // If winner changed, cascade downstream update
  if (match.nextMatchId) {
    const nextMatch = await Match.findById(match.nextMatchId);
    if (nextMatch) {
      if (match.nextMatchSlot === 'team1') {
        nextMatch.team1 = newWinnerId;
      } else if (match.nextMatchSlot === 'team2') {
        nextMatch.team2 = newWinnerId;
      }
      if (!nextMatch.team1 || !nextMatch.team2) {
        if (nextMatch.status !== 'bye') {
          nextMatch.status = 'pending';
        }
      }
      await nextMatch.save();
    }
  }

  // Audit Log
  await AuditLog.create({
    action: 'CORRECT_MATCH_RESULT',
    performedBy: adminUser._id,
    performedByName: adminUser.fullName || 'Admin',
    entityType: 'Match',
    entityId: match._id.toString(),
    details: {
      matchId: match._id,
      previousWinner,
      newWinner: newWinnerId,
      previousFinalScore,
      newFinalScore: match.finalScore
    },
    reason: reason.trim()
  });

  return match;
};

module.exports = {
  calculateBoardScore,
  evaluateMatchBoards,
  updateMatchLiveScore,
  confirmMatchWinner,
  correctMatchResult
};
