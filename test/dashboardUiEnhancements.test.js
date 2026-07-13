'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('dashboard bundle loads the shared rich editor and UI enhancements', () => {
  const bundle = source('src/adminServer.js');
  assert.match(bundle, /rich-message-editor\.js/);
  assert.match(bundle, /dashboard-ui-enhancements\.js/);
  assert.ok(bundle.indexOf('rich-message-editor.js') < bundle.indexOf('dashboard-ui-enhancements.js'));
});

test('live previews share container controls, root text, and complete placeholder help', () => {
  const script = source('admin/dashboard-ui-enhancements.js');
  const richEditor = source('admin/rich-message-editor.js');
  const messages = source('admin/messages.js');
  assert.match(richEditor, /className = 'rich-container-remove'/);
  assert.match(richEditor, /container\.append\(remove\)/);
  assert.match(script, /rich-add-container/);
  assert.match(script, /message-root-content\.message-root-empty/);
  assert.match(messages, /message-root-gap-line/);
  assert.doesNotMatch(messages, /<strong>Add message<\/strong>/);
  assert.match(messages, /message-preview-remove-container/);
  assert.match(messages, />Add Container<\/button>/);
  assert.match(richEditor, /message-syntax-reference/);
  assert.match(messages, /CoinSpriteMessageSyntax\?\.markup/);
  for (const token of ['<server>', '<channel>', '<@mention>', '<level>', '<ticket_id>', '<appeal-id>', '<moderation-action>', '<moderator-id>', '<notice-delivery>', '<severity-tier>', '<channel-rule>', '<separator>']) {
    assert.ok(richEditor.includes(token), 'missing placeholder ' + token);
  }
  assert.match(script, /collectPatch = wrapped/);
  assert.match(script, /containers: current\.containers/);
  assert.match(script, /Supported operators/);
  assert.match(script, /&gt;=/);
  assert.match(script, /&lt;=/);
});

test('old message placeholder palette is removed in favor of shared compact syntax help', () => {
  const components = source('admin/message-components.js');
  const richEditor = source('admin/rich-message-editor.js');
  assert.doesNotMatch(components, /tokenPalette|data-placeholder-token|Message formats/);
  assert.doesNotMatch(richEditor, /rich-format-bar|rich-format-tokens|Message formats/);
  assert.match(richEditor, /message-syntax-token-row/);
  assert.match(richEditor, /message-syntax-usage/);
  assert.match(richEditor, /Condition format/);
});

test('ticket, request, welcome, leveling, and template editors use the same live-only UI', () => {
  const tickets = source('admin/tickets.js');
  const community = source('admin/community-messages.js');
  const enhancements = source('admin/dashboard-ui-enhancements.js');
  const messages = source('admin/messages.js');
  const ticketEditor = tickets.match(/function messageEditor[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(ticketEditor, /ticket-message-live-only/);
  assert.doesNotMatch(ticketEditor, /message-builder|panel-heading|Message formats/);
  assert.match(tickets, /CoinSpriteRichEditor\.mount/);
  assert.match(community, /CoinSpriteRichEditor\?\.mount/);
  assert.match(enhancements, /mountLevelEditor/);
  assert.match(messages, /botDefault \|\| template\.defaultLocked/);
  assert.match(messages, /message-syntax-reference|CoinSpriteMessageSyntax/);
});

test('dashboard section tabs stay in normal flow and owner escaped-newline artifacts are removed', () => {
  const script = source('admin/dashboard-ui-enhancements.js');
  const baseStyles = source('admin/style.css');
  const bootstrap = source('admin/bootstrap.js');
  assert.match(script, /dashboard-section-tabs/);
  assert.match(script, /position: static !important/);
  assert.doesNotMatch(script, /dashboard-sticky-tabs|position: sticky/);
  assert.match(baseStyles, /\.mini-tabs\s*\{[\s\S]*?position: static/);
  assert.doesNotMatch(bootstrap, /position: sticky/);
  assert.match(script, /removeEscapedNewlineArtifacts/);
  assert.match(script, /\\\\n/);
});

test('dashboard feature gating keeps non-GAG2 tabs hidden for limited servers', () => {
  const app = source('admin/app.js');
  const server = source('src/adminServer.js');
  const styles = source('admin/style.css');
  assert.match(app, /state\.visibleTabs = fullBot \? null : new Set\(\['gag2Stock'\]\)/);
  assert.match(app, /state\.featureVisibilityObserver = new MutationObserver/);
  assert.match(app, /state\.featureVisibilityQueued/);
  assert.match(app, /scheduleFeatureVisibilityEnforce/);
  assert.doesNotMatch(app, /applyFeatureVisibility\(state\.savedConfig\)/);
  assert.match(app, /function trackedTabNames\(\)/);
  assert.match(app, /trackedTabNames\(\)/);
  assert.match(app, /state\.featureVisibilityObserver\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  assert.match(app, /if \(state\.visibleTabs && !state\.visibleTabs\.has\(tabName\)\) return false/);
  assert.match(app, /panel\.hidden = !visible/);
  assert.match(app, /tab\.style\.display = visible \? '' : 'none'/);
  assert.match(app, /document\.body\.classList\.toggle\('gag2-stock-only'/);
  assert.match(styles, /body\.gag2-stock-only \.tab\[data-tab\]:not\(\[data-tab="gag2Stock"\]\)/);
  assert.match(styles, /body\.gag2-stock-only \.tab-panel\[data-panel\]:not\(\[data-panel="gag2Stock"\]\)/);
  assert.match(server, /currentConfig\?\.features\?\.fullBot !== true/);
});

test('GAG2 stock dashboard shows role sync progress', () => {
  const app = source('admin/app.js');
  const html = source('admin/index.html');
  const styles = source('admin/style.css');
  const server = source('src/adminServer.js');
  assert.match(app, /GAG2_STOCK_ROLE_COUNTS/);
  assert.match(app, /roleAssign/);
  assert.match(app, /\['updates', 'Bot Update alert', 'gag2UpdatesChannelMount'\]/);
  assert.match(html, /gag2AssignRoleChannelMount/);
  assert.match(html, /Bot Update alert/);
  assert.match(html, /recommended-label">Recommended/);
  assert.match(html, /field-label field-label-with-badge/);
  assert.match(html, /gag2UpdatesChannelMount/);
  assert.match(styles, /\.field-label\.field-label-with-badge\s*\{[\s\S]*?display: inline-flex/);
  assert.match(html, /gag2StockPermissionOverlay/);
  assert.match(html, /gag2StockPermissionRefreshButton/);
  assert.match(app, /gag2StockPermissionState/);
  assert.match(app, /renderGag2StockPermissionGate/);
  assert.match(app, /refreshGag2StockPermissions/);
  assert.match(app, /directory\?refresh=1/);
  assert.match(app, /state\.gag2StockPermissions = state\.directory\.gag2StockPermissions/);
  assert.match(app, /Adding \$\{roleCountLabel\(adding\)\}/);
  assert.match(app, /Removing \$\{roleCountLabel\(removing\)\}/);
  assert.match(app, /gag2-stock\/setup-progress/);
  assert.match(styles, /\.gag2-stock-panel\.is-locked \.gag2-stock-grid/);
  assert.match(styles, /filter: blur\(3px\)/);
  assert.match(server, /gag2StockPermissions/);
  assert.match(server, /guild\.members\.fetch\(\{ user: botUserId, force: true \}\)/);
  assert.match(server, /fetchGuildDirectory\(guild, \{ force \}\)/);
  assert.match(server, /PermissionFlagsBits\.ManageRoles/);
  assert.match(app, /pollGag2RoleProgress\(payload\.roleProgress\)/);
  assert.match(server, /getGag2StockSetupProgress/);
  assert.match(server, /roleProgress: getGag2StockSetupProgress\(guildId\)/);
});

test('dashboard exposes terms and bug reports with owner report review hooks', () => {
  const html = source('admin/index.html');
  const sitePages = source('admin/site-pages.js');
  const ownerPanel = source('admin/owner-panel.js');
  const ownerRoutes = source('src/ownerPanelRoutes.js');
  const server = source('src/adminServer.js');

  assert.match(html, /data-site-page="terms-service"/);
  assert.match(html, /data-site-page="terms-use"/);
  assert.match(html, /data-site-page="report-bugs"/);
  assert.match(html, /\/admin\/site-pages\.js/);
  assert.match(sitePages, /bugReportForm/);
  assert.match(sitePages, /\/api\/bug-reports/);
  assert.match(ownerPanel, /data-owner-view="reports"/);
  assert.match(ownerPanel, /\/api\/owner\/reports/);
  assert.match(ownerRoutes, /handleBugReportCreate/);
  assert.match(server, /\/api\/bug-reports/);
});
