const fs = require('fs');
const http = require('http');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const IMAGE_DIR = process.env.ADMIN_IMAGE_DIR || path.join(__dirname, '..', 'images');
const MESSAGE_SCRIPT = path.join(__dirname, '..', 'admin', 'messages.js');
const ICONS = new Map([
  ['/admin/images/leveling.png', path.join(IMAGE_DIR, 'leveling.png')],
  ['/admin/images/ticket.png', path.join(IMAGE_DIR, 'ticket.png')],
  ['/admin/images/message.png', path.join(IMAGE_DIR, 'message.png')],
]);

function serveMessagesScript(res) {
  fs.readFile(MESSAGE_SCRIPT, 'utf8', (error, source) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const patched = source.replace('if (selected().containers.length > 1) selected().containers.splice', 'selected().containers.splice');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(patched);
  });
}

http.createServer = function iconAssetServer(listener) {
  return previousCreateServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === '/admin/messages.js') {
      serveMessagesScript(res);
      return;
    }
    const filePath = ICONS.get(pathname);
    if (!filePath) {
      listener(req, res);
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      res.end(data);
    });
  });
};

module.exports = {};
