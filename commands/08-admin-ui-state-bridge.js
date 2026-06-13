'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_FIXES_JS = path.join(__dirname, '..', 'admin', 'admin-fixes.js');

const bridgeScript = String.raw`
;(() => {
  window.state = state;
  window.TAB_NAMES = TAB_NAMES;
  window.ensureTicketEditor = ensureTicketEditor;
  window.setStatus = setStatus;
  window.refreshDirtyState = refreshDirtyState;
  window.setActiveTab = setActiveTab;

  const iconStyle = document.createElement('style');
  iconStyle.textContent =
    '.tab .tab-icon{' +
      '--tab-icon-outline:#b5bac1;' +
      'width:34px!important;height:34px!important;flex:0 0 34px!important;' +
      'box-sizing:border-box!important;padding:5px!important;' +
      'border:2px solid var(--tab-icon-outline)!important;border-radius:8px!important;' +
      'background:#111318!important;box-shadow:none!important;filter:none!important;' +
      'transform:none!important;transition:border-color 160ms ease,background 160ms ease!important' +
    '}' +
    '.tab:hover .tab-icon,.tab.active .tab-icon{' +
      'background:#171a20!important;box-shadow:none!important;filter:none!important;transform:none!important' +
    '}' +
    '.tab[data-tab="leveling"] .tab-icon{--tab-icon-outline:#57f287}' +
    '.tab[data-tab="tickets"] .tab-icon{--tab-icon-outline:#ed4245}' +
    '.tab[data-tab="messages"] .tab-icon{--tab-icon-outline:#63b8ff}' +
    '@media(max-width:740px){.tab .tab-icon{' +
      'width:30px!important;height:30px!important;flex-basis:30px!important;padding:4px!important;border-radius:7px!important' +
    '}}';
  document.head.append(iconStyle);

  function captureResetView() {
    const view = {
      tab: state.activeTab,
      levelingTab: state.activeLevelingTab,
      scrollTop: elements.configForm?.scrollTop || 0,
      ticketId: '',
      ticketSection: '',
    };
    if (view.tab !== 'tickets') return view;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim() || '';
    const types = ensureTicketEditor().getValue()?.tickets?.types || [];
    view.ticketId = types.find((type) => heading.endsWith(type.name))?.id || '';
    view.ticketSection = document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || '';
    return view;
  }

  function restoreResetView(view) {
    if (!view) return;
    if (view.tab === 'leveling' && view.levelingTab) {
      document.querySelector('[data-leveling-tab="' + CSS.escape(view.levelingTab) + '"]')?.click();
    }
    if (view.tab === 'tickets' && view.ticketId) {
      document.querySelector('.ticket-type-card[data-ticket-id="' + CSS.escape(view.ticketId) + '"]')?.click();
      if (view.ticketSection) {
        document.querySelector('#ticketEditorRoot .ticket-type-tabs [data-value="' + CSS.escape(view.ticketSection) + '"]')?.click();
      }
    }
    requestAnimationFrame(() => {
      if (elements.configForm) elements.configForm.scrollTop = view.scrollTop;
      refreshDirtyState();
    });
  }

  let automaticResetPass = false;
  document.addEventListener('click', (event) => {
    const resetButton = event.target.closest('#resetTabButton');
    if (!resetButton || automaticResetPass) return;
    const view = captureResetView();

    setTimeout(() => {
      refreshDirtyState();
      if (state.dirtyTabs.has(view.tab)) {
        automaticResetPass = true;
        resetButton.click();
        automaticResetPass = false;
      }
      setTimeout(() => restoreResetView(view), 0);
    }, 0);
  }, true);
})();
`;

const previousReadFile = fs.readFile.bind(fs);
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_FIXES_JS) || typeof callback !== 'function') {
    return previousReadFile(filePath, ...args);
  }

  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, source + bridgeScript);
  };
  return previousReadFile(filePath, ...args);
};

module.exports = {};
