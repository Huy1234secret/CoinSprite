const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ADMIN_FONT_PACKAGES,
  ADMIN_FONT_STATUS,
  assertAdminFontsAvailable,
  loadAdminAsset,
  loadAdminFont,
} = require('../src/adminAssets');
const root = path.join(__dirname, '..');

test('admin entrypoint receives content-derived JavaScript, emoji data, and stylesheet versions', () => {
  const index = loadAdminAsset('document');
  const emojiData = loadAdminAsset('emojiData.js');
  const app = loadAdminAsset('app.js');
  const style = loadAdminAsset('style.css');
  const dashboardStyle = loadAdminAsset('dashboard.css');
  assert.ok(index && emojiData && app && style && dashboardStyle);
  const html = index.data.toString('utf8');
  assert.match(html, new RegExp(`/admin/emojiData\\.js\\?v=${emojiData.version}`));
  assert.match(html, new RegExp(`/admin/app\\.js\\?v=${app.version}`));
  assert.match(html, new RegExp(`/admin/style\\.css\\?v=${style.version}`));
  assert.match(html, new RegExp(`/admin/dashboard\\.css\\?v=${dashboardStyle.version}`));
  assert.match(html, /<meta id="emojiDataAsset" data-src="\/admin\/emojiData\.js\?v=[a-f0-9]{16}">/);
  assert.doesNotMatch(html, /<script[^>]+src="\/admin\/emojiData\.js/);
  assert.match(style.data.toString('utf8'), /\.level-card-canvas-wrap[^}]*width:\s*min\(100%,550px\)/);
  assert.doesNotMatch(html, /20260806-9/);
});

test('dashboard accepts a zero-second chat XP cooldown', () => {
  const html = loadAdminAsset('document').data.toString('utf8');
  const app = loadAdminAsset('app.js').data.toString('utf8');
  assert.match(html, /id="levelingCooldown" type="number" min="0" max="3600"/);
  assert.match(app, /clampNumber\(source\.xp\.cooldownSeconds, 0, 3600, 60\)/);
  assert.match(app, /clampNumber\(target\.value, 0, 3600, 60\)/);
});

test('remade dashboard has no HTML source file and retains every main view', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'admin')).filter((name) => name.endsWith('.html')), []);
  assert.equal(loadAdminAsset('index.html'), null);
  const document = loadAdminAsset('document').data.toString('utf8');
  assert.match(document, /One place for your server\./);
  assert.doesNotMatch(document, /product-preview|landing-features|Explore features/);
  for (const view of ['leveling', 'member-messages', 'message-templates', 'reaction-roles', 'games', 'owner']) {
    assert.match(document, new RegExp(`data-view="${view}"`));
    assert.match(document, new RegExp(`data-view-panel="${view}"`));
  }
  for (const emoji of ['🏅', '👋', '📝', '🎭', '🎮', '🛠️']) assert.ok(document.includes(emoji));
  const ids = [...document.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const bindings = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const requiredIds = [...bindings.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(requiredIds.filter((id) => !ids.includes(id)), []);
});

test('shared CoinSprite brand icon is available to the public dashboard', () => {
  const icon = loadAdminAsset('brand-icon.png');
  assert.ok(icon);
  assert.ok(icon.data.length > 1_000);
  assert.match(icon.version, /^[a-f0-9]{16}$/);
  const html = loadAdminAsset('document').data.toString('utf8');
  assert.match(html, /rel="icon" type="image\/png" href="\/admin\/brand-icon\.png"/);
  assert.match(html, /class="brand-mark" aria-hidden="true">🪙/);
  for (const removed of ['chances.html', 'chances.css', 'chances.js']) assert.equal(loadAdminAsset(removed), null);
});

test('stylesheet and bundled font URLs use recursive content hashes', () => {
  const style = loadAdminAsset('style.css').data.toString('utf8');
  const cssMatch = style.match(/\/admin\/fonts\/noto-sans\.css\?v=([a-f0-9]{16})/);
  const unicodeCssMatch = style.match(/\/admin\/fonts\/noto-sans-sc\.css\?v=([a-f0-9]{16})/);
  assert.ok(cssMatch);
  assert.ok(unicodeCssMatch);

  const fontCss = loadAdminFont('/admin/fonts/noto-sans.css');
  assert.equal(fontCss.version, cssMatch[1]);
  const css = fontCss.data.toString('utf8');
  const fileMatch = css.match(/\/admin\/fonts\/files\/([a-z0-9-]+\.woff2)\?v=([a-f0-9]{16})/);
  assert.ok(fileMatch);
  assert.equal(loadAdminFont(`/admin/fonts/files/${fileMatch[1]}`).version, fileMatch[2]);
});

test('browser card fonts expose every bundled normal, bold, and available italic face', () => {
  const style = loadAdminAsset('style.css').data.toString('utf8');
  for (const [key, entry] of Object.entries(ADMIN_FONT_PACKAGES)) {
    assert.match(style, new RegExp(`/admin/fonts/${key}\\.css\\?v=[a-f0-9]{16}`));
    const css = loadAdminFont(`/admin/fonts/${key}.css`).data.toString('utf8');
    assert.match(css, new RegExp(`font-family:\\s*'${entry.family}'`));
    assert.match(css, /font-style:\s*normal/);
    assert.match(css, /font-weight:\s*\d+\s+\d+/);
    if (entry.stylesheets.includes('wght-italic.css')) assert.match(css, /font-style:\s*italic/);
    assert.doesNotMatch(css, /url\([^)]*\.\/files\//);
  }
  assert.match(ADMIN_FONT_STATUS.manifestHash, /^[a-f0-9]{24}$/);
  assert.deepEqual(assertAdminFontsAvailable().families, ADMIN_FONT_STATUS.families);
});

test('browser font validation fails closed and rejects a loaded fallback face', () => {
  const script = `
    const Module = require('module');
    const original = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === '@fontsource-variable/noto-sans/package.json') {
        const error = new Error('simulated missing browser font'); error.code = 'MODULE_NOT_FOUND'; throw error;
      }
      return original.call(this, request, ...rest);
    };
    require('./src/adminAssets');
  `;
  const missing = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Required browser Fontsource package is unavailable: @fontsource-variable\/noto-sans/);

  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  assert.match(app, /normalizedFontFaceFamily\(entry\.family\) === face\.family/);
  assert.match(app, /entry\.status === 'loaded'/);
  assert.match(app, /!exact \|\| !declared \|\| !document\.fonts\.check/);
  assert.match(app, /Required browser font silently fell back/);
});
