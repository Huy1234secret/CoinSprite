const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ balances: {} }, null, 2), 'utf8');
  }
}

function loadState() {
  ensureStoreFile();

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.balances !== 'object' || parsed.balances === null) {
      return { balances: {} };
    }
    return parsed;
  } catch {
    return { balances: {} };
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function getBalance(userId) {
  const state = loadState();
  return Number(state.balances[userId] || 0);
}

function addBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.balances[userId] || 0);
  const next = current + amount;
  state.balances[userId] = next;
  saveState(state);
  return next;
}

module.exports = {
  STORE_PATH,
  getBalance,
  addBalance,
};
