const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'luck-boosts.json');
const DEFAULT_STATE = { activeBoost: null };
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PERCENT = 10_000;

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
}

function normalizeState(state) {
  const activeBoost = state?.activeBoost && typeof state.activeBoost === 'object' ? state.activeBoost : null;
  return { activeBoost };
}

function loadState() {
  ensureStore();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function parseDuration(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  const unitPattern = /(\d+(?:\.\d+)?)(days|day|d|hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)/g;
  let totalMs = 0;
  let matched = '';
  let match;

  while ((match = unitPattern.exec(compact)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = match[2];
    const multiplier = unit.startsWith('d') ? 86_400_000
      : unit.startsWith('h') ? 3_600_000
        : unit.startsWith('m') ? 60_000
          : 1_000;
    totalMs += value * multiplier;
    matched += match[0];
  }

  if (matched !== compact) return null;
  const roundedMs = Math.round(totalMs);
  if (roundedMs < MIN_DURATION_MS || roundedMs > MAX_DURATION_MS) return null;
  return roundedMs;
}

function parseLuckPercent(input) {
  const raw = String(input || '').trim().replace(/%$/, '');
  if (!raw) return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_PERCENT) return null;
  return percent;
}

function getMultiplierFromPercent(percent) {
  return 1 + (Math.max(0, Number(percent) || 0) / 100);
}

function formatMultiplier(multiplier) {
  const safe = Math.max(1, Number(multiplier) || 1);
  return `${Number(safe.toFixed(2))}x`;
}

function formatMoreLuckPercent(percent) {
  return `${Number((Math.max(0, Number(percent) || 0)).toFixed(2)).toLocaleString('en-US').replace(/\.00$/, '')}%`;
}

function colorForMultiplier(multiplier) {
  const safe = Math.max(1, Number(multiplier) || 1);
  if (safe >= 10) return 0x9B59B6;
  if (safe >= 5) return 0xE74C3C;
  if (safe >= 3) return 0xE67E22;
  if (safe >= 2) return 0xF1C40F;
  return 0x57F287;
}

function startBoost({ durationMs, percent, startedById, now = Date.now() }) {
  const multiplier = getMultiplierFromPercent(percent);
  const boost = {
    percent,
    multiplier,
    startedById,
    startedAt: now,
    endsAt: now + durationMs,
  };
  saveState({ activeBoost: boost });
  return boost;
}

function getActiveBoost(now = Date.now()) {
  const state = loadState();
  const boost = state.activeBoost;
  if (!boost || Number(boost.endsAt) <= now) {
    if (boost) saveState({ activeBoost: null });
    return null;
  }
  const percent = Math.max(0, Number(boost.percent) || 0);
  const multiplier = Math.max(1, Number(boost.multiplier) || getMultiplierFromPercent(percent));
  return {
    ...boost,
    percent,
    multiplier,
  };
}

module.exports = {
  MAX_DURATION_MS,
  MAX_PERCENT,
  MIN_DURATION_MS,
  colorForMultiplier,
  formatMoreLuckPercent,
  formatMultiplier,
  getActiveBoost,
  getMultiplierFromPercent,
  parseDuration,
  parseLuckPercent,
  startBoost,
};
