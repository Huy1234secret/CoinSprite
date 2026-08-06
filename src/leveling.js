const crypto = require('crypto');
const path = require('path');
const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { readJsonFile, writeJsonAtomic } = require('./jsonFileStore');
const { logCommandSystem } = require('./commandLogger');
const {
  DEFAULT_LEVELING_CONFIG,
  getGuildConfig,
  isGuildLevelingEnabled,
} = require('./serverConfig');

const DATA_PATH = path.join(__dirname, '..', 'data', 'leveling.json');
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ACCENT = 0xb9f547;
const PAGE_SIZE = 10;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';

let cachedState = null;
let saveTimer = null;

function blankState() {
  return { version: 1, guilds: {} };
}

function normalizeRecord(value = {}) {
  return {
    xp: Math.max(0, Math.floor(Number(value.xp) || 0)),
    messages: Math.max(0, Math.floor(Number(value.messages) || 0)),
    lastXpAt: Math.max(0, Number(value.lastXpAt) || 0),
    lastMessageAt: Math.max(0, Number(value.lastMessageAt) || 0),
    lastMessageHash: String(value.lastMessageHash || '').slice(0, 64),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0),
  };
}

function normalizeState(value) {
  const state = blankState();
  if (!value || typeof value !== 'object') return state;
  for (const [guildId, guild] of Object.entries(value.guilds || {})) {
    if (!/^\d{16,20}$/.test(guildId)) continue;
    const users = {};
    for (const [userId, record] of Object.entries(guild?.users || {})) {
      if (/^\d{16,20}$/.test(userId)) users[userId] = normalizeRecord(record);
    }
    state.guilds[guildId] = { users };
  }
  return state;
}

function getState() {
  if (!cachedState) cachedState = normalizeState(readJsonFile(DATA_PATH, { label: 'leveling data', fallback: blankState() }));
  return cachedState;
}

function flushLevelingState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (cachedState) writeJsonAtomic(DATA_PATH, cachedState);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushLevelingState, 750);
  saveTimer.unref?.();
}

function resetLevelingCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  cachedState = null;
}

function guildUsers(guildId) {
  const state = getState();
  state.guilds[guildId] ||= { users: {} };
  return state.guilds[guildId].users;
}

function userRecord(guildId, userId) {
  const users = guildUsers(String(guildId));
  users[userId] ||= normalizeRecord();
  return users[userId];
}

function levelingConfig(guildId) {
  return getGuildConfig(guildId)?.leveling || DEFAULT_LEVELING_CONFIG;
}

function xpThresholdForLevel(level, curve = DEFAULT_LEVELING_CONFIG.curve) {
  const target = Math.max(0, Math.floor(Number(level) || 0));
  if (!target) return 0;
  return Math.floor(Math.max(1, Number(curve.baseXp) || 100) * Math.pow(target, Math.max(1, Number(curve.growth) || 1.5)));
}

function levelForXp(xp, curve = DEFAULT_LEVELING_CONFIG.curve) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  const maximum = Math.max(1, Math.floor(Number(curve.maxLevel) || 100));
  let low = 0;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (xpThresholdForLevel(middle, curve) <= total) low = middle;
    else high = middle - 1;
  }
  return low;
}

function applyXpToRecord(record, amount, config = DEFAULT_LEVELING_CONFIG, nowMs = Date.now()) {
  const oldXp = record.xp;
  const oldLevel = levelForXp(oldXp, config.curve);
  record.xp = Math.max(0, Math.floor(oldXp + Number(amount || 0)));
  record.updatedAt = nowMs;
  const newLevel = levelForXp(record.xp, config.curve);
  return { amount: record.xp - oldXp, oldXp, newXp: record.xp, oldLevel, newLevel, record };
}

function memberStats(guildId, userId, config = levelingConfig(guildId)) {
  const record = normalizeRecord(guildUsers(String(guildId))[String(userId)] || {});
  const level = levelForXp(record.xp, config.curve);
  const levelStartXp = xpThresholdForLevel(level, config.curve);
  const nextLevelXp = level >= config.curve.maxLevel
    ? levelStartXp
    : xpThresholdForLevel(level + 1, config.curve);
  const progressXp = Math.max(0, record.xp - levelStartXp);
  const neededXp = Math.max(0, nextLevelXp - levelStartXp);
  const leaderboard = sortedLeaderboard(guildId, config);
  const rankIndex = leaderboard.findIndex((entry) => entry.userId === String(userId));
  return {
    ...record,
    level,
    levelStartXp,
    nextLevelXp,
    progressXp,
    neededXp,
    progressRatio: neededXp ? Math.min(1, progressXp / neededXp) : 1,
    rank: rankIndex === -1 ? leaderboard.length + 1 : rankIndex + 1,
  };
}

function sortedLeaderboard(guildId, config = levelingConfig(guildId)) {
  return Object.entries(guildUsers(String(guildId)))
    .map(([userId, record]) => ({ userId, ...normalizeRecord(record), level: levelForXp(record.xp, config.curve) }))
    .sort((left, right) => right.xp - left.xp || right.messages - left.messages || left.userId.localeCompare(right.userId));
}

function progressBar(ratio, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round((Number(ratio) || 0) * width)));
  return `${'\u25a0'.repeat(filled)}${'\u25a1'.repeat(width - filled)}`;
}

function safeName(value) {
  return String(value || 'Member').replace(/[\\*_~`|>]/g, '\\$&').slice(0, 80);
}

function number(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
}

function v2Payload(content, options = {}) {
  const inner = [{ type: 10, content }];
  if (Array.isArray(options.components) && options.components.length) {
    inner.push({ type: 14, divider: true, spacing: 1 }, ...options.components);
  }
  return {
    flags: COMPONENTS_V2_FLAG | (options.ephemeral ? EPHEMERAL_FLAG : 0),
    allowedMentions: options.allowedMentions || { parse: [], users: [], roles: [] },
    components: [{ type: 17, accent_color: options.color || ACCENT, components: inner }],
  };
}

function buildLevelPayload(user, stats) {
  const capped = stats.neededXp === 0;
  const progress = capped ? 'Maximum level reached' : `${number(stats.progressXp)} / ${number(stats.neededXp)} XP`;
  return v2Payload([
    `## \u2726 ${safeName(user?.globalName || user?.displayName || user?.username)}'s level`,
    `-# Rank #${number(stats.rank)} \u00b7 ${number(stats.messages)} eligible messages`,
    '',
    `### Level ${number(stats.level)}`,
    `\`${progressBar(stats.progressRatio)}\` **${progress}**`,
    `-# ${number(stats.xp)} total XP`,
  ].join('\n'));
}

async function leaderboardPage(interaction, page = 1) {
  const config = levelingConfig(interaction.guildId);
  const entries = sortedLeaderboard(interaction.guildId, config);
  const maxPage = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(maxPage, Math.max(1, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows = await Promise.all(entries.slice(start, start + PAGE_SIZE).map(async (entry, index) => {
    const member = interaction.guild.members.cache.get(entry.userId)
      || await interaction.guild.members.fetch(entry.userId).catch(() => null);
    const name = safeName(member?.displayName || member?.user?.username || `Member ${entry.userId}`);
    return `**${start + index + 1}.** ${name} \u2014 **Level ${number(entry.level)}** \u00b7 ${number(entry.xp)} XP`;
  }));
  const ownerId = interaction.user.id;
  const controls = maxPage > 1 ? [{
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Previous', custom_id: `leveling:leaderboard:${ownerId}:${currentPage - 1}`, disabled: currentPage <= 1 },
      { type: 2, style: 2, label: `Page ${currentPage}/${maxPage}`, custom_id: `leveling:leaderboard:${ownerId}:${currentPage}`, disabled: true },
      { type: 2, style: 2, label: 'Next', custom_id: `leveling:leaderboard:${ownerId}:${currentPage + 1}`, disabled: currentPage >= maxPage },
    ],
  }] : [];
  return v2Payload([
    `## \u219f ${safeName(interaction.guild.name)} leaderboard`,
    `-# Ranked by total XP \u00b7 ${number(entries.length)} members`,
    '',
    ...(rows.length ? rows : ['No one has earned XP yet.']),
  ].join('\n'), { components: controls });
}

function dashboardBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configured) return configured;
  try {
    return new URL(process.env.DISCORD_REDIRECT_URI || '').origin;
  } catch {
    return DEFAULT_DASHBOARD_BASE_URL;
  }
}

function messageFingerprint(message) {
  const content = String(message.content || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 1000);
  const attachments = [...(message.attachments?.values?.() || [])]
    .map((attachment) => `${attachment.name || ''}:${attachment.size || ''}`)
    .join('|');
  if (content.length < 3 && !attachments) return '';
  return crypto.createHash('sha256').update(`${content}|${attachments}`).digest('hex');
}

function randomXp(config) {
  const minimum = Math.max(1, Math.floor(config.xp.min));
  const maximum = Math.max(minimum, Math.floor(config.xp.max));
  return crypto.randomInt(minimum, maximum + 1);
}

function processMessageXp(message, options = {}) {
  const config = options.config || levelingConfig(message.guildId);
  const nowMs = Number(options.nowMs) || Date.now();
  if (!config.enabled || message.author?.bot || message.webhookId || message.system) return { awarded: false, reason: 'ineligible' };
  if (config.ignoredChannelIds.includes(message.channelId) || config.ignoredChannelIds.includes(message.channel?.parentId)) {
    return { awarded: false, reason: 'ignored-channel' };
  }
  const fingerprint = options.fingerprint || messageFingerprint(message);
  if (!fingerprint) return { awarded: false, reason: 'empty' };
  const record = userRecord(message.guildId, message.author.id);
  if (record.lastMessageAt && record.lastMessageHash === fingerprint && nowMs - record.lastMessageAt < DUPLICATE_WINDOW_MS) {
    return { awarded: false, reason: 'duplicate', record };
  }
  record.lastMessageHash = fingerprint;
  record.lastMessageAt = nowMs;
  record.messages += 1;
  record.updatedAt = nowMs;
  const cooldownMs = Math.max(5, Number(config.xp.cooldownSeconds) || 60) * 1000;
  if (record.lastXpAt && nowMs - record.lastXpAt < cooldownMs) {
    scheduleSave();
    return { awarded: false, reason: 'cooldown', record };
  }
  record.lastXpAt = nowMs;
  const result = applyXpToRecord(record, options.amount ?? randomXp(config), config, nowMs);
  scheduleSave();
  return { awarded: result.amount > 0, reason: 'awarded', ...result };
}

async function syncRewardRoles(guild, userId, level, config = levelingConfig(guild.id)) {
  const rewards = config.roleRewards.filter((reward) => reward.level <= level);
  if (!rewards.length) return;
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  const desired = config.stackRoleRewards ? rewards : [rewards.at(-1)];
  const desiredIds = new Set(desired.map((reward) => reward.roleId));
  const rewardIds = new Set(config.roleRewards.map((reward) => reward.roleId));
  const add = [...desiredIds].filter((roleId) => !member.roles.cache.has(roleId));
  const remove = [...rewardIds].filter((roleId) => member.roles.cache.has(roleId) && !desiredIds.has(roleId));
  if (add.length) await member.roles.add(add, `CoinSprite level ${level} reward`).catch((error) => logCommandSystem(`Level reward add failed in ${guild.id}: ${error?.message || 'unknown error'}`));
  if (remove.length) await member.roles.remove(remove, `CoinSprite level ${level} reward update`).catch((error) => logCommandSystem(`Level reward cleanup failed in ${guild.id}: ${error?.message || 'unknown error'}`));
}

function announcementText(template, message, level) {
  return String(template || DEFAULT_LEVELING_CONFIG.announcements.message)
    .replaceAll('{user}', `<@${message.author.id}>`)
    .replaceAll('{username}', safeName(message.member?.displayName || message.author.username))
    .replaceAll('{level}', String(level))
    .replaceAll('{server}', safeName(message.guild.name));
}

async function announceLevelUp(message, result, config) {
  if (!config.announcements.enabled) return;
  const channel = config.announcements.channelId
    ? message.guild.channels.cache.get(config.announcements.channelId)
      || await message.guild.channels.fetch(config.announcements.channelId).catch(() => null)
    : message.channel;
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return;
  const stats = memberStats(message.guildId, message.author.id, config);
  await channel.send(v2Payload([
    `## \u2726 Level ${result.newLevel} reached`,
    announcementText(config.announcements.message, message, result.newLevel),
    '',
    stats.neededXp
      ? `\`${progressBar(stats.progressRatio)}\` ${number(stats.progressXp)} / ${number(stats.neededXp)} XP toward level ${result.newLevel + 1}`
      : `\`${progressBar(1)}\` Maximum level reached`,
  ].join('\n'), {
    allowedMentions: { parse: [], users: [message.author.id], roles: [] },
  })).catch((error) => logCommandSystem(`Level-up announcement failed in ${message.guildId}: ${error?.message || 'unknown error'}`));
}

async function handleLevelingMessage(message) {
  if (!message.guildId || !isGuildLevelingEnabled(message.guildId)) return false;
  const config = levelingConfig(message.guildId);
  const result = processMessageXp(message, { config });
  if (!result.awarded || result.newLevel <= result.oldLevel) return result.awarded;
  await syncRewardRoles(message.guild, message.author.id, result.newLevel, config);
  await announceLevelUp(message, result, config);
  logCommandSystem(`Leveling: ${message.author.id} reached level ${result.newLevel} in guild ${message.guildId}.`);
  return true;
}

async function executeLevel(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  await interaction.reply(buildLevelPayload(user, memberStats(interaction.guildId, user.id)));
}

async function executeLeaderboard(interaction) {
  await interaction.reply(await leaderboardPage(interaction, interaction.options.getInteger('page') || 1));
}

async function executeLevelSet(interaction) {
  const user = interaction.options.getUser('user', true);
  const level = interaction.options.getInteger('level', true);
  const config = levelingConfig(interaction.guildId);
  const record = userRecord(interaction.guildId, user.id);
  const oldLevel = levelForXp(record.xp, config.curve);
  const targetLevel = Math.min(level, config.curve.maxLevel);
  record.xp = xpThresholdForLevel(targetLevel, config.curve);
  record.updatedAt = Date.now();
  scheduleSave();
  await syncRewardRoles(interaction.guild, user.id, targetLevel, config);
  await interaction.reply(v2Payload(`## Level updated\n**${safeName(user.username)}** moved from level ${oldLevel} to **level ${targetLevel}**.`, { ephemeral: true }));
}

async function executeXpAdd(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const config = levelingConfig(interaction.guildId);
  const result = applyXpToRecord(userRecord(interaction.guildId, user.id), amount, config);
  scheduleSave();
  await syncRewardRoles(interaction.guild, user.id, result.newLevel, config);
  await interaction.reply(v2Payload(`## XP added\n**${safeName(user.username)}** received **${number(amount)} XP** and is now level **${result.newLevel}**.`, { ephemeral: true }));
}

async function executeSetup(interaction) {
  await interaction.reply(v2Payload([
    '## \u219f Leveling setup',
    'Configure XP pacing, announcements, ignored channels, and reward roles in the dashboard.',
    `-# Server ID: ${interaction.guildId}`,
  ].join('\n'), {
    ephemeral: true,
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Open Leveling dashboard', url: `${dashboardBaseUrl()}/admin` }],
    }],
  }));
}

const LEVELING_COMMANDS = [
  {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Show a member level and XP progress.')
      .addUserOption((option) => option.setName('user').setDescription('Member to view')),
    execute: executeLevel,
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the server XP leaderboard.')
      .addIntegerOption((option) => option.setName('page').setDescription('Leaderboard page').setMinValue(1)),
    execute: executeLeaderboard,
  },
  {
    data: new SlashCommandBuilder()
      .setName('level-set')
      .setDescription('Set a member level.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption((option) => option.setName('user').setDescription('Member to update').setRequired(true))
      .addIntegerOption((option) => option.setName('level').setDescription('New level').setMinValue(0).setMaxValue(1000).setRequired(true)),
    execute: executeLevelSet,
  },
  {
    data: new SlashCommandBuilder()
      .setName('xp-add')
      .setDescription('Add XP to a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption((option) => option.setName('user').setDescription('Member to reward').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('XP amount').setMinValue(1).setMaxValue(1000000).setRequired(true)),
    execute: executeXpAdd,
  },
  {
    data: new SlashCommandBuilder()
      .setName('leveling-setup')
      .setDescription('Open the Leveling dashboard.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    execute: executeSetup,
  },
];

const commandMap = new Map(LEVELING_COMMANDS.map((command) => [command.data.name, command]));
const ADMIN_COMMAND_NAMES = new Set(['level-set', 'xp-add', 'leveling-setup']);

async function handleLevelingInteraction(interaction) {
  if (interaction.isChatInputCommand?.()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return false;
    if (ADMIN_COMMAND_NAMES.has(interaction.commandName) && !interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply(v2Payload('## Manage Server required\nYou do not have permission to use this Leveling command.', { ephemeral: true }));
      return true;
    }
    if (!isGuildLevelingEnabled(interaction.guildId) && interaction.commandName !== 'leveling-setup') {
      await interaction.reply(v2Payload('## Leveling is paused\nAn administrator can enable it from the dashboard.', { ephemeral: true }));
      return true;
    }
    await command.execute(interaction);
    return true;
  }
  if (interaction.isButton?.() && interaction.customId.startsWith('leveling:leaderboard:')) {
    const [, , ownerId, page] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
      await interaction.reply(v2Payload('These leaderboard controls belong to another member.', { ephemeral: true }));
      return true;
    }
    await interaction.update(await leaderboardPage(interaction, page));
    return true;
  }
  return false;
}

module.exports = {
  COMPONENTS_V2_FLAG,
  DATA_PATH,
  LEVELING_COMMANDS,
  applyXpToRecord,
  buildLevelPayload,
  flushLevelingState,
  handleLevelingInteraction,
  handleLevelingMessage,
  leaderboardPage,
  levelForXp,
  memberStats,
  processMessageXp,
  progressBar,
  resetLevelingCache,
  sortedLeaderboard,
  xpThresholdForLevel,
};
