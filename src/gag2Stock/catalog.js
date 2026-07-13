const RARITY_COLORS = {
  common: 0xB0ADAC,
  uncommon: 0x3EC044,
  rare: 0x3E7EF4,
  epic: 0x9D3CD2,
  legendary: 0xE2AB0F,
  mythic: 0xD62928,
  mythical: 0xD62928,
  super: 0xB71E99,
  secret: 0xFFFFFF,
};

const RARITY_RANKS = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
  mythical: 6,
  super: 7,
  secret: 9,
};

const SELL_BONUS_COLORS = {
  '2x': 0xE2AB0F,
  '4x': 0x7DE3FF,
};
const SHECKLES_EMOJI = '<:sheckles:1525368044824825976>';

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
  mythical: 'Mythic',
  super: 'Super',
  secret: 'Secret',
};

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRarity(value) {
  const rarity = normalizeKey(value);
  return rarity === 'mythical' ? 'mythic' : rarity;
}

function item(key, roleName, emoji, rarity = '', options = {}) {
  return {
    key,
    roleName,
    emoji,
    rarity: normalizeRarity(rarity),
    color: RARITY_COLORS[normalizeRarity(rarity)] || null,
    createRole: options.createRole !== false,
  };
}

const SEED_ITEMS = [
  item('carrot', 'Carrot', '<:carrot:1525195196864925817>', 'common'),
  item('strawberry', 'Strawberry', '<:strawberry:1525195237008474242>', 'common'),
  item('blueberry', 'Blueberry', '<:blueberry:1525195192632741990>', 'common'),
  item('tulip', 'Tulip', '<:tulip:1525195243438211163>', 'uncommon'),
  item('tomato', 'Tomato', '<:tomato:1525195241026617435>', 'uncommon'),
  item('apple', 'Apple', '<:apple:1525195186085429340>', 'uncommon'),
  item('bamboo', 'Bamboo', '<:bamboo:1525195188538970295>', 'rare'),
  item('corn', 'Corn', '<:corn:1525195203651174512>', 'rare'),
  item('cactus', 'Cactus', '<:cactus:1525195194759254016>', 'rare'),
  item('pineapple', 'Pineapple', '<:pineapple:1525195227667759198>', 'rare'),
  item('mushroom', 'Mushroom', '<:mushroom:1525195225511760072>', 'epic'),
  item('green_bean', 'Green Bean', '<:green_bean:1525195214489124874>', 'epic'),
  item('banana', 'Banana', '<:banana:1525195190707683338>', 'epic'),
  item('grape', 'Grape', '<:grape:1525195212236914779>', 'epic'),
  item('coconut', 'Coconut', '<:coconut:1525195201818394806>', 'epic'),
  item('mango', 'Mango', '<:mango:1525195221200011437>', 'epic'),
  item('rocket_pop', 'Rocket Pop', '<:rocket_pop:1525195234898874630>', 'legendary'),
  item('dragon_fruit', 'Dragon Fruit', '<:dragon_fruit:1525195205807050822>', 'legendary'),
  item('acorn', 'Acorn', '<:acorn:1525195184541794434>', 'legendary'),
  item('cherry', 'Cherry', '<:cherry:1525195199381504114>', 'legendary'),
  item('sunflower', 'Sunflower', '<:sunflower:1525195239155830946>', 'legendary'),
  item('fire_fern', 'Fire Fern', '<:fire_fern:1525195210068590703>', 'legendary'),
  item('venus_fly_trap', 'Venus Flytrap', '<:venus_fly_trap:1525195248169390171>', 'mythic'),
  item('pomegranate', 'Pomegranate', '<:pomegranate:1525195232377835541>', 'mythic'),
  item('poison_apple', 'Poison Apple', '<:poison_apple:1525195230201249983>', 'mythic'),
  item('venom_spitter', 'Venom Spitter', '<:venom_spitter:1525195245661327550>', 'mythic'),
  item('moon_bloom', 'Moon Bloom', '<:moon_bloom:1525195223473586196>', 'super'),
  item('hypno_bloom', 'Hypno Bloom', '<:hypno_bloom:1525195218805194752>', 'super'),
  item('dragon_s_breath', 'Dragon’s Breath', '<:dragon_s_breath:1525195207778373814>', 'super'),
  item('sun_bloom', 'Sun Bloom', '<:sun_bloom:1525996662449766431>', 'super'),
  item('star_fruit', 'Star Fruit', '<:star_fruit:1525996660000428112>', 'super'),
  item('baby_cactus', 'Baby Cactus', '<:baby_cactus:1525390117345427507>', 'rare', { createRole: false }),
  item('horned_melon', 'Horned Melon', '<:horned_melon:1525390123875831919>', 'rare', { createRole: false }),
  item('glow_mushroom', 'Glow Mushroom', '<:glow_mushroom:1525390121929805926>', 'epic', { createRole: false }),
  item('poison_ivy', 'Poison Ivy', '<:poison_ivy:1525390125935366194>', 'legendary', { createRole: false }),
  item('ghost_pepper', 'Ghost Pepper', '<:ghost_pepper:1525390119664750612>', 'mythic', { createRole: false }),
];

const SELL_ONLY_ITEMS = [
  item('eclipse_bloom', 'Eclipse Bloom', '<:eclipse_bloom:1526031940749361163>', 'secret', { createRole: false }),
];

const SELL_ITEMS = [...SEED_ITEMS, ...SELL_ONLY_ITEMS];

const GEAR_ITEMS = [
  item('common_watering_can', 'Common Watering Can', '<:common_watering_can:1525198690707439736>', 'common'),
  item('common_sprinkler', 'Common Sprinkler', '<:common_sprinkler:1525198688283267234>', 'common'),
  item('sign', 'Sign', '<:sign:1525199115498160189>', 'common'),
  item('uncommon_sprinkler', 'Uncommon Sprinkler', '<:uncommon_sprinkler:1525198728846115007>', 'uncommon'),
  item('trowel', 'Trowel', '<:trowel:1525198726535053404>', 'rare'),
  item('rare_sprinkler', 'Rare Sprinkler', '<:rare_sprinkler:1525198712761090308>', 'rare'),
  item('jump_mushroom', 'Jump Mushroom', '<:jump_mushroom:1525198699456626799>', 'rare'),
  item('speed_mushroom', 'Speed Mushroom', '<:speed_mushroom:1525198716577911024>', 'rare'),
  item('lantern', 'Lantern', '', 'rare'),
  item('megaphone', 'Megaphone', '<:megaphone:1525198707925057607>', 'rare'),
  item('shrink_mushroom', 'Shrink Mushroom', '<:shrink_mushroom:1525198714749059162>', 'epic'),
  item('supersize_mushroom', 'Supersize Mushroom', '<:supersize_mushroom:1525198724639232100>', 'epic'),
  item('gnome', 'Gnome', '<:gnome:1525198694763200673>', 'epic'),
  item('flashbang', 'Flashbang', '<:flashbang:1525198692846538895>', 'epic'),
  item('basic_pot', 'Basic Pot', '<:basic_pot:1525198685410033684>', 'epic'),
  item('legendary_sprinkler', 'Legendary Sprinkler', '<:legendary_sprinkler:1525198702690697358>', 'epic'),
  item('invisibility_mushroom', 'Invisibility Mushroom', '<:invisibility_mushroom:1525198697263140954>', 'legendary'),
  item('teleporter', 'Teleporter', '', 'legendary'),
  item('wheelbarrow', 'Wheelbarrow', '<:wheelbarrow:1525198730683355386>', 'legendary'),
  item('player_magnet', 'Player Magnet', '<:player_magnet:1525198710231928832>', 'mythic'),
  item('strawberry_sniper', 'Strawberry Sniper', '<:strawberry_sniper:1525198718658154647>', 'mythic'),
  item('super_watering_can', 'Super Watering Can', '<:super_watering_can:1525198722785345708>', 'super'),
  item('super_sprinkler', 'Super Sprinkler', '<:super_sprinkler:1525198720931729589>', 'super'),
];

const CRATE_ITEMS = [
  item('ladder_crate', 'Ladder', '<:ladder_crate:1525201085231403240>'),
  item('bench_crate', 'Bench', '<:bench_crate:1525201076276433056>'),
  item('light_crate', 'Light', '<:light_crate:1525201087282413689>'),
  item('sign_crate', 'Sign', '<:sign_crate:1525201096023474217>'),
  item('arch_crate', 'Arch', '<:arch_crate:1525201071620882542>'),
  item('roleplay_crate', 'Roleplay', '<:roleplay_crate:1525201091317465108>'),
  item('picture_frame_crate', 'Picture Frame', '<:picture_frame_crate:1525202336631361606>'),
  item('fourth_of_july_crate', 'Fourth of July (limited)', '<:fourth_of_july_crate:1525201497116246128>'),
  item('bridge_crate', 'Bridge', '<:bridge_crate:1525201078642147469>'),
  item('spring_crate', 'Spring', '<:spring_crate:1525201098233745528>'),
  item('seesaw_crate', 'Seesaw', '<:seesaw_crate:1525201094257545286>'),
  item('conveyor_crate', 'Conveyor', '<:conveyor_crate:1525201080831443096>'),
  item('owner_door_crate', 'Owner Door', '<:owner_door_crate:1525201089387954196>'),
  item('bear_trap_crate', 'Bear Trap', '<:bear_trap_crate:1525201073957245019>'),
  item('boombox_crate', 'Boombox', '<:boombox_crate:1525201479546441931>'),
  item('fence_crate', 'Fence', '<:fence_crate:1525201083117342911>'),
  item('teleporter_pad_crate', 'Teleporter Pad', '<:teleporter_pad_crate:1525201100792397874>'),
];

function weatherItem(key, roleName, emoji, color) {
  return { key, roleName, emoji, color };
}

const WEATHER_ITEMS = [
  weatherItem('lightning', 'Lightning', '<:lightning:1525203832638799872>', 0xFFD23F),
  weatherItem('sunburst', 'Sunburst', '<:sunburst:1525203830919135363>', 0xFF8C42),
  weatherItem('starfall', 'Starfall', '<:starfall:1525203828549357718>', 0x8C7CFF),
  weatherItem('snowfall', 'Snowfall', '<:snowfall:1525203826687344740>', 0xBDEBFF),
  weatherItem('rain', 'Rain', '<:rain:1525203824376156390>', 0x4A90E2),
  weatherItem('rainbow_moon', 'Rainbow Moon', '<:rainbow_moon:1525203822417412156>', 0xC86BFA),
  weatherItem('rainbow', 'Rainbow', '<:rainbow:1525203819775135764>', 0xFF5C8A),
  weatherItem('mega_moon', 'Mega Moon', '<:mega_moon:1525203817686106172>', 0xD9D7FF),
  weatherItem('goldmoon', 'Gold Moon', '<:goldmoon:1525203815035441182>', 0xF4C542),
  weatherItem('bloodmoon', 'Blood Moon', '<:bloodmoon:1525203812607070260>', 0xB3202A),
  weatherItem('aurora', 'Aurora', '<:aurora:1525203810467840000>', 0x35E6A4),
  weatherItem('eclipse', 'Eclipse', '<:eclipse:1526025549858738287>', 0x9B59FF),
];

const ALIASES = {
  seed: {
    dragon_breath: 'dragon_s_breath',
    dragons_breath: 'dragon_s_breath',
    venus_flytrap: 'venus_fly_trap',
    venom_splitter: 'venom_spitter',
  },
  gear: {},
  crate: {
    ladder: 'ladder_crate',
    bench: 'bench_crate',
    light: 'light_crate',
    sign: 'sign_crate',
    arch: 'arch_crate',
    roleplay: 'roleplay_crate',
    picture_frame: 'picture_frame_crate',
    fourth_of_july: 'fourth_of_july_crate',
    fourth_of_july_limited: 'fourth_of_july_crate',
    bridge: 'bridge_crate',
    spring: 'spring_crate',
    seesaw: 'seesaw_crate',
    conveyor: 'conveyor_crate',
    owner_door: 'owner_door_crate',
    bear_trap: 'bear_trap_crate',
    boombox: 'boombox_crate',
    fence: 'fence_crate',
    teleporter_pad: 'teleporter_pad_crate',
  },
  weather: {
    gold_moon: 'goldmoon',
    blood_moon: 'bloodmoon',
    mega_moon_event: 'mega_moon',
  },
};

function mapByKey(items) {
  const map = new Map();
  items.forEach((entry, index) => map.set(entry.key, { ...entry, index }));
  return map;
}

const MAPS = {
  seed: mapByKey(SEED_ITEMS),
  sell: mapByKey(SELL_ITEMS),
  gear: mapByKey(GEAR_ITEMS),
  crate: mapByKey(CRATE_ITEMS),
  weather: mapByKey(WEATHER_ITEMS),
  moon: mapByKey(WEATHER_ITEMS),
};

function resolveType(type) {
  return type === 'sell' ? 'sell' : String(type || '').toLowerCase();
}

function resolveKey(type, keyOrName) {
  const baseType = type === 'sell' ? 'seed' : type === 'moon' ? 'weather' : type;
  const key = normalizeKey(keyOrName);
  return ALIASES[baseType]?.[key] || key;
}

function catalogEntry(type, value) {
  const resolvedType = resolveType(type);
  const key = resolveKey(resolvedType, value?.key || value?.id || value?.slug || value?.type || value?.name || value);
  return MAPS[resolvedType]?.get(key) || null;
}

function roleKeyForType(type, value) {
  return catalogEntry(type, value)?.key || resolveKey(type, value?.key || value?.id || value?.slug || value?.type || value?.name || value);
}

function displayNameForType(type, value) {
  return catalogEntry(type, value)?.roleName || String(value?.name || value?.type || value?.key || 'Unknown').trim();
}

function emojiForType(type, value) {
  return catalogEntry(type, value)?.emoji || String(value?.emoji || '').trim();
}

function rarityForType(type, value) {
  return catalogEntry(type, value)?.rarity || normalizeRarity(value?.rarity || '');
}

function colorForRarity(rarity) {
  return RARITY_COLORS[normalizeRarity(rarity)] || null;
}

function colorForType(type, value) {
  return catalogEntry(type, value)?.color || colorForRarity(value?.rarity) || null;
}

function orderIndexForType(type, value) {
  const entry = catalogEntry(type, value);
  return Number.isInteger(entry?.index) ? entry.index : 10_000;
}

function sortItemsForType(type, items) {
  return [...(items || [])].sort((left, right) => (
    orderIndexForType(type, left) - orderIndexForType(type, right)
    || displayNameForType(type, left).localeCompare(displayNameForType(type, right))
  ));
}

function highestRarityColor(type, items, fallback) {
  let bestRank = -1;
  let bestColor = null;
  for (const itemEntry of items || []) {
    const rarity = rarityForType(type, itemEntry);
    const rank = RARITY_RANKS[rarity] || 0;
    const color = colorForType(type, itemEntry);
    if (color && rank >= bestRank) {
      bestRank = rank;
      bestColor = color;
    }
  }
  return bestColor || fallback;
}

function customEmojiImageUrl(emoji) {
  const match = String(emoji || '').match(/^<a?:[a-z0-9_]+:(\d{16,20})>$/i);
  return match ? `https://cdn.discordapp.com/emojis/${match[1]}.png?size=128` : '';
}

function roleSpecFromItem(entry) {
  return {
    key: entry.key,
    name: entry.roleName,
    emoji: entry.emoji || '',
    roleName: entry.roleName.slice(0, 100),
    color: entry.color || null,
  };
}

function sellMultiplierBucket(multiplier) {
  const value = Number(multiplier);
  if (!Number.isFinite(value)) return '';
  if (value >= 4) return '4x';
  if (value >= 2) return '2x';
  return '';
}

function sellBonusRoleForEntry(entry) {
  const bucket = sellMultiplierBucket(entry?.multiplier);
  const rarity = rarityForType('sell', entry);
  if (!bucket || !RARITY_LABELS[rarity]) return null;
  return {
    key: `${rarity}_${bucket}`,
    name: `${RARITY_LABELS[rarity]} ${bucket}`,
    emoji: SHECKLES_EMOJI,
    roleName: `${RARITY_LABELS[rarity]} ${bucket}`,
    color: SELL_BONUS_COLORS[bucket],
    bucket,
  };
}

function sellBonusRoleSpecs() {
  return ['2x', '4x'].flatMap((bucket) => (
    ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super', 'secret'].map((rarity) => ({
      key: `${rarity}_${bucket}`,
      name: `${RARITY_LABELS[rarity]} ${bucket}`,
      emoji: SHECKLES_EMOJI,
      roleName: `${RARITY_LABELS[rarity]} ${bucket}`,
      color: SELL_BONUS_COLORS[bucket],
    }))
  ));
}

function roleSpecsForType(type) {
  if (type === 'seed') return SEED_ITEMS.filter((entry) => entry.createRole !== false).map(roleSpecFromItem);
  if (type === 'gear') return GEAR_ITEMS.map(roleSpecFromItem);
  if (type === 'crate') return CRATE_ITEMS.map(roleSpecFromItem);
  if (type === 'weather' || type === 'moon') return WEATHER_ITEMS.map(roleSpecFromItem);
  if (type === 'sell') return sellBonusRoleSpecs();
  return [];
}

module.exports = {
  SELL_BONUS_COLORS,
  SHECKLES_EMOJI,
  catalogEntry,
  colorForType,
  customEmojiImageUrl,
  displayNameForType,
  emojiForType,
  highestRarityColor,
  normalizeKey,
  normalizeRarity,
  orderIndexForType,
  roleKeyForType,
  roleSpecsForType,
  sellBonusRoleForEntry,
  sellMultiplierBucket,
  sortItemsForType,
};
