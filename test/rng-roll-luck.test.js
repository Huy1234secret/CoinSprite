const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../commands/rng-roll');
const { getLuckAdjustedChance, rollRarity } = _test;

function withMockedRandom(value, testFn) {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    testFn();
  } finally {
    Math.random = originalRandom;
  }
}

test('luck boost directly multiplies each rarity step chance', () => {
  assert.equal(getLuckAdjustedChance(2, 1), 0.5);
  assert.equal(getLuckAdjustedChance(2, 1.5), 0.75);
  assert.equal(getLuckAdjustedChance(2, 10), 0.99);
});

test('luck-adjusted rarity step chance is capped below guaranteed odds', () => {
  assert.equal(getLuckAdjustedChance(1.5, 10), 0.99);
  assert.equal(getLuckAdjustedChance(1, 100000), 0.99);
});

test('10x luck makes a high random roll beat common while 99% cap can still fail', () => {
  withMockedRandom(0.98, () => {
    assert.equal(rollRarity(1).name, 'Common');
    assert.notEqual(rollRarity(10).name, 'Common');
  });

  withMockedRandom(0.995, () => {
    assert.equal(rollRarity(10).name, 'Common');
  });
});
