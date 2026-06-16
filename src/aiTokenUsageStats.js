'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'ai-token-usage.json');
const UTC_PLUS_7_MS = 7 * 60 * 60 * 1000;
const RETENTION_MONTHS = 13;
const RECENT_EVENTS_PER_GUILD = 40;
const DEFAULT_MODEL_RATES = {
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

function utcPlus7MonthKey(date = new Date()) {
  return new Date(date.getTime() + UTC_PLUS_7_MS).toISOString().slice(0, 7);
}

function safeNumber(value) {
  const number = Number(value) || 0;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function safeMoney(value) {
  const number = Number(value) || 0;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    models: {},
  };
}

function modelRate(model) {
  const key = String(model || '').trim();
  const envInput = safeMoney(process.env.OPENAI_INPUT_USD_PER_1M);
  const envOutput = safeMoney(process.env.OPENAI_OUTPUT_USD_PER_1M);
  if (envInput || envOutput) {
    return {
      inputPerMillion: envInput || DEFAULT_MODEL_RATES['gpt-4o-mini'].inputPerMillion,
      outputPerMillion: envOutput || DEFAULT_MODEL_RATES['gpt-4o-mini'].outputPerMillion,
    };
  }
  return DEFAULT_MODEL_RATES[key] || DEFAULT_MODEL_RATES['gpt-4o-mini'];
}

function estimateCostUsd(usage = {}, model = 'gpt-4o-mini') {
  const rate = modelRate(model);
  return ((safeNumber(usage.inputTokens) / 1000000) * rate.inputPerMillion)
    + ((safeNumber(usage.outputTokens) / 1000000) * rate.outputPerMillion);
}

function estimateAggregateCostUsd(usage = {}) {
  const models = usage.models && typeof usage.models === 'object' ? usage.models : {};
  const modelEntries = Object.entries(models);
  if (!modelEntries.length) return estimateCostUsd(usage, process.env.OPENAI_MODERATION_MODEL || 'gpt-4o-mini');
  return modelEntries.reduce((sum, [model, modelUsage]) => sum + estimateCostUsd(modelUsage, model), 0);
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
    existing.estimatedCostUsd = estimateCostUsd(existing, model);
    target.models[model] = existing;
  }
  target.estimatedCostUsd = estimateAggregateCostUsd(target);
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
  const costUsd = estimateCostUsd(tokenUsage, model);

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
    estimatedCostUsd: costUsd,
    ...tokenUsage,
  });

  pruneState(state);
  saveState(state);
  return { ...tokenUsage, estimatedCostUsd: costUsd };
}

function withEstimatedCost(usage = {}, model = '') {
  const normalized = { ...emptyUsage(), ...usage, models: usage.models || {} };
  normalized.estimatedCostUsd = estimateAggregateCostUsd(normalized) || estimateCostUsd(normalized, model);
  return normalized;
}

function monthUsageForGuild(state, month, guildId) {
  const usage = state.months?.[month]?.guilds?.[guildId];
  return usage ? withEstimatedCost(usage) : emptyUsage();
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
      recent: (Array.isArray(state.history[guildId]) ? state.history[guildId] : [])
        .slice(-8)
        .reverse()
        .map((entry) => ({
          ...entry,
          estimatedCostUsd: safeMoney(entry.estimatedCostUsd) || estimateCostUsd(entry, entry.model),
        })),
    };
  }
  return {
    month,
    timezone: 'UTC+7',
    resetAt: '1st day 00:00 UTC+7',
    total: withEstimatedCost(state.months?.[month]?.total || emptyUsage()),
    guilds,
  };
}

module.exports = {
  estimateCostUsd,
  monthlyOverview,
  recordUsage,
  utcPlus7MonthKey,
};
