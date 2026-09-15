const { el, action, control, section, pageTitle } = require('../layoutKit');

function games() {
  return el('section', { class: 'view', id: 'gamesView', 'data-view-panel': 'games', hidden: true },
    pageTitle('GAMES', 'A place to play.', 'Route Counting, the daily lottery, and game commands for this server.'),
    el('div', { class: 'games-tabs', role: 'tablist', 'aria-label': 'Games' },
      el('button', { type: 'button', role: 'tab', class: 'active', 'aria-selected': 'true' }, '🧮 Counting')),
    section('Game destinations', 'No Counting channel means Counting is paused for this server.',
      el('div', { class: 'field-grid two' },
        control('Counting channel', 'countingChannel', 'select', 'One text channel where members count together'),
        control('Lottery channel', 'lotteryChannel', 'select', 'Daily draw at 20:00 UTC+7'))),
    section('Command routes', 'Leave the list empty to allow game commands in every channel.',
      el('div', { id: 'gameCommandSettings', class: 'game-command-setting-list' }),
      el('div', { class: 'section-actions' }, action('gameAddCommandSetting', '＋ Add route', 'primary'))));
}

module.exports = games;
