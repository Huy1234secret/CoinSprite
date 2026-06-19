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
  require('../commands/02-admin-icon-assets');
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
    try { fs.rmdirSync(runtimeImagesDir); } catch {}
  }
});

test('custom tab image assets are served from every public prefix', async () => {
  const icons = ['leveling.png', 'ticket.png', 'data.svg', 'moderator.svg', 'message.svg', 'messages.png'];
  for (const prefix of ['/CoinSprite/images/', '/admin/images/', '/images/']) {
    for (const filename of icons) {
      const response = await fetch(`${origin}${prefix}${filename}?v=test`);
      assert.equal(response.status, 200, `${prefix}${filename}`);
      assert.ok((response.headers.get('content-type') || '').startsWith('image/'), `${prefix}${filename}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.byteLength > 0, `${prefix}${filename}`);
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${prefix}${filename} PNG signature`);
    }
  }
});

test('image routes stream original files without patched fs.readFile', () => {
  const iconAssets = fs.readFileSync(path.join(root, 'commands', '02-admin-icon-assets.js'), 'utf8');
  const adminServer = fs.readFileSync(path.join(root, 'src', 'adminServer.js'), 'utf8');
  assert.match(iconAssets, /fs\.createReadStream\(icon\.file\)/);
  assert.match(adminServer, /fs\.createReadStream\(runtimePath\)/);
});

test('primary admin asset layer owns the CoinSprite image prefix', () => {
  const iconAssets = fs.readFileSync(path.join(root, 'commands', '02-admin-icon-assets.js'), 'utf8');
  assert.match(iconAssets, /'\/CoinSprite\/images\/'/);
  assert.match(iconAssets, /path\.join\(IMAGE_DIR, fileName\)/);
});

test('admin HTML keeps direct CoinSprite image URLs', async () => {
  const response = await fetch(`${origin}/admin`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /src="\/CoinSprite\/images\/leveling\.png/);
  assert.match(html, /src="\/CoinSprite\/images\/data\.png/);
  assert.match(html, /src="\/CoinSprite\/images\/ticket\.png/);
  assert.doesNotMatch(html, /CoinSpritedata:image/);
});

test('icon assets are not rewritten into data URLs', () => {
  const iconAssets = fs.readFileSync(path.join(root, 'commands', '02-admin-icon-assets.js'), 'utf8');
  const adminServer = fs.readFileSync(path.join(root, 'src', 'adminServer.js'), 'utf8');
  assert.doesNotMatch(iconAssets, /inlineIconUrls|data:image\/png;base64/);
  assert.doesNotMatch(adminServer, /inlineRuntimeIconUrls|data:image\/png;base64/);
});

test('tab images use exact repository file paths without custom query suffixes', () => {
  const sources = [
    'admin/index.html',
    'admin/app.js',
    'admin/user-data.js',
    'admin/moderator.js',
    'admin/messages.js',
    'admin/message-inline-editor.js',
    'commands/01-message-template-http.js',
    'commands/02-admin-icon-assets.js',
  ];
  for (const relativePath of sources) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /\?v=custom-icons-/i, relativePath);
  }
});

test('bootstrap displays image-backed tab icons instead of placeholder squares', () => {
  const bootstrap = fs.readFileSync(path.join(root, 'admin', 'bootstrap.js'), 'utf8');
  assert.match(bootstrap, /coinSpriteTabImageStyle/);
  assert.match(bootstrap, /data-tab="moderator"/);
  assert.match(bootstrap, /> img\.tab-icon/);
  assert.match(bootstrap, /display:\s*block !important/);
  assert.doesNotMatch(bootstrap, /display:\s*none !important/);
  assert.doesNotMatch(bootstrap, /background-image:\s*var\(--tab-icon-image\)/);
  assert.match(bootstrap, /object-fit:\s*contain !important/);
  assert.match(bootstrap, /rgba\(188, 120, 255, 0\.72\)/);
});

test('sidebar icons use CoinSprite images while branding uses the bot profile', () => {
  const iconSources = [
    'admin/index.html',
    'admin/app.js',
    'admin/user-data.js',
    'admin/moderator.js',
    'admin/message-inline-editor.js',
  ];
  for (const relativePath of iconSources) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /\/admin\/images\//, relativePath);
    assert.match(source, /\/CoinSprite\/images\//, relativePath);
  }
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  assert.match(index, /<link rel="icon" type="image\/png" href="\/bot-avatar\.png">/);
  assert.match(index, /<img class="brand-mark" src="\/bot-avatar\.png"/);
  const style = fs.readFileSync(path.join(root, 'admin', 'style.css'), 'utf8');
  assert.match(style, /\.brand-mark\s*\{[^}]*background:\s*transparent !important/s);
});

test('old runtime icon patch stays disabled', () => {
  const runtimeIcons = fs.readFileSync(path.join(root, 'commands', '00-admin-runtime-icons.js'), 'utf8');
  assert.doesNotMatch(runtimeIcons, /MutationObserver|scheduleUiFixes|repairTabIcons|ensureModeratorSymbolSquare/);
});
