'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT_IMAGE_DIR = path.join(__dirname, '..', 'images');
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_IMAGE_DIR = path.join(ADMIN_DIR, 'images');
const ADMIN_INDEX_PATH = path.join(ADMIN_DIR, 'index.html');
const ADMIN_APP_PATH = path.join(ADMIN_DIR, 'app.js');

const ICON_FILES = Object.freeze({
  'leveling.png': 'leveling.png',
  'level.png': 'leveling.png',
  'ticket.png': 'ticket.png',
  'tickets.png': 'ticket.png',
  'data.png': 'data.png',
  'data.svg': 'data.png',
  'moderator.png': 'moderator.png',
  'moderator.svg': 'moderator.png',
  'messages.png': 'messages.png',
  'message.png': 'messages.png',
  'message.svg': 'messages.png',
});

const ADMIN_FALLBACK_FILES = Object.freeze({
  'leveling.png': 'leveling.png',
  'level.png': 'leveling.png',
  'ticket.png': 'ticket.png',
  'tickets.png': 'ticket.png',
  'data.png': 'data.svg',
  'data.svg': 'data.svg',
  'moderator.png': 'moderator.svg',
  'moderator.svg': 'moderator.svg',
  'messages.png': 'message.svg',
  'message.png': 'message.svg',
  'message.svg': 'message.svg',
});

const PUBLIC_PREFIXES = ['/CoinSprite/images/', '/admin/images/', '/images/'];

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}

function safeIconName(value) {
  let decoded;
  try { decoded = decodeURIComponent(String(value || '')); }
  catch { return ''; }
  const normalized = path.normalize(decoded).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('/')) return '';
  return normalized.toLowerCase();
}

function iconNameFromRequest(pathname) {
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return safeIconName(pathname.slice(prefix.length));
  }
  return '';
}

function candidateIconFiles(iconName) {
  const candidates = [];
  const rootName = ICON_FILES[iconName];
  if (rootName) candidates.push(path.join(ROOT_IMAGE_DIR, rootName));
  const fallbackName = ADMIN_FALLBACK_FILES[iconName] || iconName;
  candidates.push(path.join(ADMIN_IMAGE_DIR, fallbackName));
  return candidates;
}

function iconNameFromAdminImagePath(filePath) {
  const resolved = path.resolve(String(filePath));
  const imageDir = path.resolve(ADMIN_IMAGE_DIR);
  if (resolved !== imageDir && !resolved.startsWith(`${imageDir}${path.sep}`)) return '';
  return safeIconName(path.relative(imageDir, resolved));
}

function readFirstAvailable(files, callback, index = 0) {
  const filePath = files[index];
  if (!filePath) {
    callback(Object.assign(new Error('Icon not found'), { code: 'ENOENT' }));
    return;
  }
  fs.__coinSpriteNativeReadFile(filePath, (error, data) => {
    if (error) return readFirstAvailable(files, callback, index + 1);
    callback(null, data, filePath);
  });
}

function rewriteIconUrls(source) {
  return String(source)
    .replace(/\/CoinSprite\/images\/data\.svg\?v=custom-icons-1/g, '/CoinSprite/images/data.png?v=custom-icons-1')
    .replace(/\/CoinSprite\/images\/moderator\.svg\?v=custom-icons-1/g, '/CoinSprite/images/moderator.png?v=custom-icons-1')
    .replace(/\/CoinSprite\/images\/message\.svg\?v=custom-icons-1/g, '/CoinSprite/images/messages.png?v=custom-icons-1')
    .replace(/\/admin\/images\/message\.svg/g, '/admin/images/messages.png')
    .replace(/\/admin\/images\/moderator\.svg/g, '/admin/images/moderator.png')
    .replace(/\/admin\/images\/data\.svg/g, '/admin/images/data.png');
}

function tabIconRepairScript() {
  return `\n<script>\n(() => {\n  const sources = {\n    leveling: '/CoinSprite/images/leveling.png?v=custom-icons-1',\n    data: '/CoinSprite/images/data.png?v=custom-icons-1',\n    tickets: '/CoinSprite/images/ticket.png?v=custom-icons-1',\n    moderator: '/CoinSprite/images/moderator.png?v=custom-icons-1',\n    messages: '/CoinSprite/images/messages.png?v=custom-icons-1',\n  };\n  function repairTabIcons() {\n    for (const [tabName, source] of Object.entries(sources)) {\n      const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');\n      if (!tab) continue;\n      let image = tab.querySelector('img.tab-icon');\n      if (!image) {\n        image = document.createElement('img');\n        image.className = 'tab-icon';\n        image.alt = '';\n        image.setAttribute('aria-hidden', 'true');\n        tab.prepend(image);\n      }\n      if (image.getAttribute('src') !== source) image.src = source;\n    }\n  }\n  document.addEventListener('DOMContentLoaded', repairTabIcons);\n  new MutationObserver(repairTabIcons).observe(document.documentElement, { childList: true, subtree: true });\n  repairTabIcons();\n})();\n</script>`;
}

function patchTextAsset(filePath, data) {
  const resolved = path.resolve(String(filePath));
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (resolved === path.resolve(ADMIN_INDEX_PATH)) {
    const rewritten = rewriteIconUrls(text);
    if (rewritten.includes('__coinSpriteRootTabIconRepair')) return rewritten;
    return rewritten.replace('</body>', `${tabIconRepairScript().replace('(() => {', '(() => { window.__coinSpriteRootTabIconRepair = true;')}\n</body>`);
  }
  if (resolved === path.resolve(ADMIN_APP_PATH)) return rewriteIconUrls(text);
  return data;
}

if (!fs.__coinSpriteNativeReadFile) fs.__coinSpriteNativeReadFile = fs.readFile.bind(fs);
if (!fs.__coinSpriteNativeReadFileSync) fs.__coinSpriteNativeReadFileSync = fs.readFileSync.bind(fs);

fs.readFile = function coinSpriteReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  const iconName = iconNameFromAdminImagePath(filePath);
  if (iconName && ICON_FILES[iconName] && typeof callback === 'function') {
    readFirstAvailable(candidateIconFiles(iconName), (error, data) => callback(error, data));
    return;
  }
  const resolved = path.resolve(String(filePath));
  const shouldPatchText = (resolved === path.resolve(ADMIN_INDEX_PATH) || resolved === path.resolve(ADMIN_APP_PATH)) && typeof callback === 'function';
  if (!shouldPatchText) return fs.__coinSpriteNativeReadFile(filePath, ...args);
  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const patched = patchTextAsset(filePath, data);
    callback(null, Buffer.isBuffer(data) ? Buffer.from(patched) : patched);
  };
  return fs.__coinSpriteNativeReadFile(filePath, ...args);
};

fs.readFileSync = function coinSpriteReadFileSync(filePath, ...args) {
  const iconName = iconNameFromAdminImagePath(filePath);
  if (iconName && ICON_FILES[iconName]) {
    for (const candidate of candidateIconFiles(iconName)) {
      try { return fs.__coinSpriteNativeReadFileSync(candidate, ...args); }
      catch { /* try next candidate */ }
    }
  }
  const data = fs.__coinSpriteNativeReadFileSync(filePath, ...args);
  return patchTextAsset(filePath, data);
};

const previousCreateServer = http.createServer.bind(http);
http.createServer = function coinSpriteRootIconServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (typeof listener !== 'function') return previousCreateServer(...args);
  args[listenerIndex] = (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; }
    catch { pathname = req.url || '/'; }
    const iconName = iconNameFromRequest(pathname);
    if (!iconName || !ICON_FILES[iconName]) return listener(req, res);
    readFirstAvailable(candidateIconFiles(iconName), (error, data, sourcePath) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Icon not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(sourcePath), 'Cache-Control': 'public, max-age=300' });
      res.end(data);
    });
  };
  return previousCreateServer(...args);
};

module.exports = {};
