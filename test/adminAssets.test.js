const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
let server;
let origin;

before(async () => {
  const nativeCreateServer = http.createServer;
  require('../commands/01-message-template-http');
  require('../commands/07-admin-workflow-stability');
  const createAdminServer = http.createServer;
  http.createServer = nativeCreateServer;

  server = createAdminServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('custom tab image assets are served from every public prefix', async () => {
  const icons = [
    ['leveling.png', 'image/png'],
    ['ticket.png', 'image/png'],
    ['data.svg', 'image/svg+xml'],
    ['moderator.svg', 'image/svg+xml'],
    ['message.svg', 'image/svg+xml'],
  ];

  for (const prefix of ['/CoinSprite/images/', '/admin/images/', '/images/']) {
    for (const [filename, contentType] of icons) {
      const response = await fetch(`${origin}${prefix}${filename}?v=test`);
      assert.equal(response.status, 200, `${prefix}${filename}`);
      assert.match(response.headers.get('content-type') || '', new RegExp(`^${contentType.replace('+', '\\+')}`));
      assert.ok((await response.arrayBuffer()).byteLength > 0, `${prefix}${filename}`);
    }
  }
});

test('dashboard selects the committed custom images without an extra frame', () => {
  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const handler = fs.readFileSync(path.join(root, 'commands', '01-message-template-http.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  const adminServer = fs.readFileSync(path.join(root, 'src', 'adminServer.js'), 'utf8');

  assert.match(app, /leveling: '\/admin\/images\/leveling\.png\?v=custom-icons-4'/);
  assert.match(app, /tickets: '\/admin\/images\/ticket\.png\?v=custom-icons-4'/);
  assert.doesNotMatch(handler, /TAB_ICON_FRAME_STYLE|tab-icon-frame/);
  assert.doesNotMatch(index, /tab-icon-frame/);
  assert.match(adminServer, /COINSPRITE_IMAGE_DIR \|\| '\/root\/CoinSprite\/images'/);
  assert.match(adminServer, /'\/images\/', '\/CoinSprite\/images\/', '\/admin\/images\/'/);
});
