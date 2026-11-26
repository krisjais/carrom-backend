/**
 * Helpers for generating clean, deterministic, collision-free Carrom
 * Player IDs (`CAR-<NAME>`), usernames, emails, and passwords (`<name>123`)
 * derived from each participant's full name.
 */

const extractWords = (fullName) => {
  return String(fullName || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
};

const buildFirstNameCounts = (entries = []) => {
  const counts = {};
  for (const item of entries) {
    const words = extractWords(item?.fullName || item);
    const first = words[0] || 'player';
    counts[first] = (counts[first] || 0) + 1;
  }
  return counts;
};

const generateNameCredentials = (fullName, { firstNameCounts = null, usedKeys = new Set() } = {}) => {
  const words = extractWords(fullName);
  const first = words[0] || 'player';
  const twoWords = words.slice(0, 2).join('') || first;
  const allWords = words.join('') || first;

  const preferTwoWords = firstNameCounts && (firstNameCounts[first] || 0) > 1;
  let candidate = preferTwoWords ? twoWords : first;

  if (usedKeys.has(candidate)) {
    candidate = !usedKeys.has(twoWords)
      ? twoWords
      : !usedKeys.has(allWords)
      ? allWords
      : candidate;
  }

  let key = candidate;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${allWords}${suffix}`;
    suffix++;
  }
  usedKeys.add(key);

  return {
    nameKey: key,
    studentId: `CAR-${key.toUpperCase()}`,
    username: key,
    email: `${key}@carrom.edu`,
    password: `${key}123`
  };
};

const allocateUniqueCredentials = async (fullName, { User, Participant }) => {
  const [existingUsers, existingParticipants] = await Promise.all([
    User.find({}).select('username email').lean(),
    Participant.find({}).select('studentId email').lean()
  ]);

  const usedKeys = new Set();
  for (const u of existingUsers) {
    if (u.username) usedKeys.add(u.username.toLowerCase().trim());
    if (u.email && u.email.endsWith('@carrom.edu')) {
      usedKeys.add(u.email.split('@')[0].toLowerCase().trim());
    }
  }
  for (const p of existingParticipants) {
    if (p.studentId) {
      usedKeys.add(p.studentId.replace(/^CAR-/i, '').toLowerCase().trim());
    }
  }

  return generateNameCredentials(fullName, { usedKeys });
};

module.exports = {
  extractWords,
  buildFirstNameCounts,
  generateNameCredentials,
  allocateUniqueCredentials
};
