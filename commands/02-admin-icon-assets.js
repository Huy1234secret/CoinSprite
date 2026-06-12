const fs = require('fs');
const http = require('http');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const ICONS = new Map([
  ['/admin/images/leveling.png', path.join(__dirname, '..', 'admin', 'leveling.png')],
  ['/admin/images/ticket.png', path.join(__dirname, '..', 'admin', 'ticket.png')],
]);

http.createServer = function iconAssetServer(listener) {
  return previousCreateServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
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
