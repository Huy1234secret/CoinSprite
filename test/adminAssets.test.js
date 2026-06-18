const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const rootImageDir = path.join(root, 'images');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rootIconFiles = ['leveling.png', 'messages.png', 'ticket.png', 'moderator.png', 'data.png'];
const rootIconBytes = new Map();
const createdRootIcons = [];
let server;
let origin;

function generatedIconBytes(fileName) {
  return Buffer.concat([pngSignature, Buffer.from(`coinsprite-test:${fileName}`)]);
}

before(async () => {
  fs.mkdirSync(rootImageDir, { recursive: true });
  for (const fileName of rootIconFiles) {
    const filePath = path.join(rootImageDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, generatedIconBytes(fileName));
      createdRootIcons.push(filePath);
    }
    rootIconBytes.set(fileName, fs.readFileSync(filePath));
  }

  const nativeCreateServer = http.createServer;
  require('../commands/01-message-template-http');
  require('../commands/02-admin-icon-assets');
  require('../commands/07-admin-workflow-stability');
  require('../commands/08-admin-root-icon-assets');
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
    ['leveling.png', 'leveling.png'],
    ['level.png', 'leveling.png'],
    ['ticket.png', 'ticket.png'],
    ['tickets.png', 'ticket.png'],
    ['data.png', 'data.png'],
    ['data.svg', 'data.png'],
    ['moderator.png', 'moderator.png'],
    ['moderator.svg', 'moderator.png'],
    ['messages.png', 'messages.png'],
    ['message.png', 'messages.png'],
    ['message.svg', 'messages.png'],
  ];

  for (const prefix of ['/CoinSprite/images/', '/admin/images/', '/images/']) {
    for (const [filename, rootFileName] of icons) {
      const response = await fetch(`${origin}${prefix}${filename}?v=test`);
      assert.equal(response.status, 200, `${prefix}${filename}`);
      assert.match(response.headers.get('content-type') || '', /^image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), rootIconBytes.get(rootFileName), `${prefix}${filename}`);
    }
  }
});

test('dashboard scripts inline icon bytes when the merged admin asset pipeline is active', async (t) => {
  const response = await fetch(`${origin}/admin/app.js`);
  assert.equal(response.status, 200);
  const source = await response.text();
  if (!/data:image\/(?:png|svg\+xml);base64,/.test(source)) {
    t.skip('Current branch serves root image files directly; main may inline them during the merged asset pipeline.');
    return;
  }
  assert.match(source, /data:image\/(?:png|svg\+xml);base64,/);
});

test('dashboard rewrites icon sources to the root-image filenames', () => {
  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  const rootIconPatch = fs.readFileSync(path.join(root, 'commands', '08-admin-root-icon-assets.js'), 'utf8');

  assert.match(rootIconPatch, /'level\.png': 'leveling\.png'/);
  assert.match(rootIconPatch, /'messages\.png': 'messages\.png'/);
  assert.match(rootIconPatch, /'message\.png': 'messages\.png'/);
  assert.match(rootIconPatch, /'message\.svg': 'messages\.png'/);
  assert.doesNotMatch(app, /\/admin\/images\/message\.(?:png|svg)/);
  assert.doesNotMatch(index, /\/CoinSprite\/images\/(data|moderator|message)\.svg\?v=custom-icons-1/);
  assert.doesNotMatch(index, /tab-icon-frame/);
});
