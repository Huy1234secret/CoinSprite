const { el, action, control, tabs } = require('../layoutKit');

function confirm() {
  return el('dialog', { id: 'confirmDialog', class: 'dialog' },
    el('form', { method: 'dialog' },
      el('span', { class: 'dialog-symbol', 'aria-hidden': 'true' }, '⚠️'),
      el('h2', { id: 'dialogTitle' }, 'Confirm action'), el('p', { id: 'dialogCopy' }),
      el('label', { id: 'dialogInputWrap', hidden: true }, 'Reason',
        el('textarea', { id: 'dialogInput', maxlength: '500', rows: '4' })),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'action quiet', value: 'cancel' }, 'Cancel'),
        el('button', { class: 'action danger', id: 'dialogConfirm', value: 'confirm' }, 'Confirm'))));
}

function picker() {
  return el('dialog', { id: 'templatePickerDialog', class: 'dialog template-picker-dialog' },
    el('form', { method: 'dialog' },
      el('h2', {}, 'Choose a template'),
      el('p', {}, 'A copy of the selected message will be used here.'),
      control('Search', 'templatePickerSearch', 'search', '', { maxlength: '80', placeholder: 'Search by name' }),
      el('div', { id: 'templatePickerList', class: 'template-picker-list' }),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'action quiet', value: 'cancel' }, 'Close'))));
}

function templateAction() {
  return el('dialog', { id: 'templateActionDialog', class: 'dialog template-action-dialog', 'aria-labelledby': 'templateActionTitle' },
    el('form', { method: 'dialog' },
      el('h2', { id: 'templateActionTitle' }, 'Configure action'),
      el('p', { id: 'templateActionCopy' }, 'Choose what happens when a member uses this control.'),
      el('label', { class: 'control template-action-target' },
        el('span', { class: 'control-label', id: 'templateActionTargetLabel' }, 'Target'),
        el('select', { id: 'templateActionTarget', 'aria-describedby': 'templateActionHelp' }),
        el('small', { id: 'templateActionHelp' })),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'action quiet', value: 'cancel' }, 'Cancel'),
        action('templateActionSave', 'Save action', 'primary'))));
}

function emojiPicker() {
  return el('dialog', { id: 'emojiPickerDialog', class: 'emoji-picker-dialog', 'aria-labelledby': 'emojiPickerTitle' },
    el('section', {},
      el('header', { class: 'dialog-head' },
        el('div', {}, el('span', { 'aria-hidden': 'true' }, '😀'), el('div', {},
          el('h2', { id: 'emojiPickerTitle' }, 'Choose an emoji'),
          el('p', {}, 'Insert it into the active message or control.'))),
        action('emojiPickerClose', 'Close', 'quiet', { 'aria-label': 'Close emoji picker' })),
      control('Search emojis', 'emojiPickerSearch', 'search', '', { maxlength: '80', placeholder: 'Find an emoji', autocomplete: 'off' }),
      tabs('emoji-picker-tabs', 'data-emoji-section', [
        ['bot', '🤖', 'Bot'], ['group', '👥', 'Server'], ['default', '😀', 'Standard'],
      ]),
      el('p', { id: 'emojiPickerStatus', role: 'status' }),
      el('div', { class: 'emoji-picker-catalog' },
        el('nav', { id: 'emojiPickerCategories', class: 'emoji-picker-categories', 'aria-label': 'Emoji categories', hidden: true }),
        el('div', { id: 'emojiPickerGrid', class: 'emoji-picker-grid', role: 'grid', 'aria-label': 'Emoji results' }))));
}

module.exports = () => [confirm(), picker(), templateAction(), emojiPicker()];
