'use strict';

const fs = require('fs');
const path = require('path');

if (!global.__coinSpriteModeratorSymbolSquareFallback) {
  global.__coinSpriteModeratorSymbolSquareFallback = true;

  const ROOT_DIR = path.resolve(__dirname, '..');
  const ADMIN_DIR = path.join(ROOT_DIR, 'admin');
  const STYLE_PATH = path.resolve(ADMIN_DIR, 'style.css');
  const INDEX_PATH = path.resolve(ADMIN_DIR, 'index.html');
  const APP_PATH = path.resolve(ADMIN_DIR, 'app.js');

  const previousReadFile = fs.readFile.bind(fs);
  const previousReadFileSync = fs.readFileSync.bind(fs);

  const STYLE_MARKER = '/* Moderator symbol square fallback */';
  const STYLE_PATCH = `
${STYLE_MARKER}
.tab[data-tab="moderator"] {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center !important;
  gap: 12px !important;
  --tab-icon-symbol: "🛡";
  --tab-icon-bg: rgba(155, 89, 182, 0.18);
  --tab-icon-border: rgba(188, 120, 255, 0.72);
  --tab-icon-color: #d9b7ff;
}

.tab[data-tab="moderator"]::before {
  content: none !important;
  display: none !important;
}

.tab[data-tab="moderator"] > img.tab-icon,
.tab[data-tab="moderator"] > .tab-image-icon,
.tab[data-tab="moderator"] > .message-tab-icon {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  flex: 0 0 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.tab[data-tab="moderator"] > .tab-symbol-icon {
  width: 30px !important;
  height: 30px !important;
  flex: 0 0 30px !important;
  box-sizing: border-box !important;
  display: grid !important;
  place-items: center !important;
  border: 2px solid rgba(188, 120, 255, 0.72) !important;
  border-radius: 9px !important;
  background: rgba(155, 89, 182, 0.18) !important;
  color: #d9b7ff !important;
  font-family: "Segoe UI Symbol", "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif !important;
  font-size: 16px !important;
  font-weight: 850 !important;
  line-height: 1 !important;
  text-align: center !important;
  box-shadow: none !important;
  filter: none !important;
  transform: none !important;
}

@media (max-width: 700px) {
  .tab[data-tab="moderator"] > .tab-symbol-icon {
    width: 26px !important;
    height: 26px !important;
    flex-basis: 26px !important;
    font-size: 14px !important;
  }
}
`;

  const APP_MARKER = 'Moderator symbol square fallback script';
  const APP_PATCH = `
/* ${APP_MARKER} */
;(() => {
  if (window.__coinSpriteModeratorSymbolSquare) return;
  window.__coinSpriteModeratorSymbolSquare = true;

  function findModeratorTab() {
    return document.querySelector('.tab[data-tab="moderator"]')
      || [...document.querySelectorAll('#tabList .tab, .tabs .tab, button.tab')]
        .find((tab) => tab.textContent.trim().toLowerCase() === 'moderator');
  }

  function ensureModeratorSymbolSquare() {
    const tab = findModeratorTab();
    if (!tab) return;

    tab.classList.add('tab');
    tab.dataset.tab = 'moderator';
    tab.style.setProperty('--tab-icon-symbol', '"🛡"');
    tab.style.setProperty('--tab-icon-bg', 'rgba(155, 89, 182, 0.18)');
    tab.style.setProperty('--tab-icon-border', 'rgba(188, 120, 255, 0.72)');
    tab.style.setProperty('--tab-icon-color', '#d9b7ff');

    for (const child of [...tab.children]) {
      if (child.matches('img.tab-icon, .tab-image-icon, .message-tab-icon')) child.remove();
    }

    let icon = [...tab.children].find((child) => child.classList?.contains('tab-symbol-icon'));
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'tab-symbol-icon moderator-symbol-icon';
      const label = [...tab.children].find((child) => child.tagName === 'SPAN' && !child.classList.contains('tab-symbol-icon'));
      tab.insertBefore(icon, label || tab.firstChild);
    }

    icon.textContent = '🛡';
    icon.setAttribute('aria-hidden', 'true');
  }

  function startModeratorSymbolSquare() {
    ensureModeratorSymbolSquare();
    const root = document.querySelector('#tabList') || document.querySelector('.tabs') || document.body;
    if (root) new MutationObserver(ensureModeratorSymbolSquare).observe(root, { childList: true, subtree: true });
    requestAnimationFrame(ensureModeratorSymbolSquare);
    setTimeout(ensureModeratorSymbolSquare, 150);
    setTimeout(ensureModeratorSymbolSquare, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startModeratorSymbolSquare, { once: true });
  else startModeratorSymbolSquare();
})();
`;

  function patchStyle(source) {
    const text = String(source || '');
    if (text.includes(STYLE_MARKER)) return text;
    return `${text}\n${STYLE_PATCH}`;
  }

  function patchApp(source) {
    const text = String(source || '');
    if (text.includes(APP_MARKER)) return text;
    return `${text}\n${APP_PATCH}`;
  }

  function patchIndex(source) {
    const text = String(source || '');
    let patched = text;
    if (!patched.includes(STYLE_MARKER)) patched = patched.replace('</head>', `<style>\n${STYLE_PATCH}\n</style>\n</head>`);
    if (!patched.includes(APP_MARKER)) patched = patched.replace('</body>', `<script>\n${APP_PATCH}\n</script>\n</body>`);
    return patched;
  }

  function patchTextAsset(filePath, data) {
    const resolved = path.resolve(String(filePath));
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    let patched = null;
    if (resolved === STYLE_PATH) patched = patchStyle(text);
    else if (resolved === APP_PATH) patched = patchApp(text);
    else if (resolved === INDEX_PATH) patched = patchIndex(text);
    else return data;
    return Buffer.isBuffer(data) ? Buffer.from(patched, 'utf8') : patched;
  }

  fs.readFile = function coinSpriteModeratorSymbolReadFile(filePath, ...args) {
    const callback = args[args.length - 1];
    if (typeof callback !== 'function') return previousReadFile(filePath, ...args);

    const resolved = path.resolve(String(filePath));
    const shouldPatch = resolved === STYLE_PATH || resolved === APP_PATH || resolved === INDEX_PATH;
    if (!shouldPatch) return previousReadFile(filePath, ...args);

    args[args.length - 1] = (error, data) => {
      if (error) return callback(error, data);
      return callback(null, patchTextAsset(filePath, data));
    };
    return previousReadFile(filePath, ...args);
  };

  fs.readFileSync = function coinSpriteModeratorSymbolReadFileSync(filePath, ...args) {
    const data = previousReadFileSync(filePath, ...args);
    const resolved = path.resolve(String(filePath));
    if (resolved !== STYLE_PATH && resolved !== APP_PATH && resolved !== INDEX_PATH) return data;
    return patchTextAsset(filePath, data);
  };
}

module.exports = {};
