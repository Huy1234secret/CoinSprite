const fs = require('fs');
const path = require('path');

const STORE_PATH = process.env.MODERATION_CASE_STORE_PATH
  || path.join(__dirname, '..', 'data', 'moderation-cases.json');
const VERSION = 1;
const ACTIVE = 'active';
const EXPIRED = 'expired';
const PARDONED = 'pardoned';

function emptyState() {
  return { version: VERSION, guilds: {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCase(record) {
  const createdAt = Number(record?.createdAt) || Date.now();
  const expiresAt = record?.expiresAt == null ? null : Number(record.expiresAt);
  return {
    id: String(record?.id || ''),
    guildId: String(record?.guildId || ''),
    memberId: String(record?.memberId || ''),
    moderatorId: String(record?.moderatorId || ''),
    source: String(record?.source || 'manual').slice(0, 40),
    reason: String(record?.reason || 'No reason provided.').slice(0, 1000),
    staffNotes: String(record?.staffNotes || '').slice(0, 1000),
    points: Math.max(1, Math.min(10, Math.round(Number(record?.points) || 1))),
    evidence: String(record?.evidence || '').slice(0, 1000),
    sourceChannelId: String(record?.sourceChannelId || ''),
    sourceMessageId: String(record?.sourceMessageId || ''),
    createdAt,
    updatedAt: Number(record?.updatedAt) || createdAt,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    status: [ACTIVE, EXPIRED, PARDONED].includes(record?.status) ? record.status : ACTIVE,
    pardonedAt: Number(record?.pardonedAt) || null,
    pardonedBy: String(record?.pardonedBy || ''),
    pardonReason: String(record?.pardonReason || '').slice(0, 1000),
    delivery: record?.delivery && typeof record.delivery === 'object' ? clone(record.delivery) : { status: 'pending' },
    enforcementEvents: Array.isArray(record?.enforcementEvents) ? clone(record.enforcementEvents) : [],
  };
}

function normalizeState(raw) {
  const state = emptyState();
  for (const [guildId, rawGuild] of Object.entries(raw?.guilds || {})) {
    const cases = Array.isArray(rawGuild?.cases)
      ? rawGuild.cases.map(normalizeCase).filter((record) => record.id && record.memberId)
      : [];
    state.guilds[guildId] = {
      nextCaseNumber: Math.max(1, Number(rawGuild?.nextCaseNumber) || cases.length + 1),
      cases,
      crossedThresholds: rawGuild?.crossedThresholds && typeof rawGuild.crossedThresholds === 'object'
        ? clone(rawGuild.crossedThresholds)
        : {},
    };
  }
  return state;
}

function readState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}'));
  } catch {
    return emptyState();
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const next = normalizeState(state);
  const temporary = STORE_PATH + '.tmp';
  const serialized = JSON.stringify(next, null, 2) + '\n';
  fs.writeFileSync(temporary, serialized, 'utf8');
  try {
    fs.renameSync(temporary, STORE_PATH);
  } catch {
    // Windows cannot always replace an existing destination with renameSync.
    fs.writeFileSync(STORE_PATH, serialized, 'utf8');
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function guildState(state, guildId) {
  const id = String(guildId || '');
  if (!state.guilds[id]) state.guilds[id] = { nextCaseNumber: 1, cases: [], crossedThresholds: {} };
  return state.guilds[id];
}

function expireCases(guild) {
  const now = Date.now();
  let changed = false;
  for (const record of guild.cases) {
    if (record.status === ACTIVE && record.expiresAt && record.expiresAt <= now) {
      record.status = EXPIRED;
      record.updatedAt = now;
      changed = true;
    }
  }
  return changed;
}

function activePointsFromGuild(guild, memberId) {
  return guild.cases
    .filter((record) => record.memberId === String(memberId) && record.status === ACTIVE)
    .reduce((total, record) => total + record.points, 0);
}

function rearmThresholds(guild, memberId) {
  const id = String(memberId);
  const points = activePointsFromGuild(guild, id);
  const crossed = Array.isArray(guild.crossedThresholds[id]) ? guild.crossedThresholds[id] : [];
  guild.crossedThresholds[id] = crossed.filter((threshold) => Number(threshold) <= points);
}

function createCase(input) {
  const state = readState();
  const guild = guildState(state, input.guildId);
  expireCases(guild);
  const number = guild.nextCaseNumber++;
  const now = Date.now();
  const record = normalizeCase({
    ...input,
    id: 'W-' + String(number).padStart(6, '0'),
    createdAt: now,
    updatedAt: now,
    status: ACTIVE,
    delivery: { status: 'pending', attemptedAt: null, channelId: '' },
    enforcementEvents: [],
  });
  guild.cases.push(record);
  rearmThresholds(guild, record.memberId);
  writeState(state);
  return clone(record);
}

function listCases(guildId, filters = {}) {
  const state = readState();
  const guild = guildState(state, guildId);
  const changed = expireCases(guild);
  const memberId = String(filters.memberId || '');
  const status = String(filters.status || '');
  const source = String(filters.source || '');
  const query = String(filters.query || '').trim().toLowerCase();
  if (changed) {
    for (const id of new Set(guild.cases.map((record) => record.memberId))) rearmThresholds(guild, id);
    writeState(state);
  }
  return guild.cases
    .filter((record) => !memberId || record.memberId === memberId)
    .filter((record) => !status || record.status === status)
    .filter((record) => !source || record.source === source)
    .filter((record) => !query || [record.id, record.memberId, record.reason, record.evidence].some((value) => String(value).toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(clone);
}

function getCase(guildId, caseId) {
  return listCases(guildId).find((record) => record.id.toLowerCase() === String(caseId || '').toLowerCase()) || null;
}

function activePoints(guildId, memberId) {
  return listCases(guildId, { memberId }).filter((record) => record.status === ACTIVE).reduce((sum, record) => sum + record.points, 0);
}

function updateCase(guildId, caseId, patch) {
  const state = readState();
  const guild = guildState(state, guildId);
  expireCases(guild);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  if (record.status === PARDONED) throw new Error('Pardoned cases cannot be edited.');
  if (patch.reason !== undefined) record.reason = String(patch.reason || '').trim().slice(0, 1000) || record.reason;
  if (patch.points !== undefined) record.points = Math.max(1, Math.min(10, Math.round(Number(patch.points) || record.points)));
  if (patch.evidence !== undefined) record.evidence = String(patch.evidence || '').trim().slice(0, 1000);
  if (patch.staffNotes !== undefined) record.staffNotes = String(patch.staffNotes || '').trim().slice(0, 1000);
  if (patch.expiresAt !== undefined) {
    const expiry = patch.expiresAt == null ? null : Number(patch.expiresAt);
    record.expiresAt = Number.isFinite(expiry) ? expiry : null;
    record.status = record.expiresAt && record.expiresAt <= Date.now() ? EXPIRED : ACTIVE;
  }
  record.updatedAt = Date.now();
  rearmThresholds(guild, record.memberId);
  writeState(state);
  return clone(record);
}

function pardonCase(guildId, caseId, moderatorId, reason) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  record.status = PARDONED;
  record.pardonedAt = Date.now();
  record.pardonedBy = String(moderatorId || '');
  record.pardonReason = String(reason || '').trim().slice(0, 1000);
  record.updatedAt = record.pardonedAt;
  rearmThresholds(guild, record.memberId);
  writeState(state);
  return clone(record);
}

function updateDelivery(guildId, caseId, delivery) {
  return updateRecord(guildId, caseId, (record) => {
    record.delivery = { ...record.delivery, ...clone(delivery), attemptedAt: Date.now() };
  });
}

function appendEnforcement(guildId, caseId, event) {
  return updateRecord(guildId, caseId, (record) => {
    record.enforcementEvents.push({ ...clone(event), createdAt: Number(event.createdAt) || Date.now() });
  });
}

function updateRecord(guildId, caseId, callback) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  callback(record);
  record.updatedAt = Date.now();
  writeState(state);
  return clone(record);
}

function claimCrossedThresholds(guildId, memberId, thresholds) {
  const state = readState();
  const guild = guildState(state, guildId);
  expireCases(guild);
  const id = String(memberId);
  rearmThresholds(guild, id);
  const points = activePointsFromGuild(guild, id);
  const crossed = new Set((guild.crossedThresholds[id] || []).map(Number));
  const eligible = [...new Set((thresholds || []).map(Number).filter((value) => Number.isFinite(value) && value > 0 && value <= points))].sort((a, b) => a - b);
  const newlyCrossed = eligible.filter((threshold) => !crossed.has(threshold));
  guild.crossedThresholds[id] = [...new Set([...crossed, ...eligible])].sort((a, b) => a - b);
  writeState(state);
  return { points, thresholds: newlyCrossed };
}

module.exports = {
  ACTIVE,
  EXPIRED,
  PARDONED,
  STORE_PATH,
  activePoints,
  appendEnforcement,
  claimCrossedThresholds,
  createCase,
  getCase,
  listCases,
  pardonCase,
  updateCase,
  updateDelivery,
  __test: { emptyState, normalizeState, readState, writeState },
};
