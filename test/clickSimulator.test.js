const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.CLICK_SIMULATOR_SECRET = 'test-click-simulator-secret';

const {
  createClickSimulatorToken,
  verifyClickSimulatorToken,
} = require('../src/clickSimulator/token');
const {
  CRITICAL_CHANCE,
  getClickStats,
  recordClick,
} = require('../src/clickSimulator/store');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('click simulator tokens are signed and tied to a Discord user', () => {
  const token = createClickSimulatorToken({
    userId: '123456789012345678',
    guildId: '234567890123456789',
    issuedAt: 123,
  });
  const payload = verifyClickSimulatorToken(token);
  const tampered = `${token.split('.')[0]}.bad-signature`;

  assert.equal(payload.userId, '123456789012345678');
  assert.equal(payload.guildId, '234567890123456789');
  assert.equal(payload.issuedAt, 123);
  assert.equal(verifyClickSimulatorToken(tampered), null);
});

test('click simulator records normal and critical clicks in a data file', () => {
  const filePath = path.join(__dirname, 'tmp-click-simulator.json');
  fs.rmSync(filePath, { force: true });

  const normal = recordClick('123456789012345678', {
    guildId: '234567890123456789',
    filePath,
    random: () => CRITICAL_CHANCE,
    now: Date.parse('2026-07-12T00:00:00.000Z'),
  });
  const critical = recordClick('123456789012345678', {
    guildId: '234567890123456789',
    filePath,
    random: () => 0,
    now: Date.parse('2026-07-12T00:00:01.000Z'),
  });
  const stats = getClickStats('123456789012345678', { filePath });

  assert.equal(normal.award, 1);
  assert.equal(normal.critical, false);
  assert.equal(critical.award, 10);
  assert.equal(critical.critical, true);
  assert.equal(stats.clicks, 11);
  assert.equal(stats.totalClicks, 2);
  assert.equal(stats.criticalClicks, 1);

  fs.rmSync(filePath, { force: true });
});

test('click simulator command, web assets, API routes, and tracked data file exist', () => {
  const command = source('commands/click-simulator.js');
  const server = source('src/adminServer.js');
  const html = source('click-simulator/index.html');
  const css = source('click-simulator/style.css');
  const app = source('click-simulator/app.js');
  const data = JSON.parse(source('data/click-simulator.json'));
  const gitignore = source('.gitignore');

  assert.match(command, /\.setName\('click-simulator'\)/);
  assert.match(command, /clickSimulatorUrl/);
  assert.match(server, /serveClickSimulatorAsset/);
  assert.match(server, /handleClickSimulatorApi/);
  assert.match(html, /Click Simulator/);
  assert.match(css, /\.click-popup\.critical/);
  assert.match(css, /crit-flash/);
  assert.match(app, /pointerdown/);
  assert.match(app, /\/api\/click-simulator\/click/);
  assert.deepEqual(data, { version: 1, users: {} });
  assert.match(gitignore, /!data\/click-simulator\.json/);
});
