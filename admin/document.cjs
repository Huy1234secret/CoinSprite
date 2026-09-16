const fs = require('node:fs');
const path = require('node:path');
const view = name => fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
const navigation = [
  ['levelingNav', 'leveling', '🏅', 'Leveling', 'XP & rewards'],
  ['welcomeMessagesNav', 'member-messages', '👋', 'Welcome messages', 'Make every arrival count'],
  ['messageTemplatesNav', 'message-templates', '📝', 'Message templates', 'Create once, use anywhere'],
  ['reactionRolesNav', 'reaction-roles', '🎭', 'Reaction roles', 'Let members choose'],
  ['gamesNav', 'games', '🎮', 'Games', 'Play, earn & connect'],
  ['ownerNav', 'owner', '🛠️', 'Owner panel', 'Health & access'],
];
const bot = (className = 'bot-avatar') => `<img class="${className}" src="/bot-avatar.png" alt="CoinSprite avatar" width="40" height="40">`;

function renderAdminDocument() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f5f5f2">
  <meta name="description" content="Your CoinSprite community, thoughtfully managed.">
  <title>CoinSprite · Community workspace</title>
  <link rel="icon" href="/bot-avatar.png" type="image/png">
  <link rel="stylesheet" href="/admin/workspace.css">
  <meta id="emojiDataAsset" data-src="/admin/emojiData.js">
  <script src="/admin/workspace.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#mainContent">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="/admin">${bot()}<span><strong>CoinSprite<span class="brand-dot">.</span></strong><small>COMMUNITY WORKSPACE</small></span></a>
    <div class="topbar-actions">
      <span class="connection-state" id="connectionState" role="status">Connecting…</span>
      <div class="account-wrap" id="accountWrap" hidden>
        <button class="user-chip" id="userChip" type="button" aria-expanded="false" aria-controls="accountMenu"><img id="userAvatar" alt="" width="32" height="32"><span id="sessionLabel"></span><span aria-hidden="true">🔽</span></button>
        <nav class="account-menu" id="accountMenu" aria-label="Your account" hidden><a href="/admin">🏡 Manage servers</a><a href="/profile">🪪 Profile & inventory</a></nav>
      </div>
      <button class="button ghost small" id="logoutButton" type="button" hidden>Sign out</button>
    </div>
  </header>
  <div id="mainContent" tabindex="-1">
    <div id="sessionRecovery" class="workspace-notice" role="alert" hidden>Your session expired. Your edits are still on this page. <a href="/auth/discord?returnTo=%2Fadmin" target="_blank" rel="noopener">Sign in in a new tab</a><button id="sessionReconnect" type="button">Reconnect</button></div>
    <main class="login-shell" id="loginPanel">
      <section class="login-copy">
        <span class="eyebrow">A LITTLE SPRITE. A LOT OF POSSIBILITY.</span>
        <h1>A good home for<br>your community<span>.</span></h1>
        <p>Bring your Discord server to life. Thoughtful rewards, welcoming messages, and a little friendly competition — all in one workspace.</p>
        <a class="button primary login-button" id="loginButton" href="/auth/discord"><span aria-hidden="true">💬</span> Continue with Discord</a>
        <p class="login-note" id="loginStatus" role="status">Checking your session…</p>
        <button class="text-button" id="sessionRetry" type="button" hidden>Try again</button>
        <div class="login-footnote">Your community. Your rules. <span>Powered by CoinSprite.</span></div>
      </section>
      <aside class="login-art" aria-label="CoinSprite features">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="login-bot">${bot('hero-avatar')}<strong>Small moments.<br>Stronger communities.</strong><span>Made for the people behind your server.</span></div>
        <div class="feature-tag tag-one"><span aria-hidden="true">🏅</span> Celebrate progress</div>
        <div class="feature-tag tag-two"><span aria-hidden="true">👋</span> Welcome everyone</div>
        <div class="feature-tag tag-three"><span aria-hidden="true">🎮</span> Keep it playful</div>
      </aside>
    </main>
    ${view('profile')}
    <main class="app-shell" id="appShell" hidden>
      <aside class="sidebar">
        <div class="server-block"><label for="guildSelect">YOUR SERVER</label><select id="guildSelect" disabled><option value="">Loading servers…</option></select><p id="serverMeta">Connecting to Discord</p></div>
        <button class="mobile-nav-toggle" id="mobileNavToggle" type="button" aria-controls="dashboardNav" aria-expanded="false"><span>🧭 Workspace navigation</span><span>Menu</span></button>
        <nav class="nav-list" id="dashboardNav" aria-label="Dashboard">
          <span class="nav-label">COMMUNITY</span>
          ${navigation.map(([id,key,emoji,title,subtitle]) => `<button class="nav-item${key === 'leveling' ? ' active' : ''}" id="${id}" data-view="${key}" type="button"${key === 'owner' ? ' hidden' : ''}><span class="nav-icon" aria-hidden="true">${emoji}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('\n')}
          <a class="nav-item profile-link" href="/profile"><span class="nav-icon" aria-hidden="true">🪪</span><span><strong>My profile</strong><small>Level card & inventory</small></span></a>
        </nav>
        <div class="sidebar-note">${bot()}<div><strong>A happier server starts here.</strong><p>Make it feel like yours.</p></div></div>
      </aside>
      <section class="workspace" aria-label="Server workspace">
        <div class="workspace-context"><span>WORKSPACE <span aria-hidden="true">/</span> <strong id="currentSection">Leveling</strong></span><span class="context-note">Made for your community</span></div>
        <div class="workspace-notice" id="workspaceNotice" role="status" hidden><span id="workspaceNoticeText"></span><button id="workspaceRetry" class="button small" type="button" hidden>Try again</button></div>
        <div id="workspaceViews" inert aria-busy="true">
          ${navigation.map(([,key]) => view(key)).join('\n')}
        </div>
        <footer class="workspace-footer"><span>CoinSprite <span aria-hidden="true">✦</span> Community, with character.</span><a href="/profile">Your profile</a></footer>
        <footer class="save-dock" id="saveDock" hidden><span id="saveState" role="status" aria-live="polite">Unsaved changes</span><div><button class="button ghost" id="resetButton" type="button">Reset</button><button class="button primary" id="saveButton" type="button">Apply changes</button></div></footer>
      </section>
    </main>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  ${view('dialogs')}
</body>
</html>`;
}
module.exports = { renderAdminDocument };
