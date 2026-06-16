const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'daily-message-stats.json');
const RETENTION_DAYS = 45;
const SAVE_DELAY_MS = 2000;
let state = null;
let saveTimer = null;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyState() {
  return { updatedAt: Date.now(), days: {} };
}

function loadState() {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}');
    state = parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object'
      ? parsed
      : emptyState();
  } catch {
    state = emptyState();
  }
  return state;
}

function pruneDays(target = loadState()) {
  const keys = Object.keys(target.days || {}).sort();
  while (keys.length > RETENTION_DAYS) {
    const oldest = keys.shift();
    delete target.days[oldest];
  }
}

function saveNow() {
  if (!state) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pruneDays(state);
  state.updatedAt = Date.now();
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => saveNow(), SAVE_DELAY_MS);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function ensureGuildDay(target, dayKey, guildId) {
  target.days[dayKey] ||= { total: 0, guilds: {} };
  target.days[dayKey].guilds[guildId] ||= { total: 0, channels: {} };
  return target.days[dayKey].guilds[guildId];
}

function recordMessage(message) {
  if (!message?.guildId || message.author?.bot) return;
  const target = loadState();
  const dayKey = localDateKey();
  const guild = ensureGuildDay(target, dayKey, String(message.guildId));
  const channelId = String(message.channelId || 'unknown');
  target.days[dayKey].total = Number(target.days[dayKey].total || 0) + 1;
  guild.total = Number(guild.total || 0) + 1;
  guild.channels[channelId] = Number(guild.channels[channelId] || 0) + 1;
  scheduleSave();
}

function todayOverview() {
  const target = loadState();
  saveNow();
  const dayKey = localDateKey();
  const day = target.days[dayKey] || { total: 0, guilds: {} };
  return {
    date: dayKey,
    total: Number(day.total || 0),
    guilds: Object.fromEntries(Object.entries(day.guilds || {}).map(([guildId, value]) => [guildId, {
      total: Number(value?.total || 0),
      channels: value?.channels || {},
    }])),
  };
}

module.exports = {
  recordMessage,
  todayOverview,
};
