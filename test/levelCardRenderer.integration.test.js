const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

function startRenderer(mode) {
  return new Promise((resolve, reject) => {
    const child = fork(fixture, [], {
      env: { ...process.env, LEVEL_CARD_TEST_MODE: mode, LEVEL_CARD_TEST_SECRET: secret },
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
        'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
      },
      body: internalBody(),
    });
    assert.equal(mismatchResponse.status, 409);
    assert.equal(mismatchResponse.headers.get('x-coinsprite-renderer-version'), identity.version);
    assert.equal(mismatchResponse.headers.get('x-coinsprite-font-manifest'), identity.fontManifestHash);

    const directResponse = await fetch(`${renderer.origin}/api/internal/level-card/${user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinSprite-Render-Key': key,
        'X-CoinSprite-Renderer-Version': identity.version,
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
    assert.ok(logs.some((line) => line.includes(`Authoritative level card used: user=${user.id} renderer=${identity.version} font-manifest=${identity.fontManifestHash}`)));
  } finally {
    await renderer.close();
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
  assert.match(result.stderr, /family="Noto Sans Variable" package="@fontsource-variable\/noto-sans" file="package.json"/);
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
