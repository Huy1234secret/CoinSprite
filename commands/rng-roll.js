const fs = require('fs');
const path = require('path');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const rngNotificationStore = require('../src/rngNotificationStore');
const { formatMultiplier, getActiveBoost } = require('../src/luckBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-rolls.json');
const ROLL_CHANNEL_IDS = new Set(['1503708687569522778', '1503763965497315458', '1503773311547478196', '1503779472329936988']);
const PRIMARY_ROLL_CHANNEL_ID = '1503708687569522778';
const ANNOUNCE_CHANNEL_ID = '1498300014114377860';
const LEADERBOARD_CHANNEL_ID = '1503738887929856121';
const START_PING_ROLE_ID = '1493930583137718272';
const EVENT_START_AT = Date.parse('2026-05-12T14:00:00.000Z');
const EVENT_END_AT = Date.parse('2026-05-26T14:00:00.000Z');
const ROLL_COOLDOWN_MS = 5_000;
const MIN_ROLL_LEVEL = 5;

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
  ['✨', 'Fine', 7],
  ['🔱', 'Superior', 8],
  ['🏅', 'Elite', 9],
  ['🟣', 'Epic', 10],
  ['👑', 'Grand', 11],
  ['🐉', 'Mythic', 12],
  ['🌟', 'Legendary', 13],
  ['📜', 'Ancient', 14],
  ['🔮', 'Mystic', 15],
  ['🧙', 'Arcane', 16],
  ['🪄', 'Enchanted', 17],
  ['🌌', 'Celestial', 18],
  ['💫', 'Radiant', 19],
  ['🪐', 'Astral', 20],
  ['🌙', 'Lunar', 21],
  ['☀️', 'Solar', 22],
  ['🌘', 'Eclipse', 23],
  ['🌫️', 'Nebula', 24],
  ['✴️', 'Stellar', 25],
  ['🌌', 'Cosmic', 27],
  ['🛸', 'Galactic', 30],
  ['⚫', 'Void', 33],
  ['👻', 'Phantom', 37],
  ['🕯️', 'Spectral', 41],
  ['🪽', 'Ethereal', 46],
  ['🕰️', 'Forgotten', 51],
  ['🧭', 'Lost', 57],
  ['🚫', 'Forbidden', 64],
  ['🤫', 'Secret', 71],
  ['🗝️', 'Hidden', 79],
  ['🏺', 'Relic', 88],
  ['🦴', 'Primal', 98],
  ['🐺', 'Savage', 110],
  ['🏰', 'Royal', 122],
  ['🦅', 'Imperial', 136],
  ['😇', 'Divine', 151],
  ['🕊️', 'Sacred', 169],
  ['🙏', 'Blessed', 188],
  ['👼', 'Angelic', 210],
  ['🪽', 'Seraphic', 234],
  ['😈', 'Demonic', 260],
  ['🔥', 'Infernal', 290],
  ['🕳️', 'Abyssal', 323],
  ['🌑', 'Shadow', 360],
  ['🖤', 'Darkmatter', 401],
  ['⚛️', 'Quantum', 447],
  ['🕳️', 'Singularity', 498],
  ['🔁', 'Paradox', 555],
  ['⏳', 'Timeless', 618],
  ['♾️', 'Eternal', 689],
  ['🗿', 'Immortal', 768],
  ['⚡', 'Godly', 855],
  ['🏆', 'Supreme', 953],
  ['👑', 'Sovereign', 1_060],
  ['🦁', 'Emperor', 1_180],
  ['🛡️', 'Overlord', 1_320],
  ['🔺', 'Ascended', 1_470],
  ['🧬', 'Transcendent', 1_640],
  ['🌀', 'Reality-Bent', 1_820],
  ['💭', 'Dreambound', 2_030],
  ['👻', 'Soulbound', 2_260],
  ['🌬️', 'Spiritforge', 2_520],
  ['⭐', 'Starforged', 2_810],
  ['🌕', 'Moonforged', 3_130],
  ['🔆', 'Sunforged', 3_490],
  ['🗿', 'Titan', 3_890],
  ['🏔️', 'Colossus', 4_330],
  ['🐲', 'Dragon', 4_830],
  ['🐋', 'Leviathan', 5_380],
  ['🔥', 'Phoenix', 6_000],
  ['🦑', 'Kraken', 6_680],
  ['🐾', 'Chimera', 7_440],
  ['🐍', 'Hydra', 8_290],
  ['🐘', 'Behemoth', 9_240],
  ['🌍', 'Worldbreaker', 10_300],
  ['🚪', 'Realmwalker', 11_500],
  ['🧊', 'Dimensional', 12_800],
  ['🌌', 'Multiversal', 14_200],
  ['👁️', 'Omniversal', 15_900],
  ['💥', 'Hypernova', 17_700],
  ['💣', 'Supernova', 19_700],
  ['🌱', 'Genesis', 22_000],
  ['☄️', 'Apocalypse', 24_500],
  ['Ω', 'Omega', 27_300],
  ['α', 'Alpha', 30_400],
  ['♾️', 'Infinity', 33_900],
  ['⌛', 'Eternity', 37_700],
  ['🧵', 'Fatebound', 42_000],
  ['🎯', 'Destiny', 46_800],
  ['🌈', 'Miracle', 52_200],
  ['🧿', 'Anomaly', 58_100],
  ['🔴', 'Absolute', 64_800],
  ['🔺', 'Apex', 72_200],
  ['🔢', 'Transfinite', 80_400],
  ['💠', 'Crystalline', 89_600],
  ['🟩', 'Emeraldborn', 99_900],
  ['💙', 'Sapphireborn', 111_000],
  ['❤️', 'Rubyblood', 124_000],
  ['💜', 'Amethyst Soul', 138_000],
  ['🟨', 'Goldheart', 154_000],
  ['🪨', 'Obsidian Core', 172_000],
  ['🧪', 'Alchemic', 191_000],
  ['🪬', 'Runic', 213_000],
  ['🦋', 'Faeblessed', 237_000],
  ['🍃', 'Wildborn', 264_000],
  ['🌿', 'Verdant', 295_000],
  ['🌺', 'Blooming', 328_000],
  ['🍄', 'Sporebound', 366_000],
  ['🐝', 'Honeyed', 408_000],
  ['🕸️', 'Webbed', 454_000],
  ['🦂', 'Venomfang', 506_000],
  ['🐍', 'Serpentkin', 564_000],
  ['🦇', 'Nightwing', 628_000],
  ['🦉', 'Owlseer', 700_000],
  ['🦊', 'Trickster', 780_000],
  ['🐺', 'Moonhowl', 869_000],
  ['🦌', 'Forestborn', 968_000],
  ['🐗', 'Ironhide', 1_080_000],
  ['🦅', 'Skyhunter', 1_200_000],
  ['🦈', 'Deepfang', 1_340_000],
  ['🐬', 'Tidesoul', 1_490_000],
  ['🐚', 'Seablessed', 1_660_000],
  ['🌊', 'Tidal', 1_850_000],
  ['🧜', 'Oceanic', 2_070_000],
  ['🧊', 'Frostborn', 2_300_000],
  ['❄️', 'Snowveil', 2_560_000],
  ['🌨️', 'Blizzard', 2_860_000],
  ['☃️', 'Winterbound', 3_180_000],
  ['🔥', 'Ember', 3_550_000],
  ['🌋', 'Volcanic', 3_950_000],
  ['🧨', 'Explosive', 4_400_000],
  ['💥', 'Cataclysmic', 4_910_000],
  ['⚡', 'Thunderborn', 5_470_000],
  ['🌩️', 'Stormcaller', 6_090_000],
  ['⛈️', 'Tempest', 6_790_000],
  ['🌪️', 'Tornado', 7_560_000],
  ['💨', 'Windwalker', 8_430_000],
  ['🌫️', 'Mistwalker', 9_390_000],
  ['🌁', 'Fogbound', 10_500_000],
  ['🏜️', 'Mirage', 11_700_000],
  ['🏝️', 'Oasis', 13_000_000],
  ['🌋', 'Magmaborn', 14_500_000],
  ['🪵', 'Elderwood', 16_100_000],
  ['🌳', 'Worldtree', 18_000_000],
  ['🪓', 'Warlord', 20_000_000],
  ['⚔️', 'Blademaster', 22_300_000],
  ['🏹', 'Sharpshot', 24_900_000],
  ['🛡️', 'Guardian', 27_700_000],
  ['🗡️', 'Assassin', 30_900_000],
  ['🥷', 'Nightblade', 34_400_000],
  ['🪄', 'Spellbinder', 38_300_000],
  ['📖', 'Lorekeeper', 42_700_000],
  ['🧙', 'Archmage', 47_600_000],
  ['🧝', 'Elven', 53_000_000],
  ['🧛', 'Vampiric', 59_100_000],
  ['🧟', 'Undying', 65_800_000],
  ['💀', 'Deathmarked', 73_400_000],
  ['☠️', 'Plagueborn', 81_700_000],
  ['🩸', 'Bloodmoon', 91_100_000],
  ['🦴', 'Bonelord', 101_000_000],
  ['🪦', 'Gravebound', 113_000_000],
  ['🕯️', 'Candlelit', 126_000_000],
  ['🔔', 'Oathbound', 140_000_000],
  ['📿', 'Prayerborn', 156_000_000],
  ['🧘', 'Enlightened', 174_000_000],
  ['🪷', 'Lotus', 194_000_000],
  ['🛕', 'Templeborn', 216_000_000],
  ['🏛️', 'Oracle', 241_000_000],
  ['👁️', 'Seer', 269_000_000],
  ['🧿', 'Warded', 299_000_000],
  ['🪞', 'Mirrorborn', 334_000_000],
  ['🎭', 'Masked', 372_000_000],
  ['🎲', 'Gambler', 414_000_000],
  ['🃏', 'Joker', 461_000_000],
  ['🎰', 'Jackpot', 514_000_000],
  ['💰', 'Treasureborn', 573_000_000],
  ['💎', 'Gemlord', 638_000_000],
  ['🪙', 'Coinblessed', 711_000_000],
  ['🔑', 'Keymaster', 793_000_000],
  ['🚪', 'Gatekeeper', 883_000_000],
  ['🧭', 'Wayfinder', 984_000_000],
  ['🗺️', 'Mapless', 1_100_000_000],
  ['🛤️', 'Pathbreaker', 1_220_000_000],
  ['🧱', 'Ironwall', 1_360_000_000],
  ['⚙️', 'Gearforged', 1_520_000_000],
  ['🔩', 'Steelforged', 1_690_000_000],
  ['🧲', 'Magnetized', 1_880_000_000],
  ['🔋', 'Charged', 2_100_000_000],
  ['💡', 'Enlightener', 2_340_000_000],
  ['📡', 'Signalborn', 2_610_000_000],
  ['🛰️', 'Satellite', 2_900_000_000],
  ['🚀', 'Rocketborn', 3_230_000_000],
  ['🛸', 'Starship', 3_600_000_000],
  ['🤖', 'Mechborn', 4_020_000_000],
  ['🧬', 'Mutated', 4_480_000_000],
  ['🧫', 'Bioforge', 4_990_000_000],
  ['🦠', 'Viral', 5_560_000_000],
  ['🧪', 'Toxic', 6_190_000_000],
  ['☣️', 'Hazard', 6_900_000_000],
  ['☢️', 'Radioactive', 7_690_000_000],
  ['⚗️', 'Catalyst', 8_560_000_000],
  ['🌀', 'Vortex', 9_540_000_000],
  ['🔮', 'Farseer', 10_600_000_000],
  ['🕰️', 'Chronoborn', 11_800_000_000],
  ['⏱️', 'Timekeeper', 13_200_000_000],
  ['⌚', 'Clockwork', 14_700_000_000],
  ['⌛', 'Sandbound', 16_400_000_000],
  ['🧵', 'Threaded', 18_300_000_000],
  ['🪡', 'Stitchborn', 20_400_000_000],
  ['🧶', 'Loomed', 22_700_000_000],
  ['🕸️', 'Fatewoven', 25_300_000_000],
  ['🔗', 'Chainbound', 28_200_000_000],
  ['⛓️', 'Shackled', 31_400_000_000],
  ['🗡️', 'Oathbreaker', 35_000_000_000],
  ['💢', 'Rageborn', 38_900_000_000],
  ['🧯', 'Ashen', 43_400_000_000],
  ['🌑', 'Darkstar', 48_400_000_000],
  ['🌒', 'Crescent', 53_900_000_000],
  ['🌓', 'Halfmoon', 60_000_000_000],
  ['🌔', 'Waxing', 66_900_000_000],
  ['🌕', 'Fullmoon', 74_500_000_000],
  ['🌖', 'Waning', 83_100_000_000],
  ['🌗', 'Duskmoon', 92_500_000_000],
  ['🌘', 'Blood Eclipse', 103_000_000_000],
  ['🌞', 'Dawnbringer', 115_000_000_000],
  ['🌅', 'Sunrise', 128_000_000_000],
  ['🌄', 'Daybreak', 143_000_000_000],
  ['🌆', 'Twilight', 159_000_000_000],
  ['🌃', 'Midnight', 177_000_000_000],
  ['🌌', 'Nightfall', 197_000_000_000],
  ['🌠', 'Starfall', 220_000_000_000],
  ['☄️', 'Cometborn', 245_000_000_000],
  ['🪐', 'Planetary', 273_000_000_000],
  ['🛰️', 'Orbital', 304_000_000_000],
  ['🌌', 'Starcluster', 339_000_000_000],
  ['🌫️', 'Stardust', 378_000_000_000],
  ['🕳️', 'Blackhole', 421_000_000_000],
  ['⚫', 'Event Horizon', 469_000_000_000],
  ['🔭', 'Voidseer', 523_000_000_000],
  ['🧿', 'Cosmic Eye', 582_000_000_000],
  ['🌀', 'Spiralborn', 649_000_000_000],
  ['🧊', 'Spacefrost', 723_000_000_000],
  ['🔥', 'Solarflare', 805_000_000_000],
  ['⚡', 'Pulsar', 897_000_000_000],
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
  record.pendingLuckMultiplier = Math.max(1, Number(record.pendingLuckMultiplier) || 1);
  return record;
}

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components: [{ type: 10, content }] }],
  };
}

function replyWithoutPing(message, payload) {
  const options = typeof payload === 'string' ? { content: payload } : payload;
  return message.reply({
    ...options,
    allowedMentions: {
      ...options.allowedMentions,
      repliedUser: false,
    },
  });
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

function formatLuckBoostPercent(multiplier) {
  const boostPercent = (Math.max(1, Number(multiplier) || 1) - 1) * 100;
  return Number(boostPercent.toFixed(2)).toLocaleString('en-US');
}

function rarityLabel(roll) {
  return roll ? `${roll.emoji} ${roll.name}` : 'None';
}

function rarityLabelWithPercent(roll) {
  return roll ? `${rarityLabel(roll)} \`(${formatPercent(roll.denominator)}%)\`` : rarityLabel(roll);
}

function accentForDenominator(denominator) {
  const threshold = [...ROLE_THRESHOLDS].reverse().find((item) => denominator >= item.denominator);
  if (threshold) return threshold.color;
  if (denominator >= 100) return 0x9B59B6;
  if (denominator >= 10) return 0x3498DB;
  if (denominator >= 4) return 0x57F287;
  return 0xFFFFFF;
}

function rollRarity(luckMultiplier = 1) {
  const safeLuckMultiplier = Math.max(1, Number(luckMultiplier) || 1);
  let best = RARITIES[0];
  for (const rarity of RARITIES) {
    const chance = Math.min(1, safeLuckMultiplier / rarity.denominator);
    if (Math.random() < chance && rarity.denominator > best.denominator) {
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

function nextFiveMinuteBoundaryUtcPlus7(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const nextMinutes = (Math.floor(shifted.getUTCMinutes() / 5) + 1) * 5;
  shifted.setUTCMinutes(nextMinutes, 0, 0);
  return new Date(shifted.getTime() - (7 * 60 * 60 * 1000));
}

function buildRollPayload(rarity, isNewRecord, boostLines = []) {
  const lines = [
    `## You have rolled ${rarityLabel(rarity)}`,
    `-# ${formatPercent(rarity.denominator)}%`,
  ];
  lines.push(...boostLines);
  if (isNewRecord) lines.push('-# **You have achieved a new RECORD!**');
  return container(accentForDenominator(rarity.denominator), lines.join('\n'));
}

function buildMyRarestPayload(userId) {
  const state = loadState();
  const record = getUserRecord(state, userId);
  const [first, second, third] = record.topRolls;
  const rank = getRankedUsers(state).findIndex((entry) => entry.userId === userId) + 1;
  return container(0xFFFFFF, [
    `### Rarest rarity rolled: ${rarityLabelWithPercent(first)}`,
    `-# * 2nd rarest: ${rarityLabelWithPercent(second)}`,
    `-# * 3rd rarest: ${rarityLabelWithPercent(third)}`,
    '',
    '-# ━━━━━━━━━━━━━━━━━━',
    `-# Leaderboard rank: ${rank > 0 ? `${rank}#` : 'Unranked'}`,
  ].join('\n'));
}

function buildLeaderboardPayload(guild) {
  const state = loadState();
  const status = getEventStatus();
  const rankedUsers = getRankedUsers(state);
  const totalParticipations = rankedUsers.length;
  const ranked = rankedUsers.slice(0, 10);
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
    lines.push('');
    lines.push(`-# * Total participations: ${formatNumber(totalParticipations)}`);
    lines.push(`-# Refresh: <t:${Math.floor(nextFiveMinuteBoundaryUtcPlus7().getTime() / 1000)}:R>`);
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
  const nextRefresh = nextFiveMinuteBoundaryUtcPlus7();
  const nextTime = status === 'before'
    ? Math.min(EVENT_START_AT, nextRefresh.getTime())
    : Math.min(EVENT_END_AT, nextRefresh.getTime());
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

async function announceRareRoll(client, userId, rarity, totalLuckMultiplier = 1) {
  const threshold = getRollThreshold(rarity.denominator);
  if (!threshold) return;
  const channel = await getTextChannel(client, ANNOUNCE_CHANNEL_ID);
  if (!channel) return;
  const color = await getRoleColor(channel.guild, threshold);
  const pingContent = rngNotificationStore.shouldNotify(userId, rarity.denominator) ? `<@${userId}>` : undefined;
  const lines = [
    `## <@${userId}> has rolled ${rarityLabel(rarity)}`,
    `with a chance of 1 in ${formatNumber(rarity.denominator)}! \`(${formatPercent(rarity.denominator)}%)\``,
  ];
  if (totalLuckMultiplier > 1) lines.push(`With ${formatLuckBoostPercent(totalLuckMultiplier)}% boost`);
  await channel.send({
    content: pingContent,
    allowedMentions: pingContent ? { users: [userId] } : { users: [] },
    ...container(color, lines.join('\n')),
  }).catch(() => null);
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

function getMilestoneLuckMultiplier(totalRolls) {
  const safeRolls = Math.max(0, Math.floor(Number(totalRolls) || 0));
  if (safeRolls > 0 && safeRolls % 100 === 0) return 5;
  if (safeRolls > 0 && safeRolls % 10 === 0) return 1.5;
  return 1;
}

function getLuckBoostLines({ personalMultiplier, globalBoost, earnedNextMultiplier }) {
  const lines = [];
  if (personalMultiplier > 1) lines.push(`-# Personal next-roll luck boost used: ${formatMultiplier(personalMultiplier)}`);
  if (globalBoost?.multiplier > 1) lines.push(`-# Server luck boost active: ${formatMultiplier(globalBoost.multiplier)} until <t:${Math.floor(globalBoost.endsAt / 1000)}:R>`);
  if (earnedNextMultiplier > 1) lines.push(`-# You earned ${formatMultiplier(earnedNextMultiplier)} luck for your next roll!`);
  return lines;
}

async function handleRollMessage(message, client) {
  if (message.author?.bot || message.content.trim().toLowerCase() !== '!roll') return false;
  if (!ROLL_CHANNEL_IDS.has(message.channelId)) {
    await replyWithoutPing(message, container(0xED4245, `Use !roll in <#${PRIMARY_ROLL_CHANNEL_ID}>.`)).catch(() => null);
    return true;
  }
  const progress = levelingManager.getUserProgress(message.guild.id, message.author.id);
  if (progress.level < MIN_ROLL_LEVEL) {
    await replyWithoutPing(message, container(0xED4245, `### You need chat level ${MIN_ROLL_LEVEL} to use !roll.
-# Your current level is ${progress.level}.`)).catch(() => null);
    return true;
  }

  const status = getEventStatus();
  if (status === 'before') {
    await replyWithoutPing(message, container(0xFFFFFF, `### RNG event has not started yet.\n-# Starts: <t:${Math.floor(EVENT_START_AT / 1000)}:R>`)).catch(() => null);
    return true;
  }
  if (status === 'ended') {
    await replyWithoutPing(message, container(0xED4245, '### RNG event has ended.\n-# !roll is now disabled.')).catch(() => null);
    return true;
  }

  if (getRollCooldownUntil(message.author.id) > Date.now()) return true;
  setRollCooldown(message.author.id);

  const state = loadState();
  const record = getUserRecord(state, message.author.id);
  const personalLuckMultiplier = record.pendingLuckMultiplier;
  record.pendingLuckMultiplier = 1;
  const globalBoost = getActiveBoost();
  const totalLuckMultiplier = personalLuckMultiplier * (globalBoost?.multiplier || 1);
  const rarity = rollRarity(totalLuckMultiplier);
  const isFirstRoll = !record.firstRolledAt;
  const achievedAt = Date.now();
  const previousBest = record.best?.denominator || 0;
  const isNewRecord = rarity.denominator > previousBest;
  const rollRecord = { emoji: rarity.emoji, name: rarity.name, denominator: rarity.denominator, achievedAt };

  record.totalRolls += 1;
  const earnedNextMultiplier = getMilestoneLuckMultiplier(record.totalRolls);
  record.pendingLuckMultiplier = earnedNextMultiplier;
  if (isFirstRoll) record.firstRolledAt = achievedAt;
  if (isNewRecord) record.best = rollRecord;
  updateTopRolls(record, rollRecord);
  saveState(state);

  await replyWithoutPing(message, buildRollPayload(rarity, isNewRecord, getLuckBoostLines({
    personalMultiplier: personalLuckMultiplier,
    globalBoost,
    earnedNextMultiplier,
  }))).catch(() => null);
  await assignRollRoles(message.member, rarity.denominator, isFirstRoll);
  await announceRareRoll(client, message.author.id, rarity, totalLuckMultiplier);
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
