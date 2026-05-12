const fs = require('fs');
const path = require('path');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-rolls.json');
const ROLL_CHANNEL_ID = '1503708687569522778';
const ANNOUNCE_CHANNEL_ID = '1498300014114377860';
const LEADERBOARD_CHANNEL_ID = '1503738887929856121';
const START_PING_ROLE_ID = '1493930583137718272';
const EVENT_START_AT = Date.parse('2026-05-12T14:00:00.000Z');
const EVENT_END_AT = Date.parse('2026-05-26T14:00:00.000Z');
const ROLL_COOLDOWN_MS = 10_000;

const rollCooldowns = new Map();

const FIRST_ROLL_ROLE_ID = '1503735931574812762';
const ROLE_THRESHOLDS = [
  { denominator: 1_000, roleId: '1503735158988214272', color: 0x57F287 },
  { denominator: 10_000, roleId: '1502907714966257724', color: 0x3498DB },
  { denominator: 100_000, roleId: '1503735927661527142', color: 0x9B59B6 },
  { denominator: 1_000_000, roleId: '1503735928278093884', color: 0xF1C40F },
  { denominator: 10_000_000, roleId: '1503735929855283201', color: 0xE67E22 },
  { denominator: 100_000_000, roleId: '1503735930203148349', color: 0xE74C3C },
  { denominator: 1_000_000_000, roleId: '1503735930719178922', color: 0x2B2D31 },
];

const RARITIES = [
  ['⚪', 'Common', 2],
  ['🟢', 'Uncommon', 3],
  ['🪙', 'Scarce', 4],
  ['🌀', 'Unusual', 5],
  ['🔵', 'Rare', 6],
  ['✨', 'Fine', 8],
  ['🔱', 'Superior', 10],
  ['🏅', 'Elite', 13],
  ['🟣', 'Epic', 18],
  ['👑', 'Grand', 23],
  ['🐉', 'Mythic', 30],
  ['🌟', 'Legendary', 40],
  ['📜', 'Ancient', 52],
  ['🔮', 'Mystic', 69],
  ['🧙', 'Arcane', 90],
  ['🪄', 'Enchanted', 118],
  ['🌌', 'Celestial', 156],
  ['💫', 'Radiant', 204],
  ['🪐', 'Astral', 268],
  ['🌙', 'Lunar', 352],
  ['☀️', 'Solar', 462],
  ['🌘', 'Eclipse', 606],
  ['🌫️', 'Nebula', 796],
  ['✴️', 'Stellar', 1_040],
  ['🌌', 'Cosmic', 1_370],
  ['🛸', 'Galactic', 1_800],
  ['⚫', 'Void', 2_360],
  ['👻', 'Phantom', 3_100],
  ['🕯️', 'Spectral', 4_070],
  ['🪽', 'Ethereal', 5_350],
  ['🕰️', 'Forgotten', 7_020],
  ['🧭', 'Lost', 9_210],
  ['🚫', 'Forbidden', 12_100],
  ['🤫', 'Secret', 15_900],
  ['🗝️', 'Hidden', 20_800],
  ['🏺', 'Relic', 27_400],
  ['🦴', 'Primal', 35_900],
  ['🐺', 'Savage', 47_100],
  ['🏰', 'Royal', 61_900],
  ['🦅', 'Imperial', 81_200],
  ['😇', 'Divine', 107_000],
  ['🕊️', 'Sacred', 140_000],
  ['🙏', 'Blessed', 184_000],
  ['👼', 'Angelic', 241_000],
  ['🪽', 'Seraphic', 317_000],
  ['😈', 'Demonic', 416_000],
  ['🔥', 'Infernal', 546_000],
  ['🕳️', 'Abyssal', 716_000],
  ['🌑', 'Shadow', 940_000],
  ['🖤', 'Darkmatter', 1_230_000],
  ['⚛️', 'Quantum', 1_620_000],
  ['🕳️', 'Singularity', 2_130_000],
  ['🔁', 'Paradox', 2_790_000],
  ['⏳', 'Timeless', 3_670_000],
  ['♾️', 'Eternal', 4_810_000],
  ['🗿', 'Immortal', 6_320_000],
  ['⚡', 'Godly', 8_290_000],
  ['🏆', 'Supreme', 10_900_000],
  ['👑', 'Sovereign', 14_300_000],
  ['🦁', 'Emperor', 18_800_000],
  ['🛡️', 'Overlord', 24_600_000],
  ['🔺', 'Ascended', 32_300_000],
  ['🧬', 'Transcendent', 42_400_000],
  ['🌀', 'Reality-Bent', 55_700_000],
  ['💭', 'Dreambound', 73_100_000],
  ['👻', 'Soulbound', 96_000_000],
  ['🌬️', 'Spiritforge', 126_000_000],
  ['⭐', 'Starforged', 165_000_000],
  ['🌕', 'Moonforged', 217_000_000],
  ['🔆', 'Sunforged', 285_000_000],
  ['🗿', 'Titan', 374_000_000],
  ['🏔️', 'Colossus', 491_000_000],
  ['🐲', 'Dragon', 645_000_000],
  ['🐋', 'Leviathan', 846_000_000],
  ['🔥', 'Phoenix', 1_110_000_000],
  ['🦑', 'Kraken', 1_460_000_000],
  ['🐾', 'Chimera', 1_910_000_000],
  ['🐍', 'Hydra', 2_510_000_000],
  ['🐘', 'Behemoth', 3_300_000_000],
  ['🌍', 'Worldbreaker', 4_330_000_000],
  ['🚪', 'Realmwalker', 5_690_000_000],
  ['🧊', 'Dimensional', 7_460_000_000],
  ['🌌', 'Multiversal', 9_800_000_000],
  ['👁️', 'Omniversal', 12_900_000],
  ['🔥', 'Hypernova', 16_900_000_000],
  ['🐣', 'Supernova', 22_200_000_000],
  ['🌱', 'Genesis', 29_100_000_000],
  ['✄️', 'Apocalypse', 38_200_000_000],
  ['Ω', 'Omega', 50_100_000_000],
  ['α', 'Alpha', 65_800_000_000],
  ['❾️', 'Infinity', 86_400_000_000],
  ['⌛', 'Eternity', 113_000_000_000],
  ['🧵', 'Fatebound', 149_000_000_000],
  ['🎯', 'Destiny', 195_000_000],
  ['🌈', 'Miracle', 257_000_000],
  ['🧿', 'Anomaly', 337_000_000],
  ['🔴', 'Absolute', 442_000_000_000],
  ['🔺', 'Apex', 580_000_000_000],
  ['🔢', 'Transfinite', 762_000_000_000],
  ['👑', 'One Trillion', 1_000_000_000_000],
].map(([emoji, name, denominator]) => ({ emoji, name, denominator }));

let scheduler = null;
let schedulerClient = null;

function defaultState() {
  return { users: {}, leaderboardMessageId: null, startAnnouncementSent: false };
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync (dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
}

function loadState() {
  ensureStore();
  try {
    const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      ...defaultState(),
      ...(state && typeof state === 'object' ? state : {}),
      users: state?.users && typeof state.users === 'object' ? state.users : {},
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...defaultState(), ...state }, null, 2), 'utf8');
}

function getUserRecord(state, userId) {
  if (!state.users[userId] || typeof state.users[userId] !== 'object') {
    state.users[userId] = { totalRolls: 0, firstRolledAt: null, best: null, topRolls: [] };
  }
  const record = state.users[userId];
  record.totalRolls = Math.max(0, Math.floor(Number(record.totalRolls) || 0));
  record.topRolls = Array.isArray(record.topRolls) ? record.topRolls : [];
  return record;
}

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components: [{ type: 10, content }] }],
  };
}

function formatNumber(value) {
  return Math.floor(Number(value) || 0).toLocaleString('en-US');
}

function formatShort(value) {
  const amount = Math.floor(Number(value) || 0);
  const units = [
    [1_000_000_000_000, 't'],
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (amount >= size) {
      const scaled = amount / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(amount);
}

function formatPercent(denominator) {
  const percent = 100 / denominator;
  const text = percent >= 1 ? percent.toFixed(2) : percent.toFixed(12);
  return text.replace(/\.?0+$/, '');
}

function rarityLabel(roll) {
  return roll ? `${roll.emoji} ${roll.name}` : 'None';
}

function accentForDenominator(denominator) {
  const threshold = [...ROLE_THRESHOLDS].reverse().find((item) => denominator >= item.denominator);
  if (threshold) return threshold.color;
  if (denominator >= 100) return 0x9B59B6;
  if (denominator >= 10) return 0x3498DB;
  if (denominator >= 4) return 0x57F287;
  return 0xFFFFFF;
}

function rollRarity() {
  let best = RARITIES[0];
  for (const rarity of RARITIES) {
    if (Math.floor(Math.random() * rarity.denominator) === 0 && rarity.denominator > best.denominator) {
      best = rarity;
    }
  }
  return best;
}

function sortRolls(a, b) {
  if ((b?.denominator || 0) !== (a?.denominator || 0)) return (b?.denominator || 0) - (a?.denominator || 0);
  return (a?.achievedAt || 0) - (b?.achievedAt || 0);
}

function getRankedUsers(state) {
  return Object.entries(state.users || {})
    .map(([userId, record]) => ({ userId, ...(record?.best || {}) }))
    .filter((entry) => entry.denominator)
    .sort(sortRolls);
}

function getEventStatus(now = Date.now()) {
  if (now < EVENT_START_AT) return 'before';
  if (now >= EVENT_END_AT) return 'ended';
  return 'active';
}

function nextHourlyBoundaryUtcPlus7(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  shifted.setUTCMinutes(0, 0, 0);
  shifted.setUTCHours(shifted.getUTCHours() + 1);
  return new Date(shifted.getTime() - (7 * 60 * 60 * 1000));
}

function buildRollPayload(rarity, isNewRecord) {
  const lines = [
    `## You have rolled ${rarityLabel(rarity)}`,
    `-# ${formatPercent(rarity.denominator)}%`,
  ];
  if (isNewRecord) lines.push('-# **You have achieved a new RECORD!**');
  return container(accentForDenominator(rarity.denominator), lines.join('\n'));
}

function buildMyRarestPayload(userId) {
  const state = loadState();
  const record = getUserRecord(state, userId);
  const [first, second, third] = record.topRolls;
  const rank = getRankedUsers(state).findIndex((entry) => entry.userId === userId) + 1;
  return container(0xFFFFFF, [
    `### Rarest rarity rolled: ${rarityLabel(first)}`,
    `-# * 2nd rarest: ${rarityLabel(second)}`,
    `-# * 3rd rarest: ${rarityLabel(third)}`,
    '',
    '-# ━━━━━━━━━━━━━━━━━━',
    `-# Leaderboard rank: ${rank > 0 ? `${rank}#` : 'Unranked'}`,
  ].join('\n'));
}

function buildLeaderboardPayload(guild) {
  const state = loadState();
  const status = getEventStatus();
  const ranked = getRankedUsers(state).slice(0, 10);
  const now = Date.now();
  const lines = ['## RNG Event Leaderboard'];

  if (status === 'before') {
    lines.push('-# Game has not started yet.');
    lines.push(`-# Event starts: <t:${Math.floor(EVENT_START_AT / 1000)}:R>`);
  } else if (ranked.length === 0) {
    lines.push('-# No rolls yet.');
  } else {
    for (let i = 0; i < ranked.length; i += 1) {
      const row = ranked[i];
      lines.push(`**#${i + 1}** <@${row.userId}> - ${rarityLabel(row)} (1/${formatShort(row.denominator)})`);
    }
  }

  if (status === 'active') {
    const next = nextHourlyBoundaryUtcPlus7(new Date(now));
    lines.push('');
    lines.push(`-# Refresh: <t:${Math.floor(next.getTime() / 1000)}:R>`);
    lines.push(`-# Event ends: <t:${Math.floor(EVENT_END_AT / 1000)}:R>`);
  } else if (status === 'ended') {
    lines.push('');
    lines.push(`-# Event ended: <t:${Math.floor(EVENT_END_AT / 1000)}:R>`);
  }

  return container(0xFFFFFF, lines.join('\n'));
}

async function getTextChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function upsertLeaderboardMessage(client) {
  const channel = await getTextChannel(client, LEADERBOARD_CHANNEL_ID);
  if (!channel) return;
  const state = loadState();
  const payload = buildLeaderboardPayload(channel.guild);
  let message = state.leaderboardMessageId
    ? await channel.messages.fetch(state.leaderboardMessageId).catch(() => null)
    : null;
  if (message) {
    await message.edit(payload).catch(() => null);
    return;
  }
  message = await channel.send(payload).catch(() => null);
  if (message?.id) {
    state.leaderboardMessageId = message.id;
    saveState(state);
  }
}

async function maybeSendStartAnnouncement(client) {
  if (getEventStatus() !== 'active') return;
  const state = loadState();
  if (state.startAnnouncementSent) return;
  const channel = await getTextChannel(client, LEADERBOARD_CHANNEL_ID);
  if (!channel) return;
  await channel.send({
    content: `<@&${START_PING_ROLE_ID}>`,
    ...container(0xFFFFFF, '### RNG event has started! Goodluck and wish your luck.'),
  }).catch(() => null);
  state.startAnnouncementSent = true;
  saveState(state);
}

function scheduleNextRefresh() {
  if (scheduler) clearTimeout(scheduler);
  if (!schedulerClient) return;
  const status = getEventStatus();
  if (status === 'ended') return;
  const nextHourly = nextHourlyBoundaryUtcPlus7();
  const nextTime = status === 'before'
    ? Math.min(EVENT_START_AT, nextHourly.getTime())
    : Math.min(EVENT_END_AT, nextHourly.getTime());
  const delay = Math.max(1_000, nextTime - Date.now());
  scheduler = setTimeout(async () => {
    await maybeSendStartAnnouncement(schedulerClient);
    await upsertLeaderboardMessage(schedulerClient);
    scheduleNextRefresh();
  }, delay);
}

function updateTopRolls(record, roll) {
  const existing = record.topRolls.find((item) => item.name === roll.name && item.denominator === roll.denominator);
  if (!existing) record.topRolls.push(roll);
  record.topRolls.sort(sortRolls);
  record.topRolls = record.topRolls.slice(0, 3);
}

function getRollThreshold(denominator) {
  return [...ROLE_THRESHOLDS].reverse().find((item) => denominator >= item.denominator) ?? null;
}

async function getRoleColor(guild, threshold) {
  if (!guild || !threshold?.roleId) return threshold?.color ?? 0xFFFFFF;
  const role = guild.roles.cache.get(threshold.roleId) || await guild.roles.fetch(threshold.roleId).catch(() => null);
  return role?.color || threshold.color || 0xFFFFFF;
}

async function assignRollRoles(member, denominator, isFirstRoll) {
  if (!member?.roles?.add) return;
  if (isFirstRoll) await member.roles.add(FIRST_ROLL_ROLE_ID).catch(() => null);
  for (const threshold of ROLE_THRESHOLDS) {
    if (denominator >= threshold.denominator) await member.roles.add(threshold.roleId).catch(() => null);
  }
}

async function announceRareRoll(client, userId, rarity) {
  const threshold = getRollThreshold(rarity.denominator);
  if (!threshold) return;
  const channel = await getTextChannel(client, ANNOUNCE_CHANNEL_ID);
  if (!channel) return;
  const color = await getRoleColor(channel.guild, threshold);
  await channel.send(container(color, [
    `## <@${userId}> has rolled ${rarityLabel(rarity)}`,
    `with a chance of 1 in ${formatNumber(rarity.denominator)}!`,
  ].join('\n'))).catch(() => null);
}

function getRollCooldownUntil(userId) {
  const until = rollCooldowns.get(userId) || 0;
  if (until <= Date.now()) {
    rollCooldowns.delete(userId);
    return 0;
  }
  return until;
}

function setRollCooldown(userId) {
  if (!userId) return;
  rollCooldowns.set(userId, Date.now() + ROLL_COOLDOWN_MS);
}

async function handleRollMessage(message, client) {
  if (message.author?.bot || message.content.trim().toLowerCase() !== '!roll') return false;
  if (message.channelId !== ROLL_CHANNEL_ID) {
    await message.reply(container(0xED4245, `Use !roll in <#${ROLL_CHANNEL_ID}>.`)).catch(() => null);
    return true;
  }
  const status = getEventStatus();
  if (status === 'before') {
    await message.reply(container(0xFFFFFF, `### RNG event has not started yet.\n-# Starts: <t:${Math.floor(EVENT_START_AT / 1000)}:R>`)).catch(() => null);
    return true;
  }
  if (status === 'ended') {
    await message.reply(container(0xED4245, '### RNG event has ended.\n-# !roll is now disabled.')).catch(() => null);
    return true;
  }

  if (getRollCooldownUntil(message.author.id) > Date.now()) return true;
  setRollCooldown(message.author.id);

  const rarity = rollRarity();
  const state = loadState();
  const record = getUserRecord(state, message.author.id);
  const isFirstRoll = !record.firstRolledAt;
  const achievedAt = Date.now();
  const previousBest = record.best?.denominator || 0;
  const isNewRecord = rarity.denominator > previousBest;
  const rollRecord = { emoji: rarity.emoji, name: rarity.name, denominator: rarity.denominator, achievedAt };

  record.totalRolls += 1;
  if (isFirstRoll) record.firstRolledAt = achievedAt;
  if (isNewRecord) record.best = rollRecord;
  updateTopRolls(record, rollRecord);
  saveState(state);

  await message.reply(buildRollPayload(rarity, isNewRecord)).catch(() => null);
  await assignRollRoles(message.member, rarity.denominator, isFirstRoll);
  await announceRareRoll(client, message.author.id, rarity);
  await upsertLeaderboardMessage(client);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-rarest-roll')
    .setDescription('Show your rarest RNG event rolls'),

  async init(client) {
    schedulerClient = client;
    await maybeSendStartAnnouncement(client);
    await upsertLeaderboardMessage(client);
    scheduleNextRefresh();
  },

  async execute(interaction) {
    await interaction.reply(buildMyRarestPayload(interaction.user.id));
  },

  async handleMessageCreate(message, client) {
    return handleRollMessage(message, client);
  },
};
