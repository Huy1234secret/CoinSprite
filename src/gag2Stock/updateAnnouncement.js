const { MessageFlags } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  ensureGuildConfig,
  getGuildConfig,
  isGuildGag2StockEnabled,
} = require('../serverConfig');
const { colorForType, emojiForType } = require('./catalog');
const { STATE_PATH } = require('./config');
const { syncGag2StockGuildSetup } = require('./manager');
const { syncGag2RoleAssignmentPanel } = require('./roleAssignment');
const { loadState, saveState } = require('./stateStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const UPDATE_ID = 'gag2-update-3-eclipse-bloom';
const ECLIPSE_BLOOM_KEY = 'eclipse_bloom';

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function buildEclipseBloomUpdatePayload(roleId = '') {
  const cleanRoleId = cleanDiscordId(roleId);
  const display = cleanRoleId ? `<@&${cleanRoleId}>` : 'Eclipse Bloom';
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: cleanRoleId
      ? { parse: [], users: [], roles: [cleanRoleId] }
      : { parse: [], users: [], roles: [] },
    components: [{
      type: 17,
      accent_color: colorForType('sell', { key: ECLIPSE_BLOOM_KEY }),
      components: [{
        type: 10,
        content: [
          '### Update 3',
          `- Added new Secret seed to Sell Price Track: ${emojiForType('sell', { key: ECLIPSE_BLOOM_KEY })} **${display}**.`,
          '- Added **Secret 2x** and **Secret 4x** notification roles.',
          '- Removed unreleased **Briar Rose** from sell-price tracking.',
        ].join('\n'),
      }],
    }],
  };
}

async function collectGuilds(client) {
  const ids = new Set(client?.guilds?.cache?.keys?.() || []);
  const fetched = await client?.guilds?.fetch?.().catch(() => null);
  if (typeof fetched?.keys === 'function') for (const guildId of fetched.keys()) ids.add(guildId);
  const guilds = [];
  for (const guildId of ids) {
    const guild = client?.guilds?.cache?.get?.(guildId)
      || await client?.guilds?.fetch?.(guildId).catch(() => null);
    if (guild?.id && guild?.channels && guild?.roles) guilds.push(guild);
  }
  return guilds;
}

async function sendableChannel(guild, channelId) {
  const id = cleanDiscordId(channelId);
  if (!id) return null;
  const channel = guild?.channels?.cache?.get?.(id) || await guild?.channels?.fetch?.(id).catch(() => null);
  return channel?.isTextBased?.() && typeof channel.send === 'function' ? channel : null;
}

async function updateChannelForGuild(guild, config) {
  const channels = config?.gag2Stock?.channels || {};
  return await sendableChannel(guild, channels.updates)
    || await sendableChannel(guild, channels.seed);
}

function announcementRecord(state, guildId) {
  return state?.updateAnnouncements?.[UPDATE_ID]?.[guildId] || null;
}

function saveAnnouncementRecord(guildId, record, statePath = STATE_PATH) {
  const state = loadState(statePath);
  state.updateAnnouncements ||= {};
  state.updateAnnouncements[UPDATE_ID] ||= {};
  state.updateAnnouncements[UPDATE_ID][guildId] = record;
  saveState(state, statePath);
}

async function announceEclipseBloomUpdate(client, guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  if (announcementRecord(loadState(statePath), guild.id)) return null;
  ensureGuildConfig(guild.id);
  if (!isGuildGag2StockEnabled(guild.id)) return null;

  await syncGag2StockGuildSetup(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 Eclipse Bloom role sync failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });
  await syncGag2RoleAssignmentPanel(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 Eclipse Bloom role panel refresh failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });

  const config = getGuildConfig(guild.id);
  const channel = await updateChannelForGuild(guild, config);
  if (!channel) return null;
  const roleId = cleanDiscordId(config?.gag2Stock?.roleIds?.seed?.[ECLIPSE_BLOOM_KEY]);
  const message = await channel.send(buildEclipseBloomUpdatePayload(roleId));
  saveAnnouncementRecord(guild.id, {
    channelId: channel.id,
    messageId: message.id,
    sentAt: new Date(options.now?.() || Date.now()).toISOString(),
  }, statePath);
  logCommandSystem(`GAG2 Update 3 announced in guild ${guild.id}: ${channel.id}`);
  return message;
}

async function startGag2UpdateAnnouncement(client, options = {}) {
  for (const guild of await collectGuilds(client)) {
    await announceEclipseBloomUpdate(client, guild, options).catch((error) => {
      logCommandSystem(`GAG2 Update 3 failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    });
  }
}

module.exports = {
  ECLIPSE_BLOOM_KEY,
  UPDATE_ID,
  announceEclipseBloomUpdate,
  buildEclipseBloomUpdatePayload,
  collectGuilds,
  startGag2UpdateAnnouncement,
  updateChannelForGuild,
};
