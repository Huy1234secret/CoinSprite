'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  bootstrapJs: path.join(ROOT, 'admin', 'bootstrap.js'),
};
const MARKER = 'coinSpriteCaseListDefaultMessageTypePolish';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function adminCaseListDefaultMessageTypePolish() {
  if (window.__coinSpriteCaseListDefaultMessageTypePolish) return;
  window.__coinSpriteCaseListDefaultMessageTypePolish = true;

  const styleId = 'coinSpriteCaseListDefaultMessageTypePolishStyle';
  const dmDefaultIds = new Set([
    'default-ai-moderation-user-warning',
    'default-auto-moderator-user-warning',
    'default-warning-notice',
    'default-giveaway-hoster-dm',
  ]);

  function installStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      'body #moderatorRoot .case-list-panel .case-table {',
      '  display: grid !important;',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  overflow-x: auto !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-table-head,',
      'body #moderatorRoot .case-list-panel .case-row {',
      '  display: grid !important;',
      '  grid-template-columns: minmax(90px, .72fr) minmax(230px, 1.55fr) minmax(300px, 2.35fr) minmax(100px, .72fr) minmax(112px, .72fr) !important;',
      '  align-items: start !important;',
      '  column-gap: 22px !important;',
      '  width: 100% !important;',
      '  min-width: 900px !important;',
      '  box-sizing: border-box !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-table-head {',
      '  padding: 12px 14px !important;',
      '  color: var(--muted, #b7bdc8) !important;',
      '  background: rgba(255,255,255,.035) !important;',
      '  border-radius: 8px 8px 0 0 !important;',
      '  font-size: 12px !important;',
      '  font-weight: 800 !important;',
      '  text-transform: uppercase !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row {',
      '  margin: 0 !important;',
      '  padding: 14px !important;',
      '  border: 0 !important;',
      '  border-top: 1px solid rgba(255,255,255,.075) !important;',
      '  border-radius: 0 !important;',
      '  background: transparent !important;',
      '  color: var(--text, #f2f5fb) !important;',
      '  text-align: left !important;',
      '  cursor: pointer !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row:hover,',
      'body #moderatorRoot .case-list-panel .case-row:focus-visible {',
      '  background: rgba(255,255,255,.045) !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > strong,',
      'body #moderatorRoot .case-list-panel .case-row > span,',
      'body #moderatorRoot .case-list-panel .case-row > time {',
      '  display: grid !important;',
      '  align-content: start !important;',
      '  gap: 4px !important;',
      '  min-width: 0 !important;',
      '  max-width: 100% !important;',
      '  margin: 0 !important;',
      '  line-height: 1.25 !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > strong {',
      '  color: #fff !important;',
      '  font-weight: 900 !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row small {',
      '  display: block !important;',
      '  min-width: 0 !important;',
      '  color: var(--muted, #b7bdc8) !important;',
      '  font-size: 12px !important;',
      '  font-weight: 700 !important;',
      '  line-height: 1.2 !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > span:nth-child(2),',
      'body #moderatorRoot .case-list-panel .case-row > span:nth-child(3) {',
      '  overflow-wrap: anywhere !important;',
      '  word-break: normal !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > .case-status {',
      '  justify-self: start !important;',
      '  align-self: center !important;',
      '  width: fit-content !important;',
      '  max-width: 100% !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #moderatorRoot .case-list-panel .case-row > time {',
      '  justify-self: start !important;',
      '  color: #fff !important;',
      '  font-weight: 800 !important;',
      '  white-space: nowrap !important;',
      '}',
      'body #messageTemplatesRoot .message-default-card .message-default-type {',
      '  display: block !important;',
      '  margin-top: 2px !important;',
      '  color: #c9d3e6 !important;',
      '  font-size: 12px !important;',
      '  font-weight: 800 !important;',
      '  line-height: 1.25 !important;',
      '}',
      '@media (max-width: 860px) {',
      '  body #moderatorRoot .case-list-panel .case-table { overflow-x: visible !important; }',
      '  body #moderatorRoot .case-list-panel .case-table-head { display: none !important; }',
      '  body #moderatorRoot .case-list-panel .case-row { grid-template-columns: minmax(0, 1fr) !important; min-width: 0 !important; gap: 8px !important; padding: 14px 4px !important; }',
      '  body #moderatorRoot .case-list-panel .case-row > .case-status, body #moderatorRoot .case-list-panel .case-row > time { align-self: start !important; }',
      '}',
    ].join('\n');
    document.head.append(style);
  }

  function defaultMessageType(id) {
    const value = String(id || '');
    if (!value.startsWith('default-')) return '';
    return dmDefaultIds.has(value) ? 'DM' : 'Channel';
  }

  function labelContainerForCard(card) {
    return Array.from(card.children).find((child) => child.tagName === 'SPAN'
      && !child.classList.contains('message-template-symbol')
      && !child.classList.contains('message-card-folder-button')
      && !child.classList.contains('message-card-arrow')) || null;
  }

  function labelForContainer(container) {
    return Array.from(container.children).find((child) => child.classList.contains('message-default-type')) || null;
  }

  function annotateDefaultCards(root = document) {
    root.querySelectorAll?.('#messageTemplatesRoot .message-template-card.message-default-card[data-id]').forEach((card) => {
      const type = defaultMessageType(card.dataset.id);
      if (!type) return;
      const container = labelContainerForCard(card);
      if (!container) return;
      let label = labelForContainer(container);
      if (!label) {
        label = document.createElement('small');
        label.className = 'message-default-type';
        container.append(label);
      }
      label.textContent = 'Type: ' + type;
    });
  }

  function refresh() {
    installStyles();
    annotateDefaultCards(document);
  }

  function scheduleRefresh(delay = 0) {
    window.setTimeout(refresh, delay);
  }

  function scheduleAfterMessageUiChange(event) {
    if (!event.target?.closest?.('#messageTemplatesRoot')) return;
    scheduleRefresh(0);
    scheduleRefresh(120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  } else {
    refresh();
  }

  document.addEventListener('click', scheduleAfterMessageUiChange, true);
  document.addEventListener('input', scheduleAfterMessageUiChange, true);
  document.addEventListener('change', scheduleAfterMessageUiChange, true);
  [0, 250, 750, 1500].forEach(scheduleRefresh);
}

const BOOTSTRAP_PATCH = `\n\n;(${adminCaseListDefaultMessageTypePolish.toString()})();\n`;

function patchBootstrapJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return `${text.replace(/\s*$/u, '')}${BOOTSTRAP_PATCH}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.bootstrapJs)) return patchBootstrapJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseListDefaultMessageTypePolish(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithCaseListDefaultMessageTypePolish(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
