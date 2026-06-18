'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

if (!global.__coinSpriteRuntimeAdminIcons) {
  global.__coinSpriteRuntimeAdminIcons = true;

  const previousCreateServer = http.createServer.bind(http);
  const previousReadFile = fs.readFile.bind(fs);
  const ROOT_DIR = path.resolve(__dirname, '..');
  const ADMIN_DIR = path.join(ROOT_DIR, 'admin');
  const STYLE_PATH = path.resolve(ADMIN_DIR, 'style.css');
  const ADMIN_APP_PATH = path.resolve(ADMIN_DIR, 'app.js');
  const PUBLIC_PREFIXES = ['/admin/images/', '/images/', '/CoinSprite/images/'];
  const ICON_EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg', '.svg', '.gif'];
  const ICON_ALIASES = new Map([
    ['leveling', 'leveling'],
    ['ticket', 'ticket'],
    ['tickets', 'ticket'],
    ['moderator', 'moderator'],
    ['data', 'data'],
    ['message', 'message'],
    ['messages', 'message'],
  ]);

  const IMAGE_DIRS = uniquePaths([
    path.join(ROOT_DIR, 'images'),
    path.join(ROOT_DIR, 'image'),
    path.join(process.cwd(), 'images'),
    path.join(process.cwd(), 'image'),
    path.join(ADMIN_DIR, 'images'),
  ]);

  function uniquePaths(values) {
    const seen = new Set();
    return values.map((value) => path.resolve(value)).filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function cleanIconName(value) {
    let decoded;
    try {
      decoded = decodeURIComponent(String(value || ''));
    } catch {
      return '';
    }
    const normalized = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('/')) return '';
    const basename = path.posix.basename(normalized).toLowerCase();
    return /^[a-z0-9_.-]+$/.test(basename) ? basename : '';
  }

  function candidateNames(requestedName) {
    const clean = cleanIconName(requestedName);
    if (!clean) return [];
    const extension = path.extname(clean).toLowerCase();
    const publicBase = extension ? clean.slice(0, -extension.length) : clean;
    const canonicalBase = ICON_ALIASES.get(publicBase);
    if (!canonicalBase) return [];

    const names = new Set([clean]);
    if (extension) names.add(`${canonicalBase}${extension}`);
    for (const iconExtension of ICON_EXTENSIONS) names.add(`${canonicalBase}${iconExtension}`);
    return [...names];
  }

  function fileInDirectory(directory, filename) {
    const resolvedDirectory = path.resolve(directory);
    const resolvedFile = path.resolve(directory, filename);
    if (resolvedFile !== resolvedDirectory && !resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) return '';
    try {
      return fs.statSync(resolvedFile).isFile() ? resolvedFile : '';
    } catch {
      return '';
    }
  }

  function findIconPath(requestedName) {
    const names = candidateNames(requestedName);
    for (const directory of IMAGE_DIRS) {
      for (const filename of names) {
        const filePath = fileInDirectory(directory, filename);
        if (filePath) return filePath;
      }
    }
    return '';
  }

  function contentTypeForIcon(filePath, data) {
    if (Buffer.isBuffer(data)) {
      if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
      if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
      if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
      const head = data.subarray(0, Math.min(100, data.length)).toString('utf8').trimStart().toLowerCase();
      if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml; charset=utf-8';
    }

    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
    if (extension === '.gif') return 'image/gif';
    return 'application/octet-stream';
  }

  function serveIcon(response, requestedPath) {
    const filePath = findIconPath(requestedPath);
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end('Icon not found');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        response.end('Icon not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentTypeForIcon(filePath, data),
        'Cache-Control': 'no-cache',
      });
      response.end(data);
    });
  }

  const TAB_ICON_CSS_MARKER = '/* Runtime tab icon loading fixes */';
  const TAB_ICON_CSS = `
${TAB_ICON_CSS_MARKER}
.tab[data-tab="leveling"],
.tab[data-tab="data"],
.tab[data-tab="tickets"],
.tab[data-tab="moderator"],
.tab[data-tab="messages"] {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center !important;
  gap: 12px !important;
}

.tab[data-tab="leveling"]::before,
.tab[data-tab="data"]::before,
.tab[data-tab="tickets"]::before,
.tab[data-tab="moderator"]::before,
.tab[data-tab="messages"]::before {
  content: none !important;
  display: none !important;
}

.tab[data-tab="leveling"] > img.tab-icon,
.tab[data-tab="data"] > img.tab-icon,
.tab[data-tab="tickets"] > img.tab-icon,
.tab[data-tab="moderator"] > img.tab-icon,
.tab[data-tab="messages"] > img.tab-icon {
  width: 30px !important;
  height: 30px !important;
  max-width: 30px !important;
  max-height: 30px !important;
  flex: 0 0 30px !important;
  box-sizing: border-box !important;
  display: block !important;
  object-fit: contain !important;
  object-position: center !important;
  border: 2px solid var(--tab-icon-border, rgba(120, 150, 190, 0.72)) !important;
  border-radius: 9px !important;
  background: var(--tab-icon-bg, rgba(80, 110, 150, 0.14)) !important;
  padding: 4px !important;
  margin: 0 !important;
  opacity: 1 !important;
  box-shadow: none !important;
  filter: none !important;
  outline: 0 !important;
  transform: none !important;
  clip-path: none !important;
}

.tab-image-icon,
.message-tab-icon {
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

.tab:hover > img.tab-icon,
.tab.active > img.tab-icon {
  transform: none !important;
  box-shadow: none !important;
  filter: none !important;
}

.tab[data-tab="leveling"] {
  --tab-icon-bg: rgba(87, 242, 135, 0.18);
  --tab-icon-border: rgba(87, 242, 135, 0.72);
}

.tab[data-tab="tickets"] {
  --tab-icon-bg: rgba(255, 76, 96, 0.18);
  --tab-icon-border: rgba(255, 76, 96, 0.72);
}

.tab[data-tab="messages"] {
  --tab-icon-bg: rgba(72, 149, 239, 0.20);
  --tab-icon-border: rgba(99, 184, 255, 0.72);
}

.tab[data-tab="data"] {
  --tab-icon-bg: rgba(185, 195, 210, 0.14);
  --tab-icon-border: rgba(205, 215, 230, 0.72);
}

.tab[data-tab="moderator"] {
  --tab-icon-bg: rgba(155, 89, 182, 0.18);
  --tab-icon-border: rgba(188, 120, 255, 0.72);
}

@media (max-width: 700px) {
  .tab[data-tab="leveling"] > img.tab-icon,
  .tab[data-tab="data"] > img.tab-icon,
  .tab[data-tab="tickets"] > img.tab-icon,
  .tab[data-tab="moderator"] > img.tab-icon,
  .tab[data-tab="messages"] > img.tab-icon {
    width: 26px !important;
    height: 26px !important;
    max-width: 26px !important;
    max-height: 26px !important;
    flex-basis: 26px !important;
    padding: 3px !important;
  }
}
`;

  function patchStyle(source) {
    const text = String(source || '');
    if (text.includes(TAB_ICON_CSS_MARKER)) return text;
    return `${text}\n${TAB_ICON_CSS}`;
  }

  function patchAdminApp(source) {
    let text = String(source || '');
    const iconObserverCall = `new ${['Mutation', 'Observer'].join('')}(scheduleUiFixes)`;
    const iconObserverStatement = `${iconObserverCall}.observe(document.body, { childList: true, subtree: true });`;
    text = text.replace(iconObserverStatement, '// Icon auto-check observer removed; tab images are normal <img> elements now.');
    text = text.replace(/\n\s*cleanTabIcons\(\);\n(\s*renderLevelUpRootPreview\(\);)/, '\n$1');
    return text;
  }

  fs.readFile = function coinSpriteRuntimeIconReadFile(filePath, ...args) {
    const callback = args[args.length - 1];
    if (typeof callback !== 'function') return previousReadFile(filePath, ...args);

    const resolvedPath = path.resolve(String(filePath));
    const shouldPatchStyle = resolvedPath === STYLE_PATH;
    const shouldPatchAdminApp = resolvedPath === ADMIN_APP_PATH;
    if (!shouldPatchStyle && !shouldPatchAdminApp) return previousReadFile(filePath, ...args);

    args[args.length - 1] = (error, data) => {
      if (error) return callback(error, data);
      const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const patched = shouldPatchStyle ? patchStyle(source) : patchAdminApp(source);
      return callback(null, Buffer.isBuffer(data) ? Buffer.from(patched, 'utf8') : patched);
    };
    return previousReadFile(filePath, ...args);
  };

  http.createServer = function coinSpriteRuntimeIconCreateServer(listener) {
    return previousCreateServer((request, response) => {
      let pathname;
      try {
        pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
      } catch {
        pathname = request.url || '/';
      }

      for (const prefix of PUBLIC_PREFIXES) {
        if (pathname.startsWith(prefix)) {
          serveIcon(response, pathname.slice(prefix.length));
          return;
        }
      }

      listener(request, response);
    });
  };
}

module.exports = {};
