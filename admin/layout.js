const { el, render, action } = require('./layoutKit');
const profile = require('./pages/profile');
const leveling = require('./pages/leveling');
const games = require('./pages/games');
const memberMessages = require('./pages/memberMessages');
const templates = require('./pages/templates');
const reactionRoles = require('./pages/reactionRoles');
const owner = require('./pages/owner');
const dialogs = require('./pages/dialogs');

const destinations = [
  ['levelingNav', 'leveling', '🏅', 'Leveling', 'XP and rewards'],
  ['welcomeMessagesNav', 'member-messages', '👋', 'Welcome', 'Member events'],
  ['messageTemplatesNav', 'message-templates', '📝', 'Templates', 'Reusable messages'],
  ['reactionRolesNav', 'reaction-roles', '🎭', 'Roles', 'Member choice'],
  ['gamesNav', 'games', '🎮', 'Games', 'Counting and lottery'],
  ['ownerNav', 'owner', '🛠️', 'Owner', 'Fleet tools'],
];

function topbar() {
  return el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '/admin', 'aria-label': 'CoinSprite home' },
      el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '🪙'),
      el('span', {}, el('strong', {}, 'CoinSprite'), el('small', {}, 'COMMUNITY STUDIO'))),
    el('div', { class: 'topbar-actions' },
      el('span', { class: 'live-pill' }, 'DISCORD / CONTROL'),
      el('div', { class: 'account-wrap', id: 'accountWrap', hidden: true },
        el('button', { class: 'user-chip', id: 'userChip', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
          el('img', { id: 'userAvatar', alt: '' }), el('span', { id: 'sessionLabel' }), el('span', { 'aria-hidden': 'true' }, '⌄')),
        el('div', { class: 'account-menu', id: 'accountMenu', role: 'menu', hidden: true },
          el('a', { href: '/admin', role: 'menuitem' }, '⚙️ Manage server'),
          el('a', { href: '/profile', role: 'menuitem' }, '🪪 My profile'))),
      action('logoutButton', 'Sign out', 'quiet', { hidden: true })));
}

function landing() {
  return el('main', { class: 'login-shell', id: 'loginPanel' },
    el('div', { class: 'login-accent', 'aria-hidden': 'true' }, '🪙'),
    el('section', { class: 'login-copy' },
      el('span', { class: 'eyebrow' }, 'COINSPRITE / COMMUNITY STUDIO'),
      el('h1', {}, 'Your server, in focus.'),
      el('p', {}, 'Set up the parts that make your community feel alive.'),
      el('a', { class: 'action primary login-button', id: 'loginButton', href: '/auth/discord' }, 'Continue with Discord ↗'),
      el('p', { class: 'login-note', id: 'loginStatus', role: 'status' }, 'Checking your session…')));
}

function serverStrip() {
  return el('div', { class: 'dashboard-strip' },
    el('div', { class: 'server-block' },
      el('label', { for: 'guildSelect' }, 'SERVER'),
      el('select', { id: 'guildSelect', disabled: true }, el('option', { value: '' }, 'No editable servers')),
      el('small', { id: 'serverMeta' }, 'Choose a Discord server')),
    el('button', { class: 'mobile-nav-toggle', id: 'mobileNavToggle', type: 'button', 'aria-controls': 'dashboardNav', 'aria-expanded': 'false' }, '☰ Sections'),
    el('nav', { class: 'nav-list', id: 'dashboardNav', 'aria-label': 'Dashboard sections' },
      destinations.map(([id, view, icon, label, note], index) => el('button', {
        class: `nav-item${index === 0 ? ' active' : ''}`, id, type: 'button', 'data-view': view,
        hidden: view === 'owner',
      }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon),
      el('span', {}, el('strong', {}, label), el('small', {}, note))))));
}

function app() {
  return el('main', { class: 'app-shell', id: 'appShell', hidden: true },
    serverStrip(),
    el('section', { class: 'workspace' },
      el('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite', hidden: true }),
      leveling(), memberMessages(), templates(), reactionRoles(), games(), owner(),
      el('footer', { class: 'save-dock', id: 'saveDock', role: 'status', 'aria-live': 'polite', hidden: true },
        el('span', { id: 'saveState' }, 'Unsaved changes'),
        el('div', {}, action('resetButton', 'Reset'), action('saveButton', 'Apply changes', 'primary')))));
}

function documentHead() {
  return el('head', {},
    el('meta', { charset: 'utf-8' }),
    el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    el('meta', { name: 'theme-color', content: '#e9e7e1' }),
    el('meta', { name: 'description', content: 'CoinSprite community studio for Discord servers.' }),
    el('title', {}, 'CoinSprite · Community studio'),
    el('link', { rel: 'icon', type: 'image/png', href: '/admin/brand-icon.png' }),
    el('link', { rel: 'stylesheet', href: '/admin/ui.css' }),
    el('meta', { id: 'emojiDataAsset', 'data-src': '/admin/emojiData.js' }),
    el('script', { src: '/admin/app.js', defer: true }),
    el('script', { src: '/admin/inventory.js', defer: true }));
}

function renderAdminDocument() {
  return `<!doctype html>${render(el('html', { lang: 'en' },
    documentHead(), el('body', {}, topbar(), landing(), profile(), app(), dialogs())))}`;
}

module.exports = { renderAdminDocument };
