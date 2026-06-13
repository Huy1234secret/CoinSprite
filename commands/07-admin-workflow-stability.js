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
  if (window.__coinSpriteWorkflowObserverGuard) return;
  window.__coinSpriteWorkflowObserverGuard = true;

  const NativeMutationObserver = window.MutationObserver;
  if (typeof NativeMutationObserver !== 'function') return;

  window.MutationObserver = class CoinSpriteMutationObserver {
    constructor(callback) {
      const callbackSource = Function.prototype.toString.call(callback);
      const isWorkflowRenderer = callbackSource.includes('renderWorkflowPanels');

      if (!isWorkflowRenderer) {
        return new NativeMutationObserver(callback);
      }

      let rendering = false;
      let releaseScheduled = false;
      let observer;

      const release = () => {
        rendering = false;
        releaseScheduled = false;
        observer.takeRecords();
      };

      observer = new NativeMutationObserver((records, nativeObserver) => {
        if (rendering) return;

        rendering = true;
        callback(records, nativeObserver);

        if (!releaseScheduled) {
          releaseScheduled = true;
          if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(release);
          } else {
            window.setTimeout(release, 16);
          }
        }
      });

      return observer;
    }
  };
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
  data: { name: 'admin-workflow-stability', description: 'Prevents recursive workflow renders and serves tab icon aliases.' },
  async execute() {},
};
