const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const runtimeImagesDir = path.join(root, 'images');
const runtimeIconFiles = ['leveling.png', 'ticket.png', 'data.png', 'moderator.png', 'message.png'];
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
let server;
let origin;
let createdRuntimeDir = false;
const createdRuntimeFiles = [];

function ensureRuntimeImageFixtures() {
  if (!fs.existsSync(runtimeImagesDir)) {
    fs.mkdirSync(runtimeImagesDir, { recursive: true });
    createdRuntimeDir = true;
  }

  for (const fileName of runtimeIconFiles) {
    const filePath = path.join(runtimeImagesDir, fileName);
    if (fs.existsSync(filePath)) continue;
    fs.writeFileSync(filePath, transparentPng);
    createdRuntimeFiles.push(filePath);
  }
}

before(async () => {
  const nativeCreateServer = http.createServer;
  ensureRuntimeImageFixtures();
  require('../commands/00-admin-runtime-icons');
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
  for (const filePath of createdRuntimeFiles) fs.rmSync(filePath, { force: true });
  if (createdRuntimeDir) {
    try {
      fs.rmdirSync(runtimeImagesDir);
    } catch {}
  }
});

test('custom tab image assets are served from every public prefix', async () => {
  const icons = [
    ['leveling.png', 'image/png'],
    ['ticket.png', 'image/png'],
    ['data.svg', 'image/png'],
    ['moderator.svg', 'image/png'],
    ['message.svg', 'image/png'],
    ['messages.png', 'image/png'],
  ];

  for (const prefix of ['/CoinSprite/images/', '/admin/images/', '/images/']) {
    for (const [filename, contentType] of icons) {
      const response = await fetch(`${origin}${prefix}${filename}?v=test`);
      assert.equal(response.status, 200, `${prefix}${filename}`);
      assert.ok((response.headers.get('content-type') || '').startsWith(contentType), `${prefix}${filename}`);
      assert.ok((await response.arrayBuffer()).byteLength > 0, `${prefix}${filename}`);
    }
  }
});

test('dashboard scripts inline icon bytes instead of requiring browser image requests', async () => {
  const response = await fetch(`${origin}/admin/app.js`);
  assert.equal(response.status, 200);
  const source = await response.text();
  assert.match(source, /data:image\/(?:png|svg\+xml);base64,/);
});

test('dashboard style replaces broken tab images with stable symbols', async () => {
  const response = await fetch(`${origin}/admin/style.css`);
  assert.equal(response.status, 200);
  const source = await response.text();
  assert.match(source, /Runtime tab icon loading fixes/);
  assert.match(source, /\.tab\[data-tab="moderator"\]::before/);
  assert.match(source, /content:\s*var\(--tab-icon-symbol/);
  assert.match(source, /> img\.tab-icon/);
  assert.match(source, /display:\s*none !important/);
  assert.match(source, /--tab-icon-symbol:\s*"🛡"/);
  assert.match(source, /\.tab\[data-tab="moderator"\]::before\s*{[^}]*content:\s*"🛡"/s);
  assert.match(source, /rgba\(188, 120, 255, 0\.72\)/);
  assert.doesNotMatch(source, /content:\s*none !important/);
});

test('dashboard keeps runtime image handlers but renders symbol tab icons', () => {
  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const handler = fs.readFileSync(path.join(root, 'commands', '01-message-template-http.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  const adminServer = fs.readFileSync(path.join(root, 'src', 'adminServer.js'), 'utf8');
  const runtimeIcons = fs.readFileSync(path.join(root, 'commands', '00-admin-runtime-icons.js'), 'utf8');

  assert.match(app, /leveling: '\/admin\/images\/leveling\.png\?v=custom-icons-4'/);
  assert.match(app, /tickets: '\/admin\/images\/ticket\.png\?v=custom-icons-4'/);
  assert.doesNotMatch(handler, /TAB_ICON_FRAME_STYLE|tab-icon-frame/);
  assert.doesNotMatch(index, /tab-icon-frame/);
  assert.match(adminServer, /path\.join\(__dirname, '\.\.', 'images'\)/);
  assert.match(adminServer, /'\/images\/', '\/CoinSprite\/images\/', '\/admin\/images\/'/);
  assert.match(runtimeIcons, /path\.join\(ROOT_DIR, 'images'\)/);
  assert.match(runtimeIcons, /path\.join\(ROOT_DIR, 'image'\)/);
  assert.match(runtimeIcons, /--tab-icon-symbol: "★"/);
  assert.match(runtimeIcons, /--tab-icon-symbol: "🛡"/);
  assert.match(runtimeIcons, /> img\.tab-icon/);
  assert.doesNotMatch(runtimeIcons, /content: none !important/);
});

test('tab icon fixes stay in the main runtime file without browser icon watchers', () => {
  const runtimeIcons = fs.readFileSync(path.join(root, 'commands', '00-admin-runtime-icons.js'), 'utf8');
  assert.equal(fs.existsSync(path.join(root, 'commands', '08-admin-root-icon-assets.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'commands', '09-admin-moderator-symbol-square.js')), false);
  assert.doesNotMatch(runtimeIcons, /MutationObserver|repairTabIcons|ensureModeratorSymbolSquare/);
});
