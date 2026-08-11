const assert = require('node:assert/strict');
const test = require('node:test');

const { SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  cropChanceProfile,
  cropProbabilityDistribution,
  cropProbabilityDistributionForMultiplier,
  parsePreviewLuckMultiplier,
} = require('../src/features/rng-game/services/chanceService');
const {
  PROBABILITY_SCALE,
  baseCropDistribution,
  rarityDistribution,
} = require('../src/features/rng-game/services/rngService');

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function add(left, right) {
  const divisor = greatestCommonDivisor(left.denominator, right.denominator);
  const denominator = (left.denominator / divisor) * right.denominator;
  const numerator = (left.numerator * (denominator / left.denominator))
    + (right.numerator * (denominator / right.denominator));
  const reducedBy = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / reducedBy, denominator: denominator / reducedBy };
}

function repository({ luckTier = 0, discoveries = [] } = {}) {
  const calls = [];
  return {
    calls,
    getPlayer(userId) {
      calls.push(['player', userId]);
      return { userId, luckTier };
    },
    discoveries(userId) {
      calls.push(['discoveries', userId]);
      return discoveries.map((seedId) => ({ seedId }));
    },
  };
}

test('Luck Tier 0 produces identical base and current marginal crop probabilities', () => {
  const base = cropProbabilityDistribution(0);
  const current = cropProbabilityDistribution(0);
  assert.equal(base.length, SEEDS.length);
  assert.deepEqual(current, base);
  const profile = cropChanceProfile(repository({ luckTier: 0, discoveries: ['star_fruit'] }), 'tier-zero');
  const starFruit = profile.crops.find((crop) => crop.name === 'Star Fruit');
  assert.deepEqual(starFruit.previewChance, starFruit.baseChance);
  assert.equal(starFruit.change, '×1');
});

test('editable preview Luck uses multiplier-to-tier mapping without changing saved Luck', () => {
  const source = repository({ luckTier: 7, discoveries: ['star_fruit'] });
  const profile = cropChanceProfile(source, 'preview-user', { previewLuckMultiplier: '50' });
  const starFruit = profile.crops.find((crop) => crop.name === 'Star Fruit');
  const expected = cropProbabilityDistribution(49).find((entry) => entry.seed.id === 'star_fruit');
  assert.equal(profile.luckTier, 7);
  assert.equal(profile.luckMultiplier, '8');
  assert.equal(profile.previewLuckMultiplier, '50');
  assert.deepEqual(starFruit.previewChance, require('../src/features/rng-game/services/chanceService').probabilityDisplay(expected));
  assert.deepEqual(source.calls, [['player', 'preview-user'], ['discoveries', 'preview-user']]);
});

test('unlimited preview Luck remains precision-safe for values beyond Number range', () => {
  const huge = '9'.repeat(400);
  assert.equal(parsePreviewLuckMultiplier(huge), BigInt(huge));
  const entries = cropProbabilityDistributionForMultiplier(huge);
  const total = entries.reduce(add, { numerator: 0n, denominator: 1n });
  assert.deepEqual(total, { numerator: 1n, denominator: 1n });
  assert.equal(JSON.stringify(cropChanceProfile(repository({ discoveries: ['star_fruit'] }), 'huge', {
    previewLuckMultiplier: huge,
  })).includes('Infinity'), false);
  for (const invalid of ['0', '-1', '1.5', '1e4', '+2', '', 'abc', ' 2']) {
    assert.throws(() => parsePreviewLuckMultiplier(invalid), /positive whole-number/);
  }
});

test('marginal crop probabilities form a complete distribution at every Luck tier', () => {
  for (const tier of [0, 1, 10, 20]) {
    const total = cropProbabilityDistribution(tier).reduce(add, { numerator: 0n, denominator: 1n });
    assert.deepEqual(total, { numerator: 1n, denominator: 1n }, `tier ${tier}`);
  }
});

test('higher Luck crop totals exactly match the canonical rarity distribution', () => {
  for (const tier of [1, 7, 20]) {
    const expected = rarityDistribution(tier);
    const entries = cropProbabilityDistribution(tier);
    for (const [rarity, units] of Object.entries(expected)) {
      const total = entries.filter((entry) => entry.seed.rarity === rarity)
        .reduce(add, { numerator: 0n, denominator: 1n });
      assert.equal(total.numerator * PROBABILITY_SCALE, units * total.denominator, `${rarity} tier ${tier}`);
    }
  }
});

test('marginal crop helper retains cascadingRoll within-rarity weights', () => {
  const baseWeights = new Map(baseCropDistribution().map((entry) => [entry.seed.id, entry.units]));
  const entries = cropProbabilityDistribution(12);
  for (const rarity of new Set(entries.map((entry) => entry.seed.rarity))) {
    const candidates = entries.filter((entry) => entry.seed.rarity === rarity);
    const first = candidates[0];
    for (const candidate of candidates.slice(1)) {
      assert.equal(
        candidate.numerator * first.denominator * baseWeights.get(first.seed.id),
        first.numerator * candidate.denominator * baseWeights.get(candidate.seed.id),
        `${candidate.seed.id} preserves its cascading weight inside ${rarity}`,
      );
    }
  }
});

test('profile masking omits an undiscovered Secret crop and hides every unknown crop field', () => {
  const source = repository({
    luckTier: 5,
    discoveries: ['star_fruit'],
  });
  const profile = cropChanceProfile(source, 'signed-in-user');
  const serialized = JSON.stringify(profile);
  assert.equal(profile.visibleTotal, SEEDS.length - 1);
  assert.equal(profile.discoveredCount, 1);
  assert.doesNotMatch(serialized, /Eclipse Bloom|eclipse_bloom|Secret/);
  assert.deepEqual(source.calls, [
    ['player', 'signed-in-user'],
    ['discoveries', 'signed-in-user'],
  ]);
  const unknown = profile.crops.find((crop) => !crop.discovered);
  assert.deepEqual(Object.keys(unknown).sort(), ['artworkUrl', 'discovered', 'slot']);
  assert.match(unknown.slot, /^slot-\d+$/);
});

test('a discovered Secret crop is visible and its preview chance never changes with Luck', () => {
  const profile = cropChanceProfile(repository({
    luckTier: 4,
    discoveries: ['eclipse_bloom'],
  }), 'secret-discoverer', { previewLuckMultiplier: '9'.repeat(300) });
  const secret = profile.crops.find((crop) => crop.name === 'Eclipse Bloom');
  assert.ok(secret);
  assert.equal(profile.visibleTotal, SEEDS.length);
  assert.equal(profile.discoveredCount, 1);
  assert.equal(secret.rarity, 'Secret');
  assert.equal(secret.luckAffected, false);
  assert.equal(secret.note, 'Secret Crop — Luck does not affect this chance.');
  assert.deepEqual(secret.previewChance, secret.baseChance);
  assert.equal(secret.change, '×1');
});

test('discovered visible crops expose only their display comparison fields', () => {
  const profile = cropChanceProfile(repository({
    luckTier: 8,
    discoveries: ['star_fruit'],
  }), 'discoverer');
  const crop = profile.crops.find((entry) => entry.name === 'Star Fruit');
  assert.equal(crop.discovered, true);
  assert.equal(crop.rarity, 'Super');
  assert.equal(crop.rainbowOutline, true);
  assert.match(crop.artworkUrl, /^https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.(?:png|webp)/);
  assert.match(crop.baseChance.oneIn, /^1 in /);
  assert.match(crop.baseChance.percentage, /%$/);
  assert.match(crop.previewChance.percentage, /%$/);
  assert.doesNotMatch(crop.baseChance.percentage, /^0%$/);
  assert.match(crop.change, /^×/);
  assert.equal('seedId' in crop, false);
});
