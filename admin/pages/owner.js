const { el, action, pageTitle } = require('../layoutKit');

function owner() {
  return el('section', { class: 'view', id: 'ownerView', 'data-view-panel': 'owner', hidden: true },
    pageTitle('OWNER PANEL', 'See the whole fleet.', 'Inspect server access, health, and the live bot output.',
      action('ownerRefresh', '↻ Refresh')),
    el('div', { id: 'ownerOverview', class: 'owner-overview' }),
    el('section', { class: 'console-panel' },
      el('header', { class: 'console-head' },
        el('div', {}, el('span', { class: 'console-light', 'aria-hidden': 'true' }), el('strong', {}, 'Live console')),
        el('div', {}, action('consoleClear', 'Clear'), action('consoleToggle', 'Pause'))),
      el('div', { id: 'consoleOutput', class: 'console-output', tabindex: '0' },
        el('p', { class: 'console-empty' }, 'Waiting for bot activity…'))));
}

module.exports = owner;
