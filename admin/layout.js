// Browser document assembled from a DOM description. Dashboard controls are
// retained as data so their existing behavior stays intact without an HTML file.
const tree = require('./dashboardTree.json');

const node = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat() });
const render = (entry) => {
  if (typeof entry === 'string') return entry;
  const attributes = Object.entries(entry.attrs || {}).map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${value}"`).join('');
  const opening = `<${entry.tag}${attributes}>`;
  if (new Set(['input', 'meta', 'link', 'img', 'br', 'hr', 'source']).has(entry.tag)) return opening;
  return `${opening}${(entry.children || []).map(render).join('')}</${entry.tag}>`;
};

const brand = node('a', { class: 'brand', href: '/admin', 'aria-label': 'CoinSprite home' },
  node('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '🪙'),
  node('span', {}, node('strong', {}, 'CoinSprite'), node('small', {}, 'Control panel')));

const header = node('header', { class: 'topbar' },
  brand,
  node('div', { class: 'topbar-actions' },
    node('span', { class: 'live-pill' }, node('i'), ' Discord tools'),
    node('div', { class: 'account-wrap', id: 'accountWrap', hidden: true },
      node('button', { class: 'user-chip', id: 'userChip', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
        node('img', { id: 'userAvatar', alt: '' }), node('span', { id: 'sessionLabel' }), node('i', { 'aria-hidden': 'true' }, '&#8964;')),
      node('div', { class: 'account-menu', id: 'accountMenu', role: 'menu', hidden: true },
        node('a', { href: '/admin', role: 'menuitem' }, node('b', {}, 'Manage server'), node('small', {}, 'Community settings')),
        node('a', { href: '/profile', role: 'menuitem' }, node('b', {}, 'Profile'), node('small', {}, 'Level card and inventory')))),
    node('button', { class: 'button ghost small', id: 'logoutButton', type: 'button', hidden: true }, 'Sign out')));

const landing = node('main', { class: 'login-shell', id: 'loginPanel' },
  node('section', { class: 'login-copy' },
    node('span', { class: 'eyebrow' }, 'COINSPRITE / DISCORD'),
    node('h1', {}, 'One place for your server.'),
    node('p', {}, 'Manage leveling, messages, roles, and games without the clutter.'),
    node('div', { class: 'login-actions' },
      node('a', { class: 'button primary login-button', id: 'loginButton', href: '/auth/discord' }, 'Continue with Discord ', node('span', { 'aria-hidden': 'true' }, '&#8599;'))),
    node('p', { class: 'login-note', id: 'loginStatus', role: 'status' }, 'Checking your session…')));

const navigation = [
  ['levelingNav', 'leveling', '🏅', 'Leveling', 'Locked by owner'],
  ['welcomeMessagesNav', 'member-messages', '👋', 'Welcome messages', 'Join, leave and boost'],
  ['messageTemplatesNav', 'message-templates', '📝', 'Message templates', 'Compose and reuse'],
  ['reactionRolesNav', 'reaction-roles', '🎭', 'Reaction roles', 'Member-selected roles'],
  ['gamesNav', 'games', '🎮', 'Games', 'Counting and lottery'],
  ['ownerNav', 'owner', '🛠️', 'Owner panel', 'Fleet and console'],
];

const sidebar = node('aside', { class: 'sidebar' },
  node('div', { class: 'server-block' },
    node('label', { for: 'guildSelect' }, 'CURRENT SERVER'),
    node('div', { class: 'select-wrap' }, node('select', { id: 'guildSelect', disabled: true }, node('option', { value: '' }, 'No editable servers'))),
    node('p', { id: 'serverMeta' }, 'Choose a Discord server')),
  node('button', { class: 'mobile-nav-toggle', id: 'mobileNavToggle', type: 'button', 'aria-controls': 'dashboardNav', 'aria-expanded': 'false' }, node('span', {}, 'Workspace'), node('b', {}, 'Menu')),
  node('nav', { class: 'nav-list', id: 'dashboardNav', 'aria-label': 'Dashboard' },
    navigation.map(([id, view, emoji, label, description], index) => node('button', {
      class: `nav-item${index === 0 ? ' active' : ''}`, id, type: 'button', 'data-view': view,
      ...(view === 'owner' ? { hidden: true } : {}),
    }, node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, emoji), node('span', {}, node('strong', {}, label), node('small', {}, description))))));

const emojiTabs = {
  profileCardTab: '🪪', profileInventoryTab: '🎒',
};
const dataTabs = {
  'data-member-event': { join: '👋', leave: '🚪', boost: '✨' },
  'data-template-tab': { editor: '✏️', controls: '🎛️', json: '📋', settings: '⚙️', share: '🔗' },
  'data-reaction-tab': { message: '💬', 'role-reaction': '🎭', channel: '📣' },
  'data-emoji-section': { bot: '🤖', group: '👥', default: '😀' },
};
function addTabIcons(entry) {
  if (typeof entry === 'string') return;
  const emoji = emojiTabs[entry.attrs?.id] || (entry.tag === 'button' && entry.children?.includes('Counting') ? '🧮' : '') || Object.entries(dataTabs).map(([key, values]) => values[entry.attrs?.[key]]).find(Boolean);
  if (emoji && entry.tag === 'button') entry.children.unshift(node('span', { class: 'tab-emoji', 'aria-hidden': 'true' }, emoji));
  for (const child of entry.children || []) addTabIcons(child);
}
addTabIcons(tree.profile);
for (const view of tree.views) addTabIcons(view);
for (const dialog of tree.dialogs) addTabIcons(dialog);

const workspace = node('section', { class: 'workspace' },
  node('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite', hidden: true }),
  tree.views,
  node('footer', { class: 'save-dock', id: 'saveDock', role: 'status', 'aria-live': 'polite', hidden: true },
    node('span', { id: 'saveState' }, 'Unsaved changes'),
    node('div', {}, node('button', { class: 'button ghost', id: 'resetButton', type: 'button' }, 'Reset'), node('button', { class: 'button primary', id: 'saveButton', type: 'button' }, 'Apply changes'))));

const dashboard = node('main', { class: 'app-shell', id: 'appShell', hidden: true }, sidebar, workspace);
const head = node('head', {},
  node('meta', { charset: 'utf-8' }),
  node('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
  node('meta', { name: 'theme-color', content: '#171717' }),
  node('meta', { name: 'description', content: 'A focused control panel for your Discord community.' }),
  node('title', {}, 'CoinSprite · Control panel'),
  node('link', { rel: 'icon', type: 'image/png', href: '/admin/brand-icon.png' }),
  node('link', { rel: 'stylesheet', href: '/admin/style.css' }),
  node('link', { rel: 'stylesheet', href: '/admin/dashboard.css' }),
  node('meta', { id: 'emojiDataAsset', 'data-src': '/admin/emojiData.js' }),
  node('script', { src: '/admin/app.js', defer: true }),
  node('script', { src: '/admin/inventory.js', defer: true }));

function renderAdminDocument() {
  return `<!doctype html>${render(node('html', { lang: 'en' }, head, node('body', {}, header, landing, tree.profile, dashboard, tree.dialogs)))}`;
}

module.exports = { renderAdminDocument };
