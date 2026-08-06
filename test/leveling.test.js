const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_LEVELING_CONFIG,
  normalizeLevelingConfig,
  normalizeState,
} = require('../src/serverConfig');
const {
  COMPONENTS_V2_FLAG,
  LEVELING_COMMANDS,
  applyXpToRecord,
  buildLevelPayload,
  levelUpAnnouncementPayload,
  levelForXp,
  progressBar,
  xpThresholdForLevel,
  xpMultiplierForMessage,
} = require('../src/leveling');
const { ownerLiveMetrics } = require('../src/ownerPanelRoutes');

test('leveling config clamps pacing and normalizes reward milestones', () => {
  const config = normalizeLevelingConfig({
    xp: { min: -5, max: 9999, cooldownSeconds: 1 },
    curve: { baseXp: 5, growth: 9, maxLevel: 50 },
    announcements: {
      message: '  Welcome {user} to level {level}!  ',
      layout: {
        container: true,
        accentColor: '#FF00AA',
        thumbnailEnabled: true,
        thumbnailUrl: 'javascript:alert(1)',
        galleryUrls: ['https://example.com/one.png', 'not-a-url'],
      },
    },
    channelMultipliers: { '123456789012345678': -2, bad: 4, '123456789012345679': 99 },
    roleRewards: [
      { level: 10, roleId: '223456789012345678' },
      { level: 10, roleId: '323456789012345678' },
      { level: 25, roleId: '423456789012345678' },
    ],
    roleBoosts: [
      { roleId: '523456789012345678', multiplier: 15 },
      { roleId: '523456789012345678', multiplier: 2 },
      { roleId: '623456789012345678', multiplier: -4 },
    ],
  });
  assert.deepEqual(config.xp, { min: 1, max: 2000, cooldownSeconds: 5 });
  assert.deepEqual(config.curve, { baseXp: 25, growth: 3, maxLevel: 50 });
  assert.equal(config.announcements.message, 'Welcome {user} to level {level}!');
  assert.deepEqual(config.channelMultipliers, { '123456789012345678': 0, '123456789012345679': 10 });
  assert.equal(config.announcements.layout.accentColor, '#ff00aa');
  assert.equal(config.announcements.layout.thumbnailUrl, '');
  assert.deepEqual(config.announcements.layout.galleryUrls, ['https://example.com/one.png']);
  assert.deepEqual(config.roleRewards, [
    { level: 10, roleId: '223456789012345678' },
    { level: 25, roleId: '423456789012345678' },
  ]);
  assert.deepEqual(config.roleBoosts, [
    { roleId: '523456789012345678', multiplier: 10 },
    { roleId: '623456789012345678', multiplier: 0 },
  ]);
});

test('schema upgrade locks and disables leveling for every existing server', () => {
  const state = normalizeState({
    meta: { schemaVersion: 9, disabledGuilds: {} },
    guilds: {
      '123456789012345678': {
        enabled: true,
        features: { gag2Stock: true, leveling: true },
        leveling: { enabled: true },
      },
    },
  });
  assert.equal(state.meta.schemaVersion, 10);
  assert.equal(state.guilds['123456789012345678'].features.leveling, false);
  assert.equal(state.guilds['123456789012345678'].leveling.enabled, false);
});

test('channel and role XP multipliers combine and cap at ten', () => {
  const config = {
    channelMultipliers: { '123456789012345678': 3 },
    roleBoosts: [
      { roleId: '223456789012345678', multiplier: 2 },
      { roleId: '323456789012345678', multiplier: 5 },
    ],
  };
  const message = {
    channelId: '123456789012345678',
    channel: { parentId: null },
    member: { roles: { cache: new Map([['223456789012345678', {}], ['323456789012345678', {}]]) } },
  };
  assert.deepEqual(xpMultiplierForMessage(message, config), {
    channelMultiplier: 3, roleMultiplier: 5, multiplier: 10,
  });
  assert.equal(xpMultiplierForMessage({ ...message, channelId: '999999999999999999' }, config).multiplier, 0);
});

test('level-up composer builds container, thumbnail, separator, and gallery components', () => {
  const payload = levelUpAnnouncementPayload('**hi**{separator}Level 12!', {
    announcements: { layout: {
      container: true,
      accentColor: '#ff00aa',
      thumbnailEnabled: true,
      thumbnailUrl: 'https://example.com/thumb.png',
      galleryUrls: ['https://example.com/one.png', 'https://example.com/two.png'],
    } },
  });
  assert.equal(payload.flags & COMPONENTS_V2_FLAG, COMPONENTS_V2_FLAG);
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].accent_color, 0xff00aa);
  assert.deepEqual(payload.components[0].components.map((component) => component.type), [9, 14, 10, 12]);
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
