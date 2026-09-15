const { el, action, control, toggle, pageTitle, tabs, composer } = require('../layoutKit');

function panel(name, active, ...children) {
  return el('section', { class: `reaction-role-panel${active ? ' active' : ''}`, 'data-reaction-panel': name, hidden: !active }, children);
}

function editor() {
  return el('div', { id: 'reactionRoleEditor', hidden: true },
    el('header', { class: 'template-detail-head reaction-role-detail-head' },
      el('div', {}, el('span', { id: 'reactionRoleStatus', class: 'eyebrow' }, 'DRAFT'),
        control('Template name', 'reactionRoleName', 'text', '', { maxlength: '80' }),
        el('small', { id: 'reactionRolePublishedState' }, 'Not published')),
      el('div', { class: 'head-actions' },
        toggle('Enabled', 'reactionRoleEnabled'), action('reactionRoleDuplicate', 'Duplicate'), action('reactionRoleDelete', 'Delete', 'danger'))),
    tabs('reaction-role-tabs', 'data-reaction-tab', [
      ['message', '💬', 'Message'], ['role-reaction', '🎭', 'Role controls'], ['channel', '📣', 'Publish'],
    ]),
    panel('message', true,
      el('div', { class: 'section-actions' }, action('reactionRoleUseTemplate', 'Use message template')),
      composer('Reaction roles', {
        panel: 'reactionRoleComposerPanel', frame: 'reactionRoleDiscordFrame',
        accentButton: 'reactionRoleAccentButton', accentColor: 'reactionRoleAccentColor',
        preview: 'reactionRoleMessagePreview', additional: 'reactionRoleAdditionalContainers',
        controls: 'reactionRoleControlPreview',
      }, {
        title: 'Published message', note: 'Edit the message members use to choose roles.',
        tools: [
          ['reactionRoleEmojiToggle', '😀 Emoji'], ['reactionRoleVariablesToggle', '{ } Variables'],
          ['reactionRoleContainerToggle', '▣ Container'], ['reactionRoleAdditionalContainer', '＋ Container'],
          ['reactionRoleThumbnailToggle', '▧ Thumbnail'], ['reactionRoleGalleryToggle', '▦ Gallery'],
        ],
      })),
    panel('role-reaction', false,
      el('h3', {}, 'Choose a control style'),
      el('p', {}, 'Members can select roles with buttons or dropdowns.'),
      el('div', { class: 'rr-mode-switch', role: 'group', 'aria-label': 'Reaction Role control type' },
        el('button', { class: 'active', type: 'button', 'data-reaction-mode': 'button' }, 'Buttons'),
        el('button', { type: 'button', 'data-reaction-mode': 'dropdown' }, 'Dropdowns')),
      el('div', { id: 'reactionRoleControls' }), action('reactionRoleAddControl', '＋ Add control')),
    panel('channel', false,
      control('Destination channel', 'reactionRoleChannel', 'select', 'Choose a channel CoinSprite can post to'),
      el('div', { id: 'reactionRolePermissionStatus', class: 'rr-permission-status', role: 'status' }),
      el('section', { class: 'rr-final-preview' }, el('h3', {}, 'Final Discord preview'), el('div', { id: 'reactionRoleFinalPreview' })),
      el('div', { class: 'rr-publish-actions' },
        action('reactionRoleSaveDraft', 'Save draft'), action('reactionRolePublish', 'Publish / update', 'primary'))));
}

function reactionRoles() {
  return el('section', { class: 'view', id: 'reactionRolesView', 'data-view-panel': 'reaction-roles', hidden: true },
    pageTitle('REACTION ROLES', 'Let members choose.', 'Create a role picker and publish it to one channel.',
      action('reactionRoleCreate', '＋ New picker', 'primary')),
    el('div', { class: 'reaction-role-manager' },
      el('aside', { class: 'reaction-role-library', 'aria-label': 'Reaction Role templates' },
        el('header', {}, el('h2', {}, 'Pickers'), el('small', { id: 'reactionRoleCount' }, '0 saved')),
        el('div', { id: 'reactionRoleList', class: 'reaction-role-list' })),
      el('section', { class: 'reaction-role-workspace' },
        el('div', { class: 'template-empty', id: 'reactionRoleEmpty' },
          el('span', { 'aria-hidden': 'true' }, '🎭'), el('h2', {}, 'No picker selected'),
          el('p', {}, 'Build a message, connect roles, and publish.'),
          action('reactionRoleEmptyCreate', 'Create picker', 'primary')),
        editor())));
}

module.exports = reactionRoles;
