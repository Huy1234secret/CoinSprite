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
  assert.doesNotMatch(source, /createRngGameFeature|rngGame|features\/rng-game/);
  assert.match(source, /Events\.MessageCreate/);
  for (const removed of ['commandsPath', 'inviteRewards', 'dailyMessageStats', 'GuildMemberAdd', 'giveaway', 'ticketSystem']) {
    assert.doesNotMatch(source, new RegExp(removed, 'i'));
  }
});

test('bot registers stock setup globally and syncs optional commands per guild', () => {
  const source = read('index.js');
  const commands = read('src/applicationCommands.js');
  assert.match(commands, /\.setName\(STOCK_SETUP_COMMAND_NAME\)/);
  assert.match(commands, /const STOCK_SETUP_COMMAND_NAME = 'stock-set-up'/);
  assert.match(commands, /LEVELING_COMMANDS/);
  assert.doesNotMatch(commands, /RNG_GAME_COMMANDS|features\/rng-game/);
  assert.match(source, /client\.application\.commands\.set\(GLOBAL_APPLICATION_COMMANDS\)/);
  assert.match(source, /syncGuildApplicationCommands/);
  assert.match(commands, /guild\.commands\.set\(commands\)/);
  assert.match(commands, /setDefaultMemberPermissions\(PermissionFlagsBits\.ManageGuild\)/);
  assert.match(source, /Open stock dashboard/);
  assert.match(source, /flags: COMPONENTS_V2_FLAG \| EPHEMERAL/);
  assert.doesNotMatch(source, /\.\.\.LEVELING_COMMANDS/);
  assert.doesNotMatch(source, /commandsPath|client\.commands|commands\.set\(slashCommands\)/);
});

test('optional slash command visibility follows each server engine and owner lock', () => {
  const { GLOBAL_APPLICATION_COMMANDS, featureCommandsForConfig } = require('../src/applicationCommands');
  assert.deepEqual(GLOBAL_APPLICATION_COMMANDS.map((command) => command.name), ['stock-set-up']);
  const base = {
    enabled: true,
    features: { leveling: false },
    leveling: { enabled: false },
  };
  assert.deepEqual(featureCommandsForConfig(base), []);
  const leveling = featureCommandsForConfig({
    ...base, features: { ...base.features, leveling: true }, leveling: { enabled: true },
  }).map((command) => command.name);
  assert.deepEqual(leveling, ['level', 'leaderboard', 'level-set', 'xp-add', 'leveling-setup']);
  assert.deepEqual(featureCommandsForConfig({ ...base, enabled: false }), []);
});

test('dashboard exposes one focused stylesheet and script', () => {
  const html = read('admin/index.html');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.match(html, /href="\/admin\/style\.css"/);
  assert.match(html, /src="\/admin\/app\.js"/);
  assert.doesNotMatch(html, /(?:app\.js|style\.css)\?v=/);
  assert.match(html, /GAG2 Stock/);
  assert.match(html, /Owner panel/);
  assert.match(html, /data-view="leveling"/);
  assert.match(html, /id="levelingView"/);
  assert.match(html, /id="levelingRewards"/);
  assert.doesNotMatch(html, /rngGame|rng-game|GAG2 RNG Game/);
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
  assert.doesNotMatch(source, /hasRngGame|rngGame|RNG game/);
  assert.match(source, /PUBLIC_ASSETS = new Map/);
  assert.match(source, /no-store, max-age=0/);
  assert.match(source, /public, max-age=31536000, immutable/);
  assert.match(source, /url\.searchParams\.get\('v'\)/);
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

test('legacy RNG config is removed without relocking an enabled leveling server', () => {
  const config = require('../src/serverConfig');
  const guildId = '123456789012345678';
  const state = config.normalizeState({
    meta: { schemaVersion: config.SCHEMA_VERSION, disabledGuilds: {} },
    guilds: {
      [guildId]: {
        enabled: true,
        features: { gag2Stock: true, leveling: true, rngGame: true },
        leveling: { enabled: true },
        rngGame: { enabled: true, gameChannelId: '223456789012345678' },
      },
    },
  });
  assert.equal(state.guilds[guildId].features.leveling, true);
  assert.equal(state.guilds[guildId].leveling.enabled, true);
  assert.equal(Object.hasOwn(state.guilds[guildId].features, 'rngGame'), false);
  assert.equal(Object.hasOwn(state.guilds[guildId], 'rngGame'), false);
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
  assert.doesNotMatch(css, /rng-settings-grid|rng-game/);
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

test('owner controls feature access and optional features stay server-side locked', () => {
  const server = read('src/adminServer.js');
  const owner = read('src/ownerPanelRoutes.js');
  const dashboard = read('admin/app.js');
  assert.match(server, /ownerFeatures/);
  assert.match(server, /Leveling is locked for this server/);
  assert.doesNotMatch(server, /GAG2 RNG Game|rngGame/);
  assert.match(owner, /setGuildFeatureAccess/);
  assert.match(dashboard, /data-owner-feature="leveling"/);
  assert.doesNotMatch(dashboard, /data-owner-feature="rngGame"|GAG2 RNG Game/);
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

test('profile menu opens a focused drag-and-resize level card editor', () => {
  const html = read('admin/index.html');
  const css = read('admin/style.css');
  const source = read('admin/app.js');
  const server = read('src/adminServer.js');
  const leveling = read('src/leveling.js');
  assert.match(html, />Manage Server</);
  assert.match(html, /href="\/profile"/);
  assert.match(html, /id="profileShell"/);
  assert.match(html, /id="levelCardCanvas"/);
  assert.match(html, /id="levelCardDraftCanvas"/);
  assert.match(html, /Upload background/);
  assert.match(html, /\+ Image or icon/);
  assert.match(html, /\+ Text/);
  assert.match(source, /beginCardPointer/);
  assert.match(source, /moveCardPointer/);
  assert.match(source, /uploadCardMedia/);
  assert.match(source, /constrainCardSelection/);
  assert.match(source, /CARD_SNAP_DISTANCE/);
  assert.match(source, /CARD_SNAP_RELEASE/);
  assert.match(source, /kind: 'center'/);
  assert.match(source, /cardVisualBounds/);
  assert.match(source, /\['nw'.*'n'.*'ne'/s);
  assert.match(source, /cardRotateHandle/);
  assert.match(source, /data-card-visibility/);
  assert.match(source, /data-card-toggle/);
  assert.match(source, /fontFamily/);
  assert.match(source, /underline/);
  assert.match(source, /rotation/);
  assert.match(source, /CARD_TEMPLATES/);
  assert.match(source, /undoCardDesign/);
  assert.match(source, /redoCardDesign/);
  assert.match(source, /cardHandleMetrics/);
  assert.match(source, /Nunito Rounded/);
  assert.match(source, /ensureCardFontsReady/);
  assert.match(source, /Required browser font silently fell back/);
  assert.match(source, /await Promise\.all\(textItems\.map/);
  assert.match(css, /\.level-card-canvas-wrap[^}]*width:\s*min\(100%,550px\)/);
  assert.doesNotMatch(source, /previewNameWidth/);
  assert.match(source, /\/api\/profile\/card\/preview/);
  assert.match(source, /responseHash !== expectedSavedHash/);
  assert.match(html, /Authoritative server-rendered level card preview/);
  assert.doesNotMatch(html, /levelCardExactCanvas/);
  assert.match(source, /showAuthoritativeCardPreview/);
  assert.match(source, /CARD_PREVIEW_DEBOUNCE_MS = 350/);
  assert.match(source, /cardAuthoritativeCanvas\.getContext/);
  assert.match(source, /panelOpacity/);
  assert.match(source, /1000 - target\.width/);
  assert.match(source, /320 - target\.height/);
  assert.match(source, /\/api\/profile\/card/);
  assert.match(server, /pathname === '\/api\/profile\/card'/);
  assert.match(server, /pathname === '\/api\/profile\/card\/preview'/);
  assert.match(server, /internalCardMatch/);
  assert.match(server, /hasInternalRenderKey/);
  assert.match(server, /renderLevelCard/);
  assert.match(server, /getLevelCardProfile/);
  assert.match(server, /X-CoinSprite-Design-Hash/);
  assert.match(server, /X-CoinSprite-Build-Version/);
  assert.match(server, /X-CoinSprite-Renderer-Version/);
  assert.match(server, /X-CoinSprite-Font-Manifest/);
  assert.match(server, /level-card-media/);
  assert.match(server, /serveAdminFont/);
  assert.match(html, /cardTemplateSelect/);
  assert.match(html, /cardUndoButton/);
  assert.match(html, /cardRedoButton/);
  assert.match(leveling, /renderLevelCard/);
  assert.match(leveling, /levelCardTextY\(item\)/);
  assert.match(leveling, /saved Y coordinate authoritative/);
  assert.match(leveling, /drawCardText\(context, displayName, design\.username\)/);
  assert.match(leveling, /renderPublishedLevelCard/);
  assert.match(leveling, /X-CoinSprite-Render-Key/);
  assert.match(leveling, /renderer-version-mismatch/);
  assert.match(leveling, /Authoritative level card used/);
  assert.match(leveling, /label: 'Edit card here!'/);
  assert.match(leveling, /renderLeaderboardCard/);
  assert.match(leveling, /name: 'leaderboard\.png'/);
  assert.doesNotMatch(leveling, /attachment:\/\/level-card\.png/);
});
