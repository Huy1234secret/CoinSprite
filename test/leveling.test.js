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
  buildLeaderboardPayload,
  buildLevelCardPayload,
  buildLevelPayload,
  canvasDisplayName,
  levelUpAnnouncementPayload,
  levelForXp,
  normalizeLevelCardDesign,
  progressBar,
  renderLeaderboardCard,
  renderLevelCard,
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

test('legacy text level fallback uses Components V2 and the leveling command set is stable', () => {
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

test('level card design keeps editable layers safe and scoped to the signed-in user', () => {
  const userId = '123456789012345678';
  const design = normalizeLevelCardDesign({
    background: { color: '#FF00AA', imageUrl: `/level-card-media/${userId}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`, scale: 99 },
    avatar: { x: 999, y: 999, size: 240 },
    username: { x: 999, y: 999, size: 80 },
    level: { x: 999, y: 999, size: 60 },
    rank: { x: -999, y: 999, size: 60 },
    xp: { x: 999, y: 999, size: 50 },
    progress: { x: 999, y: 999, width: 5000, height: 70, color: '#00FF00', trackColor: 'red' },
    layers: [
      { id: 'welcome', type: 'text', text: 'Hello\nworld', x: 42, y: 50, size: 28, color: '#abcdef' },
      { id: 'safe-icon', type: 'image', imageUrl: `/level-card-media/${userId}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp`, x: 999, y: 999, width: 800, height: 300 },
      { id: 'other-user', type: 'image', imageUrl: '/level-card-media/999999999999999999/cccccccccccccccccccccccccccccccc.png' },
      { id: 'external', type: 'image', imageUrl: 'https://example.com/tracker.png' },
    ],
  }, userId);
  assert.equal(design.background.color, '#ff00aa');
  assert.equal(design.background.scale, 5);
  assert.equal(design.progress.width, 950);
  assert.equal(design.progress.x, 50);
  assert.equal(design.progress.y, 250);
  assert.equal(design.avatar.x, 760);
  assert.equal(design.avatar.y, 80);
  assert.deepEqual({ x: design.username.x, y: design.username.y }, { x: 610, y: 240 });
  assert.deepEqual({ x: design.level.x, y: design.level.y }, { x: 790, y: 260 });
  assert.deepEqual({ x: design.rank.x, y: design.rank.y }, { x: 120, y: 260 });
  assert.deepEqual({ x: design.xp.x, y: design.xp.y }, { x: 670, y: 270 });
  assert.equal(design.progress.color, '#00ff00');
  assert.equal(design.progress.trackColor, '#303a33');
  assert.deepEqual(design.layers.map((layer) => layer.id), ['welcome', 'safe-icon']);
  assert.equal(design.layers[0].text, 'Hello world');
  assert.equal(design.layers[1].x, 200);
  assert.equal(design.layers[1].y, 20);
});

test('level card renderer supports Unicode names and sends a direct attachment without alt text', async () => {
  const user = { id: '123456789012345678', username: 'Sprite', displayName: '**🇪🇸 ⟪𝐒𝐞𝐫𝐠𝐃𝐚𝐦⟫**' };
  const stats = { level: 12, rank: 3, progressXp: 280, neededXp: 420, progressRatio: 2 / 3, xp: 3160 };
  const image = await renderLevelCard(user, stats, normalizeLevelCardDesign({}, user.id));
  assert.ok(image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.equal(canvasDisplayName(user.displayName), '🇪🇸 ⟪SergDam⟫');
  const payload = buildLevelCardPayload(user, stats, image);
  assert.equal(payload.flags, undefined);
  assert.equal(payload.content, null);
  assert.equal(payload.files[0].name, 'level-card.png');
  assert.equal(payload.components[0].type, 1);
  assert.equal(payload.components[0].components[0].style, 5);
  assert.equal(payload.components[0].components[0].label, 'Edit card here!');
  assert.match(payload.components[0].components[0].url, /\/profile$/);
  assert.doesNotMatch(JSON.stringify(payload), /description|alt/i);
});

test('leaderboard renderer creates an attachment image with podium-colored top ranks', async () => {
  const rows = [
    { rank: 1, displayName: 'Gold', user: { id: '111111111111111111', username: 'Gold' }, level: 30, xp: 9000 },
    { rank: 2, displayName: 'Silver', user: { id: '222222222222222222', username: 'Silver' }, level: 25, xp: 7000 },
    { rank: 3, displayName: 'Bronze', user: { id: '333333333333333333', username: 'Bronze' }, level: 20, xp: 5000 },
    { rank: 4, displayName: '🇪🇸 ⟪𝐒𝐞𝐫𝐠𝐃𝐚𝐦⟫', user: { id: '444444444444444444', username: 'SergDam' }, level: 18, xp: 4200 },
  ];
  const image = await renderLeaderboardCard({ guildName: 'Garden Hub', rows, page: 1, maxPage: 2, totalMembers: 14 });
  assert.ok(image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  const controls = [{ type: 1, components: [{ type: 2, style: 2, label: 'Next', custom_id: 'next' }] }];
  const payload = buildLeaderboardPayload(image, controls);
  assert.equal(payload.flags, undefined);
  assert.equal(payload.files[0].name, 'leaderboard.png');
  assert.deepEqual(payload.components, controls);
  assert.doesNotMatch(JSON.stringify(payload), /description|alt/i);
  const source = require('node:fs').readFileSync(require.resolve('../src/leveling'), 'utf8');
  assert.match(source, /1: \{ main: '#f6c945'/);
  assert.match(source, /2: \{ main: '#c6ced8'/);
  assert.match(source, /3: \{ main: '#d58a52'/);
});

test('/level acknowledges immediately, then replaces the loading card with the rendered image', async () => {
  const replies = [];
  const interaction = {
    guildId: '223456789012345678',
    user: { id: '123456789012345678', username: 'Sprite', globalName: 'Garden Sprite' },
    guild: { members: { cache: new Map() } },
    options: { getUser: () => null },
    reply: async (payload) => replies.push(['reply', payload]),
    editReply: async (payload) => replies.push(['edit', payload]),
  };
  await LEVELING_COMMANDS.find((command) => command.data.name === 'level').execute(interaction);
  assert.equal(replies[0][0], 'reply');
  assert.match(replies[0][1].content, /Building Garden Sprite's level card/);
  assert.equal(replies[1][0], 'edit');
  assert.equal(replies[1][1].files[0].name, 'level-card.png');
  assert.equal(replies[1][1].components[0].components[0].label, 'Edit card here!');
});

test('owner live metrics expose refreshed heap and storage labels', () => {
  const metrics = ownerLiveMetrics(Date.now());
  assert.match(metrics.sampledAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(metrics.heap.bytes > 0);
  assert.match(metrics.heap.label, /(?:B|KB|MB|GB)$/);
  assert.ok(metrics.storage.bytes >= 0);
  assert.match(metrics.storage.label, /(?:B|KB|MB|GB)$/);
});
