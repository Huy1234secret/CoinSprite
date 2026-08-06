const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_LEVELING_CONFIG,
  normalizeLevelingConfig,
} = require('../src/serverConfig');
const {
  COMPONENTS_V2_FLAG,
  LEVELING_COMMANDS,
  applyXpToRecord,
  buildLevelPayload,
  levelForXp,
  progressBar,
  xpThresholdForLevel,
} = require('../src/leveling');
const { ownerLiveMetrics } = require('../src/ownerPanelRoutes');

test('leveling config clamps pacing and normalizes reward milestones', () => {
  const config = normalizeLevelingConfig({
    xp: { min: -5, max: 9999, cooldownSeconds: 1 },
    curve: { baseXp: 5, growth: 9, maxLevel: 50 },
    announcements: { message: '  Welcome {user} to level {level}!  ' },
    ignoredChannelIds: ['123456789012345678', 'bad', '123456789012345678'],
    roleRewards: [
      { level: 10, roleId: '223456789012345678' },
      { level: 10, roleId: '323456789012345678' },
      { level: 25, roleId: '423456789012345678' },
    ],
  });
  assert.deepEqual(config.xp, { min: 1, max: 2000, cooldownSeconds: 5 });
  assert.deepEqual(config.curve, { baseXp: 25, growth: 3, maxLevel: 50 });
  assert.equal(config.announcements.message, 'Welcome {user} to level {level}!');
  assert.deepEqual(config.ignoredChannelIds, ['123456789012345678']);
  assert.deepEqual(config.roleRewards, [
    { level: 10, roleId: '223456789012345678' },
    { level: 25, roleId: '423456789012345678' },
  ]);
});

test('XP curve and level calculation agree at boundaries', () => {
  const curve = { baseXp: 100, growth: 1.5, maxLevel: 100 };
  assert.equal(xpThresholdForLevel(0, curve), 0);
  assert.equal(xpThresholdForLevel(1, curve), 100);
  assert.equal(xpThresholdForLevel(4, curve), 800);
  assert.equal(levelForXp(99, curve), 0);
  assert.equal(levelForXp(100, curve), 1);
  assert.equal(levelForXp(799, curve), 3);
  assert.equal(levelForXp(800, curve), 4);
});

test('XP awards report level crossings and preserve totals', () => {
  const record = { xp: 90 };
  const result = applyXpToRecord(record, 20, DEFAULT_LEVELING_CONFIG, 1234);
  assert.equal(result.oldLevel, 0);
  assert.equal(result.newLevel, 1);
  assert.equal(result.newXp, 110);
  assert.equal(record.updatedAt, 1234);
});

test('level payload and every leveling command use Components V2', () => {
  const payload = buildLevelPayload({ username: 'Sprite' }, {
    rank: 2, messages: 42, level: 7, progressXp: 75, neededXp: 150, progressRatio: .5, xp: 1200,
  });
  assert.equal(payload.flags & COMPONENTS_V2_FLAG, COMPONENTS_V2_FLAG);
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].components[0].type, 10);
  assert.equal(progressBar(.5).length, 12);
  assert.deepEqual(LEVELING_COMMANDS.map((command) => command.data.name), [
    'level', 'leaderboard', 'level-set', 'xp-add', 'leveling-setup',
  ]);
});

test('owner live metrics expose refreshed heap and storage labels', () => {
  const metrics = ownerLiveMetrics(Date.now());
  assert.match(metrics.sampledAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(metrics.heap.bytes > 0);
  assert.match(metrics.heap.label, /(?:B|KB|MB|GB)$/);
  assert.ok(metrics.storage.bytes >= 0);
  assert.match(metrics.storage.label, /(?:B|KB|MB|GB)$/);
});
