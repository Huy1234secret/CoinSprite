'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'ai-token-usage.json');
const UTC_PLUS_7_MS = 7 * 60 * 60 * 1000;
const RETENTION_MONTHS = 13;
const RECENT_EVENTS_PER_GUILD = 40;

function utcPlus7MonthKey(date = new Date()) {
  return new Date(date.getTime() + UTC_PLUS_7_MS).toISOString().slice(0, 7);
}

function safeNumber(value) {
  const number = Number(value) || 0;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function emptyUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    models: {},
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || 'null');
    if (parsed && typeof parsed === 'object') {
      parsed.months = parsed.months && typeof parsed.months === 'object' ? parsed.months : {};
      parsed.history = parsed.history && typeof parsed.history === 'object' ? parsed.history : {};
      return parsed;
    }
  } catch {}
  return { version: 1, months: {}, history: {} };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function normalizeUsage(usage = {}) {
  const inputTokens = safeNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = safeNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = safeNumber(usage.total_tokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function addUsage(target, usage, model) {
  target.requests = safeNumber(target.requests) + 1;
  target.inputTokens = safeNumber(target.inputTokens) + usage.inputTokens;
  target.outputTokens = safeNumber(target.outputTokens) + usage.outputTokens;
  target.totalTokens = safeNumber(target.totalTokens) + usage.totalTokens;
  target.models = target.models && typeof target.models === 'object' ? target.models : {};
  if (model) {
    const existing = target.models[model] || emptyUsage();
    addUsage(existing, usage, '');
    target.models[model] = existing;
  }
}

function pruneState(state) {
  const months = Object.keys(state.months || {}).sort();
  for (const month of months.slice(0, Math.max(0, months.length - RETENTION_MONTHS))) {
    delete state.months[month];
  }
  for (const [guildId, events] of Object.entries(state.history || {})) {
    if (!Array.isArray(events) || !events.length) {
      delete state.history[guildId];
      continue;
    }
    state.history[guildId] = events.slice(-RECENT_EVENTS_PER_GUILD);
  }
}

function recordUsage({ guildId, model, usage, source = 'openai' } = {}) {
  const id = String(guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) return null;
  const tokenUsage = normalizeUsage(usage);
  if (!tokenUsage.totalTokens) return null;

  const month = utcPlus7MonthKey();
  const state = loadState();
  state.months[month] = state.months[month] || { total: emptyUsage(), guilds: {} };
  state.months[month].total = state.months[month].total || emptyUsage();
  state.months[month].guilds = state.months[month].guilds || {};
  state.months[month].guilds[id] = state.months[month].guilds[id] || emptyUsage();

  addUsage(state.months[month].total, tokenUsage, model);
  addUsage(state.months[month].guilds[id], tokenUsage, model);

  state.history[id] = Array.isArray(state.history[id]) ? state.history[id] : [];
  state.history[id].push({
    at: new Date().toISOString(),
    month,
    model: String(model || 'unknown').slice(0, 80),
    source,
    ...tokenUsage,
  });

  pruneState(state);
  saveState(state);
  return tokenUsage;
}

function monthUsageForGuild(state, month, guildId) {
  const usage = state.months?.[month]?.guilds?.[guildId];
  return usage ? { ...emptyUsage(), ...usage, models: usage.models || {} } : emptyUsage();
}

function monthlyOverview(date = new Date()) {
  const state = loadState();
  const month = utcPlus7MonthKey(date);
  const guildIds = new Set([
    ...Object.keys(state.history || {}),
    ...Object.values(state.months || {}).flatMap((entry) => Object.keys(entry.guilds || {})),
  ]);
  const monthKeys = Object.keys(state.months || {}).sort().reverse();
  const guilds = {};
  for (const guildId of guildIds) {
    const history = monthKeys
      .map((key) => ({ month: key, ...monthUsageForGuild(state, key, guildId) }))
      .filter((entry) => entry.totalTokens || entry.requests)
      .slice(0, 6);
    guilds[guildId] = {
      current: monthUsageForGuild(state, month, guildId),
      history,
      recent: (Array.isArray(state.history[guildId]) ? state.history[guildId] : []).slice(-8).reverse(),
    };
  }
  return {
    month,
    timezone: 'UTC+7',
    resetAt: '1st day 00:00 UTC+7',
    total: state.months?.[month]?.total || emptyUsage(),
    guilds,
  };
}

module.exports = {
  monthlyOverview,
  recordUsage,
  utcPlus7MonthKey,
};
