const fs = require('node:fs');
const path = require('node:path');

const view = name => fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
const navigation = [
  ['levelingNav', 'leveling', '🏅', 'Leveling', 'XP, drops & rewards'],
  ['welcomeMessagesNav', 'member-messages', '👋', 'Member moments', 'Join, leave & boost'],
  ['messageTemplatesNav', 'message-templates', '📝', 'Message studio', 'Reusable Discord messages'],
  ['reactionRolesNav', 'reaction-roles', '🎭', 'Role menus', 'Member self-service'],
  ['gamesNav', 'games', '🎮', 'Games routing', 'Channels & commands'],
  ['ownerNav', 'owner', '🛠️', 'Fleet control', 'Health, access & logs'],
];
const bot = (className = 'bot-avatar') => `<img class="${className}" src="/bot-avatar.png" alt="CoinSprite avatar" width="44" height="44">`;

function renderAdminDocument() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b1014">
  <meta name="description" content="Configure CoinSprite across your Discord communities.">
  <title>CoinSprite · Control room</title>
  <link rel="icon" href="/bot-avatar.png" type="image/png">
  <link rel="stylesheet" href="/admin/workspace.css">
  <meta id="emojiDataAsset" data-src="/admin/emojiData.js">
  <script src="/admin/workspace.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#mainContent">Skip to workspace</a>

  <main class="login-shell" id="loginPanel">
    <section class="login-stage">
      <a class="login-brand" href="/admin">${bot('hero-avatar')}<span><strong>CoinSprite</strong><small>CONTROL ROOM</small></span></a>
      <div class="login-copy">
        <span class="signal-label"><i></i> Discord operations, one clear workspace</span>
        <h1>Run the community.<br><em>Keep the magic.</em></h1>
        <p>Configure progression, messages, role menus, and games without exposing a single bot secret.</p>
        <a class="button primary login-button" id="loginButton" href="/auth/discord"><span aria-hidden="true">💬</span> Sign in with Discord</a>
        <p class="login-note" id="loginStatus" role="status">Checking your session…</p>
        <button class="text-button" id="sessionRetry" type="button" hidden>Try again</button>
      </div>
      <div class="login-capability-grid" aria-label="CoinSprite capabilities">
        <article><b>🏅</b><span><strong>Progression</strong><small>XP, milestones, drops</small></span></article>
        <article><b>📝</b><span><strong>Publishing</strong><small>Messages, controls, roles</small></span></article>
        <article><b>🎮</b><span><strong>Community games</strong><small>Counting, careers, economy</small></span></article>
      </div>
    </section>
    <aside class="login-telemetry" aria-label="Product overview">
      <div class="telemetry-orbit">${bot('telemetry-avatar')}<span class="orbit-ring"></span></div>
      <p>One bot identity.<br>Every server-specific choice.</p>
      <div class="telemetry-line"><span>Authentication</span><strong>Discord OAuth</strong></div>
      <div class="telemetry-line"><span>Changes</span><strong>Permission checked</strong></div>
      <div class="telemetry-line"><span>Delivery</span><strong>Live bot actions</strong></div>
    </aside>
  </main>

  ${view('profile')}

  <main class="app-shell" id="appShell" hidden>
    <aside class="command-rail" aria-label="Primary navigation">
      <a class="rail-brand" href="/admin" aria-label="CoinSprite control room">${bot('rail-avatar')}</a>
      <nav class="nav-list" id="dashboardNav" aria-label="Dashboard sections">
        ${navigation.map(([id,key,emoji,title,subtitle]) => `<button class="nav-item${key === 'leveling' ? ' active' : ''}" id="${id}" data-view="${key}" type="button"${key === 'owner' ? ' hidden' : ''}><span class="nav-icon" aria-hidden="true">${emoji}</span><span class="nav-copy"><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('\n')}
      </nav>
      <a class="rail-profile" href="/profile"><span aria-hidden="true">🪪</span><span>My profile</span></a>
    </aside>

    <section class="product-stage" id="mainContent" tabindex="-1">
      <header class="scopebar">
        <div class="scope-server">
          <label for="guildSelect">ACTIVE SERVER</label>
          <select id="guildSelect" disabled><option value="">Loading servers…</option></select>
          <p id="serverMeta">Connecting to Discord</p>
        </div>
        <div class="scope-route">
          <span>CONTROL ROOM</span>
          <strong id="currentSection">Leveling</strong>
        </div>
        <div class="scope-actions">
          <span class="connection-state" id="connectionState" role="status">Connecting…</span>
          <div class="account-wrap" id="accountWrap" hidden>
            <button class="user-chip" id="userChip" type="button" aria-expanded="false" aria-controls="accountMenu"><img id="userAvatar" alt="" width="36" height="36"><span id="sessionLabel"></span><span aria-hidden="true">▾</span></button>
            <nav class="account-menu" id="accountMenu" aria-label="Your account" hidden><a href="/admin">🏠 Server controls</a><a href="/profile">🪪 Profile & inventory</a><button id="logoutButton" type="button" hidden>↪ Sign out</button></nav>
          </div>
        </div>
      </header>

      <div id="sessionRecovery" class="workspace-notice session-recovery" role="alert" hidden>Your session expired. Your draft remains on this page. <a href="/auth/discord?returnTo=%2Fadmin" target="_blank" rel="noopener">Sign in again</a><button id="sessionReconnect" type="button">Reconnect</button></div>

      <button class="mobile-nav-toggle" id="mobileNavToggle" type="button" aria-controls="dashboardNav" aria-expanded="false"><span aria-hidden="true">🧭</span><strong id="mobileNavLabel">Open sections</strong></button>

      <section class="workspace" aria-label="Server workspace">
        <div class="workspace-notice" id="workspaceNotice" role="status" hidden><span id="workspaceNoticeText"></span><button id="workspaceRetry" class="button small" type="button" hidden>Try again</button></div>
        <div id="workspaceViews" inert aria-busy="true">
          ${navigation.map(([,key]) => view(key)).join('\n')}
        </div>
        <footer class="save-dock" id="saveDock" hidden><span id="saveState" role="status" aria-live="polite">Unsaved changes</span><div><button class="button ghost" id="resetButton" type="button">Discard draft</button><button class="button primary" id="saveButton" type="button">Apply to server</button></div></footer>
      </section>
    </section>
  </main>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  ${view('dialogs')}
</body>
</html>`;
}

module.exports = { renderAdminDocument };
