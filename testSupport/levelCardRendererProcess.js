const http = require('http');

const mode = process.env.LEVEL_CARD_TEST_MODE || 'authoritative';

if (mode === 'missing-font') {
  const Module = require('module');
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function missingRequiredFont(request, ...args) {
    if (request === '@fontsource-variable/noto-sans/package.json') {
      const error = new Error('simulated missing required Fontsource package');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return resolveFilename.call(this, request, ...args);
  };
  require('../src/canvasFonts');
  process.exitCode = 2;
} else {
  const { levelCardRendererIdentity } = require('../src/canvasFonts');
  const identity = levelCardRendererIdentity();
  let handler;
  if (mode === 'authoritative') {
    const { createAdminRequestHandler } = require('../src/adminServer');
    handler = createAdminRequestHandler({ renderSecret: process.env.LEVEL_CARD_TEST_SECRET }, { user: null });
  } else {
    handler = (req, res) => {
      const rendererVersion = mode === 'version-mismatch' ? `${identity.version}-different` : identity.version;
      const status = mode === 'unavailable' ? 503 : 200;
      const body = status === 200
        ? Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fixture')])
        : Buffer.from('temporarily unavailable');
      res.writeHead(status, {
        'Content-Type': status === 200 ? 'image/png' : 'text/plain',
        'Content-Length': body.length,
        'X-CoinSprite-Renderer-Version': rendererVersion,
        'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
      });
      res.end(body);
    };
  }

  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => {
    process.send?.({
      type: 'ready',
      origin: `http://127.0.0.1:${server.address().port}`,
      identity,
    });
  });
  process.on('message', (message) => {
    if (message === 'close') server.close(() => process.exit(0));
  });
}
