const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'milestone-state.json');

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ milestones: [] }, null, 2), 'utf8');
  }
}

function loadState() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.milestones)) {
      return { milestones: [] };
    }
    return parsed;
  } catch {
    return { milestones: [] };
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = {
  STORE_PATH,
  loadState,
  saveState,
};
