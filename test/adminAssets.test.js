const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const rootImageDir = path.join(root, 'images');
const rootIconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rootIconFiles = ['leveling.png', 'messages.png', 'ticket.png', 'moderator.png', 'data.png'];
const createdRootIcons = [];
let server;
let origin;

before(async () => {
  fs.mkdirSync(rootImageDir, { recursive: true });
  for (const fileName of rootIconFiles) {
    const filePath = path.join(rootImageDir, fileName);
    if (fs.existsSync(filePath)) continue;
    fs.writeFileSync(filePath, rootIconBytes);
    createdRootIcons.push(filePath);
  }

  const nativeCreateServer = http.createServer;
  require('../commands/08-admin-root-icon-assets');
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
  for (const filePath of createdRootIcons) fs.rmSync(filePath, { force: true });
});

test('custom tab image assets are served from /root/CoinSprite/images on every public prefix', async () => {
  const icons = [
    'leveling.png',
    'ticket.png',
    'data.png',
    'moderator.png',
    'messages.png',
  ];

  for (const prefix of ['/CoinSprite/images/', '/admin/images/', '/images/']) {
    for (const filename of icons) {
      const response = await fetch(`${origin}${prefix}${filename}?v=test`);
      assert.equal(response.status, 200, `${prefix}${filename}`);
      assert.match(response.headers.get('content-type') || '', /^image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), rootIconBytes, `${prefix}${filename}`);
    }
  }
});

test('dashboard rewrites icon sources to the committed root-image filenames', () => {
  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

  assert.match(app, /leveling: '\/CoinSprite\/images\/leveling\.png\?v=custom-icons-1'/);
  assert.match(app, /tickets: '\/CoinSprite\/images\/ticket\.png\?v=custom-icons-1'/);
  assert.match(app, /data: '\/CoinSprite\/images\/data\.png\?v=custom-icons-1'/);
  assert.match(app, /moderator: '\/CoinSprite\/images\/moderator\.png\?v=custom-icons-1'/);
  assert.match(app, /messages: '\/CoinSprite\/images\/messages\.png\?v=custom-icons-1'/);
  assert.doesNotMatch(index, /\/CoinSprite\/images\/(data|moderator|message)\.svg\?v=custom-icons-1/);
});
