const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const {
  AuthoritativeLevelCardError,
  levelCardRenderKey,
  renderPublishedLevelCard,
} = require('../src/leveling');
const {
  CANVAS_FONT_STATUS,
  levelCardRendererIdentity,
} = require('../src/canvasFonts');

const fixture = path.join(__dirname, '..', 'testSupport', 'levelCardRendererProcess.js');
const secret = 'cross-process-render-secret';
const user = { id: '823456789012345678', username: 'CrossProcess', displayName: 'Nguyễn 世界' };
const stats = { level: 12, rank: 3, progressXp: 280, neededXp: 420, progressRatio: 2 / 3, xp: 3160 };

function startRenderer(mode, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(fixture, [], {
      env: { ...process.env, LEVEL_CARD_TEST_MODE: mode, LEVEL_CARD_TEST_SECRET: secret, ...environment },
      silent: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Renderer fixture timed out: ${stderr}`));
    }, 15_000);
    child.once('error', reject);
    child.on('message', (message) => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      resolve({
        ...message,
        child,
        close: () => new Promise((done) => {
          child.once('exit', done);
          child.send('close');
        }),
      });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code && mode !== 'missing-font') reject(new Error(`Renderer fixture exited ${code}: ${stderr}`));
    });
  });
}

function internalBody() {
  return JSON.stringify({
    user: { username: user.username, globalName: '', displayName: user.displayName, avatarUrl: '' },
    stats,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function differingPixels(left, right) {
  const [leftImage, rightImage] = await Promise.all([loadImage(left), loadImage(right)]);
  assert.deepEqual({ width: leftImage.width, height: leftImage.height }, { width: 1000, height: 320 });
  assert.deepEqual({ width: rightImage.width, height: rightImage.height }, { width: 1000, height: 320 });
  const canvas = createCanvas(1000, 320);
  const context = canvas.getContext('2d');
  context.drawImage(leftImage, 0, 0);
  const leftPixels = context.getImageData(0, 0, 1000, 320).data;
  context.clearRect(0, 0, 1000, 320);
  context.drawImage(rightImage, 0, 0);
  const rightPixels = context.getImageData(0, 0, 1000, 320).data;
  let count = 0;
  for (let offset = 0; offset < leftPixels.length; offset += 4) {
    if (leftPixels[offset] !== rightPixels[offset]
      || leftPixels[offset + 1] !== rightPixels[offset + 1]
      || leftPixels[offset + 2] !== rightPixels[offset + 2]
      || leftPixels[offset + 3] !== rightPixels[offset + 3]) count += 1;
  }
  return count;
}

function signedSession(sessionSecret, sessionUser, csrfToken) {
  const raw = 'level-card-parity-session';
  const signature = crypto.createHmac('sha256', sessionSecret).update(raw).digest('base64url');
  const id = `${raw}.${signature}`;
  return {
    id,
    body: {
      sessions: {
        [id]: {
          createdAt: Date.now(), expiresAt: Date.now() + 60_000,
          csrfToken, oauthState: null, user: sessionUser,
        },
      },
    },
  };
}

async function internalRender(origin, identity, renderKey, renderUser, renderStats) {
  return fetch(`${origin}/api/internal/level-card/${renderUser.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CoinSprite-Render-Key': renderKey,
      'X-CoinSprite-Renderer-Version': identity.version,
      'X-CoinSprite-Build-Version': identity.buildVersion,
      'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
    },
    body: JSON.stringify({ user: renderUser, stats: renderStats }),
  });
}

test('the primary saved web preview receives the authoritative PNG', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin', 'app.js'), 'utf8');
  assert.match(html, /id="levelCardCanvas"[^>]+Authoritative server-rendered level card preview/);
  assert.match(html, /id="levelCardDraftCanvas"[^>]+hidden/);
  assert.doesNotMatch(html, /levelCardExactCanvas|cardExactWrap/);
  assert.match(app, /cardAuthoritativeCanvas: \$\('#levelCardCanvas'\)/);
  assert.match(app, /const context = elements\.cardAuthoritativeCanvas\.getContext\('2d'\)/);
  assert.match(app, /context\.drawImage\(image, 0, 0\)/);
  assert.match(app, /showAuthoritativeCardPreview\(draft\)/);
});

test('bot receives the exact PNG bytes from a separately started authoritative renderer', async () => {
  const renderer = await startRenderer('authoritative');
  const identity = levelCardRendererIdentity();
  const key = levelCardRenderKey(secret);
  try {
    const mismatchResponse = await fetch(`${renderer.origin}/api/internal/level-card/${user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinSprite-Render-Key': key,
        'X-CoinSprite-Renderer-Version': `${identity.version}-old-bot`,
        'X-CoinSprite-Build-Version': identity.buildVersion,
        'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
      },
      body: internalBody(),
    });
    assert.equal(mismatchResponse.status, 409);
    assert.equal(mismatchResponse.headers.get('x-coinsprite-renderer-version'), identity.version);
    assert.equal(mismatchResponse.headers.get('x-coinsprite-build-version'), identity.buildVersion);
    assert.equal(mismatchResponse.headers.get('x-coinsprite-font-manifest'), identity.fontManifestHash);

    const directResponse = await fetch(`${renderer.origin}/api/internal/level-card/${user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinSprite-Render-Key': key,
        'X-CoinSprite-Renderer-Version': identity.version,
        'X-CoinSprite-Build-Version': identity.buildVersion,
        'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
      },
      body: internalBody(),
    });
    assert.equal(directResponse.status, 200);
    const authoritativeBytes = Buffer.from(await directResponse.arrayBuffer());
    const logs = [];
    const publishedBytes = await renderPublishedLevelCard(user, stats, {
      origin: renderer.origin,
      key,
      log: (message) => logs.push(message),
    });
    assert.deepEqual(publishedBytes, authoritativeBytes);
    assert.equal(renderer.identity.version, identity.version);
    assert.equal(renderer.identity.fontManifestHash, identity.fontManifestHash);
    assert.ok(logs.some((line) => line.includes(`Authoritative level card used: user=${user.id} source=authoritative renderer=${identity.version} build=${identity.buildVersion} font-manifest=${identity.fontManifestHash}`)));
  } finally {
    await renderer.close();
  }
});

test('saved web preview and /level use one authoritative design and are pixel-identical', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-level-card-'));
  const sessionSecret = 'level-card-session-secret';
  const csrfToken = 'level-card-csrf-token';
  const sessionUser = {
    id: '923456789012345678', username: 'RawUsername', globalName: 'Canonical Global', avatar: null,
  };
  const session = signedSession(sessionSecret, sessionUser, csrfToken);
  const sessionPath = path.join(temporary, 'sessions.json');
  const levelingPath = path.join(temporary, 'leveling.json');
  fs.writeFileSync(sessionPath, JSON.stringify(session.body));
  const renderer = await startRenderer('authoritative', {
    ADMIN_SESSION_STORE_PATH: sessionPath,
    LEVELING_DATA_PATH: levelingPath,
    LEVEL_CARD_TEST_SESSION_SECRET: sessionSecret,
  });
  const identity = levelCardRendererIdentity();
  const renderKey = levelCardRenderKey(secret);
  const cookie = `coinsprite_admin=${session.id}`;
  const renderUser = {
    id: sessionUser.id,
    username: sessionUser.username,
    globalName: sessionUser.globalName,
    displayName: 'Guild Nickname',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
  const renderStats = { level: 0, rank: 1, xp: 0, progressXp: 0, neededXp: 100, progressRatio: 0 };
  const distinctiveDesign = {
    avatar: { visible: false },
    username: { x: 47, y: 219, size: 57, fontFamily: 'mono', bold: false, italic: true, color: '#fefefe' },
    level: { visible: false }, rank: { visible: false }, xp: { visible: false }, progress: { visible: false },
    panelOpacity: 0,
  };

  const save = async (design) => {
    const response = await fetch(`${renderer.origin}/api/profile/card`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ design }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const webPreview = async (designHash, design) => fetch(`${renderer.origin}/api/profile/card/preview`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ designHash, design, draft: Boolean(design) }),
  });

  try {
    const firstSaved = await save(distinctiveDesign);
    const profileResponse = await fetch(`${renderer.origin}/api/profile/card`, { headers: { Cookie: cookie } });
    assert.equal(profileResponse.status, 200);
    assert.equal((await profileResponse.json()).preview.username, sessionUser.globalName);
    assert.deepEqual(firstSaved.design.username, {
      x: 47, y: 219, size: 57, color: '#fefefe', visible: true, rotation: 0,
      fontFamily: 'mono', bold: false, italic: true, underline: false,
    });
    assert.match(firstSaved.designHash, /^[a-f0-9]{64}$/);
    assert.ok(firstSaved.updatedAt > 0);
    const persisted = JSON.parse(fs.readFileSync(levelingPath, 'utf8')).profiles[sessionUser.id];
    assert.equal(persisted.designHash, firstSaved.designHash);
    assert.equal(persisted.updatedAt, firstSaved.updatedAt);

    const firstWebResponse = await webPreview(firstSaved.designHash);
    const firstInternalResponse = await internalRender(renderer.origin, identity, renderKey, renderUser, renderStats);
    assert.equal(firstWebResponse.status, 200);
    assert.equal(firstInternalResponse.status, 200);
    assert.equal(firstWebResponse.headers.get('x-coinsprite-design-hash'), firstSaved.designHash);
    assert.equal(firstInternalResponse.headers.get('x-coinsprite-design-hash'), firstSaved.designHash);
    assert.equal(firstInternalResponse.headers.get('x-coinsprite-build-version'), identity.buildVersion);
    assert.equal(firstInternalResponse.headers.get('x-coinsprite-render-source'), 'authoritative');
    const firstWebPng = Buffer.from(await firstWebResponse.arrayBuffer());
    const firstInternalPng = Buffer.from(await firstInternalResponse.arrayBuffer());
    assert.equal(firstSaved.designHash, 'c82cd7da39c8019368e27765bd481c5a18c7723d63085f87f9111895bf955b7d');
    assert.equal(sha256(firstWebPng), sha256(firstInternalPng));
    assert.equal(await differingPixels(firstWebPng, firstInternalPng), 0);

    const unsavedDraft = { ...distinctiveDesign, username: { ...distinctiveDesign.username, fontFamily: 'handwriting', bold: true, italic: false } };
    const draftWebResponse = await webPreview(firstSaved.designHash, unsavedDraft);
    const draftDiscordResponse = await internalRender(renderer.origin, identity, renderKey, renderUser, renderStats);
    const draftWebPng = Buffer.from(await draftWebResponse.arrayBuffer());
    const draftDiscordPng = Buffer.from(await draftDiscordResponse.arrayBuffer());
    assert.equal(draftWebResponse.headers.get('x-coinsprite-render-source'), 'authoritative-draft');
    assert.notEqual(sha256(draftWebPng), sha256(firstWebPng));
    assert.equal(sha256(draftDiscordPng), sha256(firstInternalPng));

    const secondSaved = await save(unsavedDraft);
    assert.notEqual(secondSaved.designHash, firstSaved.designHash);
    const staleResponse = await webPreview(firstSaved.designHash);
    assert.equal(staleResponse.status, 409);
    assert.equal(staleResponse.headers.get('x-coinsprite-design-hash'), secondSaved.designHash);

    const secondWebResponse = await webPreview(secondSaved.designHash);
    const secondWebPng = Buffer.from(await secondWebResponse.arrayBuffer());
    let publishedMetadata;
    const secondDiscordPng = await renderPublishedLevelCard({
      id: renderUser.id, username: renderUser.username, globalName: renderUser.globalName, displayName: renderUser.displayName,
    }, renderStats, {
      origin: renderer.origin,
      key: renderKey,
      onMetadata: (metadata) => { publishedMetadata = metadata; },
      log: () => {},
    });
    assert.equal(publishedMetadata.designHash, secondSaved.designHash);
    assert.equal(publishedMetadata.source, 'authoritative');
    assert.equal(secondSaved.designHash, '98d4092161d2ad171cbf4b15b7f7709a0233e2e13289adc1620208dc4296461f');
    assert.equal(sha256(secondWebPng), sha256(secondDiscordPng));
    assert.notEqual(sha256(secondDiscordPng), sha256(firstInternalPng));
    assert.equal(await differingPixels(secondWebPng, secondDiscordPng), 0);
  } finally {
    await renderer.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('renderer identity mismatch is visible and rejects the panel PNG', async () => {
  const renderer = await startRenderer('version-mismatch');
  const logs = [];
  try {
    await assert.rejects(
      () => renderPublishedLevelCard(user, stats, {
        origin: renderer.origin,
        key: levelCardRenderKey(secret),
        log: (message) => logs.push(message),
      }),
      (error) => error instanceof AuthoritativeLevelCardError && error.reason === 'renderer-version-mismatch',
    );
    assert.ok(logs.some((line) => line.includes('renderer-version-mismatch')));
  } finally {
    await renderer.close();
  }
});

test('failed authoritative request cannot silently produce a local different-font card', async () => {
  const renderer = await startRenderer('unavailable');
  const logs = [];
  try {
    await assert.rejects(
      () => renderPublishedLevelCard(user, stats, {
        origin: renderer.origin,
        key: levelCardRenderKey(secret),
        log: (message) => logs.push(message),
      }),
      (error) => error instanceof AuthoritativeLevelCardError && error.reason === 'http-503',
    );
    assert.ok(logs.some((line) => line.includes('status=503')));
    assert.ok(logs.some((line) => line.includes('reason=http-503')));
    assert.equal(logs.some((line) => line.includes('using local renderer')), false);
  } finally {
    await renderer.close();
  }
});

test('missing required Fontsource package fails a separate renderer process clearly', async () => {
  const result = await new Promise((resolve) => {
    const child = fork(fixture, [], {
      env: { ...process.env, LEVEL_CARD_TEST_MODE: 'missing-font' },
      silent: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => resolve({ code, stderr }));
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Level card font registration failed/);
  assert.match(result.stderr, /family="CoinSprite Index Sans" package="@fontsource-variable\/noto-sans" file="noto-sans-latin-wght-normal\.woff2"/);
  assert.match(result.stderr, /simulated missing required Fontsource package/);
  assert.match(result.stderr, /Required font dependency is not installed; run "npm ci" in this deployment before starting CoinSprite/);
});

test('font manifest, lockfile, and deployment scripts require identical bundled dependencies', () => {
  const requiredPackages = [
    'caveat', 'noto-sans', 'noto-sans-sc', 'noto-serif', 'nunito', 'oswald', 'roboto-mono',
  ].map((name) => `node_modules/@fontsource-variable/${name}`);
  const lockfile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  for (const packagePath of requiredPackages) assert.equal(lockfile.packages[packagePath].version, '5.3.0');
  assert.equal(lockfile.packages['node_modules/@napi-rs/canvas'].version, '1.0.3');
  assert.equal(CANVAS_FONT_STATUS.files, 164);
  assert.match(CANVAS_FONT_STATUS.manifestHash, /^[a-f0-9]{24}$/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['predeploy:bot'], 'npm ci');
  assert.equal(packageJson.scripts['predeploy:panel'], 'npm ci');
});
