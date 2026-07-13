const path = require('path');
const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const { readJsonFile, writeJsonAtomic } = require('../jsonFileStore');
const {
  ensureGuildConfig,
  getGuildConfig,
  updateGuildGag2StockChannel,
} = require('../serverConfig');
const { colorForType, emojiForType, roleSpecsForType } = require('./catalog');
const { syncGag2StockGuildSetup } = require('./manager');
const { syncGag2RoleAssignmentPanel } = require('./roleAssignment');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const UPDATE_CHANNEL_KEY = 'updates';
const UPDATE_CHANNEL_NAME = 'Bot Update';
const UPDATE_ID = 'gag2-update-1';
const UPDATE_ANNOUNCEMENT_AT_MS = Date.parse('2026-07-12T23:00:00.000Z');
const UPDATE_RETRY_MS = 60_000;
const UPDATE_SEED_KEYS = Object.freeze(['sun_bloom', 'star_fruit']);
const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'gag2-update-rollout.json');
const NO_MENTIONS = { parse: [], users: [], roles: [] };

let rolloutTimer = null;

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function defaultRolloutState() {
  return { version: 1, updateId: UPDATE_ID, guilds: {} };
}

function loadRolloutState(filePath = STATE_PATH) {
  const parsed = readJsonFile(filePath, { fallback: defaultRolloutState, label: 'GAG2 update rollout state' });
  if (!parsed || typeof parsed !== 'object' || parsed.updateId !== UPDATE_ID) return defaultRolloutState();
  return {
    ...defaultRolloutState(),
    ...parsed,
    guilds: parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {},
  };
}

function saveRolloutState(state, filePath = STATE_PATH) {
  const next = {
    ...defaultRolloutState(),
    ...(state && typeof state === 'object' ? state : {}),
    version: 1,
    updateId: UPDATE_ID,
  };
  writeJsonAtomic(filePath, next);
  return next;
}

async function sendableChannel(guild, channelId) {
  const id = cleanDiscordId(channelId);
  if (!id) return null;
  const channel = guild?.channels?.cache?.get?.(id) || await guild?.channels?.fetch?.(id).catch(() => null);
  return channel?.isTextBased?.() && typeof channel.send === 'function' ? channel : null;
}

function setGuildRecord(state, guildId, patch) {
  state.guilds[guildId] = { ...(state.guilds[guildId] || {}), ...patch };
  return state.guilds[guildId];
}

async function collectRolloutGuilds(client) {
  const guildIds = new Set(client?.guilds?.cache?.keys?.() || []);
  const fetched = await client?.guilds?.fetch?.().catch(() => null);
  if (typeof fetched?.keys === 'function') {
    for (const guildId of fetched.keys()) guildIds.add(guildId);
  }
  const guilds = [];
  for (const guildId of guildIds) {
    const guild = client?.guilds?.cache?.get?.(guildId)
      || await client?.guilds?.fetch?.(guildId).catch(() => null);
    if (guild?.id && guild?.channels && guild?.roles) guilds.push(guild);
  }
  return guilds;
}

async function provisionGuildUpdateChannel(guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  const state = loadRolloutState(statePath);
  const record = state.guilds[guild.id] || {};
  ensureGuildConfig(guild.id);

  const configuredId = cleanDiscordId(getGuildConfig(guild.id)?.gag2Stock?.channels?.[UPDATE_CHANNEL_KEY]);
  const configuredChannel = await sendableChannel(guild, configuredId);
  if (configuredChannel) {
    if (!record.provisionedAt) {
      setGuildRecord(state, guild.id, {
        channelId: configuredChannel.id,
        provisionedAt: new Date(options.now?.() || Date.now()).toISOString(),
        usedExistingChannel: true,
      });
      saveRolloutState(state, statePath);
    }
    return configuredChannel;
  }

  // A successful rollout is never repeated, even if an admin later removes
  // or deletes the channel. They can choose a replacement on the dashboard.
  if (record.provisionedAt) return null;

  const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageChannels)) {
    logCommandSystem(`GAG2 update channel skipped for guild ${guild.id}: bot lacks Manage Channels.`);
    return null;
  }

  const channel = await guild.channels.create({
    name: UPDATE_CHANNEL_NAME,
    type: ChannelType.GuildText,
    reason: 'CoinSprite one-time Bot Update alert rollout',
  }).catch((error) => {
    logCommandSystem(`GAG2 update channel create failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    return null;
  });
  if (!channel) return null;

  updateGuildGag2StockChannel(guild.id, UPDATE_CHANNEL_KEY, channel.id);
  setGuildRecord(state, guild.id, {
    channelId: channel.id,
    provisionedAt: new Date(options.now?.() || Date.now()).toISOString(),
    usedExistingChannel: false,
  });
  saveRolloutState(state, statePath);
  logCommandSystem(`Created one-time Bot Update channel for guild ${guild.id}: ${channel.id}`);
  return channel;
}

function buildUpdateAnnouncementPayload(roleIds = {}) {
  const specs = Object.fromEntries(roleSpecsForType('seed').map((spec) => [spec.key, spec]));
  const mentions = [];
  const itemText = UPDATE_SEED_KEYS.map((key) => {
    const spec = specs[key];
    const roleId = cleanDiscordId(roleIds[key]);
    if (roleId) mentions.push(roleId);
    const name = roleId ? `<@&${roleId}>` : spec.roleName;
    return `${emojiForType('seed', { key })} **${name}**`;
  });
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: mentions.length ? { parse: [], users: [], roles: mentions } : NO_MENTIONS,
    components: [{
      type: 17,
      accent_color: colorForType('seed', { key: 'sun_bloom' }),
      components: [{
        type: 10,
        content: `### Update 1\n- Added new seeds: ${itemText[0]} & ${itemText[1]}.`,
      }],
    }],
  };
}

async function prepareGuildForUpdate(client, guild, options = {}) {
  const channel = await provisionGuildUpdateChannel(guild, options);
  if (!channel) return null;
  await syncGag2StockGuildSetup(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 update role preparation failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });
  await syncGag2RoleAssignmentPanel(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 update role panel refresh failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });
  return channel;
}

async function announceGuildUpdate(client, guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  let state = loadRolloutState(statePath);
  const record = state.guilds[guild.id] || {};
  if (!record.provisionedAt || record.announcedAt) return Boolean(record.announcedAt);

  await syncGag2StockGuildSetup(client, guild.id).catch(() => null);
  await syncGag2RoleAssignmentPanel(client, guild.id).catch(() => null);
  const config = getGuildConfig(guild.id);
  const channel = await sendableChannel(guild, config?.gag2Stock?.channels?.[UPDATE_CHANNEL_KEY]);
  if (!channel) return false;

  const roleIds = config?.gag2Stock?.roleIds?.seed || {};
  const seedBound = Boolean(cleanDiscordId(config?.gag2Stock?.channels?.seed));
  if (seedBound && UPDATE_SEED_KEYS.some((key) => !cleanDiscordId(roleIds[key]))) {
    logCommandSystem(`GAG2 update announcement waiting for new seed roles in guild ${guild.id}.`);
    return false;
  }

  const message = await channel.send(buildUpdateAnnouncementPayload(roleIds)).catch((error) => {
    logCommandSystem(`GAG2 update announcement failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    return null;
  });
  if (!message) return false;

  state = loadRolloutState(statePath);
  setGuildRecord(state, guild.id, {
    announcementChannelId: channel.id,
    announcementMessageId: message.id,
    announcedAt: new Date(options.now?.() || Date.now()).toISOString(),
  });
  saveRolloutState(state, statePath);
  logCommandSystem(`GAG2 Update 1 announced in guild ${guild.id}: ${channel.id}`);
  return true;
}

async function runUpdateRollout(client, options = {}) {
  const now = options.now?.() || Date.now();
  const guilds = await collectRolloutGuilds(client);
  const state = loadRolloutState(options.statePath || STATE_PATH);
  for (const guild of guilds) {
    if (state.guilds[guild.id]?.announcedAt) continue;
    await prepareGuildForUpdate(client, guild, options).catch((error) => {
      logCommandSystem(`GAG2 update preparation failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    });
  }
  if (now < UPDATE_ANNOUNCEMENT_AT_MS) return false;
  for (const guild of guilds) await announceGuildUpdate(client, guild, options);
  return true;
}

function scheduleUpdateRollout(client, options = {}) {
  if (rolloutTimer) clearTimeout(rolloutTimer);
  const now = options.now?.() || Date.now();
  const delay = Math.max(0, UPDATE_ANNOUNCEMENT_AT_MS - now);
  rolloutTimer = setTimeout(async () => {
    rolloutTimer = null;
    await runUpdateRollout(client, options);
    const state = loadRolloutState(options.statePath || STATE_PATH);
    const guilds = await collectRolloutGuilds(client);
    const hasPending = guilds.some((guild) => !state.guilds[guild.id]?.announcedAt);
    if (hasPending) {
      rolloutTimer = setTimeout(() => scheduleUpdateRollout(client, { ...options, now: () => Date.now() }), UPDATE_RETRY_MS);
      rolloutTimer.unref?.();
    }
  }, delay);
  rolloutTimer.unref?.();
  return now + delay;
}

async function startGag2UpdateRollout(client, options = {}) {
  await runUpdateRollout(client, options);
  scheduleUpdateRollout(client, options);
}

module.exports = {
  STATE_PATH,
  UPDATE_ANNOUNCEMENT_AT_MS,
  UPDATE_CHANNEL_KEY,
  UPDATE_CHANNEL_NAME,
  UPDATE_ID,
  UPDATE_SEED_KEYS,
  announceGuildUpdate,
  buildUpdateAnnouncementPayload,
  collectRolloutGuilds,
  loadRolloutState,
  provisionGuildUpdateChannel,
  runUpdateRollout,
  saveRolloutState,
  scheduleUpdateRollout,
  startGag2UpdateRollout,
};
