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
  announcementText,
  applyXpToRecord,
  buildLevelPayload,
  levelUpAnnouncementPayload,
  levelForXp,
  progressBar,
  resolvedAnnouncementLayout,
  xpThresholdForLevel,
  xpMultiplierForMessage,
} = require('../src/leveling');
const { ownerLiveMetrics } = require('../src/ownerPanelRoutes');
const { decodeLevelingMedia } = require('../src/adminServer');

test('leveling config clamps pacing and normalizes reward milestones', () => {
  const config = normalizeLevelingConfig({
    xp: { min: -5, max: 9999, cooldownSeconds: 1 },
    curve: { baseXp: 5, growth: 9, maxLevel: 50 },
    announcements: {
      template: '## ✨ Level {level}\nWelcome {user} to level {level}!\n\n`{bar}` {progress_xp}/{needed_xp} → {next_level}',
      layout: {
        container: true,
        accentColor: '#FF00AA',
        thumbnailEnabled: true,
        thumbnailUrl: '{user_profile}',
        galleryUrls: ['https://example.com/one.png', '{user_profile}', 'not-a-url'],
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
  assert.equal(config.announcements.template, '## ✨ Level {level}\nWelcome {user} to level {level}!\n\n`{bar}` {progress_xp}/{needed_xp} → {next_level}');
  assert.deepEqual(config.channelMultipliers, { '123456789012345678': 0, '123456789012345679': 10 });
  assert.equal(config.announcements.layout.accentColor, '#ff00aa');
  assert.equal(config.announcements.layout.thumbnailUrl, '{user_profile}');
  assert.deepEqual(config.announcements.layout.galleryUrls, ['https://example.com/one.png', '{user_profile}']);
  assert.deepEqual(config.roleRewards, [
    { level: 10, roleId: '223456789012345678' },
    { level: 25, roleId: '423456789012345678' },
  ]);
  assert.deepEqual(config.roleBoosts, [
    { roleId: '523456789012345678', multiplier: 10 },
    { roleId: '623456789012345678', multiplier: 0 },
  ]);
});

test('level-up templates replace title, member, and XP progress variables', () => {
  const message = {
    author: {
      id: '123456789012345678',
      username: 'GardenHero',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/avatar.png',
    },
    member: { displayName: 'Garden Hero' },
    guild: { name: 'Grow a Garden' },
  };
  assert.equal(
    announcementText('{user} • {user_profile} • {username} • {level} • {next_level} • {server} • `{bar}` {progress_xp}/{needed_xp} • {total_xp}', message, 12, {
      nextLevel: 13,
      bar: '■■□□',
      progressXp: '280',
      neededXp: '420',
      totalXp: '3,160',
    }),
    '<@123456789012345678> • https://cdn.discordapp.com/avatars/123/avatar.png • Garden Hero • 12 • 13 • Grow a Garden • `■■□□` 280/420 • 3,160',
  );
  assert.deepEqual(
    resolvedAnnouncementLayout({
      thumbnailUrl: '{user_profile}',
      galleryUrls: ['{user_profile}', 'https://example.com/static.png'],
    }, message, 12),
    {
      thumbnailUrl: 'https://cdn.discordapp.com/avatars/123/avatar.png',
      galleryUrls: ['https://cdn.discordapp.com/avatars/123/avatar.png', 'https://example.com/static.png'],
    },
  );
});

test('legacy three-field announcements migrate into the unified editor template', () => {
  const config = normalizeLevelingConfig({
    announcements: {
      title: 'Old title {level}',
      message: 'Old message for {user}',
      progress: 'Old progress {progress_xp}/{needed_xp}',
    },
  });
  assert.equal(
    config.announcements.template,
    '## Old title {level}\nOld message for {user}\n\nOld progress {progress_xp}/{needed_xp}',
  );
  assert.equal(config.announcements.title, undefined);
  assert.equal(config.announcements.message, undefined);
  assert.equal(config.announcements.progress, undefined);
});

test('leveling image upload accepts real image bytes and rejects disguised files', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const media = decodeLevelingMedia(png);
  assert.equal(media.extension, 'png');
  assert.equal(media.contentType, 'image/png');
  assert.ok(media.data.length > 8);
  assert.throws(() => decodeLevelingMedia(`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`), /does not match/);
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
