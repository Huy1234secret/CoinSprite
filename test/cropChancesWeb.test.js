const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-chances-'));
const sessionPath = path.join(temporary, 'sessions.json');
const sessionSecret = 'crop-chances-test-secret';
const rawSessionId = 'signed-crop-chances-session';
const signature = crypto.createHmac('sha256', sessionSecret).update(rawSessionId).digest('base64url');
const sessionId = `${rawSessionId}.${signature}`;
fs.writeFileSync(sessionPath, JSON.stringify({
  sessions: {
    [sessionId]: {
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      csrfToken: 'chance-csrf',
      oauthState: null,
      user: { id: 'signed-user', username: 'signed', globalName: 'Signed User', avatar: null },
    },
  },
}));
process.env.ADMIN_SESSION_STORE_PATH = sessionPath;

const { createAdminRequestHandler, safeOAuthReturnTo } = require('../src/adminServer');

function startServer(repository) {
  const client = {
    guilds: { cache: new Map(), fetch: async () => null },
    user: { displayAvatarURL: () => null },
  };
  const env = {
    clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    sessionSecret, cookieSecure: false, publicOrigin: '',
  };
  const server = http.createServer(createAdminRequestHandler(env, client, { rngRepository: repository }));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
  }));
}

test('crop chances endpoint requires sign-in and always reads the session user', async (t) => {
  const calls = [];
  const repository = {
    getPlayer(userId) { calls.push(['player', userId]); return { luckTier: 4 }; },
    discoveries(userId) {
      calls.push(['discoveries', userId]);
      return [{ seedId: 'eclipse_bloom' }, { seedId: 'star_fruit' }];
    },
  };
  const { server, origin } = await startServer(repository);
  t.after(() => server.close());

  const unsigned = await fetch(`${origin}/api/profile/crop-chances`);
  assert.equal(unsigned.status, 401);
  assert.deepEqual(await unsigned.json(), { error: 'Not logged in.' });
  assert.deepEqual(calls, []);

  const signed = await fetch(`${origin}/api/profile/crop-chances?userId=another-user`, {
    headers: { Cookie: `coinsprite_admin=${encodeURIComponent(sessionId)}` },
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get('cache-control'), 'no-store');
  const payload = await signed.json();
  assert.equal(payload.luckTier, 4);
  assert.equal(payload.discoveredCount, 1);
  assert.equal(payload.visibleTotal, 32);
  assert.doesNotMatch(JSON.stringify(payload), /Eclipse Bloom|eclipse_bloom|Secret|another-user/);
  assert.deepEqual(calls, [['player', 'signed-user'], ['discoveries', 'signed-user']]);
});

test('/chances and its dedicated static assets are served with the existing studs file', async (t) => {
  const repository = { getPlayer: () => ({ luckTier: 0 }), discoveries: () => [] };
  const { server, origin } = await startServer(repository);
  t.after(() => server.close());
  const page = await fetch(`${origin}/chances`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control'), /no-store/);
  const html = await page.text();
  assert.match(html, /Your Crop Chances/);
  assert.match(html, /\/admin\/chances\.css\?v=/);
  assert.match(html, /\/admin\/chances\.js\?v=/);
  assert.match(html, /\/auth\/discord\?returnTo=%2Fchances/);

  for (const asset of ['/admin/chances.css', '/admin/chances.js']) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, asset);
  }
  const studs = await fetch(`${origin}/assets/rng/studs-texture.png`);
  assert.equal(studs.status, 200);
  assert.equal(studs.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await studs.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('OAuth return paths are restricted to signed-in CoinSprite pages', () => {
  assert.equal(safeOAuthReturnTo('/chances'), '/chances');
  assert.equal(safeOAuthReturnTo('/profile'), '/profile');
  assert.equal(safeOAuthReturnTo('https://evil.example/chances'), '/admin');
  assert.equal(safeOAuthReturnTo('//evil.example'), '/admin');
});

test.after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});
