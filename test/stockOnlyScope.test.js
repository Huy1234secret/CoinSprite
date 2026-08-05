const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('bot startup loads only GAG stock and owner-panel services', () => {
  const source = read('index.js');
  assert.match(source, /startAdminServer/);
  assert.match(source, /startGag2StockPoster/);
  assert.match(source, /startGag2UpdateAnnouncement/);
  assert.match(source, /handleGag2RoleAssignmentInteraction/);
  for (const removed of ['commandsPath', 'inviteRewards', 'dailyMessageStats', 'MessageCreate', 'GuildMemberAdd', 'giveaway', 'ticketSystem']) {
    assert.doesNotMatch(source, new RegExp(removed, 'i'));
  }
});

test('dashboard exposes one focused stylesheet and script', () => {
  const html = read('admin/index.html');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.match(html, /GAG2 Stock/);
  assert.match(html, /Owner panel/);
  assert.match(html, /CoinSprite <em>bot\.<\/em>/);
  assert.match(html, /1525195196864925817/);
  assert.doesNotMatch(html, /Your Garden/);
  for (const removed of ['Leveling', 'Tickets', 'Moderation', 'Invite rewards', 'Giveaway']) {
    assert.doesNotMatch(html, new RegExp(removed, 'i'));
  }
});

test('admin writes require CSRF and only accept GAG stock config', () => {
  const source = read('src/adminServer.js');
  assert.match(source, /function requireCsrf/);
  assert.match(source, /Only GAG stock configuration can be updated/);
  assert.match(source, /PUBLIC_ASSETS = new Map/);
  assert.doesNotMatch(source, /handleAppealApi|moderationCases|ticketCommand|handleUserData/);
});

test('stock-only config permanently disables full bot features', () => {
  const config = require('../src/serverConfig');
  assert.equal(config.DEFAULT_FEATURES.gag2Stock, true);
  assert.equal(config.DEFAULT_FEATURES.fullBot, false);
  assert.equal(config.isGuildFullBotEnabled('1493901002519347290'), false);
  const normalized = config.normalizeGag2StockConfig({
    enabled: true,
    channels: { seed: '123456789012345678', gear: 'not-an-id' },
    filters: { sellMultipliers: ['4x', 'invalid'] },
  });
  assert.equal(normalized.channels.seed, '123456789012345678');
  assert.equal(normalized.channels.gear, '');
  assert.deepEqual(normalized.filters.sellMultipliers, ['4x']);
});

test('responsive design keeps desktop and mobile layouts', () => {
  const css = read('admin/style.css');
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.mobile-save/);
  assert.match(css, /\.topbar \{ position: sticky; top: 0;/);
  assert.match(css, /\.notification-menu/);
});

test('notification settings use searchable dropdown item pickers', () => {
  const source = read('admin/app.js');
  assert.match(source, /data-picker-trigger/);
  assert.match(source, /data-picker-search/);
  assert.match(source, /data-filter-item/);
  assert.match(source, /roleItems: stock\.filters\.roleItems/);
  assert.doesNotMatch(source, /updateRoleItemsForChangedRarities/);
});

test('all-server visibility is reserved for owners', () => {
  const source = read('src/adminServer.js');
  assert.match(source, /const ids = isOwnerSession\(session, client\)/);
  assert.match(source, /if \(!isOwnerSession\(session, client\)\)/);
  assert.match(source, /member\?\.permissions\?\.has\(PermissionFlagsBits\.Administrator\)/);
  assert.match(source, /!getGuildConfig\(guild\.id\)\) continue/);
});
