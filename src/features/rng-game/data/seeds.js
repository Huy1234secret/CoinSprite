const { CROP_EMOJIS, RARITY_EMOJIS } = require('./emojis');

const RARITIES = Object.freeze({
  Common: Object.freeze({ color: 0x9CA3AF, emoji: RARITY_EMOJIS.Common }),
  Uncommon: Object.freeze({ color: 0x22C55E, emoji: RARITY_EMOJIS.Uncommon }),
  Rare: Object.freeze({ color: 0x3B82F6, emoji: RARITY_EMOJIS.Rare }),
  Epic: Object.freeze({ color: 0xA855F7, emoji: RARITY_EMOJIS.Epic }),
  Legendary: Object.freeze({ color: 0xF59E0B, emoji: RARITY_EMOJIS.Legendary }),
  Mythic: Object.freeze({ color: 0xF43F5E, emoji: RARITY_EMOJIS.Mythic }),
  Super: Object.freeze({ color: 0x00E5FF, emoji: RARITY_EMOJIS.Super }),
});

function seed(id, displayName, rarity, numerator, denominator, minimumWeight, maximumWeight, minimumValue, maximumValue, options = {}) {
  const rarityConfig = RARITIES[rarity];
  if (!rarityConfig) throw new Error(`Unknown RNG rarity: ${rarity}`);
  return Object.freeze({
    id,
    displayName,
    rarity,
    chanceNumerator: numerator,
    chanceDenominator: denominator,
    minimumWeight,
    maximumWeight,
    minimumValue,
    maximumValue,
    emoji: CROP_EMOJIS[id],
    rarityColor: rarityConfig.color,
    rarityEmoji: rarityConfig.emoji,
    fallback: options.fallback === true,
  });
}

// Order is gameplay data: every non-fallback entry is checked in this exact,
// rarest-first sequence. Chances are individual conditional checks.
const SEEDS = Object.freeze([
  seed('star_fruit', 'Star Fruit', 'Super', 1, 1_000_000, 5, 30, 150_000, 4_000_000),
  seed('dragons_breath', 'Dragon\u2019s Breath', 'Super', 111, 100_000_000, 4, 26, 100_000, 2_500_000),
  seed('hypno_bloom', 'Hypno Bloom', 'Super', 1, 800_000, 3, 22, 75_000, 1_800_000),
  seed('sun_bloom', 'Sun Bloom', 'Super', 71, 50_000_000, 3, 20, 50_000, 1_250_000),
  seed('moon_bloom', 'Moon Bloom', 'Super', 83, 50_000_000, 3, 18, 35_000, 850_000),
  seed('briar_rose', 'Briar Rose', 'Mythic', 1, 500_000, 1.5, 10, 22_000, 550_000),
  seed('venom_spitter', 'Venom Spitter', 'Mythic', 111, 50_000_000, 2, 12, 15_000, 350_000),
  seed('poison_apple', 'Poison Apple', 'Mythic', 1, 400_000, 1.5, 9, 10_000, 250_000),
  seed('pomegranate', 'Pomegranate', 'Mythic', 57, 20_000_000, 1.5, 10, 7_000, 170_000),
  seed('venus_flytrap', 'Venus Flytrap', 'Mythic', 333, 100_000_000, 3, 18, 5_000, 120_000),
  seed('fire_fern', 'Fire Fern', 'Legendary', 1, 250_000, 1.5, 10, 3_500, 85_000),
  seed('sunflower', 'Sunflower', 'Legendary', 1, 200_000, 1.5, 9, 2_500, 60_000),
  seed('cherry', 'Cherry', 'Legendary', 333, 50_000_000, 0.4, 3, 1_600, 40_000),
  seed('acorn', 'Acorn', 'Legendary', 1, 100_000, 0.8, 6, 1_100, 26_000),
  seed('dragon_fruit', 'Dragon Fruit', 'Legendary', 1_333, 100_000_000, 2.5, 14, 750, 18_000),
  seed('rocket_pop', 'Rocket Pop', 'Legendary', 1, 50_000, 1, 6, 500, 12_500),
  seed('mango', 'Mango', 'Epic', 1, 40_000, 2, 10, 350, 8_500),
  seed('coconut', 'Coconut', 'Epic', 1, 20_000, 1.5, 8, 220, 5_500),
  seed('grape', 'Grape', 'Epic', 1, 10_000, 0.5, 3, 140, 3_500),
  seed('banana', 'Banana', 'Epic', 1, 4_000, 0.8, 4, 90, 2_250),
  seed('green_bean', 'Green Bean', 'Epic', 1, 2_000, 0.4, 2.5, 60, 1_500),
  seed('mushroom', 'Mushroom', 'Epic', 1, 1_000, 0.5, 3.5, 40, 1_000),
  seed('pineapple', 'Pineapple', 'Rare', 1, 400, 1.2, 5.5, 25, 700),
  seed('cactus', 'Cactus', 'Rare', 1, 200, 1.5, 7, 18, 450),
  seed('corn', 'Corn', 'Rare', 1, 100, 0.8, 3.5, 12, 300),
  seed('bamboo', 'Bamboo', 'Rare', 1, 50, 1, 5, 8, 200),
  seed('apple', 'Apple', 'Uncommon', 3, 100, 0.6, 2.5, 5, 120),
  seed('tomato', 'Tomato', 'Uncommon', 1, 20, 0.4, 1.8, 4, 80),
  seed('tulip', 'Tulip', 'Uncommon', 2, 25, 0.25, 1.1, 3, 60),
  seed('blueberry', 'Blueberry', 'Common', 3, 25, 0.2, 0.9, 2, 40),
  seed('strawberry', 'Strawberry', 'Common', 1, 5, 0.15, 0.75, 1, 30),
  seed('carrot', 'Carrot', 'Common', 1, 2, 0.1, 0.6, 1, 20, { fallback: true }),
]);

const SEED_BY_ID = new Map(SEEDS.map((entry) => [entry.id, entry]));
const CHECKED_SEEDS = Object.freeze(SEEDS.filter((entry) => !entry.fallback));
const FALLBACK_SEED = SEEDS.find((entry) => entry.fallback);

module.exports = { CHECKED_SEEDS, FALLBACK_SEED, RARITIES, SEEDS, SEED_BY_ID };
