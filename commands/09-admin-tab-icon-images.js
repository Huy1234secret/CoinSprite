'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);
const ADMIN_DIR = path.resolve(__dirname, '..', 'admin');
const ADMIN_APP_JS = path.join(ADMIN_DIR, 'app.js');
const IMAGE_DIR = path.join(ADMIN_DIR, 'images');

const PUBLIC_IMAGE_PREFIXES = ['/CoinSprite/images/', '/images/', '/admin/images/'];
const TAB_ICON_FILES = new Set(['leveling.png', 'ticket.png', 'data.svg', 'moderator.svg', 'message.svg']);

function contentTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function publicIconName(pathname) {
  const decoded = decodeURIComponent(String(pathname || ''));
  const prefix = PUBLIC_IMAGE_PREFIXES.find((item) => decoded.startsWith(item));
  if (!prefix) return '';
  const fileName = decoded.slice(prefix.length).replace(/^\/+/, '');
  return TAB_ICON_FILES.has(fileName) ? fileName : '';
}

function sendIcon(res, fileName) {
  const filePath = path.join(IMAGE_DIR, fileName);
  const resolvedImageDir = path.resolve(IMAGE_DIR);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedImageDir && !resolvedFile.startsWith(`${resolvedImageDir}${path.sep}`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  fs.readFile(resolvedFile, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypeFor(fileName),
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
}

const tabIconImageScript = [
  ';(() => {',
  '  if (window.__coinSpriteTabIconImageFix) return;',
  '  window.__coinSpriteTabIconImageFix = true;',
  '',
  "  const ICON_BASE = '/CoinSprite/images/';",
  '  const TAB_ICONS = {',
  "    leveling: 'leveling.png',",
  "    data: 'data.svg',",
  "    tickets: 'ticket.png',",
  "    moderator: 'moderator.svg',",
  "    messages: 'message.svg',",
  '  };',
  '',
  "  const style = document.createElement('style');",
  '  style.textContent = [',
  "    '.tab { display: flex !important; align-items: center !important; gap: 12px !important; }',",
  "    '.tab .tab-icon, .tab[data-tab=\"moderator\"] .tab-icon { width: 30px !important; height: 30px !important; max-width: 30px !important; max-height: 30px !important; flex: 0 0 30px !important; display: block !important; box-sizing: border-box !important; object-fit: contain !important; object-position: center !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; outline: 0 !important; filter: none !important; transform: none !important; image-rendering: auto !important; }',",
  "    '.tab .tab-icon-frame, .tab[data-tab=\"moderator\"] .tab-icon-frame { display: contents !important; width: auto !important; height: auto !important; flex: initial !important; overflow: visible !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }',",
  "    '.tab .tab-image-icon, .tab .message-tab-icon { display: none !important; }',",
  "    '@media (max-width: 740px) { .tab .tab-icon, .tab[data-tab=\"moderator\"] .tab-icon { width: 26px !important; height: 26px !important; max-width: 26px !important; max-height: 26px !important; flex-basis: 26px !important; } }',",
  "  ].join('');",
  '  document.head.append(style);',
  '',
  '  function imageSource(fileName) {',
  '    return ICON_BASE + fileName;',
  '  }',
  '',
  '  function unwrapIconFrame(button) {',
  "    const frame = button.querySelector('.tab-icon-frame');",
  "    const image = frame && frame.querySelector('img.tab-icon');",
  '    if (frame && image) button.prepend(image);',
  '    if (frame) frame.remove();',
  '  }',
  '',
  '  function ensureTabIcon(tabName, fileName) {',
  "    const button = document.querySelector('.tab[data-tab=\"' + CSS.escape(tabName) + '\"]');",
  '    if (!button) return;',
  '',
  '    unwrapIconFrame(button);',
  "    button.querySelectorAll('.tab-image-icon, .message-tab-icon').forEach((node) => node.remove());",
  '',
  "    let image = button.querySelector('img.tab-icon');",
  '    if (!image) {',
  "      image = document.createElement('img');",
  '      button.prepend(image);',
  '    } else if (image.parentElement !== button || button.firstElementChild !== image) {',
  '      button.prepend(image);',
  '    }',
  '',
  "    if (image.className !== 'tab-icon') image.className = 'tab-icon';",
  "    if (image.getAttribute('alt') !== '') image.alt = '';",
  "    if (image.getAttribute('aria-hidden') !== 'true') image.setAttribute('aria-hidden', 'true');",
  '',
  '    const expectedSource = imageSource(fileName);',
  "    if (image.getAttribute('src') !== expectedSource) image.src = expectedSource;",
  '  }',
  '',
  '  let scheduled = false;',
  '  function repairTabIcons() {',
  '    scheduled = false;',
  '    for (const entry of Object.entries(TAB_ICONS)) ensureTabIcon(entry[0], entry[1]);',
  '  }',
  '',
  '  function scheduleRepair() {',
  '    if (scheduled) return;',
  '    scheduled = true;',
  '    requestAnimationFrame(repairTabIcons);',
  '  }',
  '',
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', repairTabIcons, { once: true });",
  '  } else {',
  '    repairTabIcons();',
  '  }',
  '',
  '  new MutationObserver(scheduleRepair).observe(document.documentElement, {',
  '    childList: true,',
  '    subtree: true,',
  '    attributes: true,',
  "    attributeFilter: ['src', 'class'],",
  '  });',
  '  scheduleRepair();',
  '})();',
].join('\n');

function appendTabIconFix(source) {
  const text = String(source);
  return text.includes('__coinSpriteTabIconImageFix') ? text : `${text}\n${tabIconImageScript}`;
}

function isAdminAppPath(filePath) {
  return path.resolve(String(filePath)) === ADMIN_APP_JS;
}

fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (!isAdminAppPath(filePath) || typeof callback !== 'function') {
    return previousReadFile(filePath, ...args);
  }

  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, appendTabIconFix(source));
  };
  return previousReadFile(filePath, ...args);
};

fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
  const data = previousReadFileSync(filePath, ...args);
  if (!isAdminAppPath(filePath)) return data;
  const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  return appendTabIconFix(source);
};

http.createServer = function tabIconAssetServer(listener) {
  return previousCreateServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    const fileName = publicIconName(pathname);
    if (fileName) {
      sendIcon(res, fileName);
      return;
    }
    listener(req, res);
  });
};

module.exports = {};
