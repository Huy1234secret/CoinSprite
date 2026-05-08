const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'giveaway-state.json');

const DEFAULT_STATE = {
  drafts: {},
  giveaways: {},
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
      drafts: parsed.drafts ?? {},
      giveaways: parsed.giveaways ?? {},
    };
  } catch {
    const fallback = cloneDefaultState();
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
    return fallback;
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

module.exports = {
  STORE_PATH,
  loadState,
  saveState,
};
