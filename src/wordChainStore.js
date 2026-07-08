const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'word-chain-state.json');

const DEFAULT_STATE = {
  game: null,
  cooldownEndsAt: 0,
  restrictions: {},
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function ensureParentDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function ensureStoreFile() {
  ensureParentDir();
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
  }
}

function loadState() {
  ensureStoreFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}');
    return {
      game: parsed.game ?? null,
      cooldownEndsAt: Number(parsed.cooldownEndsAt) || 0,
      restrictions: normalizeRestrictions(parsed.restrictions),
    };
  } catch {
    const fallback = cloneDefaultState();
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
    return fallback;
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify({
    game: state?.game ?? null,
    cooldownEndsAt: Number(state?.cooldownEndsAt) || 0,
    restrictions: normalizeRestrictions(state?.restrictions),
  }, null, 2)}\n`, 'utf8');
}

function normalizeRestrictions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const restrictions = {};
  for (const [userId, expiresAt] of Object.entries(source)) {
    if (!/^\d{16,20}$/.test(userId)) continue;
    const parsedExpiry = Number(expiresAt);
    if (Number.isFinite(parsedExpiry) && parsedExpiry > Date.now()) restrictions[userId] = parsedExpiry;
  }
  return restrictions;
}

module.exports = {
  STORE_PATH,
  loadState,
  saveState,
};
