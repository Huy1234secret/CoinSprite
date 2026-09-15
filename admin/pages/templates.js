const { el, action, control, toggle, pageTitle, tabs, composer } = require('../layoutKit');

function panel(name, active, ...children) {
  return el('section', { class: `template-tab-panel${active ? ' active' : ''}`, 'data-template-panel': name, hidden: !active }, children);
}

function editor() {
  return el('div', { id: 'templateEditor', hidden: true },
    el('header', { class: 'template-detail-head' },
      el('div', {}, el('span', { id: 'templateStatusBadge', class: 'eyebrow' }, 'SAVED'),
        el('h2', { id: 'templateEditorTitle' }, 'Untitled template'), el('p', { id: 'templateTimestamps' })),
      el('div', { class: 'head-actions' }, action('templateDuplicateButton', 'Duplicate'), action('templateDeleteButton', 'Delete', 'danger'))),
    tabs('template-tabs', 'data-template-tab', [
      ['editor', '✏️', 'Message'], ['controls', '🎛️', 'Controls'], ['json', '📋', 'JSON'],
      ['settings', '⚙️', 'Settings'], ['share', '🔗', 'Share'],
    ]),
    panel('editor', true,
      el('div', { class: 'composer-count', id: 'templateCharacterCount' }, '0 / 4000'),
      composer('Message template', {
        panel: 'templateComposerPanel', frame: 'templateDiscordFrame', accentButton: 'templateAccentButton',
        accentColor: 'templateAccentColor', preview: 'templateMessagePreview',
        additional: 'templateAdditionalContainers', controls: 'templateControlPreview',
      }, {
        title: 'Message canvas', note: 'Edit the rendered message and insert variables at your cursor.',
        tools: [
          ['templateEmojiToggle', '😀 Emoji'], ['templateVariablesToggle', '{ } Variables'],
          ['templateContainerAdd', '▣ Container'], ['templateAdditionalContainerAdd', '＋ Container'],
          ['templateThumbnailAdd', '▧ Thumbnail'], ['templateGalleryAdd', '▦ Gallery'],
        ],
      })),
    panel('controls', false,
      el('h3', {}, 'Interactions'),
      el('p', {}, 'Attach buttons or dropdowns to the message.'),
      el('div', { class: 'rr-mode-switch', role: 'group', 'aria-label': 'Control type' },
        el('button', { class: 'active', type: 'button', 'data-template-control-mode': 'none' }, 'None'),
        el('button', { type: 'button', 'data-template-control-mode': 'button' }, 'Buttons'),
        el('button', { type: 'button', 'data-template-control-mode': 'dropdown' }, 'Dropdowns')),
      el('div', { id: 'templateControls' }), action('templateAddControl', '＋ Add control')),
    panel('json', false,
      el('div', { class: 'section-heading' }, el('h3', {}, 'Template JSON'),
        el('div', { class: 'head-actions' },
          action('templateJsonFormat', 'Format'), action('templateJsonCopy', 'Copy'), action('templateJsonImport', 'Import / replace', 'primary'))),
      el('textarea', { id: 'templateJsonEditor', rows: '18', spellcheck: 'false', 'aria-describedby': 'templateJsonError' }),
      el('p', { id: 'templateJsonError', role: 'alert', hidden: true }),
      el('details', { class: 'resolved-payload' }, el('summary', {}, 'Resolved Discord payload'), el('pre', { id: 'templateResolvedPayload' }))),
    panel('settings', false,
      el('div', { class: 'field-grid two' },
        control('Name', 'templateName', 'text', 'Visible in this library', { maxlength: '80', required: true }),
        control('Folder', 'templateFolderSelect', 'select', 'Unfiled is always available'),
        control('Description', 'templateDescription', 'textarea', 'Optional note for administrators', { maxlength: '500', rows: '3' }),
        control('Default channel', 'templateChannel', 'select', 'Where this template is normally sent'),
        toggle('Template available', 'templateEnabled', 'Disabled templates cannot be sent normally')),
      el('section', { class: 'template-variable-reference' }, el('h3', {}, 'Variables'), el('div', { id: 'templateVariableReference' })),
      el('section', { class: 'template-send-panel' },
        el('div', {}, el('h3', {}, 'Deliver'), el('small', { id: 'templateSendHint' }, 'Save before sending.')),
        control('Channel', 'templateSendChannel', 'select'),
        action('templateSendTest', 'Send test'), action('templateSendNow', 'Send now', 'primary'))),
    panel('share', false,
      el('section', { class: 'template-share-card' },
        el('h3', {}, 'Authenticated link'),
        el('p', {}, 'The link opens this server and template after an administrator signs in.'),
        control('Link', 'templateShareLink', 'text', '', { readonly: true }), action('templateCopyLink', 'Copy link', 'primary')),
      el('section', { class: 'template-share-card' },
        el('h3', {}, 'Use as a snapshot'),
        el('p', {}, 'Leveling and Welcome Messages can copy this template without linking later edits.'))));
}

function templates() {
  return el('section', { class: 'view', id: 'messageTemplatesView', 'data-view-panel': 'message-templates', hidden: true },
    pageTitle('MESSAGE TEMPLATES', 'Write once. Send well.', 'Keep reusable Discord messages in a tidy library.',
      action('templateCreateButton', '＋ New template', 'primary')),
    el('div', { class: 'template-manager', id: 'templateManager' },
      el('aside', { class: 'template-folders', 'aria-label': 'Template folders' },
        el('header', {}, el('div', {}, el('h2', {}, 'Folders'), el('small', { id: 'templateTotalCount' }, '0 templates')),
          action('templateFolderCreate', '＋', 'quiet', { 'aria-label': 'Create folder' })),
        el('nav', { id: 'templateFolderList', 'aria-label': 'Folders' })),
      el('section', { class: 'template-library', 'aria-label': 'Template list' },
        el('header', {}, control('Search', 'templateSearch', 'search', '', { maxlength: '80', placeholder: 'Find a template' }),
          action('templateListCreate', '＋', 'quiet', { 'aria-label': 'Create template' })),
        el('div', { id: 'templateList', class: 'template-list' })),
      el('section', { class: 'template-detail', 'aria-label': 'Selected template' },
        el('div', { class: 'template-empty', id: 'templateEmptyState' },
          el('span', { 'aria-hidden': 'true' }, '📝'), el('h2', {}, 'Start with a message'),
          el('p', {}, 'Choose one from the library or make a new template.'),
          action('templateEmptyCreate', 'Create template', 'primary')),
        editor())));
}

module.exports = templates;
