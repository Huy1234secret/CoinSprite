const { MessageFlags } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  ensureGuildConfig,
  getGuildConfig,
  isGuildGag2StockEnabled,
} = require('../serverConfig');
const { emojiForType } = require('./catalog');
const {
  DEFAULT_GAG2_BROADCAST_CONCURRENCY,
  mapWithConcurrency,
  normalizeConcurrency,
} = require('./concurrency');
const { STATE_PATH } = require('./config');
const { syncGag2StockGuildSetup } = require('./manager');
const { syncGag2RoleAssignmentPanel } = require('./roleAssignment');
const { loadState, saveState } = require('./stateStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const UPDATE_ID = 'gag2-update-4-notification-role-cleanup';
const BUG_PATCH_UPDATE_ID = 'gag2-bug-patches-sell-price-dedupe';
const PERFORMANCE_BOOST_UPDATE_ID = 'gag2-performance-boost-concurrent-broadcasts';
const REMOVED_NOTIFICATION_ROLE_KEYS = Object.freeze({
  seed: Object.freeze([
    'ghost_pepper',
    'baby_cactus',
    'horned_melon',
    'glow_mushroom',
    'poison_ivy',
    'rocket_pop',
    'eclipse_bloom',
  ]),
  gear: Object.freeze(['sign', 'megaphone', 'lantern', 'teleporter', 'wheelbarrow', 'strawberry_sniper']),
  crate: Object.freeze(['fourth_of_july_crate']),
});

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function itemLabel(type, key, name) {
  const emoji = emojiForType(type, { key });
  return `${emoji ? `${emoji} ` : ''}**${name}**`;
}

function buildRoleCleanupUpdatePayload() {
  const seedPackItems = [
    itemLabel('seed', 'ghost_pepper', 'Ghost Pepper'),
    itemLabel('seed', 'baby_cactus', 'Baby Cactus'),
    itemLabel('seed', 'horned_melon', 'Horned Melon'),
    itemLabel('seed', 'glow_mushroom', 'Glow Mushroom'),
    itemLabel('seed', 'poison_ivy', 'Poison Ivy'),
  ].join(', ');
  const retiredItems = [
    itemLabel('seed', 'rocket_pop', 'Rocket Pop'),
    itemLabel('crate', 'fourth_of_july_crate', 'Fourth of July'),
  ].join(' and ');
  const eclipseBloom = itemLabel('sell', 'eclipse_bloom', 'Eclipse Bloom');
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: [], roles: [] },
    components: [{
      type: 17,
      accent_color: 0xB0ADAC,
      components: [{
        type: 10,
        content: [
          '### Update 4',
          `- Removed notification roles for seed-pack-only seeds: ${seedPackItems}.`,
          '-# These seeds cannot be purchased directly from the Seed Shop.',
          `- Removed notification roles for retired limited items: ${retiredItems}.`,
          '-# These items are no longer available from their shops.',
          `- Removed the notification role for ${eclipseBloom}.`,
          '-# Eclipse Bloom is obtained through merging rather than purchased from the shop.',
          '- Removed unnecessary Gear Shop notification roles: **Sign**, **Megaphone**, **Lantern**, **Teleporter**, **Wheelbarrow**, and **Strawberry Sniper**.',
          '-# Individual notifications are not needed for these gear items.',
        ].join('\n'),
      }],
    }],
  };
}

function buildBugPatchesUpdatePayload() {
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: [], roles: [] },
    components: [{
      type: 17,
      accent_color: 0x3EC044,
      components: [{
        type: 10,
        content: [
          '### Bug Patches',
          '- Fixed an issue where **Sell Price Track** could replay an older price update after posting the latest one.',
          '- Fixed an issue that could send the same sell price notification twice.',
          '- **Sell Price Track** now announces only when the displayed prices change.',
        ].join('\n'),
      }],
    }],
  };
}

function buildPerformanceBoostUpdatePayload() {
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: [], roles: [] },
    components: [{
      type: 17,
      accent_color: 0xE2AB0F,
      components: [{
        type: 10,
        content: [
          '### Performance Boost! ⭐',
          '- GAG2 updates now broadcast to multiple servers at the same time.',
          '- Stock, weather, moon, sell-price, and bot-update notifications should arrive much faster across every configured server.',
          '- Delivery remains rate-limit safe, with per-channel duplicate protection unchanged.',
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

function announcementRecord(state, updateId, guildId) {
  return state?.updateAnnouncements?.[updateId]?.[guildId] || null;
}

function saveAnnouncementRecord(updateId, guildId, record, statePath = STATE_PATH) {
  const state = loadState(statePath);
  state.updateAnnouncements ||= {};
  state.updateAnnouncements[updateId] ||= {};
  state.updateAnnouncements[updateId][guildId] = record;
  saveState(state, statePath);
}

async function announceRoleCleanupUpdate(client, guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  if (announcementRecord(loadState(statePath), UPDATE_ID, guild.id)) return null;
  ensureGuildConfig(guild.id);
  if (!isGuildGag2StockEnabled(guild.id)) return null;

  const syncResult = await syncGag2StockGuildSetup(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 notification role cleanup failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    return null;
  });
  if (!syncResult || syncResult.failed) {
    logCommandSystem(`GAG2 Update 4 postponed for guild ${guild.id}: notification role cleanup is incomplete.`);
    return null;
  }
  await syncGag2RoleAssignmentPanel(client, guild.id).catch((error) => {
    logCommandSystem(`GAG2 role panel refresh failed after notification role cleanup for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });

  const config = getGuildConfig(guild.id);
  const channel = await updateChannelForGuild(guild, config);
  if (!channel) return null;
  const message = await channel.send(buildRoleCleanupUpdatePayload());
  saveAnnouncementRecord(UPDATE_ID, guild.id, {
    channelId: channel.id,
    messageId: message.id,
    sentAt: new Date(options.now?.() || Date.now()).toISOString(),
  }, statePath);
  logCommandSystem(`GAG2 Update 4 announced in guild ${guild.id}: ${channel.id}`);
  return message;
}

async function announceBugPatchesUpdate(client, guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  if (announcementRecord(loadState(statePath), BUG_PATCH_UPDATE_ID, guild.id)) return null;
  ensureGuildConfig(guild.id);
  if (!isGuildGag2StockEnabled(guild.id)) return null;

  const config = getGuildConfig(guild.id);
  const channel = await updateChannelForGuild(guild, config);
  if (!channel) return null;
  const message = await channel.send(buildBugPatchesUpdatePayload());
  saveAnnouncementRecord(BUG_PATCH_UPDATE_ID, guild.id, {
    channelId: channel.id,
    messageId: message.id,
    sentAt: new Date(options.now?.() || Date.now()).toISOString(),
  }, statePath);
  logCommandSystem(`GAG2 Bug Patches announced in guild ${guild.id}: ${channel.id}`);
  return message;
}

async function announcePerformanceBoostUpdate(client, guild, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  if (announcementRecord(loadState(statePath), PERFORMANCE_BOOST_UPDATE_ID, guild.id)) return null;
  ensureGuildConfig(guild.id);
  if (!isGuildGag2StockEnabled(guild.id)) return null;

  const config = getGuildConfig(guild.id);
  const channel = await updateChannelForGuild(guild, config);
  if (!channel) return null;
  const message = await channel.send(buildPerformanceBoostUpdatePayload());
  saveAnnouncementRecord(PERFORMANCE_BOOST_UPDATE_ID, guild.id, {
    channelId: channel.id,
    messageId: message.id,
    sentAt: new Date(options.now?.() || Date.now()).toISOString(),
  }, statePath);
  logCommandSystem(`GAG2 Performance Boost announced in guild ${guild.id}: ${channel.id}`);
  return message;
}

async function startGag2UpdateAnnouncement(client, options = {}) {
  const guilds = await collectGuilds(client);
  const concurrency = normalizeConcurrency(
    options.broadcastConcurrency,
    DEFAULT_GAG2_BROADCAST_CONCURRENCY,
  );
  await mapWithConcurrency(guilds, concurrency, async (guild) => {
    await announceRoleCleanupUpdate(client, guild, options).catch((error) => {
      logCommandSystem(`GAG2 Update 4 failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    });
    await announceBugPatchesUpdate(client, guild, options).catch((error) => {
      logCommandSystem(`GAG2 Bug Patches announcement failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    });
    await announcePerformanceBoostUpdate(client, guild, options).catch((error) => {
      logCommandSystem(`GAG2 Performance Boost announcement failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
    });
  });
}

module.exports = {
  BUG_PATCH_UPDATE_ID,
  PERFORMANCE_BOOST_UPDATE_ID,
  REMOVED_NOTIFICATION_ROLE_KEYS,
  UPDATE_ID,
  announceBugPatchesUpdate,
  announcePerformanceBoostUpdate,
  announceRoleCleanupUpdate,
  buildBugPatchesUpdatePayload,
  buildPerformanceBoostUpdatePayload,
  buildRoleCleanupUpdatePayload,
  collectGuilds,
  startGag2UpdateAnnouncement,
  updateChannelForGuild,
};
