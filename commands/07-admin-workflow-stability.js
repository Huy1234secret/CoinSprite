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

  const NativeMutationObserver = window.MutationObserver;
  if (typeof NativeMutationObserver !== 'function') return;

  window.MutationObserver = class CoinSpriteMutationObserver {
    constructor(callback) {
      const callbackSource = Function.prototype.toString.call(callback);
      const isWorkflowRenderer = callbackSource.includes('renderWorkflowPanels');

      if (!isWorkflowRenderer) return new NativeMutationObserver(callback);

      let rendering = false;
      let releaseScheduled = false;
      let observer;

      const release = () => {
        rendering = false;
        releaseScheduled = false;
        observer.takeRecords();
        if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
      };

      observer = new NativeMutationObserver((records, nativeObserver) => {
        if (rendering) return;
        rendering = true;
        callback(records, nativeObserver);

        if (!releaseScheduled) {
          releaseScheduled = true;
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(release);
          else window.setTimeout(release, 16);
        }
      });

      return observer;
    }
  };

  const roleLayoutCss = document.createElement('style');
  roleLayoutCss.textContent =
    '.sequence-item .request-role-add-field.inline-role-add-field{' +
      'display:block;flex:1;min-width:240px;max-width:520px;margin:0 12px 0 auto' +
    '}' +
    '.sequence-item .request-role-add-field.inline-role-add-field>.field-label,' +
    '.sequence-item .request-role-add-field.inline-role-add-field>.request-action-note{' +
      'display:none' +
    '}' +
    '.sequence-item .request-role-add-field.inline-role-add-field .picker-button{' +
      'min-height:38px' +
    '}' +
    '@media(max-width:760px){' +
      '.sequence-item .request-role-add-field.inline-role-add-field{' +
        'flex:0 0 100%;min-width:0;max-width:none;margin:8px 0 0' +
      '}' +
    '}';
  document.head.append(roleLayoutCss);

  let layoutScheduled = false;
  function placeRolePickerInActionRow() {
    layoutScheduled = false;
    document.querySelectorAll('#ticketEditorRoot .ticket-control-card').forEach((card) => {
      const field = card.querySelector('.request-role-add-field');
      if (!field) return;
      const roleItem = [...card.querySelectorAll('.sequence-item')].find((item) => {
        const label = item.querySelector(':scope > strong')?.textContent?.trim().toLowerCase();
        return label === 'role add';
      });
      if (!roleItem) return;
      field.classList.add('inline-role-add-field');
      if (field.parentElement === roleItem) return;
      const actionButtons = roleItem.querySelector(':scope > div:last-child');
      roleItem.insertBefore(field, actionButtons || null);
    });
  }
  function scheduleRoleLayout() {
    if (layoutScheduled) return;
    layoutScheduled = true;
    window.requestAnimationFrame(placeRolePickerInActionRow);
  }

  const ticketRoot = document.querySelector('#ticketEditorRoot');
  if (ticketRoot) new NativeMutationObserver(scheduleRoleLayout).observe(ticketRoot, { childList: true, subtree: true });
  scheduleRoleLayout();

  function captureEditorView() {
    const view = {
      tab: window.state?.activeTab || '',
      levelingTab: window.state?.activeLevelingTab || '',
      scrollTop: document.querySelector('#configForm')?.scrollTop || 0,
      ticketId: '',
      ticketSection: '',
    };
    if (view.tab !== 'tickets') return view;

    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim() || '';
    const types = window.ensureTicketEditor?.().getValue()?.tickets?.types || [];
    view.ticketId = types.find((type) => heading.endsWith(type.name))?.id || '';
    view.ticketSection = document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || '';
    return view;
  }

  function restoreEditorView(view) {
    if (!view) return;
    if (view.tab && window.state?.activeTab !== view.tab) {
      const nativeTab = document.querySelector('.tab[data-tab="' + CSS.escape(view.tab) + '"]');
      nativeTab?.click();
    }
    if (view.levelingTab && view.tab === 'leveling') {
      document.querySelector('[data-leveling-tab="' + CSS.escape(view.levelingTab) + '"]')?.click();
    }
    if (view.ticketId && view.tab === 'tickets') {
      const card = document.querySelector('.ticket-type-card[data-ticket-id="' + CSS.escape(view.ticketId) + '"]');
      card?.click();
      if (view.ticketSection) {
        document.querySelector('#ticketEditorRoot .ticket-type-tabs [data-value="' + CSS.escape(view.ticketSection) + '"]')?.click();
      }
    }
    window.requestAnimationFrame(() => {
      const form = document.querySelector('#configForm');
      if (form) form.scrollTop = view.scrollTop;
      scheduleRoleLayout();
    });
  }

  function waitForSaveAndRestore(view, attempts = 0) {
    if (window.state?.saving && attempts < 200) {
      window.setTimeout(() => waitForSaveAndRestore(view, attempts + 1), 25);
      return;
    }
    restoreEditorView(view);
  }

  document.addEventListener('click', (event) => {
    const reset = event.target.closest('#resetTabButton');
    const save = event.target.closest('#saveButton');
    if (!reset && !save) return;
    const view = captureEditorView();
    if (reset) queueMicrotask(() => restoreEditorView(view));
    if (save) queueMicrotask(() => waitForSaveAndRestore(view));
  }, true);

  queueMicrotask(() => {
    if (typeof window.setActiveTab !== 'function' || window.setActiveTab.__dirtyGuard) return;
    const nativeSetActiveTab = window.setActiveTab;
    function guardedSetActiveTab(tabName) {
      const activeTab = window.state?.activeTab;
      if (tabName !== activeTab && window.state?.dirtyTabs?.has(activeTab)) {
        window.setStatus?.('Save or reset ' + (window.TAB_NAMES?.[activeTab] || activeTab) + ' before opening another section.', 'error');
        const bar = document.querySelector('#unsavedBar');
        bar?.classList.remove('attention');
        void bar?.offsetWidth;
        bar?.classList.add('attention');
        return;
      }
      return nativeSetActiveTab(tabName);
    }
    guardedSetActiveTab.__dirtyGuard = true;
    window.setActiveTab = guardedSetActiveTab;
  });
})();
`;
}

const previousReadFile = fs.readFile.bind(fs);
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_FIXES_JS) || typeof callback !== 'function') {
    return previousReadFile(filePath, ...args);
  }

  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, source + browserScript());
  };

  return previousReadFile(filePath, ...args);
};

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  return previousCreateServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      pathname = request.url || '/';
    }

    const iconPath = ICON_ALIASES.get(pathname);
    if (!iconPath) return listener(request, response);

    fs.readFile(iconPath, (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Icon not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
      });
      response.end(data);
    });
  });
};

module.exports = {
  data: { name: 'admin-workflow-stability', description: 'Stabilizes request workflow editing and admin navigation.' },
  async execute() {},
};
