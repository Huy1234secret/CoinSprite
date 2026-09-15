const { el, action, control, toggle, section, pageTitle, tabs, composer } = require('../layoutKit');

function memberMessages() {
  return el('section', { class: 'view', id: 'welcomeMessagesView', 'data-view-panel': 'member-messages', hidden: true },
    pageTitle('WELCOME MESSAGES', 'Every arrival has a voice.', 'Prepare separate messages for joins, departures, and boosts.',
      toggle('Messages on', 'welcomeMessagesEnabled', 'Master switch for these events')),
    tabs('member-message-tabs', 'data-member-event', [
      ['join', '👋', 'Join'], ['leave', '🚪', 'Leave'], ['boost', '✨', 'Boost'],
    ]),
    section('Event message', 'Tune the selected event without affecting the others.',
      el('div', { class: 'event-heading' },
        el('span', { id: 'welcomeEventStep', class: 'eyebrow' }, '01 / JOIN'),
        el('h2', { id: 'welcomeEventTitle' }, 'Join message'),
        action('welcomeEventReset', 'Reset to default')),
      el('p', { id: 'welcomeEventDescription' }, 'Sent when a new member joins.'),
      el('div', { class: 'field-grid two' },
        el('label', { class: 'toggle' },
          el('span', {}, el('strong', {}, 'Send this message'), el('small', { id: 'welcomeEventToggleCopy' }, 'When a member joins')),
          el('input', { id: 'welcomeEventEnabled', type: 'checkbox' })),
        control('Destination channel', 'welcomeEventChannel', 'select', 'Only channels where CoinSprite can post')),
      composer('Welcome messages', {
        panel: 'welcomeComposerPanel', frame: 'welcomeDiscordFrame', accentButton: 'welcomeAccentButton',
        accentColor: 'welcomeAccentColor', preview: 'welcomeMessagePreview', additional: 'welcomeAdditionalContainers',
      }, {
        title: 'Event preview', note: 'Click the message to edit its content.', previewLabelId: 'welcomePreviewLabel',
        actions: [action('welcomeUseTemplate', 'Use template'), action('welcomeSaveAsTemplate', 'Save as template')],
        tools: [
          ['welcomeEmojiToggle', '😀 Emoji'], ['welcomeVariablesToggle', '{ } Variables'],
          ['welcomeContainerAdd', '▣ Container'], ['welcomeAdditionalContainerAdd', '＋ Container'],
          ['welcomeThumbnailAdd', '▧ Thumbnail'], ['welcomeGalleryAdd', '▦ Gallery'],
        ],
      })));
}

module.exports = memberMessages;
