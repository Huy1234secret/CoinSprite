const fs = require('fs');
const path = require('path');

const STORE_PATH = process.env.MODERATION_CASE_STORE_PATH
  || path.join(__dirname, '..', 'data', 'moderation-cases.json');
const VERSION = 2;
const ACTIVE = 'active';
const EXPIRED = 'expired';
const PARDONED = 'pardoned';
const CASE_TYPES = new Set(['warning', 'automod_warning', 'note', 'appeal']);

function emptyState() {
  return { version: VERSION, guilds: {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedString(value, maximum = 1000) {
  return String(value || '').slice(0, maximum);
}

function normalizeDetails(record) {
  const source = record?.details && typeof record.details === 'object' ? record.details : record || {};
  const expiresAt = source.expiresAt == null ? null : Number(source.expiresAt);
  return {
    reason: boundedString(source.reason || 'No reason provided.'),
    staffNotes: boundedString(source.staffNotes),
    points: Math.max(1, Math.min(10, Math.round(Number(source.points) || 1))),
    evidence: boundedString(source.evidence),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

function normalizeReference(value, defaults = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...defaults,
    ...clone(source),
    channelId: boundedString(source.channelId || defaults.channelId || '', 30),
    messageId: boundedString(source.messageId || defaults.messageId || '', 30),
  };
}

function normalizeReferences(record) {
  const references = record?.references && typeof record.references === 'object' ? record.references : {};
  return {
    source: normalizeReference(references.source, {
      channelId: boundedString(record?.sourceChannelId, 30),
      messageId: boundedString(record?.sourceMessageId, 30),
    }),
    notification: normalizeReference(references.notification || record?.delivery, { status: 'pending', attemptedAt: null }),
    staffLog: normalizeReference(references.staffLog),
  };
}

function normalizeEvent(event, index, recordId) {
  const createdAt = Number(event?.createdAt) || Date.now();
  const data = event?.data && typeof event.data === 'object'
    ? clone(event.data)
    : event && typeof event === 'object'
      ? Object.fromEntries(Object.entries(event).filter(([key]) => !['id', 'type', 'actorId', 'createdAt'].includes(key)))
      : {};
  return {
    id: boundedString(event?.id || recordId + ':E-' + String(index + 1).padStart(4, '0'), 80),
    type: boundedString(event?.type || 'case.event', 80),
    actorId: boundedString(event?.actorId, 30),
    createdAt,
    data,
  };
}

function appendAuditEvent(record, type, actorId, data = {}, createdAt = Date.now()) {
  if (!Array.isArray(record.events)) record.events = [];
  const event = normalizeEvent({
    id: record.id + ':E-' + String(record.events.length + 1).padStart(4, '0'),
    type,
    actorId,
    createdAt,
    data,
  }, record.events.length, record.id);
  record.events.push(event);
  return event;
}

function legacyEvents(record) {
  const events = [];
  const createdAt = Number(record?.createdAt) || Date.now();
  events.push({
    type: 'case.created',
    actorId: boundedString(record?.moderatorId, 30),
    createdAt,
    data: { migrated: true, sourceVersion: 1 },
  });
  if (record?.delivery && typeof record.delivery === 'object' && record.delivery.status !== 'pending') {
    events.push({
      type: 'notification.attempted',
      actorId: '',
      createdAt: Number(record.delivery.attemptedAt) || Number(record?.updatedAt) || createdAt,
      data: clone(record.delivery),
    });
  }
  for (const enforcement of Array.isArray(record?.enforcementEvents) ? record.enforcementEvents : []) {
    events.push({
      type: enforcement?.success ? 'enforcement.completed' : 'enforcement.failed',
      actorId: '',
      createdAt: Number(enforcement?.createdAt) || Number(record?.updatedAt) || createdAt,
      data: clone(enforcement),
    });
  }
  if (record?.status === PARDONED || record?.pardonedAt) {
    events.push({
      type: 'case.pardoned',
      actorId: boundedString(record?.pardonedBy, 30),
      createdAt: Number(record?.pardonedAt) || Number(record?.updatedAt) || createdAt,
      data: { reason: boundedString(record?.pardonReason) },
    });
  }
  return events;
}

function normalizeCase(record) {
  const createdAt = Number(record?.createdAt) || Date.now();
  const type = CASE_TYPES.has(record?.type) ? record.type : 'warning';
  const targetUserId = boundedString(record?.targetUserId || record?.memberId, 30);
  const authorId = boundedString(record?.authorId || record?.moderatorId, 30);
  const rawEvents = Array.isArray(record?.events) ? record.events : legacyEvents(record);
  const normalized = {
    id: boundedString(record?.id, 80),
    guildId: boundedString(record?.guildId, 30),
    type,
    targetUserId,
    authorId,
    source: boundedString(record?.source || 'manual', 40),
    status: [ACTIVE, EXPIRED, PARDONED].includes(record?.status) ? record.status : ACTIVE,
    details: normalizeDetails(record),
    references: normalizeReferences(record),
    createdAt,
    updatedAt: Number(record?.updatedAt) || createdAt,
    events: rawEvents.map((event, index) => normalizeEvent(event, index, boundedString(record?.id, 80))),
  };
  if (!normalized.events.length) appendAuditEvent(normalized, 'case.created', authorId, {});
  return normalized;
}

function normalizeState(raw) {
  const state = emptyState();
  for (const [guildId, rawGuild] of Object.entries(raw?.guilds || {})) {
    const cases = Array.isArray(rawGuild?.cases)
      ? rawGuild.cases.map(normalizeCase).filter((record) => record.id && record.targetUserId)
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

function migrationBackupPath(version) {
  return STORE_PATH + '.v' + version + '.bak';
}

function writeMigrationBackup(serialized, version) {
  const backup = migrationBackupPath(version);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, serialized, 'utf8');
}

function readState() {
  let serialized;
  try {
    serialized = fs.readFileSync(STORE_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    throw error;
  }

  let raw;
  try {
    raw = JSON.parse(serialized || '{}');
  } catch (error) {
    console.error('Moderation case store contains invalid JSON and was not reset:', error);
    throw new Error('Moderation case store contains invalid JSON. Restore it from backup before continuing.');
  }

  const sourceVersion = Math.max(1, Number(raw?.version) || 1);
  const state = normalizeState(raw);
  if (sourceVersion < VERSION) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    writeMigrationBackup(serialized, sourceVersion);
    writeState(state);
  }
  return state;
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
    fs.copyFileSync(temporary, STORE_PATH);
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function guildState(state, guildId) {
  const id = String(guildId || '');
  if (!state.guilds[id]) state.guilds[id] = { nextCaseNumber: 1, cases: [], crossedThresholds: {} };
  return state.guilds[id];
}

function publicCase(record) {
  if (!record) return null;
  const result = clone(record);
  const pardon = [...result.events].reverse().find((event) => event.type === 'case.pardoned');
  const enforcementEvents = result.events
    .filter((event) => event.type.startsWith('enforcement.'))
    .map((event) => ({ ...clone(event.data), createdAt: event.createdAt }));
  return {
    ...result,
    memberId: result.targetUserId,
    moderatorId: result.authorId,
    reason: result.details.reason,
    staffNotes: result.details.staffNotes,
    points: result.details.points,
    evidence: result.details.evidence,
    expiresAt: result.details.expiresAt,
    sourceChannelId: result.references.source.channelId,
    sourceMessageId: result.references.source.messageId,
    delivery: clone(result.references.notification),
    enforcementEvents,
    pardonedAt: pardon?.createdAt || null,
    pardonedBy: pardon?.actorId || '',
    pardonReason: boundedString(pardon?.data?.reason),
  };
}

function expireCases(guild) {
  const now = Date.now();
  let changed = false;
  for (const record of guild.cases) {
    if (record.status === ACTIVE && record.details.expiresAt && record.details.expiresAt <= now) {
      record.status = EXPIRED;
      record.updatedAt = now;
      appendAuditEvent(record, 'case.expired', '', { expiresAt: record.details.expiresAt }, now);
      changed = true;
    }
  }
  return changed;
}

function activePointsFromGuild(guild, targetUserId) {
  return guild.cases
    .filter((record) => record.targetUserId === String(targetUserId) && record.status === ACTIVE && ['warning', 'automod_warning'].includes(record.type))
    .reduce((total, record) => total + record.details.points, 0);
}

function rearmThresholds(guild, targetUserId) {
  const id = String(targetUserId);
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
  const type = CASE_TYPES.has(input?.type) ? input.type : input?.source === 'automod' ? 'automod_warning' : 'warning';
  const prefix = ['warning', 'automod_warning'].includes(type) ? 'W' : 'C';
  const record = normalizeCase({
    id: prefix + '-' + String(number).padStart(6, '0'),
    guildId: input.guildId,
    type,
    targetUserId: input.targetUserId || input.memberId,
    authorId: input.authorId || input.moderatorId,
    source: input.source,
    status: ACTIVE,
    details: { ...input.details, reason: input.reason, staffNotes: input.staffNotes, points: input.points, evidence: input.evidence, expiresAt: input.expiresAt },
    references: {
      source: { channelId: input.sourceChannelId, messageId: input.sourceMessageId },
      notification: { status: 'pending', attemptedAt: null, channelId: '', messageId: '' },
      staffLog: { channelId: '', messageId: '' },
    },
    createdAt: now,
    updatedAt: now,
    events: [],
  });
  appendAuditEvent(record, 'case.created', record.authorId, { source: record.source, type: record.type }, now);
  guild.cases.push(record);
  rearmThresholds(guild, record.targetUserId);
  writeState(state);
  return publicCase(record);
}

function filteredCases(guild, filters = {}) {
  const targetUserId = String(filters.targetUserId || filters.memberId || '');
  const authorId = String(filters.authorId || filters.moderatorId || '');
  const type = String(filters.type || '');
  const status = String(filters.status || '');
  const source = String(filters.source || '');
  const query = String(filters.query || '').trim().toLowerCase();
  return guild.cases
    .filter((record) => !targetUserId || record.targetUserId === targetUserId)
    .filter((record) => !authorId || record.authorId === authorId)
    .filter((record) => !type || record.type === type)
    .filter((record) => !status || record.status === status)
    .filter((record) => !source || record.source === source)
    .filter((record) => !query || [
      record.id,
      record.type,
      record.targetUserId,
      record.authorId,
      record.source,
      record.details.reason,
      record.details.evidence,
      record.details.staffNotes,
    ].some((value) => String(value).toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function listCases(guildId, filters = {}) {
  const state = readState();
  const guild = guildState(state, guildId);
  const changed = expireCases(guild);
  if (changed) {
    for (const id of new Set(guild.cases.map((record) => record.targetUserId))) rearmThresholds(guild, id);
    writeState(state);
  }
  return filteredCases(guild, filters).map(publicCase);
}

function getCase(guildId, caseId) {
  return listCases(guildId).find((record) => record.id.toLowerCase() === String(caseId || '').toLowerCase()) || null;
}

function activePoints(guildId, targetUserId) {
  return listCases(guildId, { targetUserId })
    .filter((record) => record.status === ACTIVE && ['warning', 'automod_warning'].includes(record.type))
    .reduce((sum, record) => sum + record.details.points, 0);
}

function updateCase(guildId, caseId, patch, actorId = '') {
  const state = readState();
  const guild = guildState(state, guildId);
  expireCases(guild);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  if (record.status === PARDONED) throw new Error('Pardoned cases cannot be edited.');

  const changes = {};
  const setDetail = (key, value) => {
    if (record.details[key] === value) return;
    changes[key] = { from: record.details[key], to: value };
    record.details[key] = value;
  };
  if (patch.reason !== undefined) setDetail('reason', boundedString(String(patch.reason || '').trim() || record.details.reason));
  if (patch.points !== undefined) setDetail('points', Math.max(1, Math.min(10, Math.round(Number(patch.points) || record.details.points))));
  if (patch.evidence !== undefined) setDetail('evidence', boundedString(String(patch.evidence || '').trim()));
  if (patch.staffNotes !== undefined) setDetail('staffNotes', boundedString(String(patch.staffNotes || '').trim()));
  if (patch.expiresAt !== undefined) {
    const expiry = patch.expiresAt == null ? null : Number(patch.expiresAt);
    setDetail('expiresAt', Number.isFinite(expiry) ? expiry : null);
    record.status = record.details.expiresAt && record.details.expiresAt <= Date.now() ? EXPIRED : ACTIVE;
  }
  if (!Object.keys(changes).length) return publicCase(record);

  record.updatedAt = Date.now();
  appendAuditEvent(record, 'case.edited', actorId, { changes }, record.updatedAt);
  rearmThresholds(guild, record.targetUserId);
  writeState(state);
  return publicCase(record);
}

function pardonCase(guildId, caseId, actorId, reason) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  if (record.status === PARDONED) return publicCase(record);
  record.status = PARDONED;
  record.updatedAt = Date.now();
  appendAuditEvent(record, 'case.pardoned', actorId, { reason: boundedString(String(reason || '').trim()) }, record.updatedAt);
  rearmThresholds(guild, record.targetUserId);
  writeState(state);
  return publicCase(record);
}

function updateRecord(guildId, caseId, callback) {
  const state = readState();
  const guild = guildState(state, guildId);
  const record = guild.cases.find((item) => item.id.toLowerCase() === String(caseId || '').toLowerCase());
  if (!record) return null;
  callback(record);
  record.updatedAt = Date.now();
  writeState(state);
  return publicCase(record);
}

function appendEvent(guildId, caseId, type, actorId, data = {}) {
  return updateRecord(guildId, caseId, (record) => {
    appendAuditEvent(record, type, actorId, data);
  });
}

function updateDelivery(guildId, caseId, delivery) {
  return updateRecord(guildId, caseId, (record) => {
    const attemptedAt = Number(delivery?.attemptedAt) || Date.now();
    record.references.notification = normalizeReference(
      { ...record.references.notification, ...clone(delivery), attemptedAt },
      { status: 'pending', attemptedAt: null },
    );
    appendAuditEvent(record, 'notification.attempted', '', clone(record.references.notification), attemptedAt);
  });
}

function updateStaffLog(guildId, caseId, reference) {
  return updateRecord(guildId, caseId, (record) => {
    record.references.staffLog = normalizeReference(reference);
    appendAuditEvent(record, 'staff_log.sent', '', clone(record.references.staffLog));
  });
}

function appendEnforcement(guildId, caseId, event) {
  return updateRecord(guildId, caseId, (record) => {
    const createdAt = Number(event?.createdAt) || Date.now();
    appendAuditEvent(record, event?.success ? 'enforcement.completed' : 'enforcement.failed', '', clone(event), createdAt);
  });
}

function claimCrossedThresholds(guildId, targetUserId, thresholds) {
  const state = readState();
  const guild = guildState(state, guildId);
  expireCases(guild);
  const id = String(targetUserId);
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
  VERSION,
  activePoints,
  appendEnforcement,
  appendEvent,
  claimCrossedThresholds,
  createCase,
  getCase,
  listCases,
  pardonCase,
  updateCase,
  updateDelivery,
  updateStaffLog,
  __test: { emptyState, migrationBackupPath, normalizeCase, normalizeState, publicCase, readState, writeState },
};
