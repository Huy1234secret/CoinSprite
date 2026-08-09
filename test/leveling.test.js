const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const {
  DEFAULT_LEVELING_CONFIG,
  normalizeLevelingConfig,
  normalizeState,
} = require('../src/serverConfig');
const {
  COMPONENTS_V2_FLAG,
  LEVEL_CARD_MEDIA_DIR,
  LEVELING_COMMANDS,
  announcementText,
  applyXpToRecord,
  buildLeaderboardPayload,
  buildLevelCardPayload,
  buildLevelPayload,
  canvasDisplayName,
  handleLevelingInteraction,
  leaderboardPageModal,
  levelCardRenderOrigin,
  levelCardRenderKey,
  loadLocalCardImage,
  levelUpAnnouncementPayload,
  levelForXp,
  normalizeLevelCardDesign,
  progressBar,
  renderLeaderboardCard,
  renderLevelCard,
  renderPublishedLevelCard,
  resolvedAnnouncementLayout,
  xpThresholdForLevel,
  xpMultiplierForMessage,
} = require('../src/leveling');
const { ownerLiveMetrics } = require('../src/ownerPanelRoutes');
const { decodeLevelingMedia } = require('../src/adminServer');
const { levelCardRendererIdentity } = require('../src/canvasFonts');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function withCaBxMetadata(png) {
  const type = Buffer.from('caBX');
  const payload = Buffer.from('content credentials metadata');
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  type.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, payload])), 8 + payload.length);
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

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
    panelOpacity: -4,
    avatar: { x: 999, y: 999, size: 240, visible: false, rotation: 33 },
    username: { x: 999, y: 999, size: 80, fontFamily: 'serif', bold: false, italic: true, underline: true, rotation: 361 },
    level: { x: 999, y: 999, size: 60, visible: false },
    rank: { x: -999, y: 999, size: 60 },
    xp: { x: 999, y: 999, size: 50 },
    progress: { x: 999, y: 999, width: 5000, height: 70, color: '#00FF00', trackColor: 'red' },
    layers: [
      { id: 'welcome', type: 'text', text: 'Hello\nworld', x: 42, y: 50, size: 28, color: '#abcdef', fontFamily: 'mono', bold: false, italic: true, underline: true, rotation: -450 },
      { id: 'safe-icon', type: 'image', imageUrl: `/level-card-media/${userId}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp`, x: 999, y: 999, width: 800, height: 300 },
      { id: 'other-user', type: 'image', imageUrl: '/level-card-media/999999999999999999/cccccccccccccccccccccccccccccccc.png' },
      { id: 'external', type: 'image', imageUrl: 'https://example.com/tracker.png' },
    ],
  }, userId);
  assert.equal(design.background.color, '#ff00aa');
  assert.equal(design.background.scale, 5);
  assert.equal(design.panelOpacity, 0);
  assert.equal(design.progress.width, 950);
  assert.equal(design.progress.x, 50);
  assert.equal(design.progress.y, 250);
  assert.equal(design.avatar.x, 760);
  assert.equal(design.avatar.y, 80);
  assert.equal(design.avatar.visible, false);
  assert.equal(design.avatar.rotation, 33);
  assert.deepEqual({ x: design.username.x, y: design.username.y }, { x: 610, y: 240 });
  assert.deepEqual({ fontFamily: design.username.fontFamily, bold: design.username.bold, italic: design.username.italic, underline: design.username.underline, rotation: design.username.rotation }, {
    fontFamily: 'serif', bold: false, italic: true, underline: true, rotation: 1,
  });
  assert.equal(design.level.visible, false);
  assert.deepEqual({ x: design.level.x, y: design.level.y }, { x: 790, y: 260 });
  assert.deepEqual({ x: design.rank.x, y: design.rank.y }, { x: 120, y: 260 });
  assert.deepEqual({ x: design.xp.x, y: design.xp.y }, { x: 670, y: 270 });
  assert.equal(design.progress.color, '#00ff00');
  assert.equal(design.progress.trackColor, '#303a33');
  assert.deepEqual(design.layers.map((layer) => layer.id), ['welcome', 'safe-icon']);
  assert.equal(design.layers[0].text, 'Hello world');
  assert.deepEqual({ fontFamily: design.layers[0].fontFamily, bold: design.layers[0].bold, italic: design.layers[0].italic, underline: design.layers[0].underline, rotation: design.layers[0].rotation }, {
    fontFamily: 'mono', bold: false, italic: true, underline: true, rotation: -90,
  });
  assert.equal(design.layers[1].x, 200);
  assert.equal(design.layers[1].y, 20);
});

test('level card background retries after a missing upload and uses saved panel opacity', async () => {
  const userId = '123456789012345679';
  const assetId = 'dddddddddddddddddddddddddddddddd';
  const directory = path.join(LEVEL_CARD_MEDIA_DIR, userId);
  const filePath = path.join(directory, `${assetId}.png`);
  fs.rmSync(directory, { recursive: true, force: true });
  const design = normalizeLevelCardDesign({
    background: { color: '#0000ff', imageUrl: `/level-card-media/${userId}/${assetId}.png` },
    panelOpacity: 0,
  }, userId);
  const user = { id: userId, username: 'BackgroundTest' };
  const stats = { level: 1, rank: 1, progressXp: 1, neededXp: 2, progressRatio: .5, xp: 1 };
  try {
    const beforeUpload = await renderLevelCard(user, stats, design);
    const background = createCanvas(16, 16);
    const context = background.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 16, 16);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filePath, background.toBuffer('image/png'));
    const afterUpload = await renderLevelCard(user, stats, design);
    assert.notDeepEqual(afterUpload, beforeUpload);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('level card renderer keeps editor text sizing exact and honors visibility, typography, and rotation', async () => {
  const user = { id: '123456789012345688', username: 'ExactPreview' };
  const stats = { level: 7, rank: 4, progressXp: 41, neededXp: 281, progressRatio: 41 / 281, xp: 900 };
  const design = {
    panelOpacity: 0,
    avatar: { visible: false }, username: { visible: false }, level: { visible: false },
    rank: { visible: false }, xp: { visible: false }, progress: { visible: false },
    layers: [{
      id: 'exact-text', type: 'text', text: 'Exact text', x: 100, y: 110, width: 12, height: 12,
      size: 42, color: '#ffffff', fontFamily: 'sans', bold: true, italic: false, underline: false, rotation: 0,
    }],
  };
  const narrowSavedBox = await renderLevelCard(user, stats, design);
  const wideSavedBox = await renderLevelCard(user, stats, {
    ...design,
    layers: [{ ...design.layers[0], width: 600, height: 200 }],
  });
  assert.deepEqual(narrowSavedBox, wideSavedBox);

  const styled = await renderLevelCard(user, stats, {
    ...design,
    layers: [{ ...design.layers[0], fontFamily: 'mono', italic: true, underline: true, rotation: 30 }],
  });
  assert.notDeepEqual(styled, narrowSavedBox);

  const hidden = await renderLevelCard(user, stats, {
    ...design,
    layers: [{ ...design.layers[0], visible: false }],
  });
  assert.notDeepEqual(hidden, narrowSavedBox);
});

test('Discord level card renderer follows the website canvas clipping', async () => {
  const userId = '123456789012345686';
  const assetId = 'cccccccccccccccccccccccccccccccc';
  const directory = path.join(LEVEL_CARD_MEDIA_DIR, userId);
  const filePath = path.join(directory, `${assetId}.png`);
  const artwork = createCanvas(100, 100);
  const artworkContext = artwork.getContext('2d');
  artworkContext.fillStyle = '#ff0000';
  artworkContext.fillRect(0, 0, 100, 100);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, artwork.toBuffer('image/png'));

  try {
    const image = await renderLevelCard({ id: userId, username: 'WebsiteTruth' }, {
      level: 1, rank: 1, progressXp: 0, neededXp: 1, progressRatio: 0, xp: 0,
    }, {
      panelOpacity: 0,
      avatar: { visible: false }, username: { visible: false }, level: { visible: false },
      rank: { visible: false }, xp: { visible: false }, progress: { visible: false },
      layers: [{
        id: 'corner-art', type: 'image', imageUrl: `/level-card-media/${userId}/${assetId}.png`,
        x: 0, y: 0, width: 100, height: 100, rotation: 0,
      }],
    });
    const decoded = await loadImage(image);
    const pixels = createCanvas(1000, 320);
    const context = pixels.getContext('2d');
    context.drawImage(decoded, 0, 0);
    assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0);
    assert.equal(context.getImageData(50, 50, 1, 1).data[3], 255);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('level card media loads locally without a remote request', async () => {
  const userId = '123456789012345680';
  const assetId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const directory = path.join(LEVEL_CARD_MEDIA_DIR, userId);
  const filePath = path.join(directory, `${assetId}.png`);
  const image = createCanvas(2, 2).toBuffer('image/png');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, image);
  try {
    let fetched = false;
    const loaded = await loadLocalCardImage(`/level-card-media/${userId}/${assetId}.png`, userId, {
      origin: 'https://panel.coin-sprite.com',
      fetchImpl: async () => { fetched = true; },
      log: () => {},
    });
    assert.ok(loaded);
    assert.equal(fetched, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('level card media loads remotely after a local miss', async () => {
  const userId = '123456789012345681';
  const assetId = 'ffffffffffffffffffffffffffffffff';
  const expectedUrl = `https://panel.coin-sprite.com/level-card-media/${userId}/${assetId}.png`;
  const image = createCanvas(2, 2).toBuffer('image/png');
  let requestedUrl;
  const loaded = await loadLocalCardImage(`/level-card-media/${userId}/${assetId}.png`, userId, {
    origin: 'https://panel.coin-sprite.com/profile',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === 'content-type' ? 'image/png' : String(image.length) },
        arrayBuffer: async () => image,
      };
    },
    log: () => {},
  });
  assert.ok(loaded);
  assert.equal(requestedUrl, expectedUrl);
});

test('level card media falls back remotely after a corrupt local image', async () => {
  const userId = '123456789012345682';
  const assetId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const directory = path.join(LEVEL_CARD_MEDIA_DIR, userId);
  const filePath = path.join(directory, `${assetId}.png`);
  const image = createCanvas(2, 2).toBuffer('image/png');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('not an image'));
  try {
    let requests = 0;
    const loaded = await loadLocalCardImage(`/level-card-media/${userId}/${assetId}.png`, userId, {
      origin: 'https://panel.coin-sprite.com',
      fetchImpl: async () => {
        requests += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name === 'content-type' ? 'image/png' : String(image.length) },
          arrayBuffer: async () => image,
        };
      },
      log: () => {},
    });
    assert.ok(loaded);
    assert.equal(requests, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('level card media accepts a valid image with a proxy-style content type', async () => {
  const userId = '123456789012345683';
  const assetId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const image = withCaBxMetadata(createCanvas(2, 2).toBuffer('image/png'));
  const logs = [];
  const loaded = await loadLocalCardImage(`/level-card-media/${userId}/${assetId}.png`, userId, {
    origin: 'https://panel.coin-sprite.com',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'content-type' ? 'application/octet-stream' : null },
      arrayBuffer: async () => image,
    }),
    log: (message) => logs.push(message),
  });
  assert.ok(loaded);
  assert.ok(logs.some((message) => message.includes('content-type=application/octet-stream')));
  assert.ok(logs.some((message) => message.includes('removed caBX metadata before decode')));
});

test('level card media remote decode and fetch failures remain retryable', async () => {
  const userId = '123456789012345684';
  const image = createCanvas(2, 2).toBuffer('image/png');
  let decodeRequests = 0;
  const decodeUrl = `/level-card-media/${userId}/cccccccccccccccccccccccccccccccc.png`;
  const decodeOptions = {
    origin: 'https://panel.coin-sprite.com',
    fetchImpl: async () => {
      decodeRequests += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => image,
      };
    },
    loadImageImpl: async () => { throw new Error('undecodable image'); },
    log: () => {},
  };
  assert.equal(await loadLocalCardImage(decodeUrl, userId, decodeOptions), null);
  assert.equal(await loadLocalCardImage(decodeUrl, userId, decodeOptions), null);
  assert.equal(decodeRequests, 2);

  let fetchRequests = 0;
  const fetchUrl = `/level-card-media/${userId}/dddddddddddddddddddddddddddddddd.png`;
  const fetchOptions = {
    origin: 'https://panel.coin-sprite.com',
    fetchImpl: async () => {
      fetchRequests += 1;
      throw new Error('temporary proxy failure');
    },
    log: () => {},
  };
  assert.equal(await loadLocalCardImage(fetchUrl, userId, fetchOptions), null);
  assert.equal(await loadLocalCardImage(fetchUrl, userId, fetchOptions), null);
  assert.equal(fetchRequests, 2);
});

test('level card media rejects a URL owned by another user', async () => {
  let fetched = false;
  const loaded = await loadLocalCardImage(
    '/level-card-media/123456789012345685/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png',
    '123456789012345686',
    { origin: 'https://panel.coin-sprite.com', fetchImpl: async () => { fetched = true; }, log: () => {} },
  );
  assert.equal(loaded, null);
  assert.equal(fetched, false);
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

test('/level uses the dashboard renderer that owns saved card media', async () => {
  const identity = levelCardRendererIdentity();
  const designHash = 'a'.repeat(64);
  const expected = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('authoritative-card'),
  ]);
  let request;
  const logs = [];
  const image = await renderPublishedLevelCard({
    id: '123456789012345678',
    username: 'Sprite',
    displayName: 'Garden Sprite',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  }, {
    level: 12, rank: 3, progressXp: 280, neededXp: 420, progressRatio: 2 / 3, xp: 3160,
  }, {
    origin: 'https://panel.coin-sprite.com',
    key: 'signed-render-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => ({
          'content-type': 'image/png',
          'x-coinsprite-renderer-version': identity.version,
          'x-coinsprite-build-version': identity.buildVersion,
          'x-coinsprite-font-manifest': identity.fontManifestHash,
          'x-coinsprite-design-hash': designHash,
          'x-coinsprite-saved-at': '1720000000000',
          'x-coinsprite-render-source': 'authoritative',
        })[name.toLowerCase()] || null },
        arrayBuffer: async () => expected,
      };
    },
    log: (message) => logs.push(message),
  });
  assert.deepEqual(image, expected);
  assert.equal(request.url, 'https://panel.coin-sprite.com/api/internal/level-card/123456789012345678');
  assert.equal(request.options.headers['X-CoinSprite-Render-Key'], 'signed-render-key');
  assert.equal(request.options.headers['X-CoinSprite-Renderer-Version'], identity.version);
  assert.equal(request.options.headers['X-CoinSprite-Build-Version'], identity.buildVersion);
  assert.equal(request.options.headers['X-CoinSprite-Font-Manifest'], identity.fontManifestHash);
  assert.equal(JSON.parse(request.options.body).user.displayName, 'Garden Sprite');
  assert.ok(logs.some((message) => message.includes(`status=200 source=authoritative renderer=${identity.version} build=${identity.buildVersion} font-manifest=${identity.fontManifestHash} design=${designHash}`)));
  assert.ok(logs.some((message) => message.includes('Authoritative level card used')));
  assert.equal(levelCardRenderKey('shared-secret'), levelCardRenderKey('shared-secret'));
  assert.equal(levelCardRenderOrigin({ DISCORD_REDIRECT_URI: 'https://panel.coin-sprite.com/auth/discord/callback' }), 'https://panel.coin-sprite.com');
});

test('/level reports an authoritative renderer failure without falling back or logging its secret', async () => {
  const logs = [];
  await assert.rejects(() => renderPublishedLevelCard({
    id: '123456789012345687', username: 'Fallback', displayName: 'Fallback',
  }, {
    level: 2, rank: 4, progressXp: 10, neededXp: 20, progressRatio: .5, xp: 50,
  }, {
    origin: 'https://panel.coin-sprite.com',
    key: 'must-not-appear-in-logs',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      headers: { get: (name) => name === 'content-type' ? 'text/plain' : null },
    }),
    log: (message) => logs.push(message),
  }), (error) => error.code === 'LEVEL_CARD_AUTHORITATIVE_UNAVAILABLE' && error.reason === 'http-503');
  assert.ok(logs.some((message) => message.includes('status=503 source=missing renderer=missing build=missing font-manifest=missing design=missing saved-at=missing content-type=text/plain')));
  assert.ok(logs.some((message) => message.includes('reason=http-503')));
  assert.doesNotMatch(logs.join('\n'), /must-not-appear-in-logs/);
});

test('leaderboard uses one fixed Unicode-capable image and one modal page button', async () => {
  const rows = [
    { rank: 1, displayName: 'Gold', user: { id: '111111111111111111', username: 'Gold' }, level: 30, xp: 9000 },
    { rank: 2, displayName: 'Silver', user: { id: '222222222222222222', username: 'Silver' }, level: 25, xp: 7000 },
    { rank: 3, displayName: 'Bronze', user: { id: '333333333333333333', username: 'Bronze' }, level: 20, xp: 5000 },
    { rank: 4, displayName: '你好世界 · Nguyễn 🌱', user: { id: '444444444444444444', username: 'Unicode' }, level: 18, xp: 4200 },
  ];
  const image = await renderLeaderboardCard({ guildName: 'Garden Hub', rows, page: 1, maxPage: 2, totalMembers: 14 });
  const emptyImage = await renderLeaderboardCard({ guildName: 'Garden Hub', rows: [], page: 2, maxPage: 2, totalMembers: 14 });
  assert.ok(image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  const [fullSize, emptySize] = await Promise.all([loadImage(image), loadImage(emptyImage)]);
  assert.deepEqual({ width: fullSize.width, height: fullSize.height }, { width: 1000, height: 1079 });
  assert.deepEqual({ width: emptySize.width, height: emptySize.height }, { width: 1000, height: 1079 });
  assert.equal(canvasDisplayName(rows[3].displayName), rows[3].displayName);
  assert.equal(GlobalFonts.has('CoinSprite Unicode'), true);

  const payload = buildLeaderboardPayload(image, { ownerId: '123', currentPage: 2, maxPage: 8, viewerRank: 9 });
  assert.deepEqual(payload, {
    flags: COMPONENTS_V2_FLAG,
    content: null,
    allowedMentions: { parse: [], users: [], roles: [] },
    attachments: [],
    files: [{ attachment: image, name: 'leaderboard.png' }],
    components: [{
      type: 17,
      accent_color: 0xffffff,
      components: [
        { type: 12, items: [{ media: { url: 'attachment://leaderboard.png' } }] },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: 'You are placed **#9** in the leaderboard!' },
        { type: 1, components: [{
          type: 2, style: 2, label: 'Page 2 / 8', custom_id: 'leveling:leaderboard-open:123:8',
        }] },
      ],
    }],
  });
  assert.doesNotMatch(JSON.stringify(payload), /description|alt/i);

  const modal = leaderboardPageModal('123', 8);
  assert.equal(modal.title, 'Switch leaderboard page');
  assert.equal(modal.components[0].components[0].label, 'What page you wanna switch to?');
  assert.equal(modal.components[0].components[0].placeholder, '1 / 8');
  const source = require('node:fs').readFileSync(require.resolve('../src/leveling'), 'utf8');
  assert.match(source, /1: \{ main: '#f6c945'/);
  assert.match(source, /2: \{ main: '#c6ced8'/);
  assert.match(source, /3: \{ main: '#d58a52'/);
});

test('leaderboard page button opens its owner-only page modal', async () => {
  let shown;
  const handled = await handleLevelingInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'leveling:leaderboard-open:123:7',
    user: { id: '123' },
    showModal: async (modal) => { shown = modal; },
  });
  assert.equal(handled, true);
  assert.equal(shown.custom_id, 'leveling:leaderboard-submit:123:7');

  let deniedReply;
  await handleLevelingInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'leveling:leaderboard-open:123:7',
    user: { id: '456' },
    reply: async (payload) => { deniedReply = payload; },
  });
  assert.equal(deniedReply.flags & 64, 64);
  assert.match(deniedReply.components[0].components[0].content, /another member/);

  let errorReply;
  const invalid = await handleLevelingInteraction({
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId: 'leveling:leaderboard-submit:123:7',
    user: { id: '123' },
    fields: { getTextInputValue: () => '9' },
    reply: async (payload) => { errorReply = payload; },
  });
  assert.equal(invalid, true);
  assert.match(errorReply.components[0].components[0].content, /from \*\*1\*\* to \*\*7\*\*/);
});

test('leaderboard modal pagination replaces the attachment on the same message', async () => {
  const calls = [];
  const handled = await handleLevelingInteraction({
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId: 'leveling:leaderboard-submit:123:1',
    user: { id: '123' },
    guildId: '923456789012345678',
    guild: {
      name: 'Unicode 世界',
      members: { cache: new Map(), fetch: async () => null },
    },
    fields: { getTextInputValue: () => '1' },
    deferUpdate: async () => calls.push('deferUpdate'),
    editReply: async (payload) => calls.push(['editReply', payload]),
  });
  assert.equal(handled, true);
  assert.equal(calls[0], 'deferUpdate');
  assert.equal(calls[1][0], 'editReply');
  const payload = calls[1][1];
  assert.equal(payload.flags, COMPONENTS_V2_FLAG);
  assert.deepEqual(payload.attachments, []);
  assert.equal(payload.files[0].name, 'leaderboard.png');
  assert.equal(payload.allowedMentions.parse.length, 0);
  assert.equal(payload.components[0].components[0].items[0].media.url, 'attachment://leaderboard.png');
  assert.equal(payload.components[0].components[3].components[0].label, 'Page 1 / 1');
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
