const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const levelingStore = require('./levelingStore');
const ticketSystemStore = require('./ticketSystemStore');
const messageTemplates = require('./messageTemplates');
const {
  getConfiguredGuildIds,
  getDisabledGuilds,
  getGuildConfigRaw,
  loadState,
  setGuildEnabled,
} = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');

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

function dataUsageForGuild(guildId) {
  const levelingState = levelingStore.loadState();
  const levelingGuild = levelingState.guilds?.[guildId] || {};
  const ticketState = ticketSystemStore.loadState();
  const templates = messageTemplates.listTemplates(guildId);
  return {
    levelingUsers: Object.keys(levelingGuild.users || {}).length,
    messagesTracked: Object.values(levelingGuild.users || {}).reduce((sum, user) => sum + (Number(user?.messages) || 0), 0),
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

async function guildSummary(client, guildId, disabledRecords) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const owner = guild.ownerId ? null : await guild.fetchOwner().catch(() => null);
  const config = getGuildConfigRaw(guild.id);
  const storage = dataFileBytesForGuild(guild.id);
  const usage = dataUsageForGuild(guild.id);
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
    disabled: disabledRecords[guild.id] || null,
    usage,
    storage: {
      ...storage,
      label: formatBytes(storage.totalBytes),
    },
  };
}

async function ownerOverview(client) {
  await client.guilds.fetch().catch(() => null);
  const disabledRecords = getDisabledGuilds();
  const configuredIds = new Set(getConfiguredGuildIds({ includeDisabled: true }));
  const ids = new Set([...client.guilds.cache.keys(), ...configuredIds]);
  const guilds = (await Promise.all([...ids].map((id) => guildSummary(client, id, disabledRecords)))).filter(Boolean);
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
    storage: globalStorage(),
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
  const slashCommands = client.commands?.map?.((command) => command.data?.toJSON?.()).filter(Boolean) || [];
  await guild.commands.set(slashCommands).catch((error) => logCommandSystem(`Failed to restore commands for enabled guild ${guild.id}: ${error?.message ?? 'unknown error'}`));
  logCommandSystem(`Owner ${adminUserId} enabled guild ${guild.id}.`);
  return { guildId: guild.id, config: result.config };
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

module.exports = {
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerOverview,
  isOwnerSession,
};
