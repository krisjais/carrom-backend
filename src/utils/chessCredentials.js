/**
 * Generates clean, unique, name-based Chess Player IDs (`CHS-<NAME>`) and
 * default passwords (`<name>123`) from each competitor's full name.
 */

const extractChessWords = (fullName) => {
  return String(fullName || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
};

const generateChessNameCredentials = (fullName, existingPlayerIds = []) => {
  const usedKeys = new Set(
    (existingPlayerIds || [])
      .filter(Boolean)
      .map((id) => String(id).replace(/^CHS-/i, '').toLowerCase().trim())
  );

  const words = extractChessWords(fullName);
  const first = words[0] || 'player';
  const twoWords = words.slice(0, 2).join('') || first;
  const allWords = words.join('') || first;

  let key = first;
  if (usedKeys.has(key)) {
    key = !usedKeys.has(twoWords)
      ? twoWords
      : !usedKeys.has(allWords)
      ? allWords
      : first;
  }

  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${allWords}${suffix}`;
    suffix++;
  }

  return {
    nameKey: key,
    playerId: `CHS-${key.toUpperCase()}`,
    email: `${key}@gmail.com`,
    password: `${key}123`
  };
};

module.exports = {
  extractChessWords,
  generateChessNameCredentials
};
