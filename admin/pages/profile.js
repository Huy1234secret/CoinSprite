const { el, action, control, pageTitle } = require('../layoutKit');

const templates = [
  ['classic', 'Classic'], ['arcade', 'Arcade'], ['split', 'Split'],
  ['minimal', 'Minimal'], ['spotlight', 'Spotlight'],
];

function pager(prefix) {
  return el('div', { class: 'pager' },
    action(`${prefix}Previous`, '← Previous'), el('span', { id: `${prefix}Page` }, '1 / 1'), action(`${prefix}Next`, 'Next →'));
}

function inventory() {
  return el('section', { id: 'webInventory', class: 'inventory-view', hidden: true, 'aria-label': 'Your inventory' },
    el('header', { class: 'inventory-toolbar' },
      el('div', {}, el('h2', {}, 'Your collection'), el('p', {}, 'Everything earned across your games.')),
      action('ticketHistoryButton', '🎟️ Lottery history'), action('inventoryRefresh', '↻ Refresh')),
    el('p', { id: 'inventoryStatus', role: 'status' }),
    el('div', { class: 'inventory-scroll' }, el('div', { id: 'inventoryGrid', class: 'inventory-grid' })),
    pager('inventory'));
}

function ticketHistory() {
  return el('dialog', { id: 'ticketDialog', class: 'ticket-dialog' },
    el('header', { class: 'dialog-head' }, el('div', {}, el('span', { class: 'eyebrow' }, 'LOTTERY'), el('h2', {}, 'Ticket history')), action('ticketClose', 'Close')),
    el('p', {}, 'Check tickets from the past 30 days. Each ticket receives only its highest prize.'),
    el('div', { class: 'field-grid' },
      control('Draw date', 'ticketDate', 'select'),
      control('Find a code', 'ticketSearch', 'search', '', { maxlength: '8', placeholder: '5A-1B-0F' })),
    el('p', { id: 'ticketStatus', role: 'status' }), el('div', { id: 'ticketList', class: 'ticket-list' }), pager('ticket'));
}

function cardStudio() {
  return el('section', { class: 'card-studio' },
    el('header', { class: 'studio-head' },
      el('div', {}, el('span', { class: 'eyebrow' }, 'LEVEL CARD'), el('h2', {}, 'Build your card'), el('p', {}, 'Move, resize, and rotate elements in the workspace.')),
      el('div', { class: 'studio-actions' },
        el('label', { class: 'studio-template' }, 'Style ', el('select', { id: 'cardTemplateSelect' }, templates.map(([value, title]) => el('option', { value }, title)))),
        action('cardTemplateButton', 'Apply style'),
        action('cardUndoButton', '↶', 'quiet', { disabled: true, 'aria-label': 'Undo' }),
        action('cardRedoButton', '↷', 'quiet', { disabled: true, 'aria-label': 'Redo' }),
        action('cardBackgroundButton', '🖼️ Background'),
        action('cardImageButton', '＋ Image'),
        action('cardTextButton', '＋ Text', 'primary'),
        el('input', { id: 'cardBackgroundFile', type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true }),
        el('input', { id: 'cardImageFile', type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true }))),
    el('div', { class: 'studio-grid' },
      el('aside', { class: 'layers-panel' }, el('h3', {}, 'Layers'), el('div', { id: 'cardLayerList', class: 'layer-list' })),
      el('div', { class: 'card-workbench' },
        el('div', { class: 'level-card-canvas-wrap', id: 'cardCanvasWrap' },
          el('canvas', { id: 'levelCardCanvas', width: '1000', height: '320', 'aria-label': 'Authoritative server-rendered level card preview' }),
          el('canvas', { id: 'levelCardDraftCanvas', width: '1000', height: '320', 'aria-label': 'Editable draft level card preview', hidden: true })),
        el('p', { id: 'cardPreviewLabel', class: 'studio-hint' },
          el('strong', {}, 'Loading card preview'), el('small', {}, 'The saved card uses the same renderer as /level.'))),
      el('aside', { class: 'inspector-panel' }, el('span', { class: 'eyebrow' }, 'INSPECTOR'), el('h3', { id: 'cardInspectorTitle' }, 'Background'), el('div', { id: 'cardInspector' }))));
}

function profile() {
  return el('main', { class: 'profile-shell', id: 'profileShell', hidden: true },
    pageTitle('YOUR PROFILE', 'Make it yours.', 'Customize your level card and browse your collection.',
      el('img', { id: 'profileAvatar', alt: '', class: 'profile-avatar' }),
      el('strong', { id: 'profileName' }, 'Member'),
      el('a', { class: 'action quiet', href: '/admin' }, 'Manage servers')),
    el('nav', { class: 'inventory-tabs', 'aria-label': 'Profile tabs' },
      el('button', { id: 'profileCardTab', type: 'button', 'aria-pressed': 'true' }, '🪪 Card editor'),
      el('button', { id: 'profileInventoryTab', type: 'button', 'aria-pressed': 'false' }, '🎒 Inventory')),
    inventory(), el('div', { id: 'inventoryTooltip', class: 'inventory-tooltip', role: 'tooltip', hidden: true }),
    ticketHistory(), cardStudio(),
    el('footer', { class: 'profile-save-dock', id: 'profileSaveDock', hidden: true },
      el('span', {}, el('strong', {}, 'Unsaved card changes'), el('small', {}, 'Your saved card is still live.')),
      el('div', {}, action('cardResetButton', 'Reset'), action('cardSaveButton', 'Save card', 'primary'))));
}

module.exports = profile;
