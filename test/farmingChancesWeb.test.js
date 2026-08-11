const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-farming-chances-'));
const sessionPath = path.join(temporary, 'sessions.json');
const sessionSecret = 'farming-chances-test-secret';
const rawSessionId = 'signed-farming-chances-session';
const signature = crypto.createHmac('sha256', sessionSecret).update(rawSessionId).digest('base64url');
const sessionId = `${rawSessionId}.${signature}`;
fs.writeFileSync(sessionPath, JSON.stringify({
  sessions: {
    [sessionId]: {
      createdAt: Date.now(), expiresAt: Date.now() + 60_000, csrfToken: 'farming-chance-csrf',
      oauthState: null,
      user: { id: 'signed-farmer', username: 'farmer', globalName: 'Signed Farmer', avatar: null },
    },
  },
}));
process.env.ADMIN_SESSION_STORE_PATH = sessionPath;

const { createAdminRequestHandler, safeOAuthReturnTo } = require('../src/adminServer');

function startServer(repository) {
  const client = { guilds: { cache: new Map(), fetch: async () => null }, user: { displayAvatarURL: () => null } };
  const env = {
    clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    sessionSecret, cookieSecure: false, publicOrigin: '',
  };
  const farmingService = {
    profile: (userId) => repository.ensureProfile(userId),
  };
  const server = http.createServer(createAdminRequestHandler(env, client, {
    farmingGame: { repository, farmingService },
  }));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
  }));
}

test('Farming chance API requires sign-in, uses only the session user, and never mutates preview state', async (t) => {
  const calls = [];
  const profile = { luckTier: 7, bigCropTier: 3, balance: 44n };
  const repository = {
    ensureProfile(userId) { calls.push(['profile', userId]); return { ...profile }; },
    cropStatistics(userId, cropId) {
      calls.push(['stats', userId, cropId]);
      return { totalPlanted: 0n, totalHarvested: 0n, highestWeightUnits: 0 };
    },
  };
  const { server, origin } = await startServer(repository);
  t.after(() => server.close());

  const unsigned = await fetch(`${origin}/api/profile/farming-crop-chances?luck=999`);
  assert.equal(unsigned.status, 401);
  assert.deepEqual(calls, []);

  const signed = await fetch(`${origin}/api/profile/farming-crop-chances?luck=999999999999999999999&userId=another-user`, {
    headers: { Cookie: `coinsprite_admin=${encodeURIComponent(sessionId)}` },
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get('cache-control'), 'no-store');
  const payload = await signed.json();
  assert.equal(payload.currentMultiplier, '8');
  assert.equal(payload.previewMultiplier, '999999999999999999999');
  assert.equal(payload.visibleTotal, 1);
  assert.deepEqual(Object.keys(payload.crops[0]).sort(), ['artworkUrl', 'discovered', 'slot']);
  assert.doesNotMatch(JSON.stringify(payload), /Carrot|Common|another-user|chanceNumerator|crop_id/);
  assert.ok(calls.every((call) => call[1] === 'signed-farmer'));
  assert.deepEqual(profile, { luckTier: 7, bigCropTier: 3, balance: 44n });

  for (const invalid of ['0', '-1', '1.5', '1e9', 'abc']) {
    const response = await fetch(`${origin}/api/profile/farming-crop-chances?luck=${encodeURIComponent(invalid)}`, {
      headers: { Cookie: `coinsprite_admin=${encodeURIComponent(sessionId)}` },
    });
    assert.equal(response.status, 400, invalid);
  }
});

test('/farm-chances serves compact responsive assets and reuses the existing studs texture', async (t) => {
  const repository = {
    ensureProfile: () => ({ luckTier: 0, bigCropTier: 0, balance: 0n }),
    cropStatistics: () => ({ totalPlanted: 0n, totalHarvested: 0n, highestWeightUnits: 0 }),
  };
  const { server, origin } = await startServer(repository);
  t.after(() => server.close());
  const page = await fetch(`${origin}/farm-chances`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Farming Crop Chances/);
  assert.match(html, /Preview only/i);
  assert.ok(html.includes('/admin/farm-chances.css?v='));
  assert.ok(html.includes('/admin/farm-chances.js?v='));
  assert.match(html, /returnTo=%2Ffarm-chances/);

  const css = await (await fetch(`${origin}/admin/farm-chances.css`)).text();
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /position: fixed/);
  assert.match(css, /padding-bottom: 190px/);
  assert.match(css, /studs-texture\.png/);
  assert.match(css, /\.farm-card-details[^}]+background: #12161d/);
  const script = await (await fetch(`${origin}/admin/farm-chances.js`)).text();
  assert.match(script, /BigInt/);
  assert.match(script, /AbortController/);
  assert.doesNotMatch(script, /Number\(.*luck|parseInt\(.*luck/i);
  const studs = await fetch(`${origin}/assets/rng/studs-texture.png`);
  assert.equal(studs.status, 200);
  assert.equal(Buffer.from(await studs.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('OAuth return paths include the separated Farming chance page', () => {
  assert.equal(safeOAuthReturnTo('/farm-chances'), '/farm-chances');
  assert.equal(safeOAuthReturnTo('https://evil.example/farm-chances'), '/admin');
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
