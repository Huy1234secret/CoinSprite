'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ADMIN_FIXES_JS = path.join(__dirname, '..', 'admin', 'admin-fixes.js');
const IMAGE_DIR = path.join(__dirname, '..', 'images');
const ICON_ALIASES = new Map([
  ['/images/leveling.png', path.join(IMAGE_DIR, 'leveling.png')],
  ['/images/ticket.png', path.join(IMAGE_DIR, 'ticket.png')],
  ['/images/message.png', path.join(IMAGE_DIR, 'message.png')],
]);

function browserScript() {
  return String.raw`
;(() => {
  if (window.__coinSpriteWorkflowStability) return;
  window.__coinSpriteWorkflowStability = true;
  const NativeObserver = window.MutationObserver;
  if (typeof NativeObserver !== 'function') return;

  window.MutationObserver = class CoinSpriteMutationObserver {
    constructor(callback) {
      if (!Function.prototype.toString.call(callback).includes('renderWorkflowPanels')) return new NativeObserver(callback);
      let rendering = false;
      let scheduled = false;
      let observer;
      const release = () => {
        rendering = false;
        scheduled = false;
        observer.takeRecords();
        window.refreshDirtyState?.();
      };
      observer = new NativeObserver((records, nativeObserver) => {
        if (rendering) return;
        rendering = true;
        callback(records, nativeObserver);
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 16)))(release);
      });
      return observer;
    }
  };

  const style = document.createElement('style');
  style.textContent =
    '.sequence-item.has-inline-action-field{' +
      'grid-template-columns:26px minmax(130px,max-content) minmax(220px,420px) auto;' +
      'align-items:center' +
    '}' +
    '.sequence-item .inline-action-field{' +
      'display:block;min-width:0;width:100%;max-width:420px;margin:0' +
    '}' +
    '.sequence-item .inline-action-field>.field-label,' +
    '.sequence-item .inline-action-field>.request-action-note{' +
      'display:none' +
    '}' +
    '.sequence-item .inline-action-field>select,' +
    '.sequence-item .inline-action-field .picker-button{' +
      'width:100%;min-height:38px' +
    '}' +
    '.sequence-item.has-inline-action-field>div:last-child{' +
      'justify-self:end;flex-wrap:nowrap' +
    '}' +
    '@media(max-width:900px){' +
      '.sequence-item.has-inline-action-field{' +
        'grid-template-columns:26px minmax(100px,1fr) minmax(180px,320px) auto' +
      '}' +
    '}' +
    '@media(max-width:650px){' +
      '.sequence-item.has-inline-action-field{' +
        'grid-template-columns:26px minmax(0,1fr) auto' +
      '}' +
      '.sequence-item .inline-action-field{' +
        'grid-column:2 / 4;grid-row:2;max-width:none' +
      '}' +
    '}';
  document.head.append(style);

  let layoutQueued = false;
  function actionRow(card, label) {
    return [...card.querySelectorAll('.sequence-item')].find((item) =>
      item.querySelector(':scope > strong')?.textContent?.trim().toLowerCase() === label
    );
  }
  function moveFieldIntoRow(field, row) {
    if (!field || !row) return;
    field.classList.add('inline-action-field');
    row.classList.add('has-inline-action-field');
    if (field.parentElement !== row) row.insertBefore(field, row.querySelector(':scope > div:last-child'));
  }
  function placeInlineActionFields() {
    layoutQueued = false;
    document.querySelectorAll('#ticketEditorRoot .ticket-control-card').forEach((card) => {
      moveFieldIntoRow(card.querySelector('.request-role-add-field'), actionRow(card, 'role add'));
      moveFieldIntoRow(card.querySelector('.request-template-field, .request-dm-field'), actionRow(card, 'dm message'));
    });
  }
  function queueActionLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(placeInlineActionFields);
  }
  const ticketRoot = document.querySelector('#ticketEditorRoot');
  if (ticketRoot) new NativeObserver(queueActionLayout).observe(ticketRoot, { childList: true, subtree: true });
  queueActionLayout();

  function captureView() {
    const view = { tab: window.state?.activeTab || '', levelingTab: window.state?.activeLevelingTab || '', scrollTop: document.querySelector('#configForm')?.scrollTop || 0, ticketId: '', ticketSection: '' };
    if (view.tab !== 'tickets') return view;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim() || '';
    const types = window.ensureTicketEditor?.().getValue()?.tickets?.types || [];
    view.ticketId = types.find((type) => heading.endsWith(type.name))?.id || '';
    view.ticketSection = document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || '';
    return view;
  }
  function restoreView(view) {
    if (!view) return;
    if (view.tab && window.state?.activeTab !== view.tab) document.querySelector('.tab[data-tab="' + CSS.escape(view.tab) + '"]')?.click();
    if (view.tab === 'leveling' && view.levelingTab) document.querySelector('[data-leveling-tab="' + CSS.escape(view.levelingTab) + '"]')?.click();
    if (view.tab === 'tickets' && view.ticketId) {
      document.querySelector('.ticket-type-card[data-ticket-id="' + CSS.escape(view.ticketId) + '"]')?.click();
      if (view.ticketSection) document.querySelector('#ticketEditorRoot .ticket-type-tabs [data-value="' + CSS.escape(view.ticketSection) + '"]')?.click();
    }
    window.requestAnimationFrame(() => {
      const form = document.querySelector('#configForm');
      if (form) form.scrollTop = view.scrollTop;
      queueActionLayout();
    });
  }
  function restoreAfterSave(view, attempts = 0) {
    if (window.state?.saving && attempts < 200) return window.setTimeout(() => restoreAfterSave(view, attempts + 1), 25);
    restoreView(view);
  }
  document.addEventListener('click', (event) => {
    const reset = event.target.closest('#resetTabButton');
    const save = event.target.closest('#saveButton');
    if (!reset && !save) return;
    const view = captureView();
    if (reset) queueMicrotask(() => restoreView(view));
    if (save) queueMicrotask(() => restoreAfterSave(view));
  }, true);

  queueMicrotask(() => {
    if (typeof window.setActiveTab !== 'function' || window.setActiveTab.__dirtyGuard) return;
    const nativeSetActiveTab = window.setActiveTab;
    const guarded = function guardedSetActiveTab(tabName) {
      const active = window.state?.activeTab;
      if (tabName !== active && window.state?.dirtyTabs?.has(active)) {
        window.setStatus?.('Save or reset ' + (window.TAB_NAMES?.[active] || active) + ' before opening another section.', 'error');
        return;
      }
      return nativeSetActiveTab(tabName);
    };
    guarded.__dirtyGuard = true;
    window.setActiveTab = guarded;
  });
})();
`;
}

const previousReadFile = fs.readFile.bind(fs);
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_FIXES_JS) || typeof callback !== 'function') return previousReadFile(filePath, ...args);
  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    callback(null, (Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) + browserScript());
  };
  return previousReadFile(filePath, ...args);
};

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  return previousCreateServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url || '/', 'http://localhost').pathname; }
    catch { pathname = request.url || '/'; }
    const iconPath = ICON_ALIASES.get(pathname);
    if (!iconPath) return listener(request, response);
    fs.readFile(iconPath, (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Icon not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      response.end(data);
    });
  });
};

module.exports = {};
