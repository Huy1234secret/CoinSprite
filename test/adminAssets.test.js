const assert = require('node:assert/strict');
const test = require('node:test');

const { loadAdminAsset, loadAdminFont } = require('../src/adminAssets');

test('admin entrypoint receives content-derived JavaScript and stylesheet versions', () => {
  const index = loadAdminAsset('index.html');
  const app = loadAdminAsset('app.js');
  const style = loadAdminAsset('style.css');
  assert.ok(index && app && style);
  const html = index.data.toString('utf8');
  assert.match(html, new RegExp(`/admin/app\\.js\\?v=${app.version}`));
  assert.match(html, new RegExp(`/admin/style\\.css\\?v=${style.version}`));
  assert.match(style.data.toString('utf8'), /\.level-card-canvas-wrap[^}]*width:\s*min\(100%,550px\)/);
  assert.doesNotMatch(html, /20260806-9/);
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
