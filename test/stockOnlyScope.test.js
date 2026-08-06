const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('bot startup loads focused GAG stock, leveling, and owner-panel services', () => {
  const source = read('index.js');
  assert.match(source, /startAdminServer/);
  assert.match(source, /startGag2StockPoster/);
  assert.match(source, /startGag2UpdateAnnouncement/);
  assert.match(source, /handleGag2RoleAssignmentInteraction/);
  assert.match(source, /handleLevelingInteraction/);
  assert.match(source, /handleLevelingMessage/);
  assert.match(source, /Events\.MessageCreate/);
  for (const removed of ['commandsPath', 'inviteRewards', 'dailyMessageStats', 'GuildMemberAdd', 'giveaway', 'ticketSystem']) {
    assert.doesNotMatch(source, new RegExp(removed, 'i'));
  }
});

test('bot registers only stock setup and leveling commands and clears legacy guild commands', () => {
  const source = read('index.js');
  assert.match(source, /\.setName\(STOCK_SETUP_COMMAND_NAME\)/);
  assert.match(source, /const STOCK_SETUP_COMMAND_NAME = 'stock-set-up'/);
  assert.match(source, /const APPLICATION_COMMANDS = \[STOCK_SETUP_COMMAND, \.\.\.LEVELING_COMMANDS/);
  assert.match(source, /client\.application\.commands\.set\(APPLICATION_COMMANDS\)/);
  assert.match(source, /guild\.commands\.set\(\[\]\)/);
  assert.match(source, /setDefaultMemberPermissions\(PermissionFlagsBits\.ManageGuild\)/);
  assert.match(source, /Open stock dashboard/);
  assert.match(source, /flags: COMPONENTS_V2_FLAG \| EPHEMERAL/);
  assert.doesNotMatch(source, /commandsPath|client\.commands|commands\.set\(slashCommands\)/);
});

test('dashboard exposes one focused stylesheet and script', () => {
  const html = read('admin/index.html');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.match(html, /\/admin\/style\.css\?v=[^"']+/);
  assert.match(html, /\/admin\/app\.js\?v=[^"']+/);
  assert.match(html, /GAG2 Stock/);
  assert.match(html, /Owner panel/);
  assert.match(html, /data-view="leveling"/);
  assert.match(html, /id="levelingView"/);
  assert.match(html, /id="levelingRewards"/);
  assert.match(html, /V2 COMMANDS/);
  assert.match(html, /CoinSprite <em>bot\.<\/em>/);
  assert.match(html, /1525195196864925817/);
  assert.match(html, /fallHarvestSection/);
  assert.match(html, /fallCountdown/);
  assert.match(html, /fallRoleFilters/);
  assert.doesNotMatch(html, /Your Garden/);
  for (const removed of ['Tickets', 'Moderation', 'Invite rewards', 'Giveaway']) {
    assert.doesNotMatch(html, new RegExp(removed, 'i'));
  }
});

test('admin writes require CSRF and accept only focused feature config', () => {
  const source = read('src/adminServer.js');
  assert.match(source, /function requireCsrf/);
  assert.match(source, /GAG stock or leveling configuration is required/);
  assert.match(source, /hasLeveling/);
  assert.match(source, /PUBLIC_ASSETS = new Map/);
  assert.match(source, /'Cache-Control': 'no-store, max-age=0'/);
  assert.match(source, /Pragma: 'no-cache'/);
  assert.match(source, /fallHarvestEndsAt/);
  assert.doesNotMatch(source, /handleAppealApi|moderationCases|ticketCommand|handleUserData/);
});

test('only GAG stock is unlocked by default', () => {
  const config = require('../src/serverConfig');
  assert.equal(config.DEFAULT_FEATURES.gag2Stock, true);
  assert.equal(config.DEFAULT_FEATURES.leveling, false);
  assert.equal(config.DEFAULT_FEATURES.fullBot, false);
  assert.equal(config.DEFAULT_LEVELING_CONFIG.enabled, false);
  assert.equal(config.DEFAULT_LEVELING_CONFIG.announcements.enabled, false);
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
  assert.match(css, /\.save-dock/);
  assert.match(css, /\.topbar \{ position: sticky; top: 0;/);
  assert.match(css, /\.notification-menu/);
  assert.match(css, /@keyframes fall-leaf/);
  assert.match(css, /\.event-toggle span \{ min-height: 58px;/);
  assert.match(css, /\.leveling-settings-grid/);
  assert.match(css, /\.reward-row/);
  assert.match(css, /animation: none !important/);
});

test('dashboard moves engine control to the header and only shows save dock for changes', () => {
  const html = read('admin/index.html');
  const source = read('admin/app.js');
  assert.doesNotMatch(html, /hero-panel|engineTitle|engineMessage|mobileSave/);
  assert.match(html, /class="switch-card header-switch"/);
  assert.match(html, /class="save-dock" id="saveDock"[^>]*hidden/);
  assert.match(source, /elements\.saveDock\.hidden = !dirty && !state\.saving/);
  assert.match(html, /id="resetButton"/);
  assert.match(source, /function resetUnsavedChanges/);
});

test('notification settings use searchable dropdown item pickers', () => {
  const source = read('admin/app.js');
  assert.match(source, /data-picker-trigger/);
  assert.match(source, /data-picker-search/);
  assert.match(source, /data-filter-item/);
  assert.match(source, /data-fall-filter-item/);
  assert.match(source, /roleItems: stock\.filters\.roleItems/);
  assert.match(source, /fallRoleItems: stock\.fall\.roleItems/);
  assert.match(source, /data-fall-multiplier/);
  assert.match(source, /\['normal', '2x', '4x'\]/);
  assert.match(source, /Moon prediction/);
  assert.match(source, /Accuracy 100%/);
  assert.match(source, /startFallCountdown/);
  assert.match(source, /1525203819775135764/);
  assert.match(source, /1525203812607070260/);
  assert.match(source, /1533299246315475045/);
  assert.match(source, /1533305562043781282/);
  assert.match(source, /1533306164018937936/);
  assert.doesNotMatch(source, /updateRoleItemsForChangedRarities/);
});

test('all-server visibility is reserved for owners', () => {
  const source = read('src/adminServer.js');
  assert.match(source, /const ids = isOwnerSession\(session, client\)/);
  assert.match(source, /if \(!isOwnerSession\(session, client\)\)/);
  assert.match(source, /member\?\.permissions\?\.has\(PermissionFlagsBits\.Administrator\)/);
  assert.match(source, /!getGuildConfig\(guild\.id\)\) continue/);
});

test('owner heap and storage cards poll live without refreshing the page', () => {
  const source = read('admin/app.js');
  const routes = read('src/adminServer.js');
  assert.match(source, /api\('\/api\/owner\/metrics'\)/);
  assert.match(source, /setInterval\(\(\) => pollOwnerMetrics/);
  assert.match(source, /data-owner-metric="\$\{key\}"/);
  assert.match(routes, /pathname === '\/api\/owner\/metrics'/);
});

test('owner controls feature access and leveling stays server-side locked', () => {
  const server = read('src/adminServer.js');
  const owner = read('src/ownerPanelRoutes.js');
  const dashboard = read('admin/app.js');
  assert.match(server, /ownerFeatures/);
  assert.match(server, /Leveling is locked for this server/);
  assert.match(owner, /setGuildFeatureAccess/);
  assert.match(dashboard, /data-owner-feature="leveling"/);
  assert.match(dashboard, /Locked by owner/);
});

test('leveling dashboard provides a single fully editable live V2 composer with media uploads', () => {
  const html = read('admin/index.html');
  const source = read('admin/app.js');
  const css = read('admin/style.css');
  assert.match(html, /Live Discord message/);
  assert.doesNotMatch(html, /id="levelingMessage"/);
  assert.match(html, /id="levelingVariablesToggle"/);
  assert.match(html, /id="levelingComposerPanel"/);
  assert.match(html, /id="levelingContainerAdd"/);
  assert.match(html, /id="levelingThumbnailAdd"/);
  assert.match(html, /id="levelingGalleryAdd"/);
  assert.match(source, /discordInlineMarkdown/);
  assert.match(source, /beginInlineMessageEdit/);
  assert.match(source, /data-inline-message-input/);
  assert.match(source, /inlineTemplateEditor\(announcements\.template\)/);
  assert.equal((source.match(/<textarea class="inline-message-input"/g) || []).length, 1, 'the live message has one edit box');
  assert.doesNotMatch(source, /inlineTemplateEditor\('title'|inlineTemplateEditor\('progress'/);
  assert.match(source, /\{user_profile\}/);
  assert.match(source, /LEVELING_VARIABLES/);
  assert.match(source, /leveling-media/);
  assert.match(source, /data-leveling-channel-multiplier/);
  assert.match(source, /renderLevelingBoosts/);
  assert.match(source, /role-color/);
  assert.match(css, /\.inline-message-editor\.editing/);
  assert.match(css, /\.preview-tool-panel/);
  assert.match(css, /\.preview-tool-panel\[data-panel="variables"\]\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(css, /\.discord-preview\s*\{[^}]*min-height:\s*390px/);
});
