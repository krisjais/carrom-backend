const { getRoundNameByEntries } = require('../services/drawEngine');

function simulateDraw(N) {
  const roundsPlan = [];
  let currentEntries = N;
  let rNum = 1;

  while (currentEntries > 1) {
    const realMatchesCount = Math.floor(currentEntries / 2);
    const byesCount = currentEntries % 2;
    const nextEntriesCount = realMatchesCount + byesCount;

    roundsPlan.push({
      roundNumber: rNum,
      entriesCount: currentEntries,
      realMatchesCount,
      byesCount,
      nextEntriesCount,
      roundName: getRoundNameByEntries(currentEntries, rNum)
    });

    currentEntries = nextEntriesCount;
    rNum++;
  }

  const totalRealMatches = roundsPlan.reduce((acc, r) => acc + r.realMatchesCount, 0);
  const totalByes = roundsPlan.reduce((acc, r) => acc + r.byesCount, 0);

  return {
    N,
    totalRounds: roundsPlan.length,
    totalRealMatches,
    totalByes,
    roundsPlan
  };
}

const testCases = [4, 5, 6, 8, 9, 10, 15, 16, 20, 31, 32];

console.log('================================================================');
console.log('       TOURNAMENT DRAW ENGINE ALGORITHM TEST RESULTS            ');
console.log('================================================================\n');

testCases.forEach((N) => {
  const result = simulateDraw(N);
  console.log(`>>> TEST CASE: N = ${N} PLAYERS/TEAMS`);
  console.log(`    Total Rounds: ${result.totalRounds} | Playable Matches: ${result.totalRealMatches} | Total Byes: ${result.totalByes}`);
  result.roundsPlan.forEach((r) => {
    console.log(`    - ${r.roundName} (Round ${r.roundNumber}): ${r.entriesCount} entries -> ${r.realMatchesCount} matches, ${r.byesCount} bye -> ${r.nextEntriesCount} advancing`);
  });
  console.log('----------------------------------------------------------------');
});

module.exports = { simulateDraw };
