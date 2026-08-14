const { RARITIES } = require('./seeds');

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;

function item(config) {
  if (!RARITIES[config.rarity]) throw new Error(`Unknown item rarity: ${config.rarity}`);
  return Object.freeze({
    ...config,
    price: BigInt(config.price),
    stock: Object.freeze({ ...config.stock }),
    effect: Object.freeze({ ...config.effect }),
  });
}

// Prices, chances, effects, and artwork identifiers live in one immutable
// catalogue so command choices, persistence, rendering, and roll logic cannot
// drift apart.
const ITEMS = Object.freeze([
  item({
    id: 'secret_mushroom', displayName: 'Secret Mushroom', emoji: '<:SecretMush:1537694615522770984>',
    rarity: 'Secret', type: 'Mushroom', price: 3_000, durationMs: HOUR_MS,
    description: 'Secret crop chance ×1.25; permanent Luck is not multiplied again',
    restockChanceBps: 800, stock: { minimum: 1, maximum: 1 },
    effect: { kind: 'rarity', rarity: 'Secret', numerator: 125, denominator: 100, baseOnly: true },
  }),
  item({
    id: 'super_mushroom', displayName: 'Super Mushroom', emoji: '<:SuperMush:1537694628596158564>',
    rarity: 'Super', type: 'Mushroom', price: 10_000, durationMs: 30 * MINUTE_MS,
    description: 'Super crop chance ×1.20', restockChanceBps: 1_000,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'rarity', rarity: 'Super', numerator: 120, denominator: 100 },
  }),
  item({
    id: 'mythic_mushroom', displayName: 'Mythic Mushroom', emoji: '<:MythicMush:1537694626893271060>',
    rarity: 'Mythic', type: 'Mushroom', price: 7_500, durationMs: 30 * MINUTE_MS,
    description: 'Mythic crop chance ×1.18', restockChanceBps: 1_400,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'rarity', rarity: 'Mythic', numerator: 118, denominator: 100 },
  }),
  item({
    id: 'legendary_mushroom', displayName: 'Legendary Mushroom', emoji: '<:LegendMush:1537695886606340146>',
    rarity: 'Legendary', type: 'Mushroom', price: 12_000, durationMs: 30 * MINUTE_MS,
    description: 'Legendary crop chance ×1.15', restockChanceBps: 1_800,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'rarity', rarity: 'Legendary', numerator: 115, denominator: 100 },
  }),
  item({
    id: 'epic_mushroom', displayName: 'Epic Mushroom', emoji: '<:EpicMush:1537694624842383430>',
    rarity: 'Epic', type: 'Mushroom', price: 4_000, durationMs: 30 * MINUTE_MS,
    description: 'Epic crop chance ×1.12', restockChanceBps: 2_800,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'rarity', rarity: 'Epic', numerator: 112, denominator: 100 },
  }),
  item({
    id: 'rare_mushroom', displayName: 'Rare Mushroom', emoji: '<:RareMush:1537694617292505199>',
    rarity: 'Rare', type: 'Mushroom', price: 1_500, durationMs: 30 * MINUTE_MS,
    description: 'Rare crop chance ×1.10', restockChanceBps: 4_500,
    stock: { minimum: 1, maximum: 3 }, effect: { kind: 'rarity', rarity: 'Rare', numerator: 110, denominator: 100 },
  }),
  item({
    id: 'rare_sprinkler', displayName: 'Rare Sprinkler', emoji: '<:RareSprinkler:1537694622585720912>',
    rarity: 'Rare', type: 'Sprinkler', price: 18_000, durationMs: 30 * MINUTE_MS,
    description: 'Crop weight ×1.08 and BIG chance +0.60 percentage points', restockChanceBps: 2_000,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'sprinkler', weightBps: 10_800, bigBonusBps: 60 },
  }),
  item({
    id: 'uncommon_sprinkler', displayName: 'Uncommon Sprinkler', emoji: '<:UncommonSprinkler:1537694635416363079>',
    rarity: 'Uncommon', type: 'Sprinkler', price: 7_500, durationMs: 30 * MINUTE_MS,
    description: 'Crop weight ×1.05 and BIG chance +0.35 percentage points', restockChanceBps: 3_500,
    stock: { minimum: 1, maximum: 3 }, effect: { kind: 'sprinkler', weightBps: 10_500, bigBonusBps: 35 },
  }),
  item({
    id: 'super_watering_can', displayName: 'Super Watering Can', emoji: '<:SuperWateringCan:1537694633105039472>',
    rarity: 'Super', type: 'Watering Can', price: 1_500, durationMs: 0,
    description: 'Crop weight ×1.50 on the next successful roll', restockChanceBps: 4_500,
    stock: { minimum: 2, maximum: 5 }, effect: { kind: 'watering-can', weightBps: 15_000 },
  }),
  item({
    id: 'super_sprinkler', displayName: 'Super Sprinkler', emoji: '<:SuperSprinkler:1537694630660014110>',
    rarity: 'Super', type: 'Sprinkler', price: 45_000, durationMs: 30 * MINUTE_MS,
    description: 'Crop weight ×1.12 and BIG chance +1.00 percentage point', restockChanceBps: 1_000,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'sprinkler', weightBps: 11_200, bigBonusBps: 100 },
  }),
  item({
    id: 'legendary_sprinkler', displayName: 'Legendary Sprinkler', emoji: '<:LegendarySprinkler:1537694620056551454>',
    rarity: 'Legendary', type: 'Sprinkler', price: 80_000, durationMs: 30 * MINUTE_MS,
    description: 'Crop weight ×1.16 and BIG chance +1.50 percentage points', restockChanceBps: 600,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'sprinkler', weightBps: 11_600, bigBonusBps: 150 },
  }),
  item({
    id: 'common_watering_can', displayName: 'Common Watering Can', emoji: '<:CommonWateringCan:1537694613484343357>',
    rarity: 'Common', type: 'Watering Can', price: 250, durationMs: 0,
    description: 'Crop weight ×1.15 on the next successful roll', restockChanceBps: 8_000,
    stock: { minimum: 5, maximum: 12 }, effect: { kind: 'watering-can', weightBps: 11_500 },
  }),
  item({
    id: 'common_sprinkler', displayName: 'Common Sprinkler', emoji: '<:CommonSprinkler:1537694611621937202>',
    rarity: 'Common', type: 'Sprinkler', price: 3_000, durationMs: 30 * MINUTE_MS,
    description: 'Crop weight ×1.03 and BIG chance +0.20 percentage points', restockChanceBps: 6_000,
    stock: { minimum: 2, maximum: 5 }, effect: { kind: 'sprinkler', weightBps: 10_300, bigBonusBps: 20 },
  }),
  item({
    id: 'common_egg', displayName: 'Common Egg', emoji: '<:CommonEgg:1537694241055314060>',
    rarity: 'Common', type: 'Egg', price: 25_000, durationMs: 0,
    description: 'Hatch one random pet', restockChanceBps: 4_000,
    stock: { minimum: 1, maximum: 3 }, effect: { kind: 'egg' },
  }),
]);

const ITEM_BY_ID = new Map(ITEMS.map((entry) => [entry.id, entry]));
const ITEM_BY_NORMALIZED_NAME = new Map(ITEMS.map((entry) => [entry.displayName.toLowerCase(), entry]));

module.exports = Object.freeze({ HOUR_MS, ITEMS, ITEM_BY_ID, ITEM_BY_NORMALIZED_NAME, MINUTE_MS });
