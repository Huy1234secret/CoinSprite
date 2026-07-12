const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const aiTokenUsageStats = require('./aiTokenUsageStats');
const dailyMessageStats = require('./dailyMessageStats');
const levelingStore = require('./levelingStore');
const ticketSystemStore = require('./ticketSystemStore');
const messageTemplates = require('./messageTemplates');
const bugReportStore = require('./bugReportStore');
const {
  getConfiguredGuildIds,
  getDisabledGuilds,
  getGuildConfigRaw,
  loadState,
  setGuildEnabled,
  setGuildFeatures,
} = require('./serverConfig');
const { getOwnerConsoleEntries, logCommandSystem } = require('./commandLogger');
const { slashCommandPayloadsForGuild } = require('./featureGate');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function ownerIdSet() {
  const raw = [
    process.env.OWNER_USER_IDS,
    process.env.BOT_OWNER_IDS,
    process.env.ADMIN_OWNER_IDS,
    process.env.OWNER_ID,
    process.env.BOT_OWNER_ID,
  ].filter(Boolean).join(',');
  return new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter((id) => /^\d{16,20}$/.test(id)));
}

function isOwnerSession(session, client) {
  const userId = String(session?.user?.id || '');
  if (!/^\d{16,20}$/.test(userId)) return false;
  const ids = ownerIdSet();
  if (ids.has(userId)) return true;
  const appOwner = client?.application?.owner;
  if (appOwner?.id && appOwner.id === userId) return true;
  if (appOwner?.members?.has?.(userId)) return true;
  return false;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function dataFileBytesForGuild(guildId) {
  const configState = loadState();
  const configBytes = Buffer.byteLength(JSON.stringify(configState.guilds?.[guildId] || {}));
  const disabledBytes = Buffer.byteLength(JSON.stringify(configState.meta?.disabledGuilds?.[guildId] || {}));
  const levelingState = levelingStore.loadState();
  const levelingGuild = levelingState.guilds?.[guildId] || {};
  const levelingBytes = Buffer.byteLength(JSON.stringify(levelingGuild));
  const ticketState = ticketSystemStore.loadState();
  const ticketSlice = {
    panelMessageId: ticketState.panelMessageIdByGuild?.[guildId] || null,
    panelChannelId: ticketState.panelChannelIdByGuild?.[guildId] || null,
    nextTicketId: ticketState.nextTicketIdByGuild?.[guildId] || null,
    blacklistedUsers: ticketState.blacklistedUsersByGuild?.[guildId] || [],
    roleRequests: Object.fromEntries(Object.entries(ticketState.roleRequests || {}).filter(([, item]) => item?.guildId === guildId)),
    giveawayRequests: Object.fromEntries(Object.entries(ticketState.giveawayRequests || {}).filter(([, item]) => item?.guildId === guildId)),
    tickets: Object.fromEntries(Object.entries(ticketState.tickets || {}).filter(([, item]) => item?.guildId === guildId)),
  };
  const ticketBytes = Buffer.byteLength(JSON.stringify(ticketSlice));
  const templates = messageTemplates.listTemplates(guildId);
  const templateBytes = Buffer.byteLength(JSON.stringify(templates));
  return {
    configBytes,
    disabledBytes,
    levelingBytes,
    ticketBytes,
    templateBytes,
    totalBytes: configBytes + disabledBytes + levelingBytes + ticketBytes + templateBytes,
  };
}

function dataUsageForGuild(guildId, todayMessages = null, aiUsage = null) {
  const levelingState = levelingStore.loadState();
  const levelingGuild = levelingState.guilds?.[guildId] || {};
  const ticketState = ticketSystemStore.loadState();
  const templates = messageTemplates.listTemplates(guildId);
  return {
    levelingUsers: Object.keys(levelingGuild.users || {}).length,
    messagesTracked: Object.values(levelingGuild.users || {}).reduce((sum, user) => sum + (Number(user?.messages) || 0), 0),
    todayMessages: Number(todayMessages?.guilds?.[guildId]?.total || 0),
    aiTokens: aiUsage?.guilds?.[guildId] || { current: {}, history: [], recent: [] },
    reactionsTracked: Object.values(levelingGuild.users || {}).reduce((sum, user) => sum + (Number(user?.reactions) || 0), 0),
    messageTemplates: templates.length,
    ticketBlacklistedUsers: Array.isArray(ticketState.blacklistedUsersByGuild?.[guildId]) ? ticketState.blacklistedUsersByGuild[guildId].length : 0,
    openTicketRecords: Object.values(ticketState.tickets || {}).filter((item) => item?.guildId === guildId && !item?.closed).length,
    roleRequests: Object.values(ticketState.roleRequests || {}).filter((item) => item?.guildId === guildId).length,
    giveawayRequests: Object.values(ticketState.giveawayRequests || {}).filter((item) => item?.guildId === guildId).length,
  };
}

function globalStorage() {
  const files = [];
  for (const dir of [DATA_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) files.push({ name: path.relative(path.join(__dirname, '..'), filePath), bytes: stat.size });
    }
  }
  return {
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    label: formatBytes(files.reduce((sum, file) => sum + file.bytes, 0)),
    files,
  };
}

function partialGuildSummary(client, guildId, fallbackGuild, disabledRecords, todayMessages, aiUsage) {
  const config = getGuildConfigRaw(guildId);
  const storage = dataFileBytesForGuild(guildId);
  const usage = dataUsageForGuild(guildId, todayMessages, aiUsage);
  return {
    id: guildId,
    name: fallbackGuild?.name || `Guild ${guildId}`,
    iconURL: fallbackGuild?.iconURL?.({ extension: 'png', size: 64 }) || null,
    ownerId: null,
    totalUsers: Number(fallbackGuild?.approximateMemberCount || fallbackGuild?.approximate_member_count || fallbackGuild?.memberCount) || 0,
    channels: 0,
    roles: 0,
    configured: Boolean(config),
    enabled: config?.enabled !== false,
    features: config?.features || { gag2Stock: true, fullBot: false },
    disabled: disabledRecords[guildId] || null,
    partial: true,
    limitedInfo: true,
    usage,
    storage: {
      ...storage,
      label: formatBytes(storage.totalBytes),
    },
  };
}

async function guildSummary(client, guildId, disabledRecords, todayMessages, aiUsage, fallbackGuild = null) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return fallbackGuild ? partialGuildSummary(client, guildId, fallbackGuild, disabledRecords, todayMessages, aiUsage) : null;
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const owner = guild.ownerId ? null : await guild.fetchOwner().catch(() => null);
  const config = getGuildConfigRaw(guild.id);
  const storage = dataFileBytesForGuild(guild.id);
  const usage = dataUsageForGuild(guild.id, todayMessages, aiUsage);
  return {
    id: guild.id,
    name: guild.name,
    iconURL: guild.iconURL?.({ extension: 'png', size: 64 }) || null,
    ownerId: guild.ownerId || owner?.id || null,
    totalUsers: Number(guild.memberCount) || 0,
    channels: channels?.size || 0,
    roles: roles?.size || 0,
    configured: Boolean(config),
    enabled: config?.enabled !== false,
    features: config?.features || { gag2Stock: true, fullBot: false },
    disabled: disabledRecords[guild.id] || null,
    partial: false,
    limitedInfo: false,
    usage,
    storage: {
      ...storage,
      label: formatBytes(storage.totalBytes),
    },
  };
}

function addGuildId(ids, value) {
  const id = typeof value === 'string' ? value : value?.id;
  if (/^\d{16,20}$/.test(String(id || ''))) ids.add(String(id));
}

function addGuildIdsFromCollection(ids, value) {
  if (!value) return;
  if (typeof value.keys === 'function') {
    for (const key of value.keys()) addGuildId(ids, key);
  }
  if (typeof value.values === 'function') {
    for (const guild of value.values()) addGuildId(ids, guild);
    return;
  }
  if (Array.isArray(value)) {
    for (const guild of value) addGuildId(ids, guild);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, guild] of Object.entries(value)) {
      addGuildId(ids, key);
      addGuildId(ids, guild);
    }
  }
}

function addGuildRecord(records, keyOrGuild, maybeGuild = null) {
  const guild = maybeGuild?.id ? maybeGuild : (typeof keyOrGuild === 'object' ? keyOrGuild : null);
  const keyId = typeof keyOrGuild === 'string' ? keyOrGuild : keyOrGuild?.id;
  const valueId = guild?.id;
  const id = /^\d{16,20}$/.test(String(keyId || '')) ? keyId : valueId;
  if (!/^\d{16,20}$/.test(String(id || ''))) return;
  const existing = records.get(String(id));
  if (existing?.channels && existing?.roles) return;
  records.set(String(id), guild || existing || { id: String(id) });
}

function addGuildRecordsFromCollection(records, value) {
  if (!value) return;
  if (typeof value.entries === 'function') {
    for (const [key, guild] of value.entries()) addGuildRecord(records, key, guild);
    return;
  }
  if (Array.isArray(value)) {
    for (const guild of value) addGuildRecord(records, guild);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, guild] of Object.entries(value)) addGuildRecord(records, key, guild);
  }
}

async function collectOwnerGuildRecords(client, configuredIds = []) {
  const records = new Map();
  for (const id of configuredIds) addGuildRecord(records, id);
  addGuildRecordsFromCollection(records, client?.guilds?.cache);
  const fetchedGuilds = await client?.guilds?.fetch?.().catch(() => null);
  addGuildRecordsFromCollection(records, fetchedGuilds);
  addGuildRecordsFromCollection(records, client?.guilds?.cache);
  return records;
}

async function collectOwnerGuildIds(client, configuredIds = []) {
  return new Set((await collectOwnerGuildRecords(client, configuredIds)).keys());
}

async function ownerOverview(client) {
  const todayMessages = dailyMessageStats.todayOverview();
  const aiUsage = aiTokenUsageStats.monthlyOverview();
  const disabledRecords = getDisabledGuilds();
  const bugReports = bugReportStore.listBugReports({ limit: 200 });
  const configuredIds = new Set(getConfiguredGuildIds({ includeDisabled: true }));
  const guildRecords = await collectOwnerGuildRecords(client, configuredIds);
  const guilds = (await Promise.all([...guildRecords].map(([id, fallbackGuild]) => guildSummary(client, id, disabledRecords, todayMessages, aiUsage, fallbackGuild)))).filter(Boolean);
  const delayMeanMs = Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0;
  const fps = delayMeanMs > 0 ? Math.max(1, Math.round(1000 / Math.max(1, delayMeanMs))) : null;
  return {
    bot: {
      tag: client.user?.tag || 'Unknown',
      id: client.user?.id || '',
      pingMs: Math.max(0, Math.round(client.ws?.ping || 0)),
      latencyMs: Math.max(0, Math.round(client.ws?.ping || 0)),
      fps,
      uptimeMs: Math.round(process.uptime() * 1000),
      guildCount: guilds.length,
      totalUsers: guilds.reduce((sum, guild) => sum + guild.totalUsers, 0),
      memory: {
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
        rssLabel: formatBytes(process.memoryUsage().rss),
        heapUsedLabel: formatBytes(process.memoryUsage().heapUsed),
      },
    },
    messages: {
      today: todayMessages.total,
      date: todayMessages.date,
      timezone: todayMessages.timezone,
      resetAt: todayMessages.resetAt,
    },
    aiTokens: {
      month: aiUsage.month,
      timezone: aiUsage.timezone,
      resetAt: aiUsage.resetAt,
      total: aiUsage.total,
    },
    storage: globalStorage(),
    bugReports: {
      total: bugReports.length,
      open: bugReports.filter((report) => report.status === 'open').length,
    },
    disabledGuilds: disabledRecords,
    guilds: guilds.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function notifyGuildOwner(guild, reason, adminUserId) {
  const owner = await guild.fetchOwner().catch(() => null);
  const content = [
    `CoinSprite has been disabled in **${guild.name}**.`,
    reason ? `Reason: ${reason}` : 'No reason was provided.',
    `Actioned by owner panel user ${adminUserId}.`,
  ].join('\n');
  if (owner) {
    const sent = await owner.send({ content }).then(() => true).catch(() => false);
    if (sent) return 'dm';
  }
  const fallback = guild.systemChannel || await guild.channels.fetch().then((channels) => channels.find((channel) => channel?.isTextBased?.() && channel.permissionsFor(guild.members.me)?.has('SendMessages'))).catch(() => null);
  if (fallback?.isTextBased?.()) {
    const sent = await fallback.send({ content }).then(() => true).catch(() => false);
    if (sent) return 'channel';
  }
  return 'failed';
}

async function setGuildDisabled(client, guildId, reason, adminUserId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    const error = new Error('Guild is not available to the bot.');
    error.statusCode = 404;
    throw error;
  }
  const result = setGuildEnabled(guild.id, false, {
    reason,
    disabledBy: adminUserId,
    disabledAt: Date.now(),
    guildName: guild.name,
  });
  await guild.commands.set([]).catch((error) => logCommandSystem(`Failed to clear commands for disabled guild ${guild.id}: ${error?.message ?? 'unknown error'}`));
  const notification = await notifyGuildOwner(guild, reason, adminUserId);
  logCommandSystem(`Owner ${adminUserId} disabled guild ${guild.id}. Notification: ${notification}.`);
  return { guildId: guild.id, disabled: result.disabled, notification };
}

async function setGuildEnabledRoute(client, guildId, adminUserId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    const error = new Error('Guild is not available to the bot.');
    error.statusCode = 404;
    throw error;
  }
  const result = setGuildEnabled(guild.id, true, {});
  const slashCommands = slashCommandPayloadsForGuild(guild.id, client.commands);
  await guild.commands.set(slashCommands).catch((error) => logCommandSystem(`Failed to restore commands for enabled guild ${guild.id}: ${error?.message ?? 'unknown error'}`));
  logCommandSystem(`Owner ${adminUserId} enabled guild ${guild.id}.`);
  return { guildId: guild.id, config: result.config };
}

async function setGuildFeaturesRoute(client, guildId, body, adminUserId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    const error = new Error('Guild is not available to the bot.');
    error.statusCode = 404;
    throw error;
  }
  const config = setGuildFeatures(guild.id, {
    gag2Stock: true,
    fullBot: Boolean(body?.fullBot),
  });
  const slashCommands = slashCommandPayloadsForGuild(guild.id, client.commands);
  await guild.commands.set(slashCommands).catch((error) => logCommandSystem(`Failed to refresh commands for feature update in guild ${guild.id}: ${error?.message ?? 'unknown error'}`));
  logCommandSystem(`Owner ${adminUserId} updated feature access for guild ${guild.id}: fullBot=${Boolean(config?.features?.fullBot)}.`);
  return { guildId: guild.id, features: config.features, registeredCommands: slashCommands.length };
}

async function handleOwnerOverview(req, res, client, deps) {
  deps.sendJson(res, 200, await ownerOverview(client));
}

async function handleOwnerDisable(req, res, client, guildId, session, deps) {
  const body = await deps.readJsonBody(req);
  const reason = String(body?.reason || '').trim().slice(0, 500);
  if (!reason) return deps.sendJson(res, 400, { error: 'Reason is required.' });
  deps.sendJson(res, 200, await setGuildDisabled(client, guildId, reason, session.user.id));
}

async function handleOwnerEnable(req, res, client, guildId, session, deps) {
  deps.sendJson(res, 200, await setGuildEnabledRoute(client, guildId, session.user.id));
}

async function handleOwnerFeatures(req, res, client, guildId, session, deps) {
  const body = await deps.readJsonBody(req);
  deps.sendJson(res, 200, await setGuildFeaturesRoute(client, guildId, body, session.user.id));
}

async function handleBugReportCreate(req, res, client, session, deps) {
  try {
    const report = bugReportStore.createBugReport(await deps.readJsonBody(req), session);
    logCommandSystem(`Bug report ${report.id} submitted by ${session.user.id}: ${report.title}`);
    deps.sendJson(res, 201, { report });
  } catch (error) {
    deps.sendJson(res, error?.statusCode || 400, { error: error?.message || 'Could not submit bug report.' });
  }
}

async function handleOwnerReports(req, res, client, session, deps) {
  deps.sendJson(res, 200, { reports: bugReportStore.listBugReports({ limit: 200 }) });
}

async function handleOwnerConsole(req, res, url, client, session, deps) {
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 250));
  deps.sendJson(res, 200, getOwnerConsoleEntries({ after, limit }));
}

async function handleOwnerReportStatus(req, res, client, reportId, session, deps) {
  try {
    const body = await deps.readJsonBody(req);
    const report = bugReportStore.updateBugReportStatus(reportId, body?.status);
    logCommandSystem(`Owner ${session.user.id} marked bug report ${report.id} as ${report.status}.`);
    deps.sendJson(res, 200, { report });
  } catch (error) {
    deps.sendJson(res, error?.statusCode || 400, { error: error?.message || 'Could not update bug report.' });
  }
}

module.exports = {
  handleBugReportCreate,
  handleOwnerConsole,
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerFeatures,
  handleOwnerOverview,
  handleOwnerReportStatus,
  handleOwnerReports,
  collectOwnerGuildRecords,
  collectOwnerGuildIds,
  isOwnerSession,
};


// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["015-moderator-case-ui-refresh.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
  moderatorCss: path.join(ROOT, 'admin', 'moderator.css'),
};

const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const CASE_DETAIL_SOURCE = String.raw`
function formatCaseDetailDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function caseFallbackText(value, fallback = 'Not recorded') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatCaseType(value) {
  return caseFallbackText(value, 'case').replace(/_/g, ' ');
}

function caseMetricCard(label, value, helper) {
  return '<div class="case-metric-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(helper) + '</small></div>';
}

function caseReferenceCard(label, primary, reference = {}) {
  const channel = caseFallbackText(reference.channelId);
  const message = caseFallbackText(reference.messageId);
  return '<div class="case-reference-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(primary) + '</strong><small>Channel ' + escapeHtml(channel) + '</small><small>Message ' + escapeHtml(message) + '</small></div>';
}

function casePersonRow(label, profile) {
  return '<div class="case-person-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(profile.name) + '</strong><small>@' + escapeHtml(profile.username) + ' · ' + escapeHtml(profile.id || 'not recorded') + '</small></div>';
}

function formatCaseEventType(value) {
  return caseFallbackText(value, 'event').replace(/\./g, ' · ').replace(/_/g, ' ');
}

function renderCaseDetail(record) {
  const target = caseProfile(record.profiles?.target, record.targetUserId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const sourceRef = record.references?.source || {};
  const editable = record.status !== 'pardoned';
  const points = Number(record.points) || 0;
  const createdAt = formatCaseDetailDate(record.createdAt);
  const updatedAt = formatCaseDetailDate(record.updatedAt);
  const expiresAt = record.expiresAt ? formatCaseDetailDate(record.expiresAt) : 'Never / not set';
  const avatar = target.avatarUrl
    ? '<img src="' + escapeHtml(target.avatarUrl) + '" alt="">'
    : '<span class="case-avatar-fallback" aria-hidden="true">' + escapeHtml((target.name || '?').slice(0, 1).toUpperCase()) + '</span>';
  const actions = editable
    ? '<div class="case-actions case-actions-sticky"><button class="button primary" type="button" data-moderator-action="save-case">Save case</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon</button></div>'
    : '<p class="case-pardon-note">Pardoned: ' + escapeHtml(record.pardonReason || 'No reason recorded.') + '</p>';
  const events = [...(record.events || [])].reverse().map((event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const summary = data.reason || data.action || data.status || data.error || '';
    return '<li><time>' + escapeHtml(formatCaseDetailDate(event.createdAt)) + '</time><div><strong>'
      + escapeHtml(formatCaseEventType(event.type)) + '</strong><span>'
      + escapeHtml(event.actorId ? 'Actor ' + event.actorId : 'System')
      + (summary ? ' · ' + escapeHtml(summary) : '') + '</span></div></li>';
  }).join('') || '<li class="case-audit-empty"><span>No audit events recorded.</span></li>';

  return '<div class="case-detail case-detail-refresh">'
    + '<div class="case-detail-topbar"><button class="button small case-back" type="button" data-moderator-action="back-to-cases">← Back to cases</button><span>Last updated ' + escapeHtml(updatedAt) + '</span></div>'
    + '<div class="panel case-detail-hero case-detail-hero-refresh"><div class="case-profile case-profile-refresh">' + avatar + '<div><span class="field-label">Target member</span><h2>' + escapeHtml(target.name) + '</h2><p>@' + escapeHtml(target.username) + ' · ' + escapeHtml(target.id) + '</p></div></div>'
    + '<div class="case-detail-heading case-heading-refresh"><span class="case-status ' + escapeHtml(record.status) + '">' + escapeHtml(record.status) + '</span><h2>' + escapeHtml(record.id) + '</h2><p>' + escapeHtml(formatCaseType(record.type)) + ' · ' + escapeHtml(record.source || 'manual') + '</p></div></div>'
    + '<div class="case-metric-grid">'
    + caseMetricCard('Points', String(points), 'Current active severity value')
    + caseMetricCard('Expiry', expiresAt, record.expiresAt ? 'Automatically expires when due' : 'No expiry is currently set')
    + caseMetricCard('Created', createdAt, 'Original case creation time')
    + caseMetricCard('Audit events', String((record.events || []).length), 'Append-only history entries')
    + '</div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-detail-grid case-detail-grid-refresh" data-case-id="' + escapeHtml(record.id) + '">'
    + '<section class="panel case-edit-panel"><div class="panel-heading"><h3>Review & edit</h3><p>Keep the outcome, reason, evidence, and private context clear for future staff.</p></div>'
    + '<label class="case-field-block"><span>Reason</span><textarea data-case-field="reason" maxlength="1000" rows="5" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label>'
    + '<div class="case-edit-grid"><label><span>Points</span><input data-case-field="points" type="number" min="1" max="10" value="' + points + '" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label><span>New expiry</span><input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, 30d, or never" ' + (editable ? '' : 'disabled') + '></label></div>'
    + '<label class="case-field-block"><span>Evidence</span><input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" placeholder="Message link, transcript, or attachment URL" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label class="case-field-block"><span>Private staff notes</span><textarea data-case-field="staffNotes" maxlength="1000" rows="4" placeholder="Internal context visible to staff only" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</section>'
    + '<aside class="case-side-stack"><section class="panel case-people-panel"><div class="panel-heading"><h3>People</h3><p>Who the case is for and who created it.</p></div><div class="case-person-list">' + casePersonRow('Target', target) + casePersonRow('Author', author) + '</div></section>'
    + '<section class="panel case-reference-panel"><div class="panel-heading"><h3>References</h3><p>Delivery, log, and source messages retained with the case.</p></div><div class="case-reference-grid">'
    + caseReferenceCard('Notice', notification.status || 'pending', notification)
    + caseReferenceCard('Staff log', 'Staff record', staffLog)
    + caseReferenceCard('Source', record.source || 'Source message', sourceRef)
    + '</div></section></aside></div>'
    + '<div class="panel case-audit-panel case-audit-panel-refresh"><div class="panel-heading"><h3>Audit trail</h3><p>Append-only lifecycle and action history.</p></div><ol class="case-audit-list case-audit-list-refresh">' + events + '</ol></div></div>';
}
`;

const CASE_CSS = String.raw`

/* coinSpriteModeratorCaseRefresh */
.case-detail-refresh {
  gap: 18px;
}

.case-detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
}

.case-detail-hero-refresh {
  position: relative;
  overflow: hidden;
  align-items: stretch;
  padding: 0;
  border-color: rgba(155, 89, 255, 0.32);
  background: linear-gradient(135deg, rgba(155, 89, 255, 0.14), rgba(88, 101, 242, 0.06) 48%, rgba(255, 255, 255, 0.025));
}

.case-detail-hero-refresh::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, #b56cff, var(--primary));
}

.case-profile-refresh {
  padding: 22px 24px 22px 28px;
}

.case-profile-refresh img,
.case-profile-refresh .case-avatar-fallback {
  width: 64px;
  height: 64px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
}

.case-profile-refresh h2 {
  margin: 2px 0 4px;
}

.case-profile-refresh p,
.case-heading-refresh p {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.case-heading-refresh {
  display: grid;
  align-content: center;
  justify-items: end;
  min-width: 260px;
  padding: 22px 24px;
  background: rgba(0, 0, 0, 0.12);
}

.case-heading-refresh h2 {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -0.02em;
}

.case-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.case-metric-card,
.case-reference-card,
.case-person-row {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.028);
}

.case-metric-card {
  display: grid;
  gap: 4px;
  min-height: 96px;
  padding: 14px;
}

.case-metric-card span,
.case-reference-card span,
.case-person-row span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.case-metric-card strong {
  color: var(--text);
  font-size: 17px;
  overflow-wrap: anywhere;
}

.case-metric-card small,
.case-reference-card small,
.case-person-row small {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.case-detail-grid-refresh {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.75fr);
  align-items: start;
}

.case-edit-panel,
.case-side-stack {
  min-width: 0;
}

.case-edit-panel {
  display: grid;
  gap: 14px;
}

.case-edit-panel label,
.case-field-block {
  display: grid;
  gap: 8px;
}

.case-edit-panel label > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.case-edit-panel textarea {
  min-height: 132px;
  resize: vertical;
}

.case-edit-panel input,
.case-edit-panel textarea {
  border-radius: 10px;
  border-color: rgba(155, 89, 255, 0.22);
  background: rgba(3, 6, 12, 0.48);
}

.case-edit-grid {
  display: grid;
  grid-template-columns: minmax(110px, 0.32fr) minmax(220px, 0.68fr);
  gap: 12px;
}

.case-side-stack,
.case-person-list,
.case-reference-grid {
  display: grid;
  gap: 12px;
}

.case-person-row,
.case-reference-card {
  display: grid;
  gap: 5px;
  padding: 12px;
}

.case-reference-card strong,
.case-person-row strong {
  overflow-wrap: anywhere;
}

.case-actions-sticky {
  position: sticky;
  bottom: 12px;
  justify-content: flex-end;
  padding-top: 4px;
  background: linear-gradient(180deg, transparent, var(--surface) 22%);
}

.case-audit-panel-refresh {
  overflow: hidden;
}

.case-audit-list-refresh li {
  grid-template-columns: minmax(170px, 0.4fr) minmax(0, 1fr);
  padding: 12px 0;
}

.case-audit-list-refresh time {
  color: var(--muted);
  font-size: 12px;
}

.case-audit-list-refresh div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.case-audit-list-refresh strong {
  text-transform: capitalize;
}

.case-audit-empty {
  display: block !important;
  color: var(--muted);
}

@media (max-width: 1120px) {
  .case-metric-grid,
  .case-detail-grid-refresh {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .case-side-stack {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .case-detail-topbar,
  .case-detail-hero-refresh {
    align-items: flex-start;
    flex-direction: column;
  }

  .case-heading-refresh {
    justify-items: start;
    width: 100%;
    min-width: 0;
    text-align: left;
  }

  .case-metric-grid,
  .case-detail-grid-refresh,
  .case-edit-grid,
  .case-audit-list-refresh li {
    grid-template-columns: 1fr;
  }

  .case-profile-refresh {
    padding-right: 18px;
  }

  .case-actions-sticky {
    position: static;
    justify-content: stretch;
    flex-direction: column;
  }
}
`;

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes('coinSpriteModeratorCaseRefresh')) return text;
  const pattern = /function renderCaseDetail\(record\) \{[\s\S]*?\n\}\n\nfunction renderCasesPanel\(\) \{/;
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `${CASE_DETAIL_SOURCE}\nfunction renderCasesPanel() {`);
}

function patchModeratorCss(source) {
  const text = String(source || '');
  if (text.includes('coinSpriteModeratorCaseRefresh')) return text;
  return `${text.replace(/\s*$/u, '')}${CASE_CSS}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  if (samePath(filePath, TARGETS.moderatorCss)) return patchModeratorCss(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithModeratorCaseRefresh(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithModeratorCaseRefresh(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["016-moderator-case-polish.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
  moderatorCss: path.join(ROOT, 'admin', 'moderator.css'),
};
const MARKER = 'coinSpriteModeratorCaseLayoutV2';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const CASE_LAYOUT = String.raw`
/* coinSpriteModeratorCaseLayoutV2 */
function caseLayoutRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(1, Math.round(Math.abs(Date.now() - date.getTime()) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const [unit, size] = units.find((item) => seconds >= item[1]) || units[units.length - 1];
  const count = Math.max(1, Math.floor(seconds / size));
  return count + ' ' + unit + (count === 1 ? '' : 's') + (date.getTime() > Date.now() ? ' from now' : ' ago');
}

function caseLayoutRow(label, valueHtml, helper = '') {
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}

function caseLayoutPerson(profile) {
  const avatar = profile.avatarUrl ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="">' : '<span>' + escapeHtml((profile.name || '?').slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<strong>' + escapeHtml(profile.name) + '</strong><small>@' + escapeHtml(profile.username) + '</small><small>' + escapeHtml(profile.id || 'not recorded') + '</small></span>';
}

function caseLayoutState(status) {
  const value = caseFallbackText(status, 'active').toLowerCase();
  const label = value === 'active' || value === 'open' ? 'Open' : 'Closed';
  return '<span class="case-state-line"><span class="case-state-dot ' + escapeHtml(value) + '"></span><span>' + escapeHtml(label) + '</span></span>';
}

function caseLayoutRef(label, reference = {}) {
  return '<span class="case-linkish">' + escapeHtml(label) + ' · channel ' + escapeHtml(reference.channelId || 'not recorded') + ' · message ' + escapeHtml(reference.messageId || 'not recorded') + '</span>';
}

function renderCaseDetail(record) {
  const target = caseProfile(record.profiles?.target, record.targetUserId || record.memberId || record.userId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const sourceRef = record.references?.source || {};
  const editable = record.status !== 'pardoned';
  const closed = !['active', 'open'].includes(String(record.status || 'active').toLowerCase());
  const points = Math.max(0, Number(record.points) || 0);
  const events = [...(record.events || [])].reverse();
  const closeEvent = events.find((event) => /pardon|expire|close/i.test(String(event.type || ''))) || null;
  const closeData = closeEvent?.data && typeof closeEvent.data === 'object' ? closeEvent.data : {};
  const closedBy = caseProfile(record.profiles?.closedBy, closeEvent?.actorId || record.closedById || '');
  const history = events.map((event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const summary = data.reason || data.action || data.status || data.error || '';
    return '<li><time>' + escapeHtml(formatCaseDetailDate(event.createdAt)) + '<small>' + escapeHtml(caseLayoutRelative(event.createdAt)) + '</small></time><div><strong>' + escapeHtml(formatCaseEventType(event.type)) + '</strong><span>' + escapeHtml(event.actorId ? 'Actor ' + event.actorId : 'System') + (summary ? ' · ' + escapeHtml(summary) : '') + '</span></div></li>';
  }).join('') || '<li class="case-history-empty">No edits recorded.</li>';

  return '<div class="case-detail case-detail-refresh case-layout-v2">'
    + '<div class="panel case-actions-bar"><h3>Actions</h3><div><button class="button small" type="button" data-moderator-action="back-to-cases">Back</button><button class="button small" type="button" disabled>View message history</button>' + (editable ? '<button class="button small danger" type="button" data-moderator-action="pardon-case">Pardon</button><a class="button small primary" href="#caseEditPanel">Edit</a>' : '<button class="button small" type="button" disabled>Closed</button>') + '</div></div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-layout-stack" data-case-id="' + escapeHtml(record.id) + '">'
    + '<section class="panel case-info-panel"><div class="case-panel-title"><span>ⓘ</span><div><h3>General information</h3><p>Core case facts, delivery references, and closure context.</p></div></div><dl>'
    + caseLayoutRow('ID', '<code>' + escapeHtml(record.id) + '</code>')
    + caseLayoutRow('State', caseLayoutState(record.status))
    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type)) + '</strong>')
    + caseLayoutRow('User', caseLayoutPerson(target))
    + caseLayoutRow('Reason', '<strong>' + escapeHtml(caseFallbackText(record.reason)) + '</strong>')
    + caseLayoutRow('Points', '<strong>' + escapeHtml(String(points)) + '</strong>')
    + caseLayoutRow('Duration', '<strong>' + escapeHtml(record.expiresAt ? formatCaseDetailDate(record.expiresAt) : 'Permanent / not set') + '</strong>')
    + caseLayoutRow('Created', '<strong>' + escapeHtml(formatCaseDetailDate(record.createdAt)) + '</strong>', caseLayoutRelative(record.createdAt))
    + caseLayoutRow('Author', caseLayoutPerson(author))
    + caseLayoutRow('Log message', caseLayoutRef('staff log', staffLog))
    + caseLayoutRow('User notification message', caseLayoutRef(notification.status || 'notice', notification))
    + caseLayoutRow('Source message', caseLayoutRef(record.source || 'source', sourceRef))
    + caseLayoutRow('Evidence', record.evidence ? '<span class="case-linkish">' + escapeHtml(record.evidence) + '</span>' : '<span class="case-muted-text">Not recorded</span>')
    + (closed ? caseLayoutRow('Closed', '<strong>' + escapeHtml(formatCaseDetailDate(closeEvent?.createdAt || record.updatedAt)) + '</strong>', caseLayoutRelative(closeEvent?.createdAt || record.updatedAt)) : '')
    + (closed ? caseLayoutRow('Closed by', caseLayoutPerson(closedBy)) : '')
    + (closed ? caseLayoutRow('Close reason', '<strong>' + escapeHtml(caseFallbackText(closeData.reason || record.pardonReason || 'No reason recorded')) + '</strong>') : '')
    + '</dl></section>'
    + '<section class="panel case-notes-panel"><div class="case-panel-title"><span>▣</span><div><h3>Moderator notes</h3><p>Private notes visible only to other moderators.</p></div></div><label class="case-field-block"><span>Add note</span><textarea data-case-field="staffNotes" maxlength="1000" rows="4" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label></section>'
    + '<section id="caseEditPanel" class="panel case-edit-panel"><div class="case-panel-title"><span>✎</span><div><h3>Edit case</h3><p>Edits append an actor-aware audit event.</p></div></div><label class="case-field-block"><span>Reason</span><textarea data-case-field="reason" maxlength="1000" rows="5" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label><div class="case-edit-grid"><label><span>Points</span><input data-case-field="points" type="number" min="1" max="10" value="' + points + '" ' + (editable ? '' : 'disabled') + '></label><label><span>New expiry</span><input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, 30d, or never" ' + (editable ? '' : 'disabled') + '></label></div><label class="case-field-block"><span>Evidence</span><input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" ' + (editable ? '' : 'disabled') + '></label>' + (editable ? '<div class="case-actions"><button class="button primary" type="button" data-moderator-action="save-case">Save changes</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon case</button></div>' : '<p class="case-pardon-note">This case is closed and cannot be edited.</p>') + '</section></div>'
    + '<details class="panel case-history-panel" open><summary><span class="case-panel-title"><span>✎</span><span><h3>Edit history (' + escapeHtml(String(events.length)) + ')</h3><p>All changes moderators have made to this case.</p></span></span><span>›</span></summary><ol>' + history + '</ol></details></div>';
}
`;

const CASE_CSS = String.raw`

/* coinSpriteModeratorCaseLayoutV2 */
.case-layout-v2 { gap: 10px; }
.case-layout-v2 .panel { border-color: rgba(255,255,255,.08); background: rgba(35,41,49,.94); box-shadow: none; border-radius: 8px; }
.case-actions-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 12px 0 18px; }
.case-actions-bar h3 { margin: 0; font-size: 18px; }
.case-actions-bar > div { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.case-layout-stack { display: grid; gap: 10px; }
.case-info-panel, .case-notes-panel, .case-edit-panel, .case-history-panel { padding: 16px 18px; }
.case-panel-title { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.case-panel-title h3 { margin: 0; font-size: 18px; }
.case-panel-title p { margin: 2px 0 0; color: var(--muted); line-height: 1.25; }
.case-panel-title > span:first-child { width: 20px; min-width: 20px; text-align: center; font-size: 16px; }
.case-info-panel dl { display: grid; margin: 0; }
.case-info-row { display: grid; grid-template-columns: minmax(86px,.14fr) minmax(0,1fr); gap: 18px; min-height: 35px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.09); }
.case-info-row:last-child { border-bottom: 0; }
.case-info-row dt { margin: 0; font-weight: 800; color: var(--text); }
.case-info-row dd { display: grid; gap: 2px; min-width: 0; margin: 0; }
.case-info-row dd > div, .case-info-row strong, .case-info-row code { overflow-wrap: anywhere; color: var(--text); }
.case-info-row small, .case-muted-text { color: var(--muted); }
.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }
.case-state-line { display: inline-flex; align-items: center; gap: 6px; }
.case-state-dot { width: 10px; height: 10px; border-radius: 99px; background: #43b581; }
.case-state-dot.pardoned, .case-state-dot.expired, .case-state-dot.closed { background: #747f8d; }
.case-user-chip { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; }
.case-user-chip img, .case-user-chip > span { width: 24px; height: 24px; border-radius: 99px; }
.case-user-chip > span { display: inline-grid; place-items: center; color: #fff; background: rgba(255,255,255,.18); font-size: 12px; font-weight: 800; }
.case-user-chip small { color: var(--muted); font-size: 11px; }
.case-notes-panel textarea, .case-edit-panel input, .case-edit-panel textarea { border-radius: 8px; border-color: rgba(255,255,255,.12); background: rgba(10,15,22,.72); }
.case-field-block, .case-edit-panel label { display: grid; gap: 8px; }
.case-field-block > span, .case-edit-panel label > span { font-weight: 800; }
.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }
.case-history-panel summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; list-style: none; }
.case-history-panel summary::-webkit-details-marker { display: none; }
.case-history-panel summary .case-panel-title { margin: 0; }
.case-history-panel summary > span:last-child { font-size: 30px; transition: transform .16s ease; }
.case-history-panel[open] summary > span:last-child { transform: rotate(90deg); }
.case-history-panel ol { margin-top: 14px; padding: 0; list-style: none; }
.case-history-panel li { display: grid; grid-template-columns: minmax(170px,.28fr) minmax(0,1fr); gap: 16px; padding: 11px 0; border-top: 1px solid rgba(255,255,255,.09); }
.case-history-panel time, .case-history-panel li div { display: grid; gap: 2px; min-width: 0; }
.case-history-panel time { font-size: 12px; font-weight: 800; }
.case-history-panel time small, .case-history-panel li span { color: var(--muted); overflow-wrap: anywhere; }
.case-history-empty { display: block !important; color: var(--muted); }
@media (max-width: 760px) { .case-actions-bar, .case-history-panel summary { align-items: stretch; flex-direction: column; } .case-actions-bar > div { justify-content: flex-start; } .case-info-row, .case-edit-grid, .case-history-panel li { grid-template-columns: 1fr; gap: 6px; } }
`;

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  const pattern = /function renderCaseDetail\(record\) \{[\s\S]*?\n\}\n\nfunction renderCasesPanel\(\) \{/;
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `${CASE_LAYOUT}\nfunction renderCasesPanel() {`);
}

function patchModeratorCss(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return `${text.replace(/\s*$/u, '')}${CASE_CSS}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  if (samePath(filePath, TARGETS.moderatorCss)) return patchModeratorCss(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseLayout(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCaseLayout(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["017-moderator-case-style-fix.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};

const MARKER_V2 = 'coinSpriteModeratorCaseLayoutV2';
const MARKER_V3 = 'coinSpriteModeratorCaseLayoutV3';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const CASE_LAYOUT = String.raw`
/* coinSpriteModeratorCaseLayoutV3 */
function caseLayoutEnsureStyles() {
  if (typeof document === 'undefined' || document.getElementById('coinSpriteModeratorCaseLayoutV3Style')) return;
  const css = [
    '/* coinSpriteModeratorCaseLayoutV3 */',
    '.case-layout-v3 { display: grid; gap: 10px; color: var(--text, #f2f5fb); }',
    '.case-layout-v3, .case-layout-v3 * { box-sizing: border-box; }',
    '.case-layout-v3 .panel { border: 1px solid rgba(255,255,255,.075); background: #2a3038; box-shadow: none; border-radius: 8px; }',
    '.case-layout-v3 .button.small { min-height: 30px; padding: 6px 10px; font-weight: 800; }',
    '.case-actions-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 12px 0 16px; overflow: hidden; }',
    '.case-actions-bar h3 { margin: 0; font-size: 18px; line-height: 1.1; }',
    '.case-actions-bar > div { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }',
    '.case-layout-stack { display: grid; gap: 10px; min-width: 0; }',
    '.case-info-panel, .case-notes-panel, .case-edit-panel, .case-history-panel { padding: 14px 16px; }',
    '.case-panel-title { display: flex; align-items: flex-start; gap: 12px; margin: 0 0 12px; }',
    '.case-panel-title > span:first-child { width: 22px; min-width: 22px; text-align: center; color: rgba(242,245,251,.9); font-size: 16px; line-height: 22px; }',
    '.case-panel-title h3 { margin: 0; font-size: 18px; line-height: 1.05; }',
    '.case-panel-title p { margin: 2px 0 0; max-width: 680px; color: var(--muted, #b7bdc8); line-height: 1.25; }',
    '.case-info-panel dl { display: grid; margin: 0; }',
    '.case-info-row { display: grid; grid-template-columns: 88px minmax(0,1fr); gap: 0; align-items: center; min-height: 34px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.09); }',
    '.case-info-row:last-child { border-bottom: 0; }',
    '.case-info-row dt { margin: 0; color: #f2f5fb; font-size: 13px; font-weight: 800; line-height: 1.2; }',
    '.case-info-row dd { display: grid; gap: 2px; min-width: 0; margin: 0; color: #f2f5fb; line-height: 1.25; }',
    '.case-info-row dd > div { min-width: 0; overflow-wrap: anywhere; }',
    '.case-info-row strong, .case-info-row code { color: #fff; font-weight: 800; overflow-wrap: anywhere; }',
    '.case-info-row code { border: 0; background: transparent; padding: 0; font-size: 12px; }',
    '.case-info-row small, .case-muted-text { color: var(--muted, #b7bdc8); font-size: 11px; }',
    '.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }',
    '.case-state-line { display: inline-flex; align-items: center; gap: 6px; width: fit-content; }',
    '.case-state-dot { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 999px; background: #3ed35d; }',
    '.case-state-dot.pardoned, .case-state-dot.expired, .case-state-dot.closed, .case-state-dot.resolved { background: #8a95a3; }',
    '.case-user-chip { display: inline-grid; grid-template-columns: 28px minmax(0, max-content); align-items: center; gap: 8px; max-width: 100%; vertical-align: middle; }',
    '.case-user-chip img, .case-user-chip > .case-user-fallback { display: block; width: 28px !important; height: 28px !important; max-width: 28px !important; max-height: 28px !important; border-radius: 999px; object-fit: cover; flex: 0 0 28px; }',
    '.case-user-chip > .case-user-fallback { display: grid; place-items: center; color: #fff; background: rgba(255,255,255,.18); font-size: 12px; font-weight: 900; }',
    '.case-user-copy { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; min-width: 0; }',
    '.case-user-copy strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.case-user-copy small { color: var(--muted, #b7bdc8); font-size: 11px; overflow-wrap: anywhere; }',
    '.case-ref-chip { display: grid; gap: 2px; min-width: 0; }',
    '.case-ref-chip strong { color: #00b0f4; }',
    '.case-ref-chip small { color: var(--muted, #b7bdc8); }',
    '.case-notes-panel textarea, .case-edit-panel input, .case-edit-panel textarea { width: 100%; border-radius: 8px; border: 1px solid rgba(255,255,255,.12); background: rgba(9,13,20,.76); color: var(--text, #f2f5fb); }',
    '.case-field-block, .case-edit-panel label { display: grid; gap: 7px; min-width: 0; }',
    '.case-field-block > span, .case-edit-panel label > span { font-weight: 800; }',
    '.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }',
    '.case-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }',
    '.case-history-panel summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; list-style: none; }',
    '.case-history-panel summary::-webkit-details-marker { display: none; }',
    '.case-history-panel summary .case-panel-title { margin: 0; }',
    '.case-history-panel summary > span:last-child { color: var(--muted, #b7bdc8); font-size: 28px; line-height: 1; transition: transform .16s ease; }',
    '.case-history-panel[open] summary > span:last-child { transform: rotate(90deg); }',
    '.case-history-panel ol { margin: 14px 0 0; padding: 0; list-style: none; }',
    '.case-history-panel li { display: grid; grid-template-columns: minmax(150px,.26fr) minmax(0,1fr); gap: 16px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,.09); }',
    '.case-history-panel time, .case-history-panel li div { display: grid; gap: 2px; min-width: 0; }',
    '.case-history-panel time { color: #fff; font-size: 12px; font-weight: 800; }',
    '.case-history-panel time small, .case-history-panel li span { color: var(--muted, #b7bdc8); overflow-wrap: anywhere; }',
    '.case-history-empty { display: block !important; color: var(--muted, #b7bdc8); }',
    '@media (max-width: 760px) { .case-actions-bar, .case-history-panel summary { align-items: stretch; flex-direction: column; } .case-actions-bar > div { justify-content: flex-start; } .case-info-row, .case-edit-grid, .case-history-panel li { grid-template-columns: 1fr; gap: 6px; } .case-info-row { align-items: start; } .case-user-chip { grid-template-columns: 28px minmax(0,1fr); } .case-user-copy strong { max-width: 100%; } }'
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'coinSpriteModeratorCaseLayoutV3Style';
  style.textContent = css;
  document.head.appendChild(style);
}

function caseLayoutRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(1, Math.round(Math.abs(Date.now() - date.getTime()) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const [unit, size] = units.find((item) => seconds >= item[1]) || units[units.length - 1];
  const count = Math.max(1, Math.floor(seconds / size));
  return count + ' ' + unit + (count === 1 ? '' : 's') + (date.getTime() > Date.now() ? ' from now' : ' ago');
}

function caseLayoutRow(label, valueHtml, helper = '') {
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}

function caseLayoutPerson(profile) {
  const name = caseFallbackText(profile.name, 'Unknown user');
  const username = caseFallbackText(profile.username, 'unknown');
  const id = caseFallbackText(profile.id, 'not recorded');
  const avatar = profile.avatarUrl
    ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="">'
    : '<span class="case-user-fallback" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<span class="case-user-copy"><strong>' + escapeHtml(name) + '</strong><small>@' + escapeHtml(username) + '</small><small>' + escapeHtml(id) + '</small></span></span>';
}

function caseLayoutState(status) {
  const value = caseFallbackText(status, 'active').toLowerCase();
  const label = value === 'active' || value === 'open' ? 'Open' : 'Closed';
  return '<span class="case-state-line"><span class="case-state-dot ' + escapeHtml(value) + '"></span><span>' + escapeHtml(label) + '</span></span>';
}

function caseLayoutRef(label, reference = {}) {
  return '<span class="case-ref-chip"><strong>' + escapeHtml(label) + '</strong><small>channel ' + escapeHtml(reference.channelId || 'not recorded') + ' · message ' + escapeHtml(reference.messageId || 'not recorded') + '</small></span>';
}

function caseLayoutDuration(record) {
  if (!record.expiresAt) return { value: 'Permanent / not set', helper: '' };
  return { value: formatCaseDetailDate(record.expiresAt), helper: caseLayoutRelative(record.expiresAt) };
}

function renderCaseDetail(record) {
  caseLayoutEnsureStyles();

  const target = caseProfile(record.profiles?.target, record.targetUserId || record.memberId || record.userId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const sourceRef = record.references?.source || {};
  const editable = record.status !== 'pardoned';
  const closed = !['active', 'open'].includes(String(record.status || 'active').toLowerCase());
  const points = Math.max(0, Number(record.points) || 0);
  const duration = caseLayoutDuration(record);
  const events = [...(record.events || [])].reverse();
  const closeEvent = events.find((event) => /pardon|expire|close/i.test(String(event.type || ''))) || null;
  const closeData = closeEvent?.data && typeof closeEvent.data === 'object' ? closeEvent.data : {};
  const closedBy = caseProfile(record.profiles?.closedBy, closeEvent?.actorId || record.closedById || '');
  const history = events.map((event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const summary = data.reason || data.action || data.status || data.error || '';
    return '<li><time>' + escapeHtml(formatCaseDetailDate(event.createdAt)) + '<small>' + escapeHtml(caseLayoutRelative(event.createdAt)) + '</small></time><div><strong>' + escapeHtml(formatCaseEventType(event.type)) + '</strong><span>' + escapeHtml(event.actorId ? 'Actor ' + event.actorId : 'System') + (summary ? ' · ' + escapeHtml(summary) : '') + '</span></div></li>';
  }).join('') || '<li class="case-history-empty">No edits recorded.</li>';

  return '<div class="case-detail case-detail-refresh case-layout-v3">'
    + '<div class="panel case-actions-bar"><h3>Actions</h3><div><button class="button small" type="button" data-moderator-action="back-to-cases">Back</button><button class="button small" type="button" disabled>View message history</button>' + (editable ? '<button class="button small danger" type="button" data-moderator-action="pardon-case">Pardon</button><a class="button small primary" href="#caseEditPanel">Edit</a>' : '<button class="button small" type="button" disabled>Closed</button>') + '</div></div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-layout-stack" data-case-id="' + escapeHtml(record.id) + '">'
    + '<section class="panel case-info-panel"><div class="case-panel-title"><span>ⓘ</span><div><h3>General information</h3><p>Core case facts, delivery references, and closure context.</p></div></div><dl>'
    + caseLayoutRow('ID', '<code>' + escapeHtml(record.id) + '</code>')
    + caseLayoutRow('State', caseLayoutState(record.status))
    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type).toUpperCase()) + '</strong>')
    + caseLayoutRow('User', caseLayoutPerson(target))
    + caseLayoutRow('Reason', '<strong>' + escapeHtml(caseFallbackText(record.reason)) + '</strong>')
    + caseLayoutRow('Points', '<strong>' + escapeHtml(String(points)) + '</strong>')
    + caseLayoutRow('Duration', '<strong>' + escapeHtml(duration.value) + '</strong>', duration.helper)
    + caseLayoutRow('Created', '<strong>' + escapeHtml(formatCaseDetailDate(record.createdAt)) + '</strong>', caseLayoutRelative(record.createdAt))
    + caseLayoutRow('Author', caseLayoutPerson(author))
    + caseLayoutRow('Log message', caseLayoutRef('staff log', staffLog))
    + caseLayoutRow('User notification message', caseLayoutRef(notification.status || 'notice', notification))
    + caseLayoutRow('Source message', caseLayoutRef(record.source || 'source', sourceRef))
    + caseLayoutRow('Evidence', record.evidence ? '<span class="case-linkish">' + escapeHtml(record.evidence) + '</span>' : '<span class="case-muted-text">Not recorded</span>')
    + (closed ? caseLayoutRow('Closed', '<strong>' + escapeHtml(formatCaseDetailDate(closeEvent?.createdAt || record.updatedAt)) + '</strong>', caseLayoutRelative(closeEvent?.createdAt || record.updatedAt)) : '')
    + (closed ? caseLayoutRow('Closed by', caseLayoutPerson(closedBy)) : '')
    + (closed ? caseLayoutRow('Close reason', '<strong>' + escapeHtml(caseFallbackText(closeData.reason || record.pardonReason || 'No reason recorded')) + '</strong>') : '')
    + '</dl></section>'
    + '<section class="panel case-notes-panel"><div class="case-panel-title"><span>▣</span><div><h3>Moderator notes</h3><p>Private notes visible only to other moderators.</p></div></div><label class="case-field-block"><span>Add note</span><textarea data-case-field="staffNotes" maxlength="1000" rows="4" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label></section>'
    + '<section id="caseEditPanel" class="panel case-edit-panel"><div class="case-panel-title"><span>✎</span><div><h3>Edit case</h3><p>Edits append an actor-aware audit event.</p></div></div><label class="case-field-block"><span>Reason</span><textarea data-case-field="reason" maxlength="1000" rows="5" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label><div class="case-edit-grid"><label><span>Points</span><input data-case-field="points" type="number" min="1" max="10" value="' + points + '" ' + (editable ? '' : 'disabled') + '></label><label><span>New expiry</span><input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, 30d, or never" ' + (editable ? '' : 'disabled') + '></label></div><label class="case-field-block"><span>Evidence</span><input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" ' + (editable ? '' : 'disabled') + '></label>' + (editable ? '<div class="case-actions"><button class="button primary" type="button" data-moderator-action="save-case">Save changes</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon case</button></div>' : '<p class="case-pardon-note">This case is closed and cannot be edited.</p>') + '</section></div>'
    + '<details class="panel case-history-panel" open><summary><span class="case-panel-title"><span>✎</span><span><h3>Edit history (' + escapeHtml(String(events.length)) + ')</h3><p>All changes moderators have made to this case.</p></span></span><span>›</span></summary><ol>' + history + '</ol></details></div>';
}
`;

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER_V3)) return text;

  const v2Pattern = new RegExp('/\\* ' + MARKER_V2 + ' \\*/\\nfunction caseLayoutRelative\\(value\\) \\{[\\s\\S]*?\\n\\}\\n\\nfunction renderCasesPanel\\(\\) \\{');
  if (v2Pattern.test(text)) return text.replace(v2Pattern, `${CASE_LAYOUT}\nfunction renderCasesPanel() {`);

  const renderPattern = /function renderCaseDetail\(record\) \{[\s\S]*?\n\}\n\nfunction renderCasesPanel\(\) \{/;
  if (renderPattern.test(text)) return text.replace(renderPattern, `${CASE_LAYOUT}\nfunction renderCasesPanel() {`);

  return text;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseLayoutFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCaseLayoutFix(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["018-moderator-case-person-row-fix.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};

const MARKER_V3 = 'coinSpriteModeratorCaseLayoutV3';
const MARKER_FIX = 'coinSpriteModeratorCasePersonRowsFix';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER_FIX) || !text.includes(MARKER_V3)) return text;

  text = text.replace('/* coinSpriteModeratorCaseLayoutV3 */', '/* coinSpriteModeratorCaseLayoutV3 */\n/* coinSpriteModeratorCasePersonRowsFix */');

  const cssNeedle = "    '.case-user-copy small { color: var(--muted, #b7bdc8); font-size: 11px; overflow-wrap: anywhere; }',";
  const cssPatch = [
    cssNeedle,
    "    'body #moderatorRoot .case-layout-v3 .case-info-row { grid-template-columns: minmax(112px,126px) minmax(0,1fr) !important; gap: 14px !important; align-items: center !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-info-row dd { display: block !important; min-width: 0 !important; max-width: 100% !important; overflow: visible !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-info-row dd > div.case-person-cell { min-width: 0 !important; max-width: 100% !important; overflow: visible !important; overflow-wrap: normal !important; word-break: normal !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-chip { display: flex !important; align-items: center !important; gap: 10px !important; width: 100% !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-chip img, body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback { width: 32px !important; height: 32px !important; max-width: 32px !important; max-height: 32px !important; min-width: 32px !important; flex: 0 0 32px !important; border-radius: 999px !important; object-fit: cover !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy { display: block !important; flex: 1 1 auto !important; width: calc(100% - 42px) !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy strong, body #moderatorRoot .case-layout-v3 .case-user-copy small { display: block !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; overflow-wrap: normal !important; word-break: normal !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy small { margin-top: 2px !important; color: var(--muted, #b7bdc8) !important; font-size: 11px !important; line-height: 1.2 !important; }',",
  ].join('\n');
  text = text.replace(cssNeedle, cssPatch);

  const oldRow = `function caseLayoutRow(label, valueHtml, helper = '') {
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}`;
  const newRow = `function caseLayoutRow(label, valueHtml, helper = '', valueClass = '') {
  const cellClass = valueClass ? ' class="' + escapeHtml(valueClass) + '"' : '';
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div' + cellClass + '>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}`;
  text = text.replace(oldRow, newRow);

  const oldPerson = `function caseLayoutPerson(profile) {
  const name = caseFallbackText(profile.name, 'Unknown user');
  const username = caseFallbackText(profile.username, 'unknown');
  const id = caseFallbackText(profile.id, 'not recorded');
  const avatar = profile.avatarUrl
    ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="">'
    : '<span class="case-user-fallback" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<span class="case-user-copy"><strong>' + escapeHtml(name) + '</strong><small>@' + escapeHtml(username) + '</small><small>' + escapeHtml(id) + '</small></span></span>';
}`;
  const newPerson = `function caseLayoutPerson(profile) {
  const source = profile || {};
  const name = caseFallbackText(source.name, 'Unknown user');
  const username = caseFallbackText(source.username, 'unknown');
  const id = caseFallbackText(source.id, 'not recorded');
  const handle = username && username !== 'unknown' ? '@' + username : '@unknown';
  const meta = id && id !== 'not recorded' ? handle + ' · ' + id : handle + ' · not recorded';
  const avatar = source.avatarUrl
    ? '<img src="' + escapeHtml(source.avatarUrl) + '" alt="">'
    : '<span class="case-user-fallback" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<span class="case-user-copy"><strong class="case-user-name">' + escapeHtml(name) + '</strong><small class="case-user-meta">' + escapeHtml(meta) + '</small></span></span>';
}`;
  text = text.replace(oldPerson, newPerson);

  text = text
    .replace("caseLayoutRow('User', caseLayoutPerson(target))", "caseLayoutRow('User', caseLayoutPerson(target), '', 'case-person-cell')")
    .replace("caseLayoutRow('Author', caseLayoutPerson(author))", "caseLayoutRow('Author', caseLayoutPerson(author), '', 'case-person-cell')")
    .replace("caseLayoutRow('Closed by', caseLayoutPerson(closedBy))", "caseLayoutRow('Closed by', caseLayoutPerson(closedBy), '', 'case-person-cell')");

  return text;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCasePersonRowsFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCasePersonRowsFix(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["019-moderator-case-user-chip-fix.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  bootstrapJs: path.join(ROOT, 'admin', 'bootstrap.js'),
};
const MARKER = 'coinSpriteModeratorCaseUserChipFix';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function caseUserChipBrowserPatch() {
  if (window.__coinSpriteModeratorCaseUserChipFix) return;
  window.__coinSpriteModeratorCaseUserChipFix = true;

  const styleId = 'coinSpriteModeratorCaseUserChipFix';
  const css = [
    'body #moderatorRoot .case-layout-v2 .case-info-row dd > div.case-person-cell,',
    'body #moderatorRoot .case-layout-v3 .case-info-row dd > div.case-person-cell {',
    '  min-width: 0 !important;',
    '  max-width: 100% !important;',
    '  overflow: hidden !important;',
    '  overflow-wrap: normal !important;',
    '  word-break: normal !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-chip,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip {',
    '  display: grid !important;',
    '  grid-template-columns: 32px minmax(0, 1fr) !important;',
    '  align-items: center !important;',
    '  justify-items: start !important;',
    '  gap: 9px !important;',
    '  width: auto !important;',
    '  max-width: min(100%, 460px) !important;',
    '  min-width: 0 !important;',
    '  padding: 0 !important;',
    '  border: 0 !important;',
    '  border-radius: 0 !important;',
    '  background: transparent !important;',
    '  box-shadow: none !important;',
    '  overflow: hidden !important;',
    '  overflow-wrap: normal !important;',
    '  word-break: normal !important;',
    '  text-align: left !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-chip img,',
    'body #moderatorRoot .case-layout-v2 .case-user-chip > .case-user-fallback,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip img,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback {',
    '  grid-column: 1 !important;',
    '  grid-row: 1 !important;',
    '  width: 32px !important;',
    '  height: 32px !important;',
    '  min-width: 32px !important;',
    '  max-width: 32px !important;',
    '  min-height: 32px !important;',
    '  max-height: 32px !important;',
    '  border-radius: 999px !important;',
    '  object-fit: cover !important;',
    '  display: block !important;',
    '  place-items: center !important;',
    '  flex: 0 0 32px !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-chip > .case-user-copy,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-copy {',
    '  grid-column: 2 !important;',
    '  display: grid !important;',
    '  grid-template-columns: minmax(0, 1fr) !important;',
    '  align-items: start !important;',
    '  justify-items: start !important;',
    '  place-items: normal !important;',
    '  gap: 2px !important;',
    '  width: auto !important;',
    '  height: auto !important;',
    '  min-width: 0 !important;',
    '  max-width: 100% !important;',
    '  min-height: 0 !important;',
    '  max-height: none !important;',
    '  padding: 0 !important;',
    '  border: 0 !important;',
    '  border-radius: 0 !important;',
    '  background: transparent !important;',
    '  box-shadow: none !important;',
    '  color: inherit !important;',
    '  font: inherit !important;',
    '  overflow: hidden !important;',
    '  overflow-wrap: normal !important;',
    '  word-break: normal !important;',
    '  text-align: left !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-chip > strong,',
    'body #moderatorRoot .case-layout-v2 .case-user-chip > small,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip > strong,',
    'body #moderatorRoot .case-layout-v3 .case-user-chip > small {',
    '  grid-column: 2 !important;',
    '  min-width: 0 !important;',
    '  max-width: 100% !important;',
    '  overflow: hidden !important;',
    '  text-overflow: ellipsis !important;',
    '  white-space: nowrap !important;',
    '  overflow-wrap: normal !important;',
    '  word-break: normal !important;',
    '  text-align: left !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-copy > strong,',
    'body #moderatorRoot .case-layout-v2 .case-user-copy > small,',
    'body #moderatorRoot .case-layout-v2 .case-user-name,',
    'body #moderatorRoot .case-layout-v2 .case-user-meta,',
    'body #moderatorRoot .case-layout-v3 .case-user-copy > strong,',
    'body #moderatorRoot .case-layout-v3 .case-user-copy > small,',
    'body #moderatorRoot .case-layout-v3 .case-user-name,',
    'body #moderatorRoot .case-layout-v3 .case-user-meta {',
    '  display: block !important;',
    '  width: 100% !important;',
    '  min-width: 0 !important;',
    '  max-width: 100% !important;',
    '  overflow: hidden !important;',
    '  text-overflow: ellipsis !important;',
    '  white-space: nowrap !important;',
    '  overflow-wrap: normal !important;',
    '  word-break: normal !important;',
    '  text-align: left !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-copy > strong,',
    'body #moderatorRoot .case-layout-v2 .case-user-name,',
    'body #moderatorRoot .case-layout-v3 .case-user-copy > strong,',
    'body #moderatorRoot .case-layout-v3 .case-user-name {',
    '  line-height: 1.16 !important;',
    '}',
    '',
    'body #moderatorRoot .case-layout-v2 .case-user-copy > small,',
    'body #moderatorRoot .case-layout-v2 .case-user-meta,',
    'body #moderatorRoot .case-layout-v3 .case-user-copy > small,',
    'body #moderatorRoot .case-layout-v3 .case-user-meta {',
    '  margin: 0 !important;',
    '  color: var(--muted, #b7bdc8) !important;',
    '  font-size: 11px !important;',
    '  font-weight: 700 !important;',
    '  line-height: 1.2 !important;',
    '}',
  ].join('\n');

  function installCaseUserChipFix() {
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.append(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCaseUserChipFix, { once: true });
  } else {
    installCaseUserChipFix();
  }
  setTimeout(installCaseUserChipFix, 0);
  setTimeout(installCaseUserChipFix, 250);
}

const BOOTSTRAP_PATCH = `\n\n;(${caseUserChipBrowserPatch.toString()})();\n`;

function patchBootstrapJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return `${text.replace(/\s*$/u, '')}${BOOTSTRAP_PATCH}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.bootstrapJs)) return patchBootstrapJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseUserChipFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCaseUserChipFix(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["01y-message-component-action-assets.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'admin', 'index.html');
const nativeReadFileSync = fs.readFileSync.bind(fs);

if (!fs.__coinSpriteMessageComponentActionAsset) {
  fs.__coinSpriteMessageComponentActionAsset = true;
  fs.readFileSync = function readFileWithMessageComponentActions(filePath, ...args) {
    const value = nativeReadFileSync(filePath, ...args);
    if (path.resolve(String(filePath)) !== INDEX_PATH || typeof value !== 'string') return value;
    if (value.includes('/admin/message-component-actions.js')) return value;
    return value
      .replace(
        '</head>',
        '  <link rel="stylesheet" href="/admin/message-component-actions.css?v=action-save-3">\n</head>',
      )
      .replace(
        '</body>',
        [
          '  <script src="/admin/message-component-actions.js?v=action-save-3" defer></script>',
          '</body>',
        ].join('\n'),
      );
  };
}

module.exports = {};
    }],
    ["01z-message-tab-editor-assets.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'admin', 'index.html');
const nativeReadFileSync = fs.readFileSync.bind(fs);

if (!fs.__coinSpriteMessageTabEditorAsset) {
  fs.__coinSpriteMessageTabEditorAsset = true;
  fs.readFileSync = function readFileWithMessageTabEditor(filePath, ...args) {
    const value = nativeReadFileSync(filePath, ...args);
    if (path.resolve(String(filePath)) !== INDEX_PATH || typeof value !== 'string') {
      return value;
    }
    if (value.includes('/admin/message-tab-inline-editor.js')) {
      return value;
    }
    return value.replace(
      '</body>',
      [
        '  <script src="/admin/message-tab-inline-editor.js" defer></script>',
        '</body>',
      ].join('\n'),
    );
  };
}

module.exports = {};
    }],
    ["02-moderator-report-channel-fix.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const path = require('path');

const ADMIN_MODERATOR_PATH = path.join(__dirname, '..', 'admin', 'moderator.js');
const ADMIN_MODERATOR_CSS_PATH = path.join(__dirname, '..', 'admin', 'moderator.css');
const ADMIN_PATCH_MARKER = '__coinSpriteModeratorReportChannelFix';
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function replaceOnce(text, oldValue, newValue) {
  const index = text.indexOf(oldValue);
  if (index < 0) return text;
  return `${text.slice(0, index)}${newValue}${text.slice(index + oldValue.length)}`;
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(ADMIN_PATCH_MARKER)) return text;

  text = replaceOnce(text,
    "    if (actionType === 'timeout') {\n      next.durationSeconds = clampSeconds(source.durationSeconds, 300);\n    }\n    return next;\n  }",
    "    if (actionType === 'timeout') {\n      next.durationSeconds = clampSeconds(source.durationSeconds, 300);\n    }\n    if (actionType === 'report' || actionType === 'log') {\n      next.reportChannelId = String(source.reportChannelId || source.channelId || '');\n    }\n    return next;\n  }",
  );
  text = replaceOnce(text, '  function actionFields(action) {', '  function actionFields(action, index) {');
  text = replaceOnce(text,
    "    if (action.type === 'timeout') {\n      return `<label class=\"automod-duration-field\">Timeout seconds <input data-link-action-field=\"durationSeconds\" type=\"number\" min=\"1\" max=\"2419200\" step=\"1\" value=\"${Number(action.durationSeconds) || 300}\"></label>`;\n    }\n    return '';\n  }",
    "    if (action.type === 'timeout') {\n      return `<label class=\"automod-duration-field\">Timeout seconds <input data-link-action-field=\"durationSeconds\" type=\"number\" min=\"1\" max=\"2419200\" step=\"1\" value=\"${Number(action.durationSeconds) || 300}\"></label>`;\n    }\n    if (action.type === 'report' || action.type === 'log') {\n      const label = action.type === 'report' ? 'Report channel' : 'Log channel';\n      return `<div class=\"picker-field automod-report-channel\"><span class=\"field-label\">${label}</span><div id=\"linkReportChannelMount-${index}\" data-link-report-channel-mount data-action-index=\"${index}\"></div></div>`;\n    }\n    return '';\n  }",
  );
  text = text.replace('      ${actionFields(normalized)}', '      ${actionFields(normalized, index)}');
  text = replaceOnce(text,
    "    const excludeRoles = root.querySelector('#linkExcludeRolesMount');\n    if (excludeRoles) renderPicker(excludeRoles, roleOptions(), link.excludeRoleIds, {\n      multiple: true, type: 'role', placeholder: 'No excluded roles',\n      onChange: (value) => setAndDirty(() => { link.excludeRoleIds = uniqueIds(value); }),\n    });\n  }",
    "    const excludeRoles = root.querySelector('#linkExcludeRolesMount');\n    if (excludeRoles) renderPicker(excludeRoles, roleOptions(), link.excludeRoleIds, {\n      multiple: true, type: 'role', placeholder: 'No excluded roles',\n      onChange: (value) => setAndDirty(() => { link.excludeRoleIds = uniqueIds(value); }),\n    });\n    root.querySelectorAll('[data-link-report-channel-mount]').forEach((mount) => {\n      const index = Number(mount.dataset.actionIndex);\n      renderPicker(mount, textChannelOptions(), link.actions[index]?.reportChannelId || '', {\n        type: 'channel',\n        placeholder: 'Use default log channel',\n        onChange: (value) => setAndDirty(() => {\n          if (link.actions[index]) link.actions[index].reportChannelId = value;\n        }),\n      });\n    });\n  }",
  );
  return `${text}\n;(() => { window.${ADMIN_PATCH_MARKER} = true; })();\n`;
}

function patchModeratorCss(source) {
  let text = String(source || '');
  if (text.includes(`/* ${ADMIN_PATCH_MARKER} */`)) return text;
  text = replaceOnce(text, '.message-section-tabs {\n  display: grid;', '.message-section-tabs {\n  position: relative;\n  z-index: 2;\n  display: grid;');
  text = replaceOnce(text, '.message-section-tabs button {\n  min-height: 42px;', '.message-section-tabs button {\n  position: relative;\n  z-index: 3;\n  touch-action: manipulation;\n  min-height: 42px;');
  text = replaceOnce(text, '.message-create-menu {\n  position: absolute;\n  z-index: 20;', '.message-create-menu {\n  position: absolute;\n  z-index: 90;');
  text += `\n/* ${ADMIN_PATCH_MARKER} */\n.automod-action-row[data-action-type="report"],\n.automod-action-row[data-action-type="log"] {\n  grid-template-columns: minmax(150px, 0.55fr) minmax(260px, 1fr) auto;\n}\n\n.automod-report-channel {\n  min-width: 0;\n}\n\n@media (max-width: 1100px) {\n  .automod-action-row[data-action-type="report"],\n  .automod-action-row[data-action-type="log"] {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n@media (max-width: 700px) {\n  .automod-action-row[data-action-type="report"],\n  .automod-action-row[data-action-type="log"] {\n    grid-template-columns: 1fr;\n  }\n}\n`;
  return text;
}

function patchAdminFile(filePath, source) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved === path.resolve(ADMIN_MODERATOR_PATH)) return patchModeratorJs(source);
  if (resolved === path.resolve(ADMIN_MODERATOR_CSS_PATH)) return patchModeratorCss(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminFile(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithModeratorReportChannelPatch(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return nativeReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithModeratorReportChannelPatch(filePath, options) {
  const data = nativeReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["020-admin-case-message-type-polish.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  bootstrapJs: path.join(ROOT, 'admin', 'bootstrap.js'),
};
const MARKER = 'coinSpriteCaseListDefaultMessageTypePolish';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function adminCaseListDefaultMessageTypePolish() {
  if (window.__coinSpriteCaseListDefaultMessageTypePolish) return;
  window.__coinSpriteCaseListDefaultMessageTypePolish = true;

  const styleId = 'coinSpriteCaseListDefaultMessageTypePolishStyle';
  const dmDefaultIds = new Set([
    'default-ai-moderation-user-warning',
    'default-auto-moderator-user-warning',
    'default-warning-notice',
    'default-warning-timeout-notice',
    'default-warning-kick-notice',
    'default-warning-ban-notice',
    'default-moderation-mute-notice',
    'default-moderation-kick-notice',
    'default-moderation-ban-notice',
    'default-giveaway-hoster-dm',
  ]);

  function installStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      'body #moderatorRoot .case-list-panel .case-table {',
      '  display: grid !important;',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  overflow-x: auto !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-table-head,',
      'body #moderatorRoot .case-list-panel .case-row {',
      '  display: grid !important;',
      '  grid-template-columns: minmax(90px, .72fr) minmax(230px, 1.55fr) minmax(300px, 2.35fr) minmax(100px, .72fr) minmax(112px, .72fr) !important;',
      '  align-items: start !important;',
      '  column-gap: 22px !important;',
      '  width: 100% !important;',
      '  min-width: 900px !important;',
      '  box-sizing: border-box !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-table-head {',
      '  padding: 12px 14px !important;',
      '  color: var(--muted, #b7bdc8) !important;',
      '  background: rgba(255,255,255,.035) !important;',
      '  border-radius: 8px 8px 0 0 !important;',
      '  font-size: 12px !important;',
      '  font-weight: 800 !important;',
      '  text-transform: uppercase !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row {',
      '  margin: 0 !important;',
      '  padding: 14px !important;',
      '  border: 0 !important;',
      '  border-top: 1px solid rgba(255,255,255,.075) !important;',
      '  border-radius: 0 !important;',
      '  background: transparent !important;',
      '  color: var(--text, #f2f5fb) !important;',
      '  text-align: left !important;',
      '  cursor: pointer !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row:hover,',
      'body #moderatorRoot .case-list-panel .case-row:focus-visible {',
      '  background: rgba(255,255,255,.045) !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > strong,',
      'body #moderatorRoot .case-list-panel .case-row > span,',
      'body #moderatorRoot .case-list-panel .case-row > time {',
      '  display: grid !important;',
      '  align-content: start !important;',
      '  gap: 4px !important;',
      '  min-width: 0 !important;',
      '  max-width: 100% !important;',
      '  margin: 0 !important;',
      '  line-height: 1.25 !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > strong {',
      '  color: #fff !important;',
      '  font-weight: 900 !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row small {',
      '  display: block !important;',
      '  min-width: 0 !important;',
      '  color: var(--muted, #b7bdc8) !important;',
      '  font-size: 12px !important;',
      '  font-weight: 700 !important;',
      '  line-height: 1.2 !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > span:nth-child(2),',
      'body #moderatorRoot .case-list-panel .case-row > span:nth-child(3) {',
      '  overflow-wrap: anywhere !important;',
      '  word-break: normal !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > .case-status {',
      '  justify-self: start !important;',
      '  align-self: center !important;',
      '  width: fit-content !important;',
      '  max-width: 100% !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > time {',
      '  justify-self: start !important;',
      '  color: #fff !important;',
      '  font-weight: 800 !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .warning-rule-row {',
      '  display: grid !important;',
      '  grid-template-columns: minmax(92px, 140px) minmax(140px, 180px) minmax(150px, 210px) minmax(220px, 1fr) auto auto !important;',
      '  align-items: end !important;',
      '  column-gap: 12px !important;',
      '}',
      'body #moderatorRoot .warning-rule-row select,',
      'body #moderatorRoot .warning-rule-row input {',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '}',
      'body #moderatorRoot .warning-rule-row .warning-rule-reason {',
      '  min-width: 0 !important;',
      '}',
      'body #moderatorRoot .warning-rule-row .warning-rule-enabled {',
      '  align-self: center !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .warning-rule-row .danger.ghost {',
      '  min-width: 110px !important;',
      '}',
      'body #messageTemplatesRoot .message-default-card .message-default-type {',
      '  display: block !important;',
      '  margin-top: 2px !important;',
      '  color: #c9d3e6 !important;',
      '  font-size: 12px !important;',
      '  font-weight: 800 !important;',
      '  line-height: 1.25 !important;',
      '}',
      '@media (max-width: 1040px) {',
      '  body #moderatorRoot .warning-rule-row { grid-template-columns: minmax(90px, 120px) minmax(130px, 160px) minmax(130px, 180px) minmax(200px, 1fr) !important; }',
      '  body #moderatorRoot .warning-rule-row .warning-rule-enabled, body #moderatorRoot .warning-rule-row .danger.ghost { justify-self: start !important; }',
      '}',
      '@media (max-width: 860px) {',
      '  body #moderatorRoot .case-list-panel .case-table { overflow-x: visible !important; }',
      '  body #moderatorRoot .case-list-panel .case-table-head { display: none !important; }',
      '  body #moderatorRoot .case-list-panel .case-row { grid-template-columns: minmax(0, 1fr) !important; min-width: 0 !important; gap: 8px !important; padding: 14px 4px !important; }',
      '  body #moderatorRoot .case-list-panel .case-row > .case-status, body #moderatorRoot .case-list-panel .case-row > time { align-self: start !important; }',
      '  body #moderatorRoot .warning-rule-row { grid-template-columns: minmax(0, 1fr) !important; }',
      '}',
    ].join('\n');
    document.head.append(style);
  }

  function defaultMessageType(id) {
    const value = String(id || '');
    if (!value.startsWith('default-')) return '';
    return dmDefaultIds.has(value) ? 'DM' : 'Channel';
  }

  function labelContainerForCard(card) {
    return Array.from(card.children).find((child) => child.tagName === 'SPAN'
      && !child.classList.contains('message-template-symbol')
      && !child.classList.contains('message-card-folder-button')
      && !child.classList.contains('message-card-arrow')) || null;
  }

  function labelForContainer(container) {
    return Array.from(container.children).find((child) => child.classList.contains('message-default-type')) || null;
  }

  function annotateDefaultCards(root = document) {
    root.querySelectorAll?.('#messageTemplatesRoot .message-template-card.message-default-card[data-id]').forEach((card) => {
      const type = defaultMessageType(card.dataset.id);
      if (!type) return;
      const container = labelContainerForCard(card);
      if (!container) return;
      let label = labelForContainer(container);
      if (!label) {
        label = document.createElement('small');
        label.className = 'message-default-type';
        container.append(label);
      }
      label.textContent = 'Type: ' + type;
    });
  }

  function refresh() {
    installStyles();
    annotateDefaultCards(document);
  }

  function scheduleRefresh(delay = 0) {
    window.setTimeout(refresh, delay);
  }

  function scheduleAfterMessageUiChange(event) {
    if (!event.target?.closest?.('#messageTemplatesRoot')) return;
    scheduleRefresh(0);
    scheduleRefresh(120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  } else {
    refresh();
  }

  document.addEventListener('click', scheduleAfterMessageUiChange, true);
  document.addEventListener('input', scheduleAfterMessageUiChange, true);
  document.addEventListener('change', scheduleAfterMessageUiChange, true);
  [0, 250, 750, 1500].forEach(scheduleRefresh);
}

const BOOTSTRAP_PATCH = `\n\n;(${adminCaseListDefaultMessageTypePolish.toString()})();\n`;

function patchBootstrapJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return `${text.replace(/\s*$/u, '')}${BOOTSTRAP_PATCH}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.bootstrapJs)) return patchBootstrapJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseListDefaultMessageTypePolish(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCaseListDefaultMessageTypePolish(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
    }],
    ["021-warning-count-admin-ui.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};
const MARKER = 'coinSpriteWarningCountAdminPatch';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function replaceEvery(text, search, replacement) {
  return String(text).split(search).join(replacement);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = text.replace('(() => {\n', '(() => {\n  /* ' + MARKER + ' */\n');

  text = replaceEvery(
    text,
    "{ threshold: 3, action: 'timeout', durationSeconds: 3600, enabled: true }",
    "{ threshold: 3, action: 'timeout', durationSeconds: 3600, reason: 'Reached 3 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 5, action: 'timeout', durationSeconds: 86400, enabled: true }",
    "{ threshold: 5, action: 'timeout', durationSeconds: 86400, reason: 'Reached 5 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 8, action: 'timeout', durationSeconds: 604800, enabled: true }",
    "{ threshold: 8, action: 'timeout', durationSeconds: 604800, reason: 'Reached 8 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true }",
    "{ threshold: 10, action: 'staff_alert', durationSeconds: 0, reason: 'Reached 10 active warnings. Action: staff alert.', enabled: true }",
  );

  text = text.replace(
    "  function normalizeDomainMode(value, whitelist = []) {",
    "  function warningRuleReason(rule = {}) {\n"
      + "    const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));\n"
      + "    const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';\n"
      + "    const saved = String(rule.reason || '').trim();\n"
      + "    if (saved) return saved.slice(0, 500);\n"
      + "    const actionLabel = action === 'timeout' ? 'mute' : action === 'staff_alert' ? 'staff alert' : action;\n"
      + "    return ('Reached ' + threshold + ' active warnings. Action: ' + actionLabel + '.').slice(0, 500);\n"
      + "  }\n\n"
      + "  function normalizeDomainMode(value, whitelist = []) {",
  );

  text = text.replace(
    "      next.points = Math.max(1, Math.min(10, Math.round(Number(source.points) || 1)));\n",
    '',
  );
  text = text.replace(
    "        <label>Points <input data-link-action-field=\"points\" type=\"number\" min=\"1\" max=\"10\" step=\"1\" value=\"${Number(action.points) || 1}\"></label>\n",
    '',
  );

  text = text.replace(
    "        escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : defaultRules).map((rule) => ({\n"
      + "          threshold: Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1))),\n"
      + "          action: ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert',\n"
      + "          durationSeconds: clampSeconds(rule.durationSeconds, rule.action === 'staff_alert' ? 0 : 3600),\n"
      + "          enabled: rule.enabled !== false,\n"
      + "        })),",
    "        escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : defaultRules).map((rule) => {\n"
      + "          const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));\n"
      + "          const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';\n"
      + "          return {\n"
      + "            threshold,\n"
      + "            action,\n"
      + "            durationSeconds: clampSeconds(rule.durationSeconds, action === 'staff_alert' ? 0 : 3600),\n"
      + "            reason: warningRuleReason({ ...rule, threshold, action }),\n"
      + "            enabled: rule.enabled !== false,\n"
      + "          };\n"
      + "        }),",
  );

  text = text.replace(/function caseStats\(\) \{[\s\S]*?\n\}\n\nfunction renderOverviewPanel\(\) \{/, () => `function caseStats() {
  const active = moderatorState.cases.filter((record) => record.status === 'active');
  const members = new Map();
  for (const record of active) members.set(record.memberId, (members.get(record.memberId) || 0) + 1);
  const near = [...members.values()].filter((warnings) => warnings >= 3).length;
  const failures = moderatorState.cases.flatMap((record) => record.enforcementEvents || []).filter((event) => event.success === false).length;
  return { active: active.length, members: members.size, near, failures };
}

function renderOverviewPanel() {`);

  text = text.replace(
    /recent\.length \? recent\.map\(\(record\) => `<div class="automod-action-row"><strong>\$\{escapeHtml\(record\.id\)\}<\/strong><span>&lt;@\$\{escapeHtml\(record\.memberId\)\}&gt;[\s\S]*?\$\{escapeHtml\(record\.status\)\}<\/span><span>\$\{escapeHtml\(record\.reason\)\}<\/span><\/div>`\)\.join\(''\) : '<p>No warning cases yet\.<\/p>'/,
    () => "recent.length ? recent.map((record) => `<div class=\"automod-action-row\"><strong>${escapeHtml(record.id)}</strong><span>&lt;@${escapeHtml(record.memberId)}&gt; - warning - ${escapeHtml(record.status)}</span><span>${escapeHtml(record.reason)}</span></div>`).join('') : '<p>No warning cases yet.</p>'",
  );

  text = text.replace(/function warningRuleRow\(rule, index\) \{[\s\S]*?\n\}\n\nfunction renderWarningsPanel\(\) \{/, () => [
    'function warningRuleRow(rule, index) {',
    "  const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';",
    '  const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));',
    '  const reason = warningRuleReason({ ...rule, threshold, action });',
    '  return \'<div class="automod-action-row warning-rule-row" data-warning-rule-index="\' + index + \'">\'',
    '    + \'<label>Warnings <input data-warning-rule-field="threshold" type="number" min="1" max="100" value="\' + threshold + \'"></label>\'',
    '    + \'<label>Action <select data-warning-rule-field="action">\'',
    "    + ['timeout', 'kick', 'ban', 'staff_alert'].map((item) => '<option value=\"' + item + '\" ' + (action === item ? 'selected' : '') + '>' + item.replace('_', ' ') + '</option>').join('')",
    "    + '</select></label>'",
    "    + (action === 'timeout' ? '<label>Duration seconds <input data-warning-rule-field=\"durationSeconds\" type=\"number\" min=\"1\" max=\"2419200\" value=\"' + (rule.durationSeconds || 3600) + '\"></label>' : '<span></span>')",
    "    + '<label class=\"warning-rule-reason\">Reason <input data-warning-rule-field=\"reason\" type=\"text\" maxlength=\"500\" value=\"' + escapeHtml(reason) + '\" placeholder=\"Reason used for this action\"></label>'",
    "    + '<label class=\"checkline warning-rule-enabled\"><input data-warning-rule-field=\"enabled\" type=\"checkbox\" ' + (rule.enabled !== false ? 'checked' : '') + '> Enabled</label>'",
    "    + '<button class=\"button small danger ghost\" type=\"button\" data-moderator-action=\"remove-warning-rule\">Remove</button>'",
    "    + '</div>';",
    '}',
    '',
    'function renderWarningsPanel() {',
  ].join('\n'));

  text = text.replace('Point-based warnings', 'Warning-count warnings');
  text = text.replace(
    '<div class="panel-heading"><h3>Warning-count warnings</h3><p>Cases remain auditable after they expire or are pardoned.</p></div>',
    '<div class="panel-heading"><h3>Warning-count warnings</h3><p>Each active warning counts once toward escalation thresholds.</p></div>',
  );
  text = text.replace(
    '      <label>Points <input id="warningCreatePoints" type="number" min="1" max="10" value="1"></label>\n',
    '',
  );
  text = text.replace(
    "            points: Number(document.querySelector('#warningCreatePoints')?.value) || 1,\n",
    '',
  );

  text = text.replace(
    "      moderatorState.warnings.escalationRules.push({ threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true });",
    "      moderatorState.warnings.escalationRules.push({ threshold: 10, action: 'staff_alert', durationSeconds: 0, reason: warningRuleReason({ threshold: 10, action: 'staff_alert' }), enabled: true });",
  );

  text = text.replace(/function warningSnapshot\(\) \{[\s\S]*?\n\}\n\nasync function loadWarningCases\(force = false\) \{/, () => `function warningSnapshot() {
  return {
    enabled: Boolean(moderatorState.warnings.enabled),
    defaultExpiryDays: Math.max(0, Math.min(3650, Number(moderatorState.warnings.defaultExpiryDays) || 90)),
    fallbackChannelId: moderatorState.warnings.fallbackChannelId || '',
    staffLogChannelId: moderatorState.warnings.staffLogChannelId || '',
    escalationRules: moderatorState.warnings.escalationRules.map((rule) => {
      const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));
      const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';
      return {
        threshold,
        action,
        durationSeconds: Math.max(0, Math.min(2419200, Number(rule.durationSeconds) || 0)),
        reason: warningRuleReason({ ...rule, threshold, action }),
        enabled: rule.enabled !== false,
      };
    }).sort((a, b) => a.threshold - b.threshold),
  };
}

async function loadWarningCases(force = false) {`);

  text = text.replace(
    "    if (warningRuleField && warningRuleField !== 'action' && warningRuleField !== 'enabled') {\n"
      + "      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);\n"
      + "      const rule = moderatorState.warnings.escalationRules[index];\n"
      + "      if (rule) rule[warningRuleField] = Number(event.target.value) || 0;\n"
      + "    }",
    "    if (warningRuleField && warningRuleField !== 'action' && warningRuleField !== 'enabled') {\n"
      + "      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);\n"
      + "      const rule = moderatorState.warnings.escalationRules[index];\n"
      + "      if (rule) {\n"
      + "        if (warningRuleField === 'reason') rule.reason = String(event.target.value || '').slice(0, 500);\n"
      + "        else rule[warningRuleField] = Number(event.target.value) || 0;\n"
      + "      }\n"
      + "    }",
  );

  text = text.replace(
    "        if (warningRuleField === 'enabled') rule.enabled = Boolean(event.target.checked);\n        else if (warningRuleField === 'action') rule.action = event.target.value;",
    "        if (warningRuleField === 'enabled') rule.enabled = Boolean(event.target.checked);\n        else if (warningRuleField === 'action') {\n          const previousReason = String(rule.reason || '');\n          rule.action = event.target.value;\n          if (!previousReason.trim() || /^Reached \\d+ active warnings\\. Action: /.test(previousReason)) rule.reason = warningRuleReason(rule);\n        }",
  );

  text = text.replace(
    "    '.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }',",
    "    '.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }',\n    '.case-edit-grid.case-edit-grid-single { grid-template-columns: minmax(240px, 1fr); }',",
  );
  text = text.replace(
    "    + caseLayoutRow('Points', '<strong>' + escapeHtml(String(points)) + '</strong>')\n",
    '',
  );
  text = text.replace(
    "<div class=\"case-edit-grid\"><label><span>Points</span><input data-case-field=\"points\" type=\"number\" min=\"1\" max=\"10\" value=\"' + points + '\" ' + (editable ? '' : 'disabled') + '></label><label><span>New expiry</span><input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, 30d, or never\" ' + (editable ? '' : 'disabled') + '></label></div>",
    "<div class=\"case-edit-grid case-edit-grid-single\"><label><span>New expiry</span><input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, 30d, or never\" ' + (editable ? '' : 'disabled') + '></label></div>",
  );
  text = text.replace(
    "    + '<div class=\"settings-grid\"><label>Points <input data-case-field=\"points\" type=\"number\" min=\"1\" max=\"10\" value=\"' + Number(record.points) + '\" ' + (editable ? '' : 'disabled') + '></label>'\n    + '<label>New expiry <input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, or use 30d/never\" ' + (editable ? '' : 'disabled') + '></label></div>'\n",
    "    + '<div class=\"settings-grid\"><label>New expiry <input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, or use 30d/never\" ' + (editable ? '' : 'disabled') + '></label></div>'\n",
  );

  return text;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithWarningCountAdminPatch(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithWarningCountAdminPatch(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = { patchModeratorJs };
    }],
    ["022-moderator-pardon-modal-actions.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};
const MARKER = 'coinSpriteModeratorModalActionPatch';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;

  const guard = "    if (!event.target.closest('#moderatorRoot')) return;";
  const replacement = "    /* " + MARKER + " */\n"
    + "    if (!event.target.closest('#moderatorRoot') && !event.target.closest('#moderatorModalBackdrop')) return;";
  return text.includes(guard) ? text.replace(guard, replacement) : text;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithModeratorModalActionPatch(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithModeratorModalActionPatch(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = { patchModeratorJs };
    }],
    ["023-moderation-sanction-case-ui.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const MARKER = 'coinSpriteSanctionCaseUiV1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = text.replace(
    "const typeOptions = ['warning', 'automod_warning', 'note', 'appeal']",
    "const typeOptions = ['warning', 'automod_warning', 'mute', 'kick', 'ban', 'note', 'appeal']",
  );

  text = text.replace(
    "function caseLayoutDuration(record) {",
    `/* ${MARKER} */
function caseLayoutEvidence(record) {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const links = attachments.map((attachment, index) => {
    const name = attachment.name || ('Evidence ' + (index + 1));
    const href = attachment.storedName
      ? '/api/guilds/' + encodeURIComponent(record.guildId) + '/moderation/evidence/' + encodeURIComponent(record.id) + '/' + encodeURIComponent(attachment.storedName)
      : attachment.url;
    if (!href) return '';
    return '<a class="case-linkish" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>';
  }).filter(Boolean);
  if (!links.length && record.evidence) {
    links.push('<a class="case-linkish" href="' + escapeHtml(record.evidence) + '" target="_blank" rel="noopener">Open evidence</a>');
  }
  return links.length ? '<span class="case-evidence-list">' + links.join('') + '</span>' : '<span class="case-muted-text">Not recorded</span>';
}

function caseLayoutDuration(record) {`,
  );

  text = text.replace(
    "    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type).toUpperCase()) + '</strong>')\n",
    "    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type).toUpperCase()) + '</strong>')\n"
      + "    + caseLayoutRow('Appealable', '<strong>' + (record.appealable ? 'Yes' : 'No') + '</strong>')\n",
  );

  text = text.replace(
    "    + caseLayoutRow('Evidence', record.evidence ? '<span class=\"case-linkish\">' + escapeHtml(record.evidence) + '</span>' : '<span class=\"case-muted-text\">Not recorded</span>')",
    "    + caseLayoutRow('Evidence', caseLayoutEvidence(record))",
  );

  text = text.replace(
    "'.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }',",
    "'.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }',\n"
      + "    '.case-evidence-list { display: flex; flex-wrap: wrap; gap: 8px 14px; }',",
  );

  return text;
}

function patchData(filePath, data, options) {
  if (!samePath(filePath)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchModeratorJs(original);
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithSanctionCaseUi(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithSanctionCaseUi(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchModeratorJs };
    }],
    ["024-spam-automod-admin-ui.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const MARKER = 'coinSpriteSpamAutoModAdminV1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function replaceRequired(text, search, replacement) {
  if (!text.includes(search)) throw new Error('Spam AutoMod admin patch anchor was not found.');
  return text.replace(search, replacement);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = replaceRequired(
    text,
    '    auto: {\n      link: {',
    `    auto: {
      /* ${MARKER} */
      spam: {
        enabled: false,
        messages: { enabled: true, count: 6, durationSeconds: 5 },
        lines: { enabled: true, maxLines: 12 },
        mentions: { enabled: true, maxMentions: 6 },
        deleteMessage: true,
        action: 'timeout',
        timeoutSeconds: 300,
      },
      link: {`,
  );

  text = replaceRequired(
    text,
    '    const link = config.moderation?.auto?.link || {};\n',
    `    const link = config.moderation?.auto?.link || {};
    const spam = config.moderation?.auto?.spam || {};
`,
  );

  text = replaceRequired(
    text,
    '      auto: {\n        link: {',
    `      auto: {
        spam: {
          enabled: Boolean(spam.enabled),
          messages: {
            enabled: spam.messages?.enabled !== false,
            count: Math.max(2, Math.min(50, Math.round(Number(spam.messages?.count) || 6))),
            durationSeconds: Math.max(1, Math.min(120, Math.round(Number(spam.messages?.durationSeconds) || 5))),
          },
          lines: {
            enabled: spam.lines?.enabled !== false,
            maxLines: Math.max(2, Math.min(100, Math.round(Number(spam.lines?.maxLines) || 12))),
          },
          mentions: {
            enabled: spam.mentions?.enabled !== false,
            maxMentions: Math.max(2, Math.min(100, Math.round(Number(spam.mentions?.maxMentions) || 6))),
          },
          deleteMessage: spam.deleteMessage !== false,
          action: ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout',
          timeoutSeconds: Math.max(60, Math.min(2419200, Math.round(Number(spam.timeoutSeconds) || 300))),
          excludeChannelIds: uniqueIds(spam.excludeChannelIds),
          excludeRoleIds: uniqueIds(spam.excludeRoleIds),
          logChannelId: String(spam.logChannelId || ''),
        },
        link: {`,
  );

  const start = text.indexOf('  function renderAutoPanel() {');
  const end = text.indexOf('\n\nfunction caseStats()', start);
  if (start < 0 || end < 0) throw new Error('Spam AutoMod render anchor was not found.');
  const render = `  function renderSpamPanel() {
    const spam = moderatorState.auto.spam;
    return '<div class="panel moderator-ai-panel">'
      + '<div class="panel-heading"><h3>Spam moderation</h3><p>Detect message bursts, excessive line counts, and mass mentions.</p></div>'
      + '<label class="checkline"><input id="spamAutoEnabled" type="checkbox" ' + (spam.enabled ? 'checked' : '') + '> Enable Spam Auto-Moderator</label>'
      + '<div class="automod-action-list">'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamMessagesEnabled" type="checkbox" ' + (spam.messages.enabled ? 'checked' : '') + '> Message burst</label><label>Messages <input id="spamMessageCount" type="number" min="2" max="50" value="' + spam.messages.count + '"></label><label>Duration seconds <input id="spamMessageSeconds" type="number" min="1" max="120" value="' + spam.messages.durationSeconds + '"></label></div>'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamLinesEnabled" type="checkbox" ' + (spam.lines.enabled ? 'checked' : '') + '> Excessive lines</label><label>Maximum lines <input id="spamMaxLines" type="number" min="2" max="100" value="' + spam.lines.maxLines + '"></label></div>'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamMentionsEnabled" type="checkbox" ' + (spam.mentions.enabled ? 'checked' : '') + '> Mass mention</label><label>Trigger at mentions <input id="spamMaxMentions" type="number" min="2" max="100" value="' + spam.mentions.maxMentions + '"></label></div>'
      + '</div><div class="settings-grid">'
      + '<label>Action <select id="spamAction">' + ['none', 'warn', 'timeout'].map((value) => '<option value="' + value + '" ' + (spam.action === value ? 'selected' : '') + '>' + value + '</option>').join('') + '</select></label>'
      + (spam.action === 'timeout' ? '<label>Timeout seconds <input id="spamTimeoutSeconds" type="number" min="60" max="2419200" value="' + spam.timeoutSeconds + '"></label>' : '')
      + '<label class="checkline"><input id="spamDeleteMessage" type="checkbox" ' + (spam.deleteMessage ? 'checked' : '') + '> Delete triggering message</label>'
      + '</div></div>';
  }

  function renderAutoPanel() {
    const link = moderatorState.auto.link;
    return '<div class="automod-grid">'
      + '<div class="automod-module-card active"><strong>Link</strong><span>' + (link.enabled ? 'Enabled' : 'Disabled') + ' · ' + (link.actions.map((action) => action.type).join(', ') || 'no actions') + '</span></div>'
      + renderLinkPanel() + '</div>';
  }

  function renderTextPanel() {
    const spam = moderatorState.auto.spam;
    return '<div class="automod-grid">'
      + '<div class="automod-module-card active"><strong>Spam</strong><span>' + (spam.enabled ? 'Enabled' : 'Disabled') + ' · burst, lines, mentions</span></div>'
      + renderSpamPanel() + '</div>';
  }`;
  text = text.slice(0, start) + render + text.slice(end);

  text = replaceRequired(
    text,
    "    const autoTabs = [['ai', 'AI Moderation'], ['auto', 'Link Moderation']];",
    "    const autoTabs = [['ai', 'AI Moderation'], ['auto', 'Link'], ['text', 'Text']];",
  );

  text = replaceRequired(
    text,
    "    let panel = moderatorState.view === 'ai' ? renderAiPanel()\n"
      + "      : moderatorState.view === 'auto' ? renderAutoPanel()\n"
      + "        : moderatorState.view === 'warnings' ? renderWarningsPanel()\n"
      + "          : renderCasesPanel();",
    "    let panel = moderatorState.view === 'ai' ? renderAiPanel()\n"
      + "      : moderatorState.view === 'auto' ? renderAutoPanel()\n"
      + "        : moderatorState.view === 'text' ? renderTextPanel()\n"
      + "          : moderatorState.view === 'warnings' ? renderWarningsPanel()\n"
      + "            : renderCasesPanel();",
  );

  text = replaceRequired(
    text,
    "moderatorState.view = ['warnings', 'auto', 'ai', 'cases'].includes(view)",
    "moderatorState.view = ['warnings', 'auto', 'text', 'ai', 'cases'].includes(view)",
  );

  text = replaceRequired(
    text,
    '<strong>Auto Moderation</strong><span>AI and link controls</span>',
    '<strong>Auto Moderation</strong><span>AI, link, and text controls</span>',
  );

  const snapshotStart = text.indexOf('  function autoSnapshot() {');
  const snapshotEnd = text.indexOf('\n  ensureModeratorTab();', snapshotStart);
  if (snapshotStart < 0 || snapshotEnd < 0) throw new Error('Spam AutoMod snapshot anchor was not found.');
  const oldSnapshot = text.slice(snapshotStart, snapshotEnd);
  const newSnapshot = oldSnapshot.replace(
    '    return {\n      link: {',
    `    const spam = moderatorState.auto.spam;
    return {
      spam: {
        enabled: Boolean(spam.enabled),
        messages: {
          enabled: Boolean(spam.messages.enabled),
          count: Math.max(2, Math.min(50, Math.round(Number(spam.messages.count) || 6))),
          durationSeconds: Math.max(1, Math.min(120, Math.round(Number(spam.messages.durationSeconds) || 5))),
        },
        lines: {
          enabled: Boolean(spam.lines.enabled),
          maxLines: Math.max(2, Math.min(100, Math.round(Number(spam.lines.maxLines) || 12))),
        },
        mentions: {
          enabled: Boolean(spam.mentions.enabled),
          maxMentions: Math.max(2, Math.min(100, Math.round(Number(spam.mentions.maxMentions) || 6))),
        },
        deleteMessage: Boolean(spam.deleteMessage),
        action: ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout',
        timeoutSeconds: Math.max(60, Math.min(2419200, Math.round(Number(spam.timeoutSeconds) || 300))),
        excludeChannelIds: uniqueIds(spam.excludeChannelIds),
        excludeRoleIds: uniqueIds(spam.excludeRoleIds),
        logChannelId: spam.logChannelId || '',
      },
      link: {`,
  );
  if (oldSnapshot === newSnapshot) throw new Error('Spam AutoMod snapshot was not patched.');
  text = text.slice(0, snapshotStart) + newSnapshot + text.slice(snapshotEnd);

  const inputAnchor = `    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationMaxInputChars')`;
  text = replaceRequired(
    text,
    inputAnchor,
    `    const link = moderatorState.auto.link;
    const spam = moderatorState.auto.spam;
    if (event.target.id === 'spamMessageCount') spam.messages.count = Number(event.target.value) || 6;
    if (event.target.id === 'spamMessageSeconds') spam.messages.durationSeconds = Number(event.target.value) || 5;
    if (event.target.id === 'spamMaxLines') spam.lines.maxLines = Number(event.target.value) || 12;
    if (event.target.id === 'spamMaxMentions') spam.mentions.maxMentions = Number(event.target.value) || 6;
    if (event.target.id === 'spamTimeoutSeconds') spam.timeoutSeconds = Number(event.target.value) || 300;
    if (event.target.id === 'moderationMaxInputChars')`,
  );

  const changeAnchor = `    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationAiEnabled')`;
  text = replaceRequired(
    text,
    changeAnchor,
    `    const link = moderatorState.auto.link;
    const spam = moderatorState.auto.spam;
    if (event.target.id === 'spamAutoEnabled') spam.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamMessagesEnabled') spam.messages.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamLinesEnabled') spam.lines.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamMentionsEnabled') spam.mentions.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamDeleteMessage') spam.deleteMessage = Boolean(event.target.checked);
    if (event.target.id === 'spamAction') spam.action = event.target.value;
    if (event.target.id === 'moderationAiEnabled')`,
  );

  text = replaceRequired(
    text,
    "if (['moderationAiEnabled', 'warningsEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode'].includes(event.target.id)",
    "if (['moderationAiEnabled', 'warningsEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode', 'spamAction'].includes(event.target.id)",
  );

  return text;
}

function patchData(filePath, data, options) {
  if (!samePath(filePath)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchModeratorJs(original);
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithSpamAutoMod(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithSpamAutoMod(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchModeratorJs };
    }],
    ["025-community-messages-admin.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'index.html');
const SCRIPT = [
  '  <script src="/admin/rich-message-editor.js?v=rich-editor-3" defer></script>',
  '  <script src="/admin/community-messages.js?v=community-messages-3" defer></script>',
].join('\\n');
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function patchIndex(source) {
  const text = String(source || '');
  if (text.includes('/admin/rich-message-editor.js') && text.includes('/admin/community-messages.js')) return text;
  return text.replace('</body>', SCRIPT + '\n</body>');
}

function patchData(filePath, data, options) {
  if (!samePath(filePath)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchIndex(original);
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCommunityMessages(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithCommunityMessages(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchIndex };
    }],
    ["026-appeal-admin-ui.js", function (module, exports, require, __filename, __dirname) {

'use strict';

const fs = require('fs');
const path = require('path');

const MODERATOR_TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const INDEX_TARGET = path.join(__dirname, '..', 'admin', 'index.html');
const MARKER = 'coinsprite-appeal-workspace-v1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function same(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function required(text, from, to) {
  if (!text.includes(from)) throw new Error('Appeal admin patch anchor was not found: ' + from.slice(0, 80));
  return text.replace(from, to);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;
  text = required(
    text,
    "    const moderationTabs = [['warnings', 'Warn System'], ['cases', 'Cases']];\n    const tabs = moderatorState.workspace === 'auto' ? autoTabs : moderationTabs;",
    "    const moderationTabs = [['warnings', 'Warn System'], ['logging', 'Logging'], ['cases', 'Cases']];\n    const appealTabs = [['appeal-settings', 'Settings'], ['appeal-form', 'Form'], ['appeal-message', 'Message']];\n    const tabs = moderatorState.workspace === 'auto' ? autoTabs : moderatorState.workspace === 'appeal' ? appealTabs : moderationTabs; /* " + MARKER + " */",
  );
  text = required(
    text,
    "    let panel = moderatorState.view === 'ai' ? renderAiPanel()\n      : moderatorState.view === 'auto' ? renderAutoPanel()\n        : moderatorState.view === 'text' ? renderTextPanel()\n          : moderatorState.view === 'warnings' ? renderWarningsPanel()\n            : renderCasesPanel();",
    "    let panel = moderatorState.workspace === 'appeal' ? '<div id=\"appealAdminRoot\"></div>'\n      : moderatorState.view === 'ai' ? renderAiPanel()\n        : moderatorState.view === 'auto' ? renderAutoPanel()\n          : moderatorState.view === 'text' ? renderTextPanel()\n            : moderatorState.view === 'warnings' ? renderWarningsPanel()\n            : moderatorState.view === 'logging' ? renderLoggingPanel()\n              : renderCasesPanel();",
  );
  text = required(
    text,
    '<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'moderation\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="moderation"><strong>Moderation</strong><span>Warnings and cases</span></button></nav>',
    '<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'moderation\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="moderation"><strong>Moderation</strong><span>Warnings and cases</span></button>\'\n      + \'<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'appeal\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="appeal"><strong>Appeal</strong><span>Forms and review messages</span></button></nav>',
  );
  text = required(
    text,
    "    if (moderatorState.view === 'cases' && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);",
    "    if (moderatorState.view === 'cases' && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);\n    if (moderatorState.workspace === 'appeal') queueMicrotask(() => window.CoinSpriteAppealAdmin?.mount(root.querySelector('#appealAdminRoot'), document.querySelector('#guildSelect')?.value, moderatorState.view));",
  );
  text = required(
    text,
    "      moderatorState.workspace = workspace === 'moderation' ? 'moderation' : 'auto';\n      moderatorState.view = moderatorState.workspace === 'moderation' ? 'warnings' : 'ai';",
    "      moderatorState.workspace = ['auto', 'moderation', 'appeal'].includes(workspace) ? workspace : 'auto';\n      moderatorState.view = moderatorState.workspace === 'moderation' ? 'warnings' : moderatorState.workspace === 'appeal' ? 'appeal-settings' : 'ai';",
  );
  text = required(
    text,
    "moderatorState.view = ['warnings', 'auto', 'text', 'ai', 'cases'].includes(view) ? view : (moderatorState.workspace === 'auto' ? 'ai' : 'warnings');",
    "moderatorState.view = ['warnings', 'logging', 'auto', 'text', 'ai', 'cases', 'appeal-settings', 'appeal-form', 'appeal-message'].includes(view) ? view : (moderatorState.workspace === 'auto' ? 'ai' : moderatorState.workspace === 'appeal' ? 'appeal-settings' : 'warnings');",
  );
  const basicNotesAnchor = "+ '<label>Private staff notes <textarea data-case-field=\"staffNotes\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</div>'";
  if (text.includes(basicNotesAnchor)) {
    text = text.replace(
      basicNotesAnchor,
      "+ '<label>Public moderator note <textarea data-case-field=\"publicNote\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.publicNote || '') + '</textarea></label>'\n    + '<label>Private staff notes <textarea data-case-field=\"staffNotes\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</div>'",
    );
  } else {
    const composedNotesAnchor = "    + '<section class=\"panel case-notes-panel\">";
    text = required(
      text,
      composedNotesAnchor,
      "    + '<section class=\"panel case-notes-panel\"><div class=\"case-panel-title\"><span>◎</span><div><h3>Public moderator note</h3></div></div><label class=\"case-field-block\"><span>Note</span><textarea data-case-field=\"publicNote\" maxlength=\"1000\" rows=\"4\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.publicNote || '') + '</textarea></label></section>'\n" + composedNotesAnchor,
    );
  }
  text = text.replace('<h3>Point-based warnings</h3>', '<h3>Warning system</h3>');
  text = text.replace('      <label>Points <input id="warningCreatePoints" type="number" min="1" max="10" value="1"></label>\n', '');
  text = text.replace('<label>Expires <input id="warningCreateExpires" placeholder="90d, 4w, or never"></label>', '<label>Time <input id="warningCreateExpires" placeholder="30m, 7d, 4w, or permanent"></label>');
  text = text.replace('      <label>Evidence URL <input id="warningCreateEvidence" type="url" placeholder="https://discord.com/channels/..."></label>', '      <label>Evidence URL <input id="warningCreateEvidence" type="url" placeholder="https://discord.com/channels/..."></label>\n      <label class="checkline"><input id="warningCreateAppealable" type="checkbox" checked> Appealable</label>');
  text = text.replace("            points: Number(document.querySelector('#warningCreatePoints')?.value) || 1,\n", '');
  text = text.replace("            evidence: document.querySelector('#warningCreateEvidence')?.value || '',", "            evidence: document.querySelector('#warningCreateEvidence')?.value || '',\n            appealable: Boolean(document.querySelector('#warningCreateAppealable')?.checked),");
  if (!text.includes('function renderLoggingPanel()')) {
    const warningsAnchor = 'function renderWarningsPanel() {';
    const loggingRenderer = `function renderLoggingPanel() {
  return \`<div class="panel moderator-ai-panel moderation-logging-panel">
    <div class="panel-heading"><h3>Moderation channel logging</h3><p>Route manual warnings, mutes, kicks, and bans to staff channels. Logs use <strong>Default: Moderation action log</strong> from Messages and include an evidence gallery when files are attached.</p></div>
    <div class="settings-grid">
      <div class="picker-field"><span class="field-label">Action log channel</span><div id="moderationActionLogChannelMount"></div></div>
      <div class="picker-field"><span class="field-label">Warning log channel</span><div id="warningLoggingChannelMount"></div></div>
    </div>
    <div class="moderator-template-note">The action log covers mute, kick, and ban. Warning logs may use a separate channel. Leave either field empty to disable that event log.</div>
  </div>\`;
}`;
    text = required(text, warningsAnchor, loggingRenderer + '\n\n' + warningsAnchor);
  }
  return text;
}

function patchIndex(source) {
  const text = String(source || '');
  if (text.includes('/admin/appeals.js')) return text;
  return text.replace('</body>', '  <script src="/admin/appeals.js?v=appeals-2" defer></script>\n</body>');
}

function patchData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = same(filePath, MODERATOR_TARGET) ? patchModeratorJs(original)
    : same(filePath, INDEX_TARGET) ? patchIndex(original)
      : original;
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithAppeals(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};
fs.readFileSync = function readFileSyncWithAppeals(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchIndex, patchModeratorJs };
    }],
  ];
  for (const [name, factory] of fixes) {
    const filename = require('path').join(__dirname, '..', 'commands', name);
    const fixModule = new ConsolidatedFixModule(filename, module);
    fixModule.filename = filename;
    fixModule.paths = ConsolidatedFixModule._nodeModulePaths(require('path').dirname(filename));
    require.cache[filename] = fixModule;
    factory.call(fixModule.exports, fixModule, fixModule.exports, fixModule.require.bind(fixModule), filename, require('path').dirname(filename));
    fixModule.loaded = true;
  }
})();
