const fs = require('fs');
const path = require('path');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const rngNotificationStore = require('../src/rngNotificationStore');
const {
  MIN_RARE_ANNOUNCE_DENOMINATOR,
  getBaseRollDenominator,
  shouldAnnounceRareRoll,
} = require('../src/rngAnnouncementRules');
const { consumeActiveBoostRoll, formatMultiplier, formatRollCount, getActiveBoost } = require('../src/luckBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-rolls.json');
const ROLL_CHANNEL_ID_LIST = ['1503708687569522778', '1503763965497315458', '1503773311547478196', '1503779472329936988'];
const ROLL_CHANNEL_IDS = new Set(ROLL_CHANNEL_ID_LIST);
const PRIMARY_ROLL_CHANNEL_ID = ROLL_CHANNEL_ID_LIST[0];
const LEADERBOARD_CHANNEL_ID = '1503738887929856121';
const RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID = '1498300014114377860';
const RARE_ROLL_LOG_THREAD_ID = '1495783372591730750';
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
  ['⚪', 'Common', 2, 2], // final: 1/2
  ['🟢', 'Uncommon', 1.5, 3], // final: 1/3
  ['🪙', 'Scarce', 1.333333, 4], // final: 1/4
  ['🌀', 'Unusual', 1.25, 5], // final: 1/5
  ['🔵', 'Rare', 1.2, 6], // final: 1/6
  ['✨', 'Fine', 1.166667, 7], // final: 1/7
  ['🔱', 'Superior', 1.142857, 8], // final: 1/8
  ['🏅', 'Elite', 1.125, 9], // final: 1/9
  ['🟣', 'Epic', 1.111111, 10], // final: 1/10
  ['👑', 'Grand', 1.1, 11], // final: 1/11
  ['🐉', 'Mythic', 1.090909, 12], // final: 1/12
  ['🌟', 'Legendary', 1.083333, 13], // final: 1/13
  ['📜', 'Ancient', 1.076923, 14], // final: 1/14
  ['🔮', 'Mystic', 1.071429, 15], // final: 1/15
  ['🧙', 'Arcane', 1.066667, 16], // final: 1/16
  ['🪄', 'Enchanted', 1.0625, 17], // final: 1/17
  ['🌌', 'Celestial', 1.058824, 18], // final: 1/18
  ['💫', 'Radiant', 1.055556, 19], // final: 1/19
  ['🪐', 'Astral', 1.052632, 20], // final: 1/20
  ['🌙', 'Lunar', 1.05, 21], // final: 1/21
  ['☀️', 'Solar', 1.047619, 22], // final: 1/22
  ['🌘', 'Eclipse', 1.045455, 23], // final: 1/23
  ['🌫️', 'Nebula', 1.043478, 24], // final: 1/24
  ['✴️', 'Stellar', 1.041667, 25], // final: 1/25
  ['🌌', 'Cosmic', 1.08, 27], // final: 1/27
  ['🛸', 'Galactic', 1.111111, 30], // final: 1/30
  ['⚫', 'Void', 1.1, 33], // final: 1/33
  ['👻', 'Phantom', 1.121212, 37], // final: 1/37
  ['🕯️', 'Spectral', 1.108108, 41], // final: 1/41
  ['🪽', 'Ethereal', 1.121951, 46], // final: 1/46
  ['🕰️', 'Forgotten', 1.108696, 51], // final: 1/51
  ['🧭', 'Lost', 1.117647, 57], // final: 1/57
  ['🚫', 'Forbidden', 1.122807, 64], // final: 1/64
  ['🤫', 'Secret', 1.109375, 71], // final: 1/71
  ['🗝️', 'Hidden', 1.112676, 79], // final: 1/79
  ['🏺', 'Relic', 1.113924, 88], // final: 1/88
  ['🦴', 'Primal', 1.113636, 98], // final: 1/98
  ['🐺', 'Savage', 1.122449, 110], // final: 1/110
  ['🏰', 'Royal', 1.109091, 122], // final: 1/122
  ['🦅', 'Imperial', 1.114754, 136], // final: 1/136
  ['😇', 'Divine', 1.110294, 151], // final: 1/151
  ['🕊️', 'Sacred', 1.119205, 169], // final: 1/169
  ['🙏', 'Blessed', 1.112426, 188], // final: 1/188
  ['👼', 'Angelic', 1.117021, 210], // final: 1/210
  ['🪽', 'Seraphic', 1.114286, 234], // final: 1/234
  ['😈', 'Demonic', 1.111111, 260], // final: 1/260
  ['🔥', 'Infernal', 1.115385, 290], // final: 1/290
  ['🕳️', 'Abyssal', 1.113793, 323], // final: 1/323
  ['🌑', 'Shadow', 1.114551, 360], // final: 1/360
  ['🖤', 'Darkmatter', 1.113889, 401], // final: 1/401
  ['⚛️', 'Quantum', 1.114713, 447], // final: 1/447
  ['🕳️', 'Singularity', 1.114094, 498], // final: 1/498
  ['🔁', 'Paradox', 1.114458, 555], // final: 1/555
  ['⏳', 'Timeless', 1.113514, 618], // final: 1/618
  ['♾️', 'Eternal', 1.114887, 689], // final: 1/689
  ['🗿', 'Immortal', 1.114659, 768], // final: 1/768
  ['⚡', 'Godly', 1.113281, 855], // final: 1/855
  ['🏆', 'Supreme', 1.11462, 953], // final: 1/953
  ['👑', 'Sovereign', 1.112277, 1060], // final: 1/1,060
  ['🦁', 'Emperor', 1.113208, 1180], // final: 1/1,180
  ['🛡️', 'Overlord', 1.118644, 1320], // final: 1/1,320
  ['🔺', 'Ascended', 1.113636, 1470], // final: 1/1,470
  ['🧬', 'Transcendent', 1.115646, 1640], // final: 1/1,640
  ['🌀', 'Reality-Bent', 1.109756, 1820], // final: 1/1,820
  ['💭', 'Dreambound', 1.115385, 2030], // final: 1/2,030
  ['👻', 'Soulbound', 1.1133, 2260], // final: 1/2,260
  ['🌬️', 'Spiritforge', 1.115044, 2520], // final: 1/2,520
  ['⭐', 'Starforged', 1.115079, 2810], // final: 1/2,810
  ['🌕', 'Moonforged', 1.113879, 3130], // final: 1/3,130
  ['🔆', 'Sunforged', 1.115016, 3490], // final: 1/3,490
  ['🗿', 'Titan', 1.114613, 3890], // final: 1/3,890
  ['🏔️', 'Colossus', 1.113111, 4330], // final: 1/4,330
  ['🐲', 'Dragon', 1.115473, 4830], // final: 1/4,830
  ['🐋', 'Leviathan', 1.113872, 5380], // final: 1/5,380
  ['🔥', 'Phoenix', 1.115242, 6000], // final: 1/6,000
  ['🦑', 'Kraken', 1.113333, 6680], // final: 1/6,680
  ['🐾', 'Chimera', 1.113772, 7440], // final: 1/7,440
  ['🐍', 'Hydra', 1.114247, 8290], // final: 1/8,290
  ['🐘', 'Behemoth', 1.114596, 9240], // final: 1/9,240
  ['🌍', 'Worldbreaker', 1.114719, 10300], // final: 1/10,300
  ['🚪', 'Realmwalker', 1.116505, 11500], // final: 1/11,500
  ['🧊', 'Dimensional', 1.113043, 12800], // final: 1/12,800
  ['🌌', 'Multiversal', 1.109375, 14200], // final: 1/14,200
  ['👁️', 'Omniversal', 1.119718, 15900], // final: 1/15,900
  ['💥', 'Hypernova', 1.113208, 17700], // final: 1/17,700
  ['💣', 'Supernova', 1.112994, 19700], // final: 1/19,700
  ['🌱', 'Genesis', 1.116751, 22000], // final: 1/22,000
  ['☄️', 'Apocalypse', 1.113636, 24500], // final: 1/24,500
  ['Ω', 'Omega', 1.114286, 27300], // final: 1/27,300
  ['α', 'Alpha', 1.113553, 30400], // final: 1/30,400
  ['♾️', 'Infinity', 1.115132, 33900], // final: 1/33,900
  ['⌛', 'Eternity', 1.112094, 37700], // final: 1/37,700
  ['🧵', 'Fatebound', 1.114058, 42000], // final: 1/42,000
  ['🎯', 'Destiny', 1.114286, 46800], // final: 1/46,800
  ['🌈', 'Miracle', 1.115385, 52200], // final: 1/52,200
  ['🧿', 'Anomaly', 1.113027, 58100], // final: 1/58,100
  ['🔴', 'Absolute', 1.115318, 64800], // final: 1/64,800
  ['🔺', 'Apex', 1.114198, 72200], // final: 1/72,200
  ['🔢', 'Transfinite', 1.113573, 80400], // final: 1/80,400
  ['💠', 'Crystalline', 1.114428, 89600], // final: 1/89,600
  ['🟩', 'Emeraldborn', 1.114955, 99900], // final: 1/99,900
  ['💙', 'Sapphireborn', 1.111111, 111000], // final: 1/111,000
  ['❤️', 'Rubyblood', 1.117117, 124000], // final: 1/124,000
  ['💜', 'Amethyst Soul', 1.112903, 138000], // final: 1/138,000
  ['🟨', 'Goldheart', 1.115942, 154000], // final: 1/154,000
  ['🪨', 'Obsidian Core', 1.116883, 172000], // final: 1/172,000
  ['🧪', 'Alchemic', 1.110465, 191000], // final: 1/191,000
  ['🪬', 'Runic', 1.115183, 213000], // final: 1/213,000
  ['🦋', 'Faeblessed', 1.112676, 237000], // final: 1/237,000
  ['🍃', 'Wildborn', 1.113924, 264000], // final: 1/264,000
  ['🌿', 'Verdant', 1.117424, 295000], // final: 1/295,000
  ['🌺', 'Blooming', 1.111864, 328000], // final: 1/328,000
  ['🍄', 'Sporebound', 1.115854, 366000], // final: 1/366,000
  ['🐝', 'Honeyed', 1.114754, 408000], // final: 1/408,000
  ['🕸️', 'Webbed', 1.112745, 454000], // final: 1/454,000
  ['🦂', 'Venomfang', 1.114537, 506000], // final: 1/506,000
  ['🐍', 'Serpentkin', 1.114625, 564000], // final: 1/564,000
  ['🦇', 'Nightwing', 1.113475, 628000], // final: 1/628,000
  ['🦉', 'Owlseer', 1.11465, 700000], // final: 1/700,000
  ['🦊', 'Trickster', 1.114286, 780000], // final: 1/780,000
  ['🐺', 'Moonhowl', 1.114103, 869000], // final: 1/869,000
  ['🦌', 'Forestborn', 1.113924, 968000], // final: 1/968,000
  ['🐗', 'Ironhide', 1.115702, 1080000], // final: 1/1,080,000
  ['🦅', 'Skyhunter', 1.111111, 1200000], // final: 1/1,200,000
  ['🦈', 'Deepfang', 1.116667, 1340000], // final: 1/1,340,000
  ['🐬', 'Tidesoul', 1.11194, 1490000], // final: 1/1,490,000
  ['🐚', 'Seablessed', 1.114094, 1660000], // final: 1/1,660,000
  ['🌊', 'Tidal', 1.114458, 1850000], // final: 1/1,850,000
  ['🧜', 'Oceanic', 1.118919, 2070000], // final: 1/2,070,000
  ['🧊', 'Frostborn', 1.111111, 2300000], // final: 1/2,300,000
  ['❄️', 'Snowveil', 1.113043, 2560000], // final: 1/2,560,000
  ['🌨️', 'Blizzard', 1.117188, 2860000], // final: 1/2,860,000
  ['☃️', 'Winterbound', 1.111888, 3180000], // final: 1/3,180,000
  ['🔥', 'Ember', 1.116352, 3550000], // final: 1/3,550,000
  ['🌋', 'Volcanic', 1.112676, 3950000], // final: 1/3,950,000
  ['🧨', 'Explosive', 1.113924, 4400000], // final: 1/4,400,000
  ['💥', 'Cataclysmic', 1.115909, 4910000], // final: 1/4,910,000
  ['⚡', 'Thunderborn', 1.114053, 5470000], // final: 1/5,470,000
  ['🌩️', 'Stormcaller', 1.113346, 6090000], // final: 1/6,090,000
  ['⛈️', 'Tempest', 1.114943, 6790000], // final: 1/6,790,000
  ['🌪️', 'Tornado', 1.113402, 7560000], // final: 1/7,560,000
  ['💨', 'Windwalker', 1.115079, 8430000], // final: 1/8,430,000
  ['🌫️', 'Mistwalker', 1.113879, 9390000], // final: 1/9,390,000
  ['🌁', 'Fogbound', 1.118211, 10500000], // final: 1/10,500,000
  ['🏜️', 'Mirage', 1.114286, 11700000], // final: 1/11,700,000
  ['🏝️', 'Oasis', 1.111111, 13000000], // final: 1/13,000,000
  ['🌋', 'Magmaborn', 1.115385, 14500000], // final: 1/14,500,000
  ['🪵', 'Elderwood', 1.110345, 16100000], // final: 1/16,100,000
  ['🌳', 'Worldtree', 1.118012, 18000000], // final: 1/18,000,000
  ['🪓', 'Warlord', 1.111111, 20000000], // final: 1/20,000,000
  ['⚔️', 'Blademaster', 1.115, 22300000], // final: 1/22,300,000
  ['🏹', 'Sharpshot', 1.116592, 24900000], // final: 1/24,900,000
  ['🛡️', 'Guardian', 1.11245, 27700000], // final: 1/27,700,000
  ['🗡️', 'Assassin', 1.115523, 30900000], // final: 1/30,900,000
  ['🥷', 'Nightblade', 1.113269, 34400000], // final: 1/34,400,000
  ['🪄', 'Spellbinder', 1.113372, 38300000], // final: 1/38,300,000
  ['📖', 'Lorekeeper', 1.114883, 42700000], // final: 1/42,700,000
  ['🧙', 'Archmage', 1.114754, 47600000], // final: 1/47,600,000
  ['🧝', 'Elven', 1.113445, 53000000], // final: 1/53,000,000
  ['🧛', 'Vampiric', 1.115094, 59100000], // final: 1/59,100,000
  ['🧟', 'Undying', 1.113367, 65800000], // final: 1/65,800,000
  ['💀', 'Deathmarked', 1.115502, 73400000], // final: 1/73,400,000
  ['☠️', 'Plagueborn', 1.113079, 81700000], // final: 1/81,700,000
  ['🩸', 'Bloodmoon', 1.115055, 91100000], // final: 1/91,100,000
  ['🦴', 'Bonelord', 1.108672, 101000000], // final: 1/101,000,000
  ['🪦', 'Gravebound', 1.118812, 113000000], // final: 1/113,000,000
  ['🕯️', 'Candlelit', 1.115044, 126000000], // final: 1/126,000,000
  ['🔔', 'Oathbound', 1.111111, 140000000], // final: 1/140,000,000
  ['📿', 'Prayerborn', 1.114286, 156000000], // final: 1/156,000,000
  ['🧘', 'Enlightened', 1.115385, 174000000], // final: 1/174,000,000
  ['🪷', 'Lotus', 1.114943, 194000000], // final: 1/194,000,000
  ['🛕', 'Templeborn', 1.113402, 216000000], // final: 1/216,000,000
  ['🏛️', 'Oracle', 1.115741, 241000000], // final: 1/241,000,000
  ['👁️', 'Seer', 1.116183, 269000000], // final: 1/269,000,000
  ['🧿', 'Warded', 1.111524, 299000000], // final: 1/299,000,000
  ['🪞', 'Mirrorborn', 1.117057, 334000000], // final: 1/334,000,000
  ['🎭', 'Masked', 1.113772, 372000000], // final: 1/372,000,000
  ['🎲', 'Gambler', 1.112903, 414000000], // final: 1/414,000,000
  ['🃏', 'Joker', 1.113527, 461000000], // final: 1/461,000,000
  ['🎰', 'Jackpot', 1.114967, 514000000], // final: 1/514,000,000
  ['💰', 'Treasureborn', 1.114786, 573000000], // final: 1/573,000,000
  ['💎', 'Gemlord', 1.113438, 638000000], // final: 1/638,000,000
  ['🪙', 'Coinblessed', 1.11442, 711000000], // final: 1/711,000,000
  ['🔑', 'Keymaster', 1.115331, 793000000], // final: 1/793,000,000
  ['🚪', 'Gatekeeper', 1.113493, 883000000], // final: 1/883,000,000
  ['🧭', 'Wayfinder', 1.114383, 984000000], // final: 1/984,000,000
  ['🗺️', 'Mapless', 1.117886, 1100000000], // final: 1/1,100,000,000
  ['🛤️', 'Pathbreaker', 1.109091, 1220000000], // final: 1/1,220,000,000
  ['🧱', 'Ironwall', 1.114754, 1360000000], // final: 1/1,360,000,000
  ['⚙️', 'Gearforged', 1.117647, 1520000000], // final: 1/1,520,000,000
  ['🔩', 'Steelforged', 1.111842, 1690000000], // final: 1/1,690,000,000
  ['🧲', 'Magnetized', 1.112426, 1880000000], // final: 1/1,880,000,000
  ['🔋', 'Charged', 1.117021, 2100000000], // final: 1/2,100,000,000
  ['💡', 'Enlightener', 1.114286, 2340000000], // final: 1/2,340,000,000
  ['📡', 'Signalborn', 1.115385, 2610000000], // final: 1/2,610,000,000
  ['🛰️', 'Satellite', 1.111111, 2900000000], // final: 1/2,900,000,000
  ['🚀', 'Rocketborn', 1.113793, 3230000000], // final: 1/3,230,000,000
  ['🛸', 'Starship', 1.114551, 3600000000], // final: 1/3,600,000,000
  ['🤖', 'Mechborn', 1.116667, 4020000000], // final: 1/4,020,000,000
  ['🧬', 'Mutated', 1.114428, 4480000000], // final: 1/4,480,000,000
  ['🧫', 'Bioforge', 1.113839, 4990000000], // final: 1/4,990,000,000
  ['🦠', 'Viral', 1.114228, 5560000000], // final: 1/5,560,000,000
  ['🧪', 'Toxic', 1.113309, 6190000000], // final: 1/6,190,000,000
  ['☣️', 'Hazard', 1.114701, 6900000000], // final: 1/6,900,000,000
  ['☢️', 'Radioactive', 1.114493, 7690000000], // final: 1/7,690,000,000
  ['⚗️', 'Catalyst', 1.113134, 8560000000], // final: 1/8,560,000,000
  ['🌀', 'Vortex', 1.114486, 9540000000], // final: 1/9,540,000,000
  ['🔮', 'Farseer', 1.111111, 10600000000], // final: 1/10,600,000,000
  ['🕰️', 'Chronoborn', 1.113208, 11800000000], // final: 1/11,800,000,000
  ['⏱️', 'Timekeeper', 1.118644, 13200000000], // final: 1/13,200,000,000
  ['⌚', 'Clockwork', 1.113636, 14700000000], // final: 1/14,700,000,000
  ['⌛', 'Sandbound', 1.115646, 16400000000], // final: 1/16,400,000,000
  ['🧵', 'Threaded', 1.115854, 18300000000], // final: 1/18,300,000,000
  ['🪡', 'Stitchborn', 1.114754, 20400000000], // final: 1/20,400,000,000
  ['🧶', 'Loomed', 1.112745, 22700000000], // final: 1/22,700,000,000
  ['🕸️', 'Fatewoven', 1.114537, 25300000000], // final: 1/25,300,000,000
  ['🔗', 'Chainbound', 1.114625, 28200000000], // final: 1/28,200,000,000
  ['⛓️', 'Shackled', 1.113475, 31400000000], // final: 1/31,400,000,000
  ['🗡️', 'Oathbreaker', 1.11465, 35000000000], // final: 1/35,000,000,000
  ['💢', 'Rageborn', 1.111429, 38900000000], // final: 1/38,900,000,000
  ['🧯', 'Ashen', 1.115681, 43400000000], // final: 1/43,400,000,000
  ['🌑', 'Darkstar', 1.115207, 48400000000], // final: 1/48,400,000,000
  ['🌒', 'Crescent', 1.113636, 53900000000], // final: 1/53,900,000,000
  ['🌓', 'Halfmoon', 1.113173, 60000000000], // final: 1/60,000,000,000
  ['🌔', 'Waxing', 1.115, 66900000000], // final: 1/66,900,000,000
  ['🌕', 'Fullmoon', 1.113602, 74500000000], // final: 1/74,500,000,000
  ['🌖', 'Waning', 1.115436, 83100000000], // final: 1/83,100,000,000
  ['🌗', 'Duskmoon', 1.113117, 92500000000], // final: 1/92,500,000,000
  ['🌘', 'Blood Eclipse', 1.113514, 103000000000], // final: 1/103,000,000,000
  ['🌞', 'Dawnbringer', 1.116505, 115000000000], // final: 1/115,000,000,000
  ['🌅', 'Sunrise', 1.113043, 128000000000], // final: 1/128,000,000,000
  ['🌄', 'Daybreak', 1.117188, 143000000000], // final: 1/143,000,000,000
  ['🌆', 'Twilight', 1.111888, 159000000000], // final: 1/159,000,000,000
  ['🌃', 'Midnight', 1.113208, 177000000000], // final: 1/177,000,000,000
  ['🌌', 'Nightfall', 1.112994, 197000000000], // final: 1/197,000,000,000
  ['🌠', 'Starfall', 1.116751, 220000000000], // final: 1/220,000,000,000
  ['☄️', 'Cometborn', 1.113636, 245000000000], // final: 1/245,000,000,000
  ['🪐', 'Planetary', 1.114286, 273000000000], // final: 1/273,000,000,000
  ['🛰️', 'Orbital', 1.113553, 304000000000], // final: 1/304,000,000,000
  ['🌌', 'Starcluster', 1.115132, 339000000000], // final: 1/339,000,000,000
  ['🌫️', 'Stardust', 1.115044, 378000000000], // final: 1/378,000,000,000
  ['🕳️', 'Blackhole', 1.113757, 421000000000], // final: 1/421,000,000,000
  ['⚫', 'Event Horizon', 1.114014, 469000000000], // final: 1/469,000,000,000
  ['🔭', 'Voidseer', 1.115139, 523000000000], // final: 1/523,000,000,000
  ['🧿', 'Cosmic Eye', 1.112811, 582000000000], // final: 1/582,000,000,000
  ['🌀', 'Spiralborn', 1.11512, 649000000000], // final: 1/649,000,000,000
  ['🧊', 'Spacefrost', 1.114022, 723000000000], // final: 1/723,000,000,000
  ['🔥', 'Solarflare', 1.113416, 805000000000], // final: 1/805,000,000,000
  ['⚡', 'Pulsar', 1.114286, 897000000000], // final: 1/897,000,000,000
  ['👑', 'One Trillion', 1.114827, 1000000000000], // final: 1/1,000,000,000,000
].map(([emoji, name, stepMultiplier, denominator]) => ({ emoji, name, stepMultiplier, denominator }));

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

const MAX_LUCK_ADJUSTED_CHANCE = 0.99;

function getLuckAdjustedChance(denominator, luckMultiplier = 1) {
  const safeDenominator = Math.max(1, Number(denominator) || 1);
  const safeLuckMultiplier = Math.max(1, Number(luckMultiplier) || 1);
  return Math.min(MAX_LUCK_ADJUSTED_CHANCE, safeLuckMultiplier / safeDenominator);
}

function getLuckAdjustedDenominator(denominator, luckMultiplier = 1) {
  const chance = getLuckAdjustedChance(denominator, luckMultiplier);
  return chance > 0 ? 1 / chance : Infinity;
}

function rollRarity(luckMultiplier = 1) {
  const roll = Math.random();

  // Apply luck once to the listed/base denominator for every rarity. This keeps
  // a 100x boost as exactly 100x odds (for example, 1/14.7b becomes
  // 1/147m) instead of compounding the boost across every rarity step.
  for (let i = RARITIES.length - 1; i >= 1; i -= 1) {
    const rarity = RARITIES[i];
    if (roll < getLuckAdjustedChance(rarity.denominator, luckMultiplier)) return rarity;
  }

  return RARITIES[0];
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

async function getTextChannel(client, channelId, context = 'channel') {
  const cached = client.channels.cache.get(channelId);
  if (cached) return cached?.isTextBased?.() ? cached : null;

  const channel = await client.channels.fetch(channelId).catch((error) => {
    console.error(`[rng-roll] Failed to fetch ${context} ${channelId}:`, error);
    return null;
  });
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
    ...container(0xFFFFFF, `<@&${START_PING_ROLE_ID}>\n### RNG event has started! Goodluck and wish your luck.`),
    allowedMentions: { roles: [START_PING_ROLE_ID] },
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

function getEarnedRoleThresholds(rollOrDenominator) {
  const baseDenominator = getBaseRollDenominator(rollOrDenominator);
  return ROLE_THRESHOLDS.filter((threshold) => baseDenominator >= threshold.denominator);
}

function getRollThreshold(rollOrDenominator) {
  return getEarnedRoleThresholds(rollOrDenominator).at(-1) ?? null;
}

async function getRoleColor(guild, threshold) {
  if (!guild || !threshold?.roleId) return threshold?.color ?? 0xFFFFFF;
  const role = guild.roles.cache.get(threshold.roleId) || await guild.roles.fetch(threshold.roleId).catch(() => null);
  return role?.color || threshold.color || 0xFFFFFF;
}

async function assignRollRoles(member, roll, isFirstRoll) {
  if (!member) return;

  // Award threshold roles from the rarity's base listed denominator, not the
  // luck-boosted effective odds used to generate the roll. For example, Runic
  // is always treated as 1/213k here, so it earns the 1/100k-or-rarer role.
  const roleIds = getEarnedRoleThresholds(roll).map((threshold) => threshold.roleId);
  // Keep the first-roll role recoverable: if a user removes it with the prefix
  // command below, any later !roll should add it back.
  roleIds.unshift(FIRST_ROLL_ROLE_ID);
  if (roleIds.length === 0) return;

  const freshMember = typeof member.fetch === 'function'
    ? await member.fetch(true).catch(() => member)
    : member;
  const roles = freshMember?.roles || member.roles;
  if (!roles?.add) return;

  const missingRoleIds = roleIds.filter((roleId) => !roles.cache?.has?.(roleId));
  if (missingRoleIds.length === 0) return;

  await roles.add(missingRoleIds).catch(async () => {
    for (const roleId of missingRoleIds) {
      await roles.add(roleId).catch(() => null);
    }
  });
}

function formatErrorForLog(error) {
  if (!error) return 'Unknown error';
  const code = error.code ? ` code=${error.code}` : '';
  const status = error.status ? ` status=${error.status}` : '';
  const message = error.message || String(error);
  return `${message}${code}${status}`;
}

function buildRareRollLogContent({ userId, rarity, baseDenominator, rollChannelId, reason, error }) {
  const lines = [
    '⚠️ RNG rare roll announcement not sent',
    `User: <@${userId}> (${userId})`,
    `Rarity: ${rarityLabel(rarity)}`,
    `Base chance: 1/${formatNumber(baseDenominator)} (${formatPercent(baseDenominator)}%)`,
    `Roll source channel: ${rollChannelId ? `<#${rollChannelId}> (${rollChannelId})` : 'unknown'}`,
    `Announcement channel: <#${RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID}> (${RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID})`,
    'Announcement sent: no',
  ];
  if (reason) lines.push(`Reason: ${reason}`);
  if (error) lines.push(`Error: ${formatErrorForLog(error)}`);
  return lines.join('\n').slice(0, 2000);
}

async function sendRareRollLog(client, details) {
  const content = buildRareRollLogContent(details);
  const thread = await getTextChannel(client, RARE_ROLL_LOG_THREAD_ID, 'RNG rare-roll log thread');
  if (!thread) {
    console.error(`[rng-roll] Cannot post rare-roll log: thread ${RARE_ROLL_LOG_THREAD_ID} was not found or is not text-based.`);
    return false;
  }

  try {
    await thread.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error(`[rng-roll] Failed to post rare-roll log to thread ${RARE_ROLL_LOG_THREAD_ID}:`, error);
    return false;
  }
}

async function logRareRollNotSent(client, details) {
  console.error(`[rng-roll] Rare-roll announcement not sent for ${details.userId}: ${details.reason || formatErrorForLog(details.error)}.`);
  await sendRareRollLog(client, details);
  return false;
}

async function announceRareRoll(client, userId, rarity, rollChannelId) {
  // Rare-roll announcements use the rarity's base listed odds only. Luck may
  // help produce the roll, but it must not lower the displayed chance or affect
  // which threshold color/notification rules are used.
  const baseDenominator = getBaseRollDenominator(rarity);
  if (!shouldAnnounceRareRoll(baseDenominator, MIN_RARE_ANNOUNCE_DENOMINATOR)) {
    console.info(`[rng-roll] Not announcing ${rarity?.name || 'unknown'} for ${userId}: base denominator ${baseDenominator} is below ${MIN_RARE_ANNOUNCE_DENOMINATOR}.`);
    return false;
  }

  console.info(`[rng-roll] Rare roll detected for ${userId}: ${rarity?.name || 'unknown'} with base denominator 1/${baseDenominator}; luck-adjusted odds are ignored for announcement rules.`);

  const threshold = getRollThreshold(baseDenominator);
  if (!threshold) {
    return logRareRollNotSent(client, {
      userId,
      rarity,
      baseDenominator,
      rollChannelId,
      reason: `No role threshold matched denominator ${baseDenominator}.`,
    });
  }

  const channel = await getTextChannel(client, RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID, 'RNG rare-roll announcement channel');
  if (!channel) {
    return logRareRollNotSent(client, {
      userId,
      rarity,
      baseDenominator,
      rollChannelId,
      reason: `Announcement channel ${RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID} was not found or is not text-based.`,
    });
  }

  const color = await getRoleColor(channel.guild, threshold);
  // Always announce rolls at 1/1k or rarer. The announcement text includes
  // the roller once, while allowedMentions controls whether that mention pings
  // based on their personal notification threshold.
  const shouldMentionUser = rngNotificationStore.shouldMention(userId, baseDenominator);
  const lines = [
    `## <@${userId}> has rolled ${rarityLabel(rarity)}`,
    `with a base chance of 1 in ${formatNumber(baseDenominator)}! \`(${formatPercent(baseDenominator)}%)\``,
  ];

  try {
    const announcement = await channel.send({
      ...container(color, lines.join('\n')),
      allowedMentions: shouldMentionUser ? { users: [userId] } : { users: [] },
    });
    if (!announcement?.id) {
      return logRareRollNotSent(client, {
        userId,
        rarity,
        baseDenominator,
        rollChannelId,
        reason: 'Discord send resolved without an announcement message id.',
      });
    }

    return true;
  } catch (error) {
    console.error(`[rng-roll] Failed to send rare-roll announcement for ${userId} in channel ${RARE_ROLL_ANNOUNCEMENT_CHANNEL_ID}:`, error);
    return logRareRollNotSent(client, {
      userId,
      rarity,
      baseDenominator,
      rollChannelId,
      error,
    });
  }
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
  if (globalBoost?.multiplier > 1) {
    const limitText = Number.isFinite(Number(globalBoost.endsAt))
      ? `until <t:${Math.floor(globalBoost.endsAt / 1000)}:R>`
      : `for this roll (${formatRollCount(globalBoost.remainingRolls)} available before this roll)`;
    lines.push(`-# Server luck boost active: ${formatMultiplier(globalBoost.multiplier)} ${limitText}`);
  }
  if (earnedNextMultiplier > 1) lines.push(`-# You earned ${formatMultiplier(earnedNextMultiplier)} luck for your next roll!`);
  return lines;
}

async function handleRemoveNewbieRollerMessage(message) {
  if (message.author?.bot || message.content.trim().toLowerCase() !== '!remove newbie-roller') return false;

  const roles = message.member?.roles;
  if (!roles?.remove) {
    await replyWithoutPing(message, container(0xED4245, '### I could not access your roles.')).catch(() => null);
    return true;
  }

  const hasRole = roles.cache?.has?.(FIRST_ROLL_ROLE_ID) ?? false;
  if (!hasRole) {
    await replyWithoutPing(message, container(0xED4245, `### You do not currently have the newbie-roller role.
-# Use !roll to get it back.`)).catch(() => null);
    return true;
  }

  await roles.remove(FIRST_ROLL_ROLE_ID).then(
    () => replyWithoutPing(message, container(0x57F287, `### Removed the newbie-roller role.
-# Use !roll anytime to get it back.`)),
    () => replyWithoutPing(message, container(0xED4245, '### I could not remove the newbie-roller role.'))
  ).catch(() => null);
  return true;
}

async function handleRollMessage(message, client) {
  if (await handleRemoveNewbieRollerMessage(message)) return true;
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
  if (globalBoost?.remainingRolls) consumeActiveBoostRoll(globalBoost.id);
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
  await assignRollRoles(message.member, rarity, isFirstRoll);
  await announceRareRoll(client, message.author.id, rarity, message.channelId);
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

  _test: {
    MAX_LUCK_ADJUSTED_CHANCE,
    getLuckAdjustedChance,
    getLuckAdjustedDenominator,
    rollRarity,
  },
};
