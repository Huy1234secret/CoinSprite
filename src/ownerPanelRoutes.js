const fs = require('fs');
const path = require('path');
const {
  getConfiguredGuildIds,
  getDisabledGuilds,
  getGuildConfigRaw,
  setGuildEnabled,
} = require('./serverConfig');
const { getOwnerConsoleEntries, logCommandSystem } = require('./commandLogger');
const { getRuntimeMetrics } = require('./runtimeMetrics');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const STORAGE_CACHE_MS = 5_000;
let storageCache = { sampledAt: 0, bytes: 0 };

function ownerIdSet() {
  const raw = [
    process.env.OWNER_USER_IDS,
    process.env.BOT_OWNER_IDS,
    process.env.ADMIN_OWNER_IDS,
    process.env.OWNER_ID,
    process.env.BOT_OWNER_ID,
  ].filter(Boolean).join(',');

  return new Set(raw.split(/[\s,]+/).filter((id) => /^\d{16,20}$/.test(id)));
}

function isOwnerSession(session, client) {
  const userId = String(session?.user?.id || '');
  if (!/^\d{16,20}$/.test(userId)) return false;
  if (ownerIdSet().has(userId)) return true;

  const applicationOwner = client?.application?.owner;
  return applicationOwner?.id === userId || applicationOwner?.members?.has?.(userId) === true;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function directoryBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return total + directoryBytes(target);
    try {
      return total + fs.statSync(target).size;
    } catch {
      return total;
    }
  }, 0);
}

function addGuildRecord(records, keyOrGuild, maybeGuild = null) {
  const guild = maybeGuild?.id ? maybeGuild : (typeof keyOrGuild === 'object' ? keyOrGuild : null);
  const candidate = typeof keyOrGuild === 'string' ? keyOrGuild : keyOrGuild?.id;
  const id = /^\d{16,20}$/.test(String(candidate || '')) ? String(candidate) : String(guild?.id || '');
  if (!/^\d{16,20}$/.test(id)) return;
  records.set(id, guild || records.get(id) || { id });
}

function addGuildRecords(records, value) {
  if (!value) return;
  if (typeof value.entries === 'function') {
    for (const [key, guild] of value.entries()) addGuildRecord(records, key, guild);
    return;
  }
  for (const [key, guild] of Object.entries(value)) addGuildRecord(records, key, guild);
}

async function collectOwnerGuildRecords(client, configuredIds = []) {
  const records = new Map();
  for (const id of configuredIds) addGuildRecord(records, id);
  addGuildRecords(records, client?.guilds?.cache);
  const fetched = await client?.guilds?.fetch?.().catch(() => null);
  addGuildRecords(records, fetched);
  addGuildRecords(records, client?.guilds?.cache);
  return records;
}

async function collectOwnerGuildIds(client, configuredIds = []) {
  return new Set((await collectOwnerGuildRecords(client, configuredIds)).keys());
}

async function guildSummary(client, id, fallback, disabledGuilds) {
  const guild = client.guilds.cache.get(id) || await client.guilds.fetch(id).catch(() => null);
  const source = guild || fallback || { id };
  const config = getGuildConfigRaw(id);
  const gag2Stock = config?.gag2Stock || {};
  const channels = gag2Stock.channels || {};
  const configuredChannels = Object.values(channels).filter(Boolean).length;
  const configBytes = Buffer.byteLength(JSON.stringify(config || {}));

  return {
    id,
    name: source.name || `Guild ${id}`,
    iconURL: source.iconURL?.({ extension: 'png', size: 64 }) || source.iconURL || null,
    ownerId: guild?.ownerId || null,
    totalUsers: Number(guild?.memberCount || source.approximateMemberCount || 0),
    enabled: config?.enabled !== false,
    disabled: disabledGuilds[id] || null,
    partial: !guild,
    stock: {
      enabled: gag2Stock.enabled !== false,
      configuredChannels,
      totalChannels: Object.keys(channels).length,
      rolesSyncedAt: gag2Stock.rolesSyncedAt || '',
    },
    storage: { bytes: configBytes, label: formatBytes(configBytes) },
  };
}

async function ownerOverview(client) {
  const configuredIds = getConfiguredGuildIds({ includeDisabled: true });
  const records = await collectOwnerGuildRecords(client, configuredIds);
  const disabledGuilds = getDisabledGuilds();
  const guilds = (await Promise.all(
    [...records].map(([id, fallback]) => guildSummary(client, id, fallback, disabledGuilds)),
  )).sort((a, b) => a.name.localeCompare(b.name));
  const memory = process.memoryUsage();
  const storageBytes = directoryBytes(DATA_DIR) + directoryBytes(LOGS_DIR);
  storageCache = { sampledAt: Date.now(), bytes: storageBytes };

  return {
    bot: {
      tag: client.user?.tag || 'Unknown',
      id: client.user?.id || '',
      pingMs: Math.max(0, Math.round(client.ws?.ping || 0)),
      uptimeMs: Math.round(process.uptime() * 1000),
      guildCount: guilds.length,
      totalUsers: guilds.reduce((total, guild) => total + guild.totalUsers, 0),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        rssLabel: formatBytes(memory.rss),
        heapUsedLabel: formatBytes(memory.heapUsed),
      },
      metrics: getRuntimeMetrics(),
    },
    storage: { bytes: storageBytes, label: formatBytes(storageBytes) },
    guilds,
  };
}

function ownerLiveMetrics(nowMs = Date.now()) {
  if (nowMs - storageCache.sampledAt >= STORAGE_CACHE_MS) {
    storageCache = {
      sampledAt: nowMs,
      bytes: directoryBytes(DATA_DIR) + directoryBytes(LOGS_DIR),
    };
  }
  const memory = process.memoryUsage();
  return {
    sampledAt: new Date(nowMs).toISOString(),
    heap: { bytes: memory.heapUsed, label: formatBytes(memory.heapUsed) },
    storage: { bytes: storageCache.bytes, label: formatBytes(storageCache.bytes) },
    runtime: getRuntimeMetrics(),
  };
}

async function getGuild(client, guildId) {
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function notifyGuildOwner(guild, reason, actorId) {
  const owner = await guild.fetchOwner().catch(() => null);
  const content = [
    `CoinSprite GAG stock has been disabled in **${guild.name}**.`,
    `Reason: ${reason}`,
    `Actioned by owner panel user ${actorId}.`,
  ].join('\n');
  if (owner && await owner.send({ content }).then(() => true).catch(() => false)) return 'dm';

  const fallback = guild.systemChannel;
  if (fallback?.isTextBased?.() && await fallback.send({ content }).then(() => true).catch(() => false)) return 'channel';
  return 'failed';
}

async function handleOwnerOverview(req, res, client, deps) {
  deps.sendJson(res, 200, await ownerOverview(client));
}

async function handleOwnerMetrics(req, res, client, session, deps) {
  deps.sendJson(res, 200, ownerLiveMetrics());
}

async function handleOwnerConsole(req, res, url, client, session, deps) {
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  deps.sendJson(res, 200, getOwnerConsoleEntries({ after, limit }));
}

async function handleOwnerDisable(req, res, client, guildId, session, deps) {
  const body = await deps.readJsonBody(req);
  const reason = String(body?.reason || '').trim().slice(0, 500);
  if (!reason) return deps.sendJson(res, 400, { error: 'Reason is required.' });
  const guild = await getGuild(client, guildId);
  if (!guild) return deps.sendJson(res, 404, { error: 'Guild is not available to the bot.' });

  const result = setGuildEnabled(guildId, false, {
    reason,
    disabledBy: session.user.id,
    disabledAt: Date.now(),
    guildName: guild.name,
  });
  await guild.commands.set([]).catch(() => null);
  const notification = await notifyGuildOwner(guild, reason, session.user.id);
  logCommandSystem(`Owner ${session.user.id} disabled GAG stock for guild ${guildId}. Notification: ${notification}.`);
  return deps.sendJson(res, 200, { guildId, disabled: result.disabled, notification });
}

async function handleOwnerEnable(req, res, client, guildId, session, deps) {
  const guild = await getGuild(client, guildId);
  if (!guild) return deps.sendJson(res, 404, { error: 'Guild is not available to the bot.' });

  const result = setGuildEnabled(guildId, true, {});
  await guild.commands.set([]).catch(() => null);
  logCommandSystem(`Owner ${session.user.id} enabled GAG stock for guild ${guildId}.`);
  return deps.sendJson(res, 200, { guildId, config: result.config });
}

module.exports = {
  collectOwnerGuildIds,
  collectOwnerGuildRecords,
  handleOwnerConsole,
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerMetrics,
  handleOwnerOverview,
  isOwnerSession,
  ownerLiveMetrics,
};
