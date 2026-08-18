const mongoose = require('mongoose');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const AuditLog = require('../models/AuditLog');

/**
 * Generates dynamic round names based on entry count
 */
const getRoundNameByEntries = (entriesCount, roundNumber, totalRounds) => {
  if (roundNumber === totalRounds || entriesCount === 2) return 'Finals';
  if (roundNumber === totalRounds - 1 || entriesCount <= 4) return 'Semifinals';
  if (roundNumber === totalRounds - 2 || entriesCount <= 8) return 'Quarterfinals';
  if (entriesCount <= 16) return 'Round of 16';
  if (entriesCount <= 32) return 'Round of 32';
  return `Round ${roundNumber}`;
};

/**
 * Calculates the exact dynamic round progression structure:
 * - If N is EVEN: realMatches = N / 2, byes = 0
 * - If N is ODD: realMatches = floor(N / 2), byes = 1
 * - Advancing entries to next round = realMatches + byes
 * - Repeats until N_next = 1
 */
const calculateRoundsPlan = (N) => {
  const roundsPlan = [];
  let currentEntries = N;
  let rNum = 1;

  while (currentEntries > 1) {
    const realMatchesCount = Math.floor(currentEntries / 2);
    const byesCount = currentEntries % 2; // 0 if even, 1 if odd
    const nextEntriesCount = realMatchesCount + byesCount;

    roundsPlan.push({
      roundNumber: rNum,
      entriesCount: currentEntries,
      realMatchesCount,
      byesCount,
      totalSlots: realMatchesCount + byesCount,
      nextEntriesCount
    });

    currentEntries = nextEntriesCount;
    rNum++;
  }

  const totalRounds = roundsPlan.length;
  roundsPlan.forEach((rp) => {
    rp.roundName = getRoundNameByEntries(rp.entriesCount, rp.roundNumber, totalRounds);
  });

  return roundsPlan;
};

/**
 * Helper to shuffle an array using Fisher-Yates algorithm
 */
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/**
 * Generates a dynamic tournament draw for N teams:
 * - Round 1 teams are shuffled and paired.
 * - Subsequent round match placeholders are created and will be dynamically populated
 *   and reshuffled as each round completes.
 */
const generateDynamicBracket = async (tournamentId, category, adminUserId = null) => {
  // 1. Fetch approved teams for category
  const teams = await Team.find({
    tournamentId,
    category,
    isApproved: true
  });

  const N = teams.length;
  if (N < 2) {
    throw new Error(`At least 2 approved teams are required to generate a draw. Currently found ${N}.`);
  }

  // 2. Check if tournament draw is locked
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) {
    throw new Error('Tournament not found.');
  }

  if (tournament.drawsLocked && tournament.drawsLocked[category]) {
    throw new Error(`The draw for ${category.replace('_', ' ').toUpperCase()} is locked and cannot be regenerated.`);
  }

  // 3. Delete existing matches for this category in this tournament
  await Match.deleteMany({ tournamentId, category });

  // 4. Compute Dynamic Round Plan
  const roundsPlan = calculateRoundsPlan(N);
  const totalRounds = roundsPlan.length;

  // 5. Shuffle approved teams for Round 1
  const shuffledTeams = shuffleArray(teams);

  // 6. Pre-create Match documents for all rounds
  const roundMatchesMap = {};
  let globalMatchCounter = 1;

  for (let r = 1; r <= totalRounds; r++) {
    const plan = roundsPlan[r - 1];
    roundMatchesMap[r] = [];

    // Playable matches
    for (let i = 0; i < plan.realMatchesCount; i++) {
      const matchDoc = new Match({
        _id: new mongoose.Types.ObjectId(),
        tournamentId,
        category,
        roundNumber: r,
        roundName: plan.roundName,
        matchNumber: globalMatchCounter++,
        matchIndexInRound: i,
        team1: null,
        team2: null,
        isBye: false,
        winnerTeam: null,
        nextMatchId: null,
        nextMatchSlot: null,
        status: 'pending',
        boardName: 'Main Carrom Board',
        carromBoardNumber: 1,
        queuePosition: null,
        boards: [
          { boardNumber: 1, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
          { boardNumber: 2, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null },
          { boardNumber: 3, team1Score: 0, team2Score: 0, queenPocketedBy: 'none', queenCovered: false, team1Fouls: 0, team2Fouls: 0, boardWinner: null }
        ],
        finalScore: { team1BoardsWon: 0, team2BoardsWon: 0 },
        isResultConfirmed: false
      });
      roundMatchesMap[r].push(matchDoc);
    }

    // Bye match (if odd entry count in this round)
    if (plan.byesCount === 1) {
      const byeDoc = new Match({
        _id: new mongoose.Types.ObjectId(),
        tournamentId,
        category,
        roundNumber: r,
        roundName: plan.roundName,
        matchNumber: globalMatchCounter++,
        matchIndexInRound: plan.realMatchesCount,
        team1: null,
        team2: null,
        isBye: true,
        winnerTeam: null,
        nextMatchId: null,
        nextMatchSlot: null,
        status: 'bye',
        boardName: 'Main Carrom Board',
        carromBoardNumber: 1,
        queuePosition: null,
        boards: [],
        finalScore: { team1BoardsWon: 0, team2BoardsWon: 0 },
        isResultConfirmed: true
      });
      roundMatchesMap[r].push(byeDoc);
    }
  }

  // 7. Populate Round 1 Matches & Bye
  const plan1 = roundsPlan[0];
  const round1Matches = roundMatchesMap[1];
  let cursor = 0;

  // Find current max queuePosition among existing ready matches across other categories
  const maxExistingMatch = await Match.findOne({
    tournamentId,
    status: 'scheduled'
  }).sort({ queuePosition: -1 });
  let nextQueuePos = (maxExistingMatch?.queuePosition || 0) + 1;

  for (let i = 0; i < plan1.realMatchesCount; i++) {
    const m = round1Matches[i];
    const t1 = shuffledTeams[cursor++];
    const t2 = shuffledTeams[cursor++];
    m.team1 = t1._id;
    m.team2 = t2._id;
    m.status = 'scheduled'; // READY
    m.queuePosition = nextQueuePos++;
    m.boardName = 'Main Carrom Board';
    m.carromBoardNumber = 1;
  }

  if (plan1.byesCount === 1) {
    const byeMatch = round1Matches[plan1.realMatchesCount];
    const byeTeam = shuffledTeams[cursor++];
    byeMatch.team1 = byeTeam._id;
    byeMatch.winnerTeam = byeTeam._id;
    byeMatch.status = 'bye';
  }

  // 8. Save all matches atomically
  const allMatchesToSave = [];
  for (let r = 1; r <= totalRounds; r++) {
    allMatchesToSave.push(...roundMatchesMap[r]);
  }

  await Match.insertMany(allMatchesToSave);

  // Recalculate estimated scheduled times for the READY queue
  const { recalculateEstimatedTimes, enqueueNewlyReadyMatch } = require('./scheduleEngine');
  await recalculateEstimatedTimes(tournamentId);

  // 9. Record audit log
  await AuditLog.create({
    action: 'GENERATE_DYNAMIC_DRAW',
    performedBy: adminUserId,
    entityType: 'CategoryDraw',
    entityId: category,
    details: {
      category,
      totalTeams: N,
      totalRounds,
      roundsPlan,
      matchesGenerated: allMatchesToSave.length
    },
    reason: `Generated dynamic draw for ${N} teams across ${totalRounds} rounds.`
  });

  return {
    category,
    totalTeams: N,
    totalRounds,
    roundsPlan,
    matchesCount: allMatchesToSave.length,
    matches: allMatchesToSave
  };
};

/**
 * Dynamic Round Advancement Engine:
 * Called when all playable matches in Round r complete.
 * Collects all advancing entries (winners + round r bye player),
 * shuffles them freshly, and pairs them into Round r+1 matches!
 */
const progressCategoryToNextRound = async (tournamentId, category, currentRoundNumber) => {
  const currentMatches = await Match.find({
    tournamentId,
    category,
    roundNumber: currentRoundNumber
  });

  if (currentMatches.length === 0) return false;

  // Check if all playable matches in current round are completed
  const playableMatches = currentMatches.filter((m) => !m.isBye);
  const allPlayableCompleted = playableMatches.every((m) => m.status === 'completed' && m.winnerTeam);

  if (!allPlayableCompleted) return false; // Not ready to advance yet

  // Collect advancing entries from current round
  const advancingTeamIds = [];
  currentMatches.forEach((m) => {
    if (m.winnerTeam) {
      advancingTeamIds.push(m.winnerTeam.toString());
    }
  });

  if (advancingTeamIds.length <= 1) return true; // Tournament ended or single winner

  const nextRoundNumber = currentRoundNumber + 1;
  const nextMatches = await Match.find({
    tournamentId,
    category,
    roundNumber: nextRoundNumber
  }).sort({ matchIndexInRound: 1 });

  if (nextMatches.length === 0) return false;

  // Check if next round is already populated
  const isAlreadyPopulated = nextMatches.some((m) => m.team1 || m.team2);
  if (isAlreadyPopulated) return true;

  // Shuffle ALL advancing entries freshly for Round r+1
  const shuffledAdvancing = shuffleArray(advancingTeamIds);

  const realNextMatches = nextMatches.filter((m) => !m.isBye);
  const byeNextMatches = nextMatches.filter((m) => m.isBye);

  const { enqueueNewlyReadyMatch } = require('./scheduleEngine');
  let cursor = 0;

  // Pair teams into real matches for Round r+1
  for (const m of realNextMatches) {
    if (cursor + 1 < shuffledAdvancing.length) {
      m.team1 = shuffledAdvancing[cursor++];
      m.team2 = shuffledAdvancing[cursor++];
      // Newly ready match appends to the end of the READY queue in FIFO order
      await enqueueNewlyReadyMatch(tournamentId, m);
    }
  }

  // Assign single Bye recipient for Round r+1 if one exists
  if (byeNextMatches.length === 1 && cursor < shuffledAdvancing.length) {
    const byeM = byeNextMatches[0];
    const byeTeamId = shuffledAdvancing[cursor++];
    byeM.team1 = byeTeamId;
    byeM.winnerTeam = byeTeamId;
    byeM.status = 'bye';
    byeM.isResultConfirmed = true;
    await byeM.save();

    // If Round r+1 has NO real matches (only a Bye), automatically advance to Round r+2
    if (realNextMatches.length === 0) {
      await progressCategoryToNextRound(tournamentId, category, nextRoundNumber);
    }
  }

  return true;
};

module.exports = {
  generateDynamicBracket,
  getRoundNameByEntries,
  calculateRoundsPlan,
  progressCategoryToNextRound
};
