const fs = require('fs');
const path = require('path');
const manager = require('../src/levelingManager');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');

const NERF_STORE_PATH = path.join(__dirname, '..', 'data', 'level-panel-xp-nerfs.json');
const XP_LOGS_DIR = path.join(__dirname, '..', 'logs', 'xp log');

function floorOneDecimal(value) {
  return Math.floor(Math.max(0, Number(value) || 0) * 10) / 10;
}

function loadNerfState() {
  try {
    if (!fs.existsSync(NERF_STORE_PATH)) return { guilds: {} };
    const parsed = JSON.parse(fs.readFileSync(NERF_STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
    return parsed;
  } catch {
    return { guilds: {} };
  }
}

function saveNerfState(state) {
  fs.mkdirSync(path.dirname(NERF_STORE_PATH), { recursive: true });
  fs.writeFileSync(NERF_STORE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getGuildNerfState(state, guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = { users: {} };
  if (!state.guilds[guildId].users || typeof state.guilds[guildId].users !== 'object') {
    state.guilds[guildId].users = {};
  }
  return state.guilds[guildId];
}

function setUserXpNerf(guildId, userId, scalePercent, durationMs, reason = '') {
  const state = loadNerfState();
  const guild = getGuildNerfState(state, guildId);
  const safeScalePercent = Math.max(1, Math.min(100, Number(scalePercent) || 100));
  const endsAt = Date.now() + Math.max(1, Math.floor(Number(durationMs) || 0));

  guild.users[userId] = {
    scalePercent: safeScalePercent,
    endsAt,
    reason: typeof reason === 'string' ? reason.trim() : '',
    appliedMessages: [],
    updatedAt: Date.now(),
  };
  saveNerfState(state);

  return { userId, scalePercent: safeScalePercent, endsAt };
}

function getActiveNerf(guildId, userId) {
  const state = loadNerfState();
  const guild = getGuildNerfState(state, guildId);
  const nerf = guild.users[userId];
  if (!nerf) return null;

  if (!nerf.endsAt || Date.now() >= nerf.endsAt) {
    delete guild.users[userId];
    saveNerfState(state);
    return null;
  }

  return { state, guild, nerf };
}

function markApplied(state, guildId, userId, messageId) {
  const guild = getGuildNerfState(state, guildId);
  const nerf = guild.users[userId];
  if (!nerf) return;

  const appliedMessages = Array.isArray(nerf.appliedMessages) ? nerf.appliedMessages : [];
  nerf.appliedMessages = [...new Set([...appliedMessages, messageId])].slice(-100);
  nerf.updatedAt = Date.now();
  saveNerfState(state);
}

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function getDailyXpLogPath(now = new Date()) {
  const day = padTwo(now.getUTCDate());
  const month = padTwo(now.getUTCMonth() + 1);
  const year = now.getUTCFullYear();
  return path.join(XP_LOGS_DIR, `XP Log ${day}-${month}-${year}.log`);
}

function getLoggedMessageXp(userId, messageId) {
  const logPath = getDailyXpLogPath();
  if (!fs.existsSync(logPath)) return null;

  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).reverse();
  const line = lines.find((entry) => entry.includes(`${userId} earned `) && entry.includes(`message ${messageId}`));
  const match = line?.match(new RegExp(`${userId} earned (\\d+(?:\\.\\d+)?) XP`));
  if (!match) return null;

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

manager.setUserXpNerf = setUserXpNerf;

const command = require('./level-panel');

command.handleMessageCreate = async function handleMessageCreate(message) {
  if (!message.guild || message.author.bot) return;

  const active = getActiveNerf(message.guild.id, message.author.id);
  if (!active) return;
  if (active.nerf.appliedMessages?.includes(message.id)) return;

  const awardedXp = getLoggedMessageXp(message.author.id, message.id);
  if (!awardedXp || awardedXp <= 0) return;

  const scalePercent = Math.max(1, Math.min(100, Number(active.nerf.scalePercent) || 100));
  const correction = floorOneDecimal(awardedXp * ((100 - scalePercent) / 100));
  if (correction <= 0) {
    markApplied(active.state, message.guild.id, message.author.id, message.id);
    return;
  }

  const current = manager.getUserProgress(message.guild.id, message.author.id);
  manager.setUserXp(message.guild.id, message.author.id, Math.max(0, current.totalXp - correction), {
    source: 'level-panel xp nerf correction',
    channelId: message.channelId,
    messageId: message.id,
    command: '/level-panel',
  });

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member) await syncMemberLevelRoles(message.guild, member).catch(() => null);
  markApplied(active.state, message.guild.id, message.author.id, message.id);
};

module.exports = command;
