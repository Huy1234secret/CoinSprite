const { RARITIES } = require('./seeds');

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const SHOP_ITEM_CONFIG_VERSION = 2;
const DEFAULT_PRICE_MARGIN_BPS = 13_500;

function item(config) {
  if (!RARITIES[config.rarity]) throw new Error(`Unknown item rarity: ${config.rarity}`);
  const minimumPrice = BigInt(config.minimumPrice);
  return Object.freeze({
    ...config,
    configVersion: SHOP_ITEM_CONFIG_VERSION,
    minimumPrice,
    // Keep the legacy field as a minimum-price alias for stock persistence and
    // callers that do not have a player-specific quote yet.
    price: minimumPrice,
    priceMarginBps: Number(config.priceMarginBps ?? DEFAULT_PRICE_MARGIN_BPS),
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
    rarity: 'Secret', type: 'Mushroom', minimumPrice: 8_000_000, durationMs: HOUR_MS,
    affectedRolls: 720, description: 'Secret crop chance +0.025 percentage points',
    restockChanceBps: 200, stock: { minimum: 1, maximum: 1 },
    effect: { kind: 'rarity-flat', rarity: 'Secret', addedProbabilityUnits: 250_000 },
  }),
  item({
    id: 'super_mushroom', displayName: 'Super Mushroom', emoji: '<:SuperMush:1537694628596158564>',
    rarity: 'Super', type: 'Mushroom', minimumPrice: 1_500_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Super crop chance ×10', restockChanceBps: 400,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'rarity', rarity: 'Super', numerator: 10, denominator: 1 },
  }),
  item({
    id: 'mythic_mushroom', displayName: 'Mythic Mushroom', emoji: '<:MythicMush:1537694626893271060>',
    rarity: 'Mythic', type: 'Mushroom', minimumPrice: 750_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Mythic crop chance ×6', restockChanceBps: 700,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'rarity', rarity: 'Mythic', numerator: 6, denominator: 1 },
  }),
  item({
    id: 'legendary_mushroom', displayName: 'Legendary Mushroom', emoji: '<:LegendMush:1537695886606340146>',
    rarity: 'Legendary', type: 'Mushroom', minimumPrice: 400_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Legendary crop chance ×3', restockChanceBps: 1_000,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'rarity', rarity: 'Legendary', numerator: 3, denominator: 1 },
  }),
  item({
    id: 'epic_mushroom', displayName: 'Epic Mushroom', emoji: '<:EpicMush:1537694624842383430>',
    rarity: 'Epic', type: 'Mushroom', minimumPrice: 150_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Epic crop chance ×1.75', restockChanceBps: 1_800,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'rarity', rarity: 'Epic', numerator: 175, denominator: 100 },
  }),
  item({
    id: 'rare_mushroom', displayName: 'Rare Mushroom', emoji: '<:RareMush:1537694617292505199>',
    rarity: 'Rare', type: 'Mushroom', minimumPrice: 50_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Rare crop chance ×1.35', restockChanceBps: 3_000,
    stock: { minimum: 1, maximum: 3 }, effect: { kind: 'rarity', rarity: 'Rare', numerator: 135, denominator: 100 },
  }),
  item({
    id: 'rare_sprinkler', displayName: 'Rare Sprinkler', emoji: '<:RareSprinkler:1537694622585720912>',
    rarity: 'Rare', type: 'Sprinkler', minimumPrice: 350_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Crop weight ×1.20 and BIG chance +1.00 percentage point', restockChanceBps: 900,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'sprinkler', weightBps: 12_000, bigBonusBps: 100 },
  }),
  item({
    id: 'uncommon_sprinkler', displayName: 'Uncommon Sprinkler', emoji: '<:UncommonSprinkler:1537694635416363079>',
    rarity: 'Uncommon', type: 'Sprinkler', minimumPrice: 125_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Crop weight ×1.10 and BIG chance +0.50 percentage points', restockChanceBps: 1_800,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'sprinkler', weightBps: 11_000, bigBonusBps: 50 },
  }),
  item({
    id: 'super_watering_can', displayName: 'Super Watering Can', emoji: '<:SuperWateringCan:1537694633105039472>',
    rarity: 'Super', type: 'Watering Can', minimumPrice: 100_000, durationMs: 0,
    affectedRolls: 1, description: 'Crop weight ×2 on the next successful roll', restockChanceBps: 2_000,
    stock: { minimum: 1, maximum: 3 }, effect: { kind: 'watering-can', weightBps: 20_000, chargesPerItem: 1 },
  }),
  item({
    id: 'super_sprinkler', displayName: 'Super Sprinkler', emoji: '<:SuperSprinkler:1537694630660014110>',
    rarity: 'Super', type: 'Sprinkler', minimumPrice: 1_000_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Crop weight ×1.35 and BIG chance +2.00 percentage points', restockChanceBps: 400,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'sprinkler', weightBps: 13_500, bigBonusBps: 200 },
  }),
  item({
    id: 'legendary_sprinkler', displayName: 'Legendary Sprinkler', emoji: '<:LegendarySprinkler:1537694620056551454>',
    rarity: 'Legendary', type: 'Sprinkler', minimumPrice: 2_500_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Crop weight ×1.50 and BIG chance +3.00 percentage points', restockChanceBps: 200,
    stock: { minimum: 1, maximum: 1 }, effect: { kind: 'sprinkler', weightBps: 15_000, bigBonusBps: 300 },
  }),
  item({
    id: 'common_watering_can', displayName: 'Common Watering Can', emoji: '<:CommonWateringCan:1537694613484343357>',
    rarity: 'Common', type: 'Watering Can', minimumPrice: 5_000, durationMs: 0,
    affectedRolls: 1, description: 'Crop weight ×1.25 on the next successful roll', restockChanceBps: 5_000,
    stock: { minimum: 3, maximum: 8 }, effect: { kind: 'watering-can', weightBps: 12_500, chargesPerItem: 1 },
  }),
  item({
    id: 'common_sprinkler', displayName: 'Common Sprinkler', emoji: '<:CommonSprinkler:1537694611621937202>',
    rarity: 'Common', type: 'Sprinkler', minimumPrice: 40_000, durationMs: 30 * MINUTE_MS,
    affectedRolls: 360, description: 'Crop weight ×1.05 and BIG chance +0.25 percentage points', restockChanceBps: 3_500,
    stock: { minimum: 2, maximum: 4 }, effect: { kind: 'sprinkler', weightBps: 10_500, bigBonusBps: 25 },
  }),
  item({
    id: 'common_egg', displayName: 'Common Egg', emoji: '<:CommonEgg:1537694241055314060>',
    rarity: 'Common', type: 'Egg', minimumPrice: 2_500_000, durationMs: 0,
    affectedRolls: 0, description: 'Hatch one random permanent pet', restockChanceBps: 800,
    stock: { minimum: 1, maximum: 2 }, effect: { kind: 'egg', hatches: 1 },
  }),
]);

const ITEM_BY_ID = new Map(ITEMS.map((entry) => [entry.id, entry]));
const ITEM_BY_NORMALIZED_NAME = new Map(ITEMS.map((entry) => [entry.displayName.toLowerCase(), entry]));

module.exports = Object.freeze({
  DEFAULT_PRICE_MARGIN_BPS,
  HOUR_MS,
  ITEMS,
  ITEM_BY_ID,
  ITEM_BY_NORMALIZED_NAME,
  MINUTE_MS,
  SHOP_ITEM_CONFIG_VERSION,
});
