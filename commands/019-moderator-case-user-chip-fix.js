'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  bootstrapJs: path.join(ROOT, 'admin', 'bootstrap.js'),
};
const MARKER = 'coinSpriteModeratorCaseUserChipFix';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const BOOTSTRAP_PATCH = String.raw`

;(() => {
  if (window.__coinSpriteModeratorCaseUserChipFix) return;
  window.__coinSpriteModeratorCaseUserChipFix = true;

  const styleId = 'coinSpriteModeratorCaseUserChipFix';

  function installCaseUserChipFix() {
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      body #moderatorRoot .case-layout-v2 .case-info-row dd > div.case-person-cell,
      body #moderatorRoot .case-layout-v3 .case-info-row dd > div.case-person-cell {
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-chip,
      body #moderatorRoot .case-layout-v3 .case-user-chip {
        display: grid !important;
        grid-template-columns: 32px minmax(0, 1fr) !important;
        align-items: center !important;
        justify-items: start !important;
        gap: 9px !important;
        width: auto !important;
        max-width: min(100%, 460px) !important;
        min-width: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        overflow: hidden !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        text-align: left !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-chip img,
      body #moderatorRoot .case-layout-v2 .case-user-chip > .case-user-fallback,
      body #moderatorRoot .case-layout-v3 .case-user-chip img,
      body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback {
        grid-column: 1 !important;
        grid-row: 1 !important;
        width: 32px !important;
        height: 32px !important;
        min-width: 32px !important;
        max-width: 32px !important;
        min-height: 32px !important;
        max-height: 32px !important;
        border-radius: 999px !important;
        object-fit: cover !important;
        display: block !important;
        place-items: center !important;
        flex: 0 0 32px !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-chip > .case-user-copy,
      body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-copy {
        grid-column: 2 !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        align-items: start !important;
        justify-items: start !important;
        place-items: normal !important;
        gap: 2px !important;
        width: auto !important;
        height: auto !important;
        min-width: 0 !important;
        max-width: 100% !important;
        min-height: 0 !important;
        max-height: none !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        color: inherit !important;
        font: inherit !important;
        overflow: hidden !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        text-align: left !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-chip > strong,
      body #moderatorRoot .case-layout-v2 .case-user-chip > small,
      body #moderatorRoot .case-layout-v3 .case-user-chip > strong,
      body #moderatorRoot .case-layout-v3 .case-user-chip > small {
        grid-column: 2 !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        text-align: left !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-copy > strong,
      body #moderatorRoot .case-layout-v2 .case-user-copy > small,
      body #moderatorRoot .case-layout-v2 .case-user-name,
      body #moderatorRoot .case-layout-v2 .case-user-meta,
      body #moderatorRoot .case-layout-v3 .case-user-copy > strong,
      body #moderatorRoot .case-layout-v3 .case-user-copy > small,
      body #moderatorRoot .case-layout-v3 .case-user-name,
      body #moderatorRoot .case-layout-v3 .case-user-meta {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        text-align: left !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-copy > strong,
      body #moderatorRoot .case-layout-v2 .case-user-name,
      body #moderatorRoot .case-layout-v3 .case-user-copy > strong,
      body #moderatorRoot .case-layout-v3 .case-user-name {
        line-height: 1.16 !important;
      }

      body #moderatorRoot .case-layout-v2 .case-user-copy > small,
      body #moderatorRoot .case-layout-v2 .case-user-meta,
      body #moderatorRoot .case-layout-v3 .case-user-copy > small,
      body #moderatorRoot .case-layout-v3 .case-user-meta {
        margin: 0 !important;
        color: var(--muted, #b7bdc8) !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        line-height: 1.2 !important;
      }
    `;
    document.head.append(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCaseUserChipFix, { once: true });
  } else {
    installCaseUserChipFix();
  }
  setTimeout(installCaseUserChipFix, 0);
  setTimeout(installCaseUserChipFix, 250);
})();
`;

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

fs.readFile = function readFileWithCaseUserChipFix(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithCaseUserChipFix(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
