function extractEmojiName(emoji) {
  const match = emoji?.match(/^<a?:([^:]+):\d+>$/);
  return match?.[1] ?? null;
}

const ITEMS = [
  {
    id: 'ITFist',
    name: 'Fist',
    emoji: '<:ITFist:1449009707355476069>',
    rarity: 'Common',
    type: 'Tool/Gear',
    value: 0,
    sellPrice: 0,
    tradable: false,
    durability: Infinity,
    maxDurability: Infinity,
    damage: { min: 1, max: 5 },
    info: 'Useable as a gear in Hunt, deal 1 - 5 damages per hit.',
  },
  {
    id: 'ITWoodenSword',
    name: 'Wooden Sword',
    emoji: '<:ITWoodenSword:1448987035363704955>',
    rarity: 'Common',
    type: 'Tool/Gear',
    value: 13,
    sellPrice: 100,
    tradable: true,
    durability: 50,
    maxDurability: 50,
    damage: { min: 3, max: 8 },
    info: 'Useable as a gear in Hunt, deal 3 - 8 damages per hit. Lose 1 durability per hit.',
  },
  {
    id: 'ITUpgradeToken',
    name: 'Upgrade Token',
    emoji: '<:ITUpgradeToken:1447502158059540481>',
    rarity: 'Rare',
    type: 'Material',
    value: 300,
    sellPrice: null,
    tradable: false,
    durability: null,
    info: 'Coming soon',
  },
  {
    id: 'ITBeastMeat',
    name: 'Beast Meat',
    emoji: '<:ITBeastMeat:1449725581217501340>',
    rarity: 'Common',
    type: 'Material',
    value: 8,
    sellPrice: 8,
    tradable: true,
    durability: null,
    info: 'A chunk of raw beast meat dropped from jungle beetles.',
  },
  {
    id: 'ITMossyShavings',
    name: 'Mossy Shavings',
    emoji: '<:ITMossyShavings:1449725583884812338>',
    rarity: 'Common',
    type: 'Material',
    value: 23,
    sellPrice: 23,
    tradable: true,
    durability: null,
    info: 'Damp moss scraps collected from jungle beetles.',
  },
  {
    id: 'ITVineFiber',
    name: 'Vine Fiber',
    emoji: '<:ITVineFiber:1450771201097207871>',
    rarity: 'Common',
    type: 'Material',
    value: 6,
    sellPrice: 150,
    tradable: true,
    durability: null,
    info: 'A fibrous strand pulled from a vine snake.',
  },
  {
    id: 'ITSharpFang',
    name: 'Sharp Fang',
    emoji: '<:ITSharpFang:1450765103250149448>',
    rarity: 'Common',
    type: 'Material',
    value: 35,
    sellPrice: 500,
    tradable: true,
    durability: null,
    info: 'A razor-edged fang harvested from dangerous predators.',
  },
  {
    id: 'ITWeakVenomGland',
    name: 'Weak Venom Gland',
    emoji: '<:ITWeakVenomGland:1450771203823370260>',
    rarity: 'Common',
    type: 'Material',
    value: 12,
    sellPrice: 300,
    tradable: true,
    durability: null,
    info: 'A venom sac still brimming with diluted toxins.',
  },
  {
    id: 'ITJungleFeather',
    name: 'Jungle Feather',
    emoji: '<:ITJungleFeather:1451102919003865108>',
    rarity: 'Common',
    type: 'Material',
    value: 20,
    sellPrice: 100,
    tradable: true,
    durability: null,
    info: 'A vibrant feather plucked from a clawfoot bird.',
  },
  {
    id: 'ITRazorTalon',
    name: 'Razor Talon',
    emoji: '<:ITRazorTalon:1451102921323450532>',
    rarity: 'Common',
    type: 'Material',
    value: 50,
    sellPrice: 300,
    tradable: true,
    durability: null,
    info: 'A sharply curved talon that can slice through bark.',
  },
  {
    id: 'ITHeavyHornFragment',
    name: 'Heavy Horn Fragment',
    emoji: '<:ITHeavyHornFragment:1451103660099637320>',
    rarity: 'Common',
    type: 'Material',
    value: 120,
    sellPrice: 900,
    tradable: true,
    durability: null,
    info: 'A weighty shard from a thornback boar horn.',
  },
  {
    id: 'ITToughHideScrap',
    name: 'Tough Hide Scrap',
    emoji: '<:ITToughHideScrap:1451103661991268416>',
    rarity: 'Common',
    type: 'Material',
    value: 40,
    sellPrice: 250,
    tradable: true,
    durability: null,
    info: 'A rugged strip of hide with natural resilience.',
  },
];

for (const item of ITEMS) {
  const emojiName = extractEmojiName(item.emoji);
  if (emojiName) {
    item.id = emojiName;
  }
}

const GEAR_ITEMS = ITEMS.filter((item) => item.type === 'Tool/Gear');
const KNOWN_GEAR = Object.fromEntries(GEAR_ITEMS.map((item) => [item.name, item]));
const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((item) => [item.id, item]));

const FIST_GEAR = KNOWN_GEAR['Fist'];
const WOODEN_SWORD_GEAR = KNOWN_GEAR['Wooden Sword'];
const UPGRADE_TOKEN_ITEM = ITEMS.find((item) => item.id === 'ITUpgradeToken');

module.exports = {
  ITEMS,
  GEAR_ITEMS,
  KNOWN_GEAR,
  ITEMS_BY_ID,
  FIST_GEAR,
  WOODEN_SWORD_GEAR,
  UPGRADE_TOKEN_ITEM,
};
