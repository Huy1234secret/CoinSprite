const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../commands/rng-roll');
const {
  getGlobalGoalLuckMultiplier,
  getGlobalGoalLuckPercent,
  getGlobalGoalTier,
  buildGlobalGoalPayload,
  getEventStatus,
  buildLeaderboardPayload,
  getGlobalRollCount,
  getLuckAdjustedChance,
  getLuckAdjustedDenominator,
  getStackedLuckMultiplier,
  rollRarity,
} = _test;

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

test('global goal tiers increase every 1000 total rolls and grant permanent 25% luck per tier', () => {
  assert.equal(getGlobalGoalTier(0), 0);
  assert.equal(getGlobalGoalLuckPercent(999), 0);
  assert.equal(getGlobalGoalTier(1000), 1);
  assert.equal(getGlobalGoalLuckPercent(1000), 25);
  assert.equal(getGlobalGoalLuckMultiplier(1000), 1.25);
  assert.equal(getGlobalGoalTier(2500), 2);
  assert.equal(getGlobalGoalLuckPercent(2500), 50);
  assert.equal(getGlobalGoalLuckMultiplier(2500), 1.5);
});

test('global roll count sums every user record', () => {
  assert.equal(getGlobalRollCount({ users: { a: { totalRolls: 250 }, b: { totalRolls: 750 }, c: { totalRolls: '12' } } }), 1012);
  assert.equal(getGlobalRollCount({ users: { a: { totalRolls: -1 }, b: { totalRolls: null } } }), 0);
});

test('rng event leaderboard payload remains separate from global goal payload', () => {
  const state = {
    users: {
      first: { best: { emoji: '🏆', name: 'Supreme', denominator: 953, achievedAt: 2 }, totalRolls: 10 },
      second: { best: { emoji: '🟣', name: 'Epic', denominator: 10, achievedAt: 1 }, totalRolls: 5 },
    },
  };

  const leaderboard = JSON.stringify(buildLeaderboardPayload(state));
  const globalGoal = JSON.stringify(buildGlobalGoalPayload(state));

  assert.match(leaderboard, /RNG Event Leaderboard/);
  assert.match(leaderboard, /<@first>/);
  assert.match(leaderboard, /Supreme/);
  assert.doesNotMatch(leaderboard, /Global Goal/);
  assert.doesNotMatch(leaderboard, /Event ends/);
  assert.match(leaderboard, /Final leaderboard update is frozen/);
  assert.match(globalGoal, /Global Goal/);
});

test('rng event stays active after the original end date', () => {
  assert.equal(getEventStatus(Date.parse('2026-05-27T14:00:00.000Z')), 'active');
});
