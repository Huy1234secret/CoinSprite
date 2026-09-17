// Browser document assembled from a DOM description. Dashboard controls are
// retained as data so their existing behavior stays intact without an HTML file.
const tree = require('./dashboardTree.json');

const node = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat() });
const iconPaths = {
  coin: ['M12 3.5c4.7 0 8.5 1.8 8.5 4S16.7 12 12 12 3.5 10.2 3.5 8 7.3 3.5 12 3.5Z', 'M3.5 8v4c0 2.2 3.8 4 8.5 4s8.5-1.8 8.5-4V8', 'M3.5 12v4c0 2.2 3.8 4 8.5 4s8.5-1.8 8.5-4v-4'],
  overview: ['M4 4h6v6H4z', 'M14 4h6v10h-6z', 'M4 14h6v6H4z', 'M14 18h6v2h-6z'],
  leveling: ['M8 4h8v5a4 4 0 0 1-8 0V4Z', 'M12 13v4', 'M8 20h8', 'M16 6h3v2a3 3 0 0 1-3 3', 'M8 6H5v2a3 3 0 0 0 3 3'],
  welcome: ['M15 19a6 6 0 0 0-12 0', 'M9 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M16 8h5', 'M18.5 5.5v5'],
  templates: ['M6 3h9l3 3v15H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  roles: ['M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 20a6 6 0 0 1 12 0', 'M17 8v8', 'M13 12h8'],
  games: ['M8 8h8a5 5 0 0 1 4.7 6.7l-1 3a2.4 2.4 0 0 1-4 1l-1.8-2.2h-3.8l-1.8 2.2a2.4 2.4 0 0 1-4-1l-1-3A5 5 0 0 1 8 8Z', 'M7 12v4', 'M5 14h4', 'M16 12h.01', 'M18 15h.01'],
  owner: ['M12 3 4 7v5c0 5 3.4 8.1 8 9 4.6-.9 8-4 8-9V7l-8-4Z', 'M9 12l2 2 4-4'],
  arrow: ['M5 12h14', 'm14 7 5 5-5 5'],
  hash: ['M10 3 8 21', 'M16 3l-2 18', 'M4 9h16', 'M3 15h16'],
  bolt: ['m13 2-9 12h7l-1 8 9-12h-7l1-8Z'],
  members: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
};
const icon = (name, className = 'icon') => node('svg', {
  class: className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
}, (iconPaths[name] || iconPaths.overview).map((d) => node('path', { d })));
const render = (entry) => {
  if (typeof entry === 'string') return entry;
  const attributes = Object.entries(entry.attrs || {}).map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${value}"`).join('');
  const opening = `<${entry.tag}${attributes}>`;
  if (new Set(['input', 'meta', 'link', 'img', 'br', 'hr', 'source']).has(entry.tag)) return opening;
  return `${opening}${(entry.children || []).map(render).join('')}</${entry.tag}>`;
};

const brand = node('a', { class: 'brand', href: '/admin', 'aria-label': 'CoinSprite home' },
  node('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('coin')),
  node('span', {}, node('strong', {}, 'CoinSprite'), node('small', {}, 'Discord control center')));

const header = node('header', { class: 'topbar' },
  brand,
  node('div', { class: 'topbar-context', 'aria-hidden': 'true' }, icon('hash'), node('span', {}, 'control-center')),
  node('div', { class: 'topbar-actions' },
    node('span', { class: 'live-pill' }, node('i'), ' Discord bot online'),
    node('div', { class: 'account-wrap', id: 'accountWrap', hidden: true },
      node('button', { class: 'user-chip', id: 'userChip', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
        node('img', { id: 'userAvatar', alt: '' }), node('span', { id: 'sessionLabel' }), node('i', { 'aria-hidden': 'true' }, '&#8964;')),
      node('div', { class: 'account-menu', id: 'accountMenu', role: 'menu', hidden: true },
        node('a', { href: '/admin', role: 'menuitem' }, node('b', {}, 'Manage server'), node('small', {}, 'Community settings')),
        node('a', { href: '/profile', role: 'menuitem' }, node('b', {}, 'Profile'), node('small', {}, 'Level card and inventory')))),
    node('button', { class: 'button ghost small', id: 'logoutButton', type: 'button', hidden: true }, 'Sign out')));

const landing = node('main', { class: 'login-shell', id: 'loginPanel' },
  node('section', { class: 'login-copy' },
    node('span', { class: 'eyebrow' }, 'YOUR DISCORD, UNDER CONTROL'),
    node('h1', {}, 'One dashboard. ', node('em', {}, 'Every community move.')),
    node('p', {}, 'Configure leveling, member journeys, reusable messages, reaction roles, and games from a control center that feels instantly familiar.'),
    node('div', { class: 'login-actions' },
      node('a', { class: 'button primary login-button', id: 'loginButton', href: '/auth/discord' }, 'Continue with Discord ', icon('arrow', 'button-icon'))),
    node('p', { class: 'login-note', id: 'loginStatus', role: 'status' }, 'Checking your Discord session…'),
    node('ul', { class: 'trust-list', 'aria-label': 'Dashboard highlights' },
      node('li', {}, 'Secure Discord sign-in'), node('li', {}, 'Live message previews'), node('li', {}, 'You control every change'))),
  node('aside', { class: 'login-preview', 'aria-label': 'CoinSprite dashboard preview' },
    node('div', { class: 'preview-kicker' }, node('span', {}, icon('hash'), ' control-center'), node('b', {}, node('i'), ' ONLINE')),
    node('div', { class: 'preview-body' },
      node('div', { class: 'preview-rail', 'aria-hidden': 'true' }, icon('overview'), icon('leveling'), icon('welcome'), icon('roles'), icon('games')),
      node('div', { class: 'preview-channels', 'aria-hidden': 'true' },
        node('strong', {}, 'COINSPRITE HQ'),
        node('small', {}, 'SERVER DASHBOARD'),
        node('span', { class: 'active' }, icon('hash'), ' overview'),
        node('span', {}, icon('bolt'), ' leveling'),
        node('span', {}, icon('members'), ' member-journeys'),
        node('span', {}, icon('templates'), ' message-studio'),
        node('span', {}, icon('games'), ' community-games')),
      node('div', { class: 'preview-content' },
        node('span', { class: 'preview-label' }, 'GOOD AFTERNOON, ADMIN'),
        node('h2', {}, 'Your community is online and ready.'),
        node('div', { class: 'preview-stat-grid' },
          node('span', {}, node('small', {}, 'SYSTEMS LIVE'), node('strong', {}, '06'), node('em', {}, 'all healthy')),
          node('span', {}, node('small', {}, 'MESSAGES'), node('strong', {}, '12'), node('em', {}, 'ready to send')),
          node('span', {}, node('small', {}, 'SETUP'), node('strong', {}, '92%'), node('em', {}, 'almost there'))),
        node('div', { class: 'preview-activity' },
          node('span', {}, icon('leveling'), node('i', {}, node('b', {}, 'Leveling engine'), node('small', {}, 'XP is flowing across 8 channels')), node('em', {}, 'ACTIVE')),
          node('span', {}, icon('welcome'), node('i', {}, node('b', {}, 'Welcome journey'), node('small', {}, 'New members land in #general')), node('em', {}, 'READY')),
          node('span', {}, icon('games'), node('i', {}, node('b', {}, 'Community games'), node('small', {}, 'Counting and lottery configured')), node('em', {}, '2 LIVE')))))));

const navigation = [
  ['overviewNav', 'overview', 'overview', 'Overview', 'Server pulse', 'server'],
  ['levelingNav', 'leveling', 'leveling', 'Leveling', 'XP and rewards', 'community'],
  ['welcomeMessagesNav', 'member-messages', 'welcome', 'Member journeys', 'Join, leave and boost', 'community'],
  ['messageTemplatesNav', 'message-templates', 'templates', 'Message studio', 'Compose and reuse', 'automation'],
  ['reactionRolesNav', 'reaction-roles', 'roles', 'Reaction roles', 'Member choices', 'automation'],
  ['gamesNav', 'games', 'games', 'Community games', 'Counting and lottery', 'automation'],
  ['ownerNav', 'owner', 'owner', 'Owner console', 'Fleet and operations', 'operations'],
];

const navItem = ([id, view, iconName, label, description]) => node('button', {
  class: `nav-item${id === 'overviewNav' ? ' active' : ''}`, id, type: 'button', 'data-view': view,
  ...(view === 'owner' ? { hidden: true } : {}),
}, node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon(iconName)), node('span', {}, node('strong', {}, label), node('small', {}, description)));

const serverRail = node('aside', { class: 'server-rail', 'aria-label': 'CoinSprite workspace' },
  node('a', { class: 'rail-home', href: '/admin', 'aria-label': 'CoinSprite home' }, icon('coin')),
  node('span', { class: 'rail-divider', 'aria-hidden': 'true' }),
  node('span', { class: 'rail-server active', 'aria-hidden': 'true' }, 'CS'),
  node('span', { class: 'rail-server muted', 'aria-hidden': 'true' }, icon('members')),
  node('span', { class: 'rail-spacer', 'aria-hidden': 'true' }),
  node('span', { class: 'rail-status', 'aria-hidden': 'true' }, node('i'), 'LIVE'));

const sidebar = node('aside', { class: 'sidebar' },
  node('div', { class: 'sidebar-title' },
    node('span', { class: 'server-avatar', 'aria-hidden': 'true' }, 'CS'),
    node('span', {}, node('strong', {}, 'Server control'), node('small', {}, 'CoinSprite workspace'))),
  node('div', { class: 'server-block' },
    node('label', { for: 'guildSelect' }, 'ACTIVE DISCORD SERVER'),
    node('div', { class: 'select-wrap' }, node('select', { id: 'guildSelect', disabled: true }, node('option', { value: '' }, 'No editable servers'))),
    node('p', { id: 'serverMeta' }, 'Choose a Discord server')),
  node('button', { class: 'mobile-nav-toggle', id: 'mobileNavToggle', type: 'button', 'aria-controls': 'dashboardNav', 'aria-expanded': 'false' }, node('span', {}, 'Dashboard menu'), node('b', {}, 'Open')),
  node('nav', { class: 'nav-list', id: 'dashboardNav', 'aria-label': 'Dashboard' },
    node('div', { class: 'nav-group' }, node('span', { class: 'nav-group-label' }, 'SERVER'), navigation.filter((entry) => entry[5] === 'server').map(navItem)),
    node('div', { class: 'nav-group' }, node('span', { class: 'nav-group-label' }, 'COMMUNITY'), navigation.filter((entry) => entry[5] === 'community').map(navItem)),
    node('div', { class: 'nav-group' }, node('span', { class: 'nav-group-label' }, 'AUTOMATION'), navigation.filter((entry) => entry[5] === 'automation').map(navItem)),
    node('div', { class: 'nav-group' }, node('span', { class: 'nav-group-label' }, 'OPERATIONS'), navigation.filter((entry) => entry[5] === 'operations').map(navItem))),
  node('div', { class: 'sidebar-footer' },
    node('span', { 'aria-hidden': 'true' }, icon('bolt')),
    node('span', {}, node('strong', {}, 'Bot connected'), node('small', {}, 'All systems operational')),
    node('i', { 'aria-hidden': 'true' })));

const overview = node('section', { class: 'view active overview-view', id: 'overviewView', 'data-view-panel': 'overview' },
  node('header', { class: 'workspace-head overview-head' },
    node('div', {}, node('span', { class: 'eyebrow' }, 'SERVER OVERVIEW'), node('h1', { id: 'overviewTitle' }, 'Your community command center.'), node('p', { id: 'overviewSubtitle' }, 'Choose a server to see what is live, what needs attention, and where to go next.')),
    node('span', { class: 'overview-health', id: 'overviewHealth' }, node('i'), node('span', {}, node('strong', {}, 'Loading workspace'), node('small', {}, 'Checking configuration')))),
  node('section', { class: 'overview-metrics', id: 'overviewMetrics', 'aria-label': 'Server summary' }),
  node('div', { class: 'overview-grid' },
    node('section', { class: 'overview-panel' },
      node('header', {}, node('div', {}, node('span', { class: 'panel-kicker' }, 'FEATURES'), node('h2', {}, 'Community systems')), node('p', {}, 'Open a system to configure it.')),
      node('div', { class: 'feature-overview-list', id: 'overviewFeatures' })),
    node('aside', { class: 'overview-side' },
      node('section', { class: 'overview-panel readiness-panel' },
        node('span', { class: 'panel-kicker' }, 'SETUP READINESS'),
        node('div', { class: 'readiness-score' }, node('strong', { id: 'overviewReadinessValue' }, '0%'), node('span', {}, node('b', {}, 'Workspace configured'), node('small', { id: 'overviewReadinessCopy' }, 'Reviewing your settings'))),
        node('div', { class: 'readiness-track', 'aria-hidden': 'true' }, node('i', { id: 'overviewReadinessBar' })),
        node('ul', { class: 'readiness-list', id: 'overviewReadinessList' })),
      node('section', { class: 'overview-panel quick-panel' },
        node('span', { class: 'panel-kicker' }, 'QUICK ACTIONS'),
        node('button', { type: 'button', 'data-overview-view': 'message-templates' }, icon('templates'), node('span', {}, node('b', {}, 'Compose a message'), node('small', {}, 'Create a reusable template')), icon('arrow')),
        node('button', { type: 'button', 'data-overview-view': 'reaction-roles' }, icon('roles'), node('span', {}, node('b', {}, 'Build reaction roles'), node('small', {}, 'Let members choose roles')), icon('arrow')),
        node('button', { type: 'button', 'data-overview-view': 'games' }, icon('games'), node('span', {}, node('b', {}, 'Tune community games'), node('small', {}, 'Configure channels and commands')), icon('arrow'))))));

const workspace = node('section', { class: 'workspace' },
  node('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite', hidden: true }),
  overview,
  tree.views,
  node('footer', { class: 'save-dock', id: 'saveDock', role: 'status', 'aria-live': 'polite', hidden: true },
    node('span', { id: 'saveState' }, 'Unsaved changes'),
    node('div', {}, node('button', { class: 'button ghost', id: 'resetButton', type: 'button' }, 'Reset'), node('button', { class: 'button primary', id: 'saveButton', type: 'button' }, 'Apply changes'))));

const dashboard = node('main', { class: 'app-shell', id: 'appShell', hidden: true }, serverRail, sidebar, workspace);
const head = node('head', {},
  node('meta', { charset: 'utf-8' }),
  node('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
  node('meta', { name: 'theme-color', content: '#0b0c0f' }),
  node('meta', { name: 'description', content: 'CoinSprite control center for Discord community settings.' }),
  node('title', {}, 'CoinSprite · Discord Control Center'),
  node('link', { rel: 'icon', type: 'image/png', href: '/admin/brand-icon.png' }),
  node('link', { rel: 'stylesheet', href: '/admin/style.css' }),
  node('link', { rel: 'stylesheet', href: '/admin/dashboard.css' }),
  node('meta', { id: 'emojiDataAsset', 'data-src': '/admin/emojiData.js' }),
  node('script', { src: '/admin/app.js', defer: true }),
  node('script', { src: '/admin/inventory.js', defer: true }));

function renderAdminDocument() {
  return `<!doctype html>${render(node('html', { lang: 'en' }, head, node('body', {},
    node('a', { class: 'skip-link', href: '#mainContent' }, 'Skip to content'),
    header,
    node('div', { id: 'mainContent', tabindex: '-1' }, landing, tree.profile, dashboard),
    tree.dialogs)))}`;
}

module.exports = { renderAdminDocument };


