const fs = require('fs');
const path = require('path');

const originalReadFile = fs.readFile.bind(fs);
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_FIXES_CSS = path.resolve(ADMIN_DIR, 'admin-fixes.css');

const VIEW_FIX_SCRIPT = `
(() => {
  let selectedTicketId = '';
  let pendingView = null;

  function currentTicketId() {
    if (selectedTicketId) return selectedTicketId;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim();
    if (!heading) return '';
    try {
      return ensureTicketEditor().getValue().tickets.types
        .find((type) => heading.endsWith(type.name))?.id || '';
    } catch {
      return '';
    }
  }

  function captureView() {
    if (state.activeTab !== 'tickets') return null;
    const ticketId = currentTicketId();
    if (!ticketId) return null;
    return {
      ticketId,
      section: document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || 'admin',
      scrollTop: elements.configForm.scrollTop,
    };
  }

  function restoreView(view) {
    if (!view?.ticketId || state.activeTab !== 'tickets') return;
    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;

    root.querySelector('[data-action="main-mini"][data-value="ticket"]')?.click();
    const card = [...root.querySelectorAll('.ticket-type-card')]
      .find((item) => item.dataset.ticketId === view.ticketId);
    if (!card) return;
    card.click();
    root.querySelector('.ticket-type-tabs [data-action="type-section"][data-value="' + view.section + '"]')?.click();
    selectedTicketId = view.ticketId;
    requestAnimationFrame(() => { elements.configForm.scrollTop = view.scrollTop || 0; });
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.ticket-type-card');
    if (card) selectedTicketId = card.dataset.ticketId || '';
    if (event.target.closest('[data-action="back-list"]')) selectedTicketId = '';
  }, true);

  elements.saveButton.addEventListener('click', () => {
    pendingView = captureView();
  }, true);

  const nativeFillConfig = fillConfig;
  fillConfig = function preserveTicketView(config) {
    nativeFillConfig(config);
    if (!pendingView) return;
    const view = pendingView;
    pendingView = null;
    queueMicrotask(() => restoreView(view));
  };
})();
`;

const VIEW_FIX_CSS = `
.sequence-item.workflow-condition-step {
  align-items: start;
}
.sequence-item.workflow-condition-step > strong {
  min-width: 0;
  padding-top: 7px;
}
.sequence-item.workflow-condition-step > .request-condition-inline {
  display: grid !important;
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  margin-top: 6px;
}
.sequence-item.workflow-condition-step .request-condition-grid,
.sequence-item.workflow-condition-step .condition-action {
  width: 100%;
  min-width: 0;
}
.sequence-item.workflow-condition-step .request-condition-grid > label,
.sequence-item.workflow-condition-step .condition-action > label {
  min-width: 0;
}
`;

fs.readFile = function patchedAdminReadFile(filePath, ...args) {
  const callback = args.pop();
  return originalReadFile(filePath, ...args, (error, data) => {
    if (error || typeof callback !== 'function') {
      callback?.(error, data);
      return;
    }
    const resolved = path.resolve(String(filePath));
    if (resolved !== ADMIN_FIXES_JS && resolved !== ADMIN_FIXES_CSS) {
      callback(null, data);
      return;
    }
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, `${source}\n${resolved === ADMIN_FIXES_JS ? VIEW_FIX_SCRIPT : VIEW_FIX_CSS}`);
  });
};

module.exports = {};
