const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../commands/rng-roll');
const { getLuckAdjustedChance, getLuckAdjustedDenominator, getStackedLuckMultiplier, rollRarity } = _test;

function withMockedRandom(value, testFn) {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    testFn();
  } finally {
    Math.random = originalRandom;
  }
}

test('luck boost divides the listed rarity denominator once', () => {
  assert.equal(getLuckAdjustedChance(14_700_000_000, 1), 1 / 14_700_000_000);
  assert.equal(getLuckAdjustedChance(14_700_000_000, 100), 1 / 147_000_000);
  assert.equal(getLuckAdjustedDenominator(14_700_000_000, 100), 147_000_000);
});

test('luck-adjusted listed denominator chance is capped below guaranteed odds', () => {
  assert.equal(getLuckAdjustedChance(2, 10), 0.99);
  assert.equal(getLuckAdjustedChance(1, 100000), 0.99);
  assert.equal(getLuckAdjustedDenominator(2, 10), 1 / 0.99);
});

test('10x luck improves the one-roll rarity threshold without compounding across steps', () => {
  withMockedRandom(0.98, () => {
    assert.equal(rollRarity(1).name, 'Common');
    assert.equal(rollRarity(10).name, 'Epic');
  });

  withMockedRandom(0.995, () => {
    assert.equal(rollRarity(10).name, 'Common');
  });
});

test('100x luck keeps a 1 in 14.7b rarity at 1 in 147m effective odds', () => {
  withMockedRandom((1 / 147_000_000) - Number.EPSILON, () => {
    assert.equal(rollRarity(100).name, 'Clockwork');
  });

  withMockedRandom(1 / 147_000_000, () => {
    assert.notEqual(rollRarity(100).name, 'Clockwork');
  });
});

test('luck multipliers stack additively instead of multiplying together', () => {
  assert.equal(getStackedLuckMultiplier(2, 5), 7);
  assert.equal(getStackedLuckMultiplier(1, 2, 10), 12);
  assert.equal(getStackedLuckMultiplier(1, 1), 1);
});
