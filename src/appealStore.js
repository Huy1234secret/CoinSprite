'use strict';

const path = require('path');
const { readJsonFile, writeJsonAtomic } = require('./jsonFileStore');

const STORE_PATH = process.env.MODERATION_APPEAL_STORE_PATH
  || path.join(__dirname, '..', 'data', 'moderation-appeals.json');
const VERSION = 1;
const FINAL_STATUSES = new Set(['accepted', 'denied']);

function emptyState() {
  return { version: VERSION, guilds: {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value, maximum = 1000) {
  return String(value ?? '').trim().slice(0, maximum);
}

function normalizeAttachment(value) {
  return {
    fieldId: clean(value?.fieldId, 60),
    name: clean(value?.name, 200),
    contentType: clean(value?.contentType, 120),
    size: Math.max(0, Number(value?.size) || 0),
    storedName: clean(value?.storedName, 240),
  };
}

function normalizeAnswer(value) {
  const raw = value?.value;
  return {
    fieldId: clean(value?.fieldId, 60),
    label: clean(value?.label, 100),
    type: clean(value?.type, 30),
    value: Array.isArray(raw)
      ? raw.map((item) => clean(item, 1000)).slice(0, 25)
      : typeof raw === 'boolean' || typeof raw === 'number'
        ? raw
        : clean(raw, 4000),
  };
}

function normalizeEvent(value, index, appealId) {
  return {
    id: clean(value?.id || appealId + ':E-' + String(index + 1).padStart(4, '0'), 100),
    type: clean(value?.type || 'appeal.event', 80),
    actorId: clean(value?.actorId, 30),
    createdAt: Number(value?.createdAt) || Date.now(),
    data: value?.data && typeof value.data === 'object' ? clone(value.data) : {},
  };
}

function normalizeAppeal(value) {
  const id = clean(value?.id, 80);
  const createdAt = Number(value?.createdAt) || Date.now();
  const status = ['pending', 'processing', 'accepted', 'denied'].includes(value?.status)
    ? value.status
    : 'pending';
  const events = (Array.isArray(value?.events) ? value.events : [])
    .map((event, index) => normalizeEvent(event, index, id));
  return {
    id,
    guildId: clean(value?.guildId, 30),
    caseId: clean(value?.caseId, 80),
    userId: clean(value?.userId, 30),
    status,
    answers: (Array.isArray(value?.answers) ? value.answers : []).slice(0, 10).map(normalizeAnswer),
    attachments: (Array.isArray(value?.attachments) ? value.attachments : []).slice(0, 50).map(normalizeAttachment),
    formSnapshot: Array.isArray(value?.formSnapshot) ? clone(value.formSnapshot).slice(0, 10) : [],
    logReference: {
      channelId: clean(value?.logReference?.channelId, 30),
      messageId: clean(value?.logReference?.messageId, 30),
    },
    createdAt,
    updatedAt: Number(value?.updatedAt) || createdAt,
    decidedAt: value?.decidedAt == null ? null : Number(value.decidedAt),
    decidedBy: clean(value?.decidedBy, 30),
    decisionReason: clean(value?.decisionReason, 1000),
    events,
  };
}

function normalizeState(value) {
  const state = emptyState();
  for (const [guildId, guild] of Object.entries(value?.guilds || {})) {
    const appeals = (Array.isArray(guild?.appeals) ? guild.appeals : [])
      .map(normalizeAppeal)
      .filter((appeal) => appeal.id && appeal.caseId && appeal.userId);
    state.guilds[guildId] = {
      nextAppealNumber: Math.max(1, Number(guild?.nextAppealNumber) || appeals.length + 1),
      appeals,
    };
  }
  return state;
}

function readState() {
  return normalizeState(readJsonFile(STORE_PATH, { fallback: emptyState, label: 'Moderation appeal store' }));
}

function writeState(state) {
  writeJsonAtomic(STORE_PATH, normalizeState(state));
}

function guildState(state, guildId) {
  const id = String(guildId || '');
  state.guilds[id] ||= { nextAppealNumber: 1, appeals: [] };
  return state.guilds[id];
}

function appendEvent(record, type, actorId = '', data = {}) {
  record.events.push(normalizeEvent({
    id: record.id + ':E-' + String(record.events.length + 1).padStart(4, '0'),
    type,
    actorId,
    createdAt: Date.now(),
    data,
  }, record.events.length, record.id));
  record.updatedAt = Date.now();
}

function publicAppeal(value) {
  return value ? clone(normalizeAppeal(value)) : null;
}

function createAppeal(input) {
  const state = readState();
  const guild = guildState(state, input.guildId);
  const number = guild.nextAppealNumber++;
  const now = Date.now();
  const record = normalizeAppeal({
    id: 'A-' + String(number).padStart(6, '0'),
    guildId: input.guildId,
    caseId: input.caseId,
    userId: input.userId,
    status: 'pending',
    answers: input.answers,
    attachments: input.attachments,
    formSnapshot: input.formSnapshot,
    createdAt: now,
    updatedAt: now,
    events: [],
  });
  appendEvent(record, 'appeal.submitted', record.userId, {});
  guild.appeals.push(record);
  writeState(state);
  return publicAppeal(record);
}

function listAppeals(guildId, filters = {}) {
  const guild = guildState(readState(), guildId);
  return guild.appeals
    .filter((item) => !filters.caseId || item.caseId === String(filters.caseId))
    .filter((item) => !filters.userId || item.userId === String(filters.userId))
    .filter((item) => !filters.status || item.status === String(filters.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicAppeal);
}

function getAppeal(guildId, appealId) {
  return listAppeals(guildId).find((item) => item.id.toLowerCase() === String(appealId || '').toLowerCase()) || null;
}

function eligibility(guildId, caseId, userId, config, now = Date.now()) {
  const appeals = listAppeals(guildId, { caseId, userId });
  const pending = appeals.find((item) => ['pending', 'processing'].includes(item.status));
  if (pending) return { allowed: false, code: 'pending', pending, count: appeals.length, retryAt: null };
  const maximum = config?.maxSubmissionsPerCase == null ? null : Number(config.maxSubmissionsPerCase);
  if (maximum != null && appeals.length >= maximum) {
    return { allowed: false, code: 'maximum', pending: null, count: appeals.length, retryAt: null };
  }
  const latest = appeals[0];
  const cooldownMs = Math.max(0, Number(config?.cooldownSeconds) || 0) * 1000;
  const retryAt = latest && cooldownMs > 0 ? latest.createdAt + cooldownMs : null;
  if (retryAt && retryAt > now) {
    return { allowed: false, code: 'cooldown', pending: null, count: appeals.length, retryAt };
  }
  return { allowed: true, code: 'allowed', pending: null, count: appeals.length, retryAt: null };
}

function updateRecord(guildId, appealId, callback) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.appeals.find((item) => item.id.toLowerCase() === String(appealId || '').toLowerCase());
  if (!record) return null;
  callback(record);
  record.updatedAt = Date.now();
  writeState(state);
  return publicAppeal(record);
}

function updateLogReference(guildId, appealId, reference) {
  return updateRecord(guildId, appealId, (record) => {
    record.logReference = {
      channelId: clean(reference?.channelId, 30),
      messageId: clean(reference?.messageId, 30),
    };
    appendEvent(record, 'appeal.logged', '', clone(record.logReference));
  });
}

function beginDecision(guildId, appealId, actorId, decision) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.appeals.find((item) => item.id.toLowerCase() === String(appealId || '').toLowerCase());
  if (!record) return { ok: false, code: 'missing', appeal: null };
  if (record.status !== 'pending') return { ok: false, code: FINAL_STATUSES.has(record.status) ? 'decided' : 'processing', appeal: publicAppeal(record) };
  record.status = 'processing';
  appendEvent(record, 'appeal.decision_started', actorId, { decision });
  writeState(state);
  return { ok: true, code: 'processing', appeal: publicAppeal(record) };
}

function finishDecision(guildId, appealId, actorId, decision, reason = '') {
  return updateRecord(guildId, appealId, (record) => {
    if (record.status !== 'processing') throw new Error('Appeal is not being processed.');
    record.status = decision === 'accepted' ? 'accepted' : 'denied';
    record.decidedAt = Date.now();
    record.decidedBy = clean(actorId, 30);
    record.decisionReason = clean(reason, 1000);
    appendEvent(record, 'appeal.' + record.status, actorId, { reason: record.decisionReason });
  });
}

function failDecision(guildId, appealId, actorId, error) {
  return updateRecord(guildId, appealId, (record) => {
    if (record.status === 'processing') record.status = 'pending';
    appendEvent(record, 'appeal.decision_failed', actorId, { error: clean(error, 1000) });
  });
}

function removeAppeal(guildId, appealId) {
  const state = readState();
  const guild = guildState(state, guildId);
  const before = guild.appeals.length;
  guild.appeals = guild.appeals.filter((item) => item.id.toLowerCase() !== String(appealId || '').toLowerCase());
  if (guild.appeals.length === before) return false;
  writeState(state);
  return true;
}

module.exports = {
  STORE_PATH,
  VERSION,
  beginDecision,
  createAppeal,
  eligibility,
  failDecision,
  finishDecision,
  getAppeal,
  listAppeals,
  removeAppeal,
  updateLogReference,
  __test: { emptyState, normalizeAppeal, normalizeState, readState, writeState },
};
