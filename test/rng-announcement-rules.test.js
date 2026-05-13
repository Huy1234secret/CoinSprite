const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_RARE_ANNOUNCE_DENOMINATOR,
  getBaseRollDenominator,
  shouldAnnounceRareRoll,
  shouldMentionAtThreshold,
} = require('../src/rngAnnouncementRules');

test('rare-roll announcements are based on base rarity denominator', () => {
  assert.equal(MIN_RARE_ANNOUNCE_DENOMINATOR, 1_000);
  assert.equal(shouldAnnounceRareRoll({ denominator: 999 }), false);
  assert.equal(shouldAnnounceRareRoll({ denominator: 1_000 }), true);
  assert.equal(shouldAnnounceRareRoll({ denominator: 1_640 }), true);
});

test('base denominator normalization ignores malformed or effective luck odds', () => {
  assert.equal(getBaseRollDenominator({ denominator: '1640.9' }), 1_640);
  assert.equal(getBaseRollDenominator({ denominator: 0 }), 0);
  assert.equal(shouldAnnounceRareRoll({ denominator: 500 }, 1_000), false);
});

test('personal notification threshold only controls mentions', () => {
  assert.equal(shouldAnnounceRareRoll(1_000), true);
  assert.equal(shouldMentionAtThreshold(1_000_000, 1_000), false);
  assert.equal(shouldMentionAtThreshold(1_000_000, 1_080_000), true);
  assert.equal(shouldMentionAtThreshold(null, 1_000), true);
});
