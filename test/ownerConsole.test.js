const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getOwnerConsoleEntries,
  logCommandSystem,
  logCommandUse,
} = require('../src/commandLogger');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('owner console buffers bot logs with hh:mm:ss timestamps and levels', () => {
  fs.rmSync(path.join(__dirname, '..', 'logs'), { recursive: true, force: true });
  const before = getOwnerConsoleEntries({ limit: 1 }).latestId;

  logCommandSystem('Registered test console command');
  logCommandUse({
    userId: '123456789012345678',
    command: '/stock-set-up',
    channelId: '234567890123456789',
  });

  const entries = getOwnerConsoleEntries({ after: before, limit: 10 }).entries;
  assert.equal(entries.length, 2);
  assert.match(entries[0].time, /^\[\d{2}:\d{2}:\d{2}\]$/);
  assert.equal(entries[0].source, 'system');
  assert.equal(entries[0].level, 'ok');
  assert.equal(entries[1].source, 'command');
  assert.equal(entries[1].level, 'command');
  assert.match(entries[1].message, /executed command \/stock-set-up/);

  fs.rmSync(path.join(__dirname, '..', 'logs'), { recursive: true, force: true });
});

test('owner panel exposes owner-only console API and UI', () => {
  const server = source('src/adminServer.js');
  const ownerRoutes = source('src/ownerPanelRoutes.js');
  const ownerPanel = source('admin/owner-panel.js');
  const ownerCss = source('admin/owner-panel.css');

  assert.match(server, /\/api\/owner\/console/);
  assert.match(server, /requireOwner\(req, res, env, client\)/);
  assert.match(ownerRoutes, /handleOwnerConsole/);
  assert.match(ownerRoutes, /getOwnerConsoleEntries/);
  assert.match(ownerPanel, /data-owner-view="console"/);
  assert.match(ownerPanel, /Bot console/);
  assert.match(ownerPanel, /\[hh:mm:ss\]/);
  assert.match(ownerPanel, /setInterval\(pollOwnerConsole, 2000\)/);
  assert.match(ownerCss, /\.owner-console-output/);
  assert.match(ownerCss, /\.owner-console-line\.level-error/);
  assert.match(ownerCss, /\.owner-console-line\.level-warn/);
});

test('command logger keeps Discord BOT LOG thread posting disabled by default', () => {
  const logger = source('src/commandLogger.js');
  assert.match(logger, /COINSPRITE_DISCORD_THREAD_LOGS/);
  assert.match(logger, /if \(DISCORD_THREAD_LOGGING_ENABLED\) void postLogToThread/);
});
