const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-notifications.json');
const MAX_SAFE_DENOMINATOR = Number.MAX_SAFE_INTEGER;

function defaultState() {
  return { users: {} };
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
}

function loadState() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      ...defaultState(),
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      users: parsed?.users && typeof parsed.users === 'object' ? parsed.users : {},
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...defaultState(), ...state }, null, 2), 'utf8');
}

function normalizeThreshold(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.floor(Number(value));
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return number;
}

function getThreshold(userId) {
  const state = loadState();
  return normalizeThreshold(state.users?.[userId]?.threshold ?? null);
}

function setThreshold(userId, threshold) {
  const state = loadState();
  state.users[userId] = {
    threshold: normalizeThreshold(threshold),
    updatedAt: Date.now(),
  };
  saveState(state);
  return state.users[userId].threshold;
}

function shouldNotify(userId, denominator) {
  const threshold = getThreshold(userId);
  if (threshold === null) return true;
  return Math.floor(Number(denominator) || 0) >= threshold;
}

function formatShortNumber(value) {
  const amount = Math.floor(Number(value) || 0);
  const units = [
    [1_000_000_000_000, 't'],
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (amount >= size && amount % size === 0) return `${amount / size}${suffix}`;
  }
  return amount.toLocaleString('en-US');
}

function formatThresholdLabel(threshold) {
  const normalized = normalizeThreshold(threshold);
  return normalized === null ? 'All' : `1/${formatShortNumber(normalized)}+`;
}

function parseThresholdInput(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { ok: true, threshold: null };

  const cleaned = raw
    .replace(/,/g, '')
    .replace(/^1\s*(?:\/|in)\s*/i, '')
    .trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([kmbt])?$/i);
  if (!match) {
    return { ok: false, error: 'Type a number like `1000`, `1k`, `1m`, `1b`, `1t`, or leave it empty for all notifications.' };
  }

  const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };
  const amount = Number(match[1]) * (multipliers[match[2]] || 1);
  const threshold = Math.floor(amount);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > MAX_SAFE_DENOMINATOR) {
    return { ok: false, error: 'That chance is too large. Please use a smaller number.' };
  }

  return { ok: true, threshold };
}

module.exports = {
  getThreshold,
  setThreshold,
  shouldNotify,
  formatThresholdLabel,
  parseThresholdInput,
};
