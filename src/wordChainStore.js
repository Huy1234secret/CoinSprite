const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'word-chain-state.json');

const DEFAULT_STATE = {
  game: null,
  cooldownEndsAt: 0,
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
  }, null, 2)}\n`, 'utf8');
}

module.exports = {
  STORE_PATH,
  loadState,
  saveState,
};
