const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('moderator dashboard uses two workspaces, server pagination, and list/detail cases', () => {
  const script = source('admin/moderator.js');
  assert.match(script, /Auto Moderation/);
  assert.match(script, /Warn System/);
  assert.match(script, /renderCaseDetail/);
  assert.match(script, /casePagination/);
  assert.match(script, /openPardonModal/);
  assert.doesNotMatch(script, /window\.(?:alert|prompt|confirm)/);
});

test('unsaved-change flow uses an accessible modal instead of browser confirm', () => {
  const script = source('admin/app.js');
  assert.match(script, /aria-modal/);
  assert.match(script, /Discard unsaved changes/);
  assert.doesNotMatch(script, /window\.confirm/);
});

test('server config migrations preserve guilds and expose centralized logging routes', () => {
  const script = source('src/serverConfig.js');
  assert.match(script, /SCHEMA_VERSION = 3/);
  assert.match(script, /resolveLoggingChannelId/);
  assert.match(script, /backupFileOnce/);
  assert.doesNotMatch(script, /resetNonPrimaryGuilds/);
});

test('cases API exposes profile hydration and pagination metadata', () => {
  const script = source('src/adminServer.js');
  assert.match(script, /hydrateCaseProfiles/);
  assert.match(script, /queryCases/);
  assert.match(script, /pagination: result\.pagination/);
});
