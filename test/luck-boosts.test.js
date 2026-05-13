const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const storePath = path.join(__dirname, '..', 'data', 'luck-boosts.json');
const {
  consumeActiveBoostRoll,
  formatRollCount,
  getActiveBoost,
  parseAmountRolls,
  startBoost,
} = require('../src/luckBoosts');

function withLuckBoostStore(testFn) {
  const existed = fs.existsSync(storePath);
  const original = existed ? fs.readFileSync(storePath, 'utf8') : null;

  return async () => {
    try {
      await testFn();
    } finally {
      if (existed) {
        fs.writeFileSync(storePath, original, 'utf8');
      } else if (fs.existsSync(storePath)) {
        fs.rmSync(storePath);
      }
    }
  };
}

test('amount-limited luck boosts expire after the configured number of rolls', withLuckBoostStore(() => {
  const boost = startBoost({ amountRolls: 2, percent: 100, startedById: 'user-1', now: 1_000 });

  assert.equal(getActiveBoost(1_000).remainingRolls, 2);
  assert.equal(getActiveBoost(1_000).multiplier, 2);
  assert.equal(consumeActiveBoostRoll(boost.id, 1_000).remainingRolls, 1);
  assert.equal(consumeActiveBoostRoll(boost.id, 1_000), null);
  assert.equal(getActiveBoost(1_000), null);
}));

test('amount helpers accept only whole roll counts and format roll labels', () => {
  assert.equal(parseAmountRolls(1), 1);
  assert.equal(parseAmountRolls(10), 10);
  assert.equal(parseAmountRolls(1.5), null);
  assert.equal(parseAmountRolls(0), null);
  assert.equal(formatRollCount(1), '1 roll');
  assert.equal(formatRollCount(10), '10 rolls');
});
