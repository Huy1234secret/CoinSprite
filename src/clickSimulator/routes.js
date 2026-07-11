const fs = require('fs');
const path = require('path');
const { getClickStats, recordClick } = require('./store');
const { verifyClickSimulatorToken } = require('./token');

const CLICK_SIMULATOR_DIR = path.join(__dirname, '..', '..', 'click-simulator');

function contentTypeFor(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function tokenFromRequest(req, url, body = null) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(body?.token || url.searchParams.get('token') || '').trim();
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveClickSimulatorAsset(req, res, url) {
  let assetPath = url.pathname === '/click-simulator' || url.pathname === '/click-simulator/'
    ? 'index.html'
    : url.pathname.slice('/click-simulator/'.length);
  try {
    assetPath = decodeURIComponent(assetPath || 'index.html');
  } catch {
    sendText(res, 400, 'Bad request');
    return true;
  }

  const normalized = path.normalize(assetPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(CLICK_SIMULATOR_DIR, normalized);
  const root = path.resolve(CLICK_SIMULATOR_DIR);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    sendText(res, 404, 'Not found');
    return true;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) return sendText(res, 404, 'Not found');
    sendText(res, 200, data, {
      'Content-Type': contentTypeFor(resolved),
      'Cache-Control': resolved.endsWith('.html') || resolved.endsWith('.js') || resolved.endsWith('.css')
        ? 'no-store'
        : 'public, max-age=300',
    });
  });
  return true;
}

async function handleClickSimulatorApi(req, res, url, deps) {
  if (req.method === 'GET' && url.pathname === '/api/click-simulator/me') {
    const payload = verifyClickSimulatorToken(tokenFromRequest(req, url));
    if (!payload) return deps.sendJson(res, 401, { error: 'Invalid click simulator link.' });
    return deps.sendJson(res, 200, {
      userId: payload.userId,
      guildId: payload.guildId,
      stats: getClickStats(payload.userId, { guildId: payload.guildId }),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/click-simulator/click') {
    const body = await deps.readJsonBody(req);
    const payload = verifyClickSimulatorToken(tokenFromRequest(req, url, body));
    if (!payload) return deps.sendJson(res, 401, { error: 'Invalid click simulator link.' });
    const stats = recordClick(payload.userId, { guildId: payload.guildId });
    return deps.sendJson(res, 200, {
      userId: payload.userId,
      guildId: payload.guildId,
      stats,
    });
  }

  return false;
}

module.exports = {
  CLICK_SIMULATOR_DIR,
  handleClickSimulatorApi,
  serveClickSimulatorAsset,
};
