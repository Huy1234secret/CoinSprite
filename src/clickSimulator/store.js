const path = require('path');
const { readJsonFile, writeJsonAtomic } = require('../jsonFileStore');

const CLICK_SIMULATOR_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'click-simulator.json');
const CRITICAL_CHANCE = 0.001;
const NORMAL_CLICK_VALUE = 1;
const CRITICAL_CLICK_VALUE = 10;

function defaultState() {
  return {
    version: 1,
    users: {},
  };
}

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function normalizeUserRecord(record = {}, userId = '', guildId = '') {
  return {
    userId,
    guildId: cleanDiscordId(record.guildId) || cleanDiscordId(guildId),
    clicks: Math.max(0, Math.floor(Number(record.clicks) || 0)),
    totalClicks: Math.max(0, Math.floor(Number(record.totalClicks) || 0)),
    criticalClicks: Math.max(0, Math.floor(Number(record.criticalClicks) || 0)),
    lastClickAt: record.lastClickAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function normalizeState(value = {}) {
  const state = defaultState();
  const users = value && typeof value === 'object' && !Array.isArray(value) ? value.users : null;
  if (users && typeof users === 'object' && !Array.isArray(users)) {
    for (const [userId, record] of Object.entries(users)) {
      const cleanUserId = cleanDiscordId(userId);
      if (!cleanUserId) continue;
      state.users[cleanUserId] = normalizeUserRecord(record, cleanUserId);
    }
  }
  return state;
}

function loadClickSimulatorState(filePath = CLICK_SIMULATOR_STATE_PATH) {
  return normalizeState(readJsonFile(filePath, { fallback: defaultState, label: 'click simulator data' }));
}

function saveClickSimulatorState(state, filePath = CLICK_SIMULATOR_STATE_PATH) {
  const normalized = normalizeState(state);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

function getClickStats(userId, options = {}) {
  const cleanUserId = cleanDiscordId(userId);
  if (!cleanUserId) throw new Error('A valid Discord user ID is required.');
  const state = loadClickSimulatorState(options.filePath);
  return normalizeUserRecord(state.users[cleanUserId], cleanUserId, options.guildId);
}

function recordClick(userId, options = {}) {
  const cleanUserId = cleanDiscordId(userId);
  if (!cleanUserId) throw new Error('A valid Discord user ID is required.');
  const state = loadClickSimulatorState(options.filePath);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const random = typeof options.random === 'function' ? Number(options.random()) : Math.random();
  const critical = random >= 0 && random < CRITICAL_CHANCE;
  const award = critical ? CRITICAL_CLICK_VALUE : NORMAL_CLICK_VALUE;
  const current = normalizeUserRecord(state.users[cleanUserId], cleanUserId, options.guildId);
  const next = {
    ...current,
    guildId: cleanDiscordId(options.guildId) || current.guildId,
    clicks: current.clicks + award,
    totalClicks: current.totalClicks + 1,
    criticalClicks: current.criticalClicks + (critical ? 1 : 0),
    lastClickAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  state.users[cleanUserId] = next;
  saveClickSimulatorState(state, options.filePath);
  return {
    ...next,
    award,
    critical,
    criticalChance: CRITICAL_CHANCE,
  };
}

module.exports = {
  CLICK_SIMULATOR_STATE_PATH,
  CRITICAL_CHANCE,
  CRITICAL_CLICK_VALUE,
  NORMAL_CLICK_VALUE,
  defaultState,
  getClickStats,
  loadClickSimulatorState,
  recordClick,
  saveClickSimulatorState,
};
