const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

let server;
let origin;

before(async () => {
  const nativeCreateServer = http.createServer;
  require('../commands/01-message-template-http');
  require('../commands/09-admin-tab-icon-images');
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

test('admin tab icons are served from their public URLs', async () => {
  const icons = [
    ['/CoinSprite/images/leveling.png', 'image/png'],
    ['/CoinSprite/images/ticket.png', 'image/png'],
    ['/CoinSprite/images/data.svg', 'image/svg+xml'],
    ['/CoinSprite/images/moderator.svg', 'image/svg+xml'],
    ['/CoinSprite/images/message.svg', 'image/svg+xml'],
    ['/admin/images/leveling.png', 'image/png'],
    ['/admin/images/ticket.png', 'image/png'],
    ['/admin/images/data.svg', 'image/svg+xml'],
    ['/admin/images/moderator.svg', 'image/svg+xml'],
    ['/admin/images/message.svg', 'image/svg+xml'],
  ];

  for (const [pathname, contentType] of icons) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type') || '', new RegExp(`^${contentType.replace('+', '\\+')}`));
    assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
  }
});

test('admin document uses an external bootstrap and no inline scripts', async () => {
  const response = await fetch(`${origin}/admin`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<script src="\/admin\/bootstrap\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});
