const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('external stock modules, command, dashboard, and documentation are absent', () => {
  const removedDirectory = path.join(root, 'src', 'gag2Stock');
  assert.deepEqual(fs.existsSync(removedDirectory) ? fs.readdirSync(removedDirectory) : [], []);
  for (const file of [
    'index.js',
    'src/applicationCommands.js',
    'src/adminServer.js',
    'src/serverConfig.js',
    'src/ownerPanelRoutes.js',
    'admin/index.html',
    'admin/app.js',
    'README.md',
    'package.json',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /gag2|stock-set-up|startGag2|handleGag2/i, file);
  }
});

test('global commands stay empty and enabled guilds always include game commands', () => {
  const { GLOBAL_APPLICATION_COMMANDS, featureCommandsForConfig } = require('../src/applicationCommands');
  assert.deepEqual(GLOBAL_APPLICATION_COMMANDS, []);
  assert.match(read('index.js'), /client\.application\.commands\.set\(GLOBAL_APPLICATION_COMMANDS\)/);

  const base = {
    enabled: true,
    features: { leveling: false },
    leveling: { enabled: false },
  };
  assert.deepEqual(featureCommandsForConfig(base).map((command) => command.name), ['cs-balance', 'cs-work', 'cs-inventory']);
  assert.deepEqual(featureCommandsForConfig({
    ...base,
    features: { ...base.features, leveling: true },
    leveling: { enabled: true },
  }).map((command) => command.name), ['cs-balance', 'cs-work', 'cs-inventory', 'level', 'leaderboard', 'level-set', 'xp-add', 'leveling-setup', 'drop-crate']);
});

test('current schema strips obsolete stock and RNG data while preserving retained settings', () => {
  const config = require('../src/serverConfig');
  const guildId = '123456789012345678';
  const state = config.normalizeState({
    meta: {
      schemaVersion: 14,
      disabledGuilds: {
        [guildId]: { reason: 'maintenance', disabledAt: 123, disabledBy: 'owner' },
      },
    },
    guilds: {
      [guildId]: {
        enabled: false,
        features: { gag2Stock: true, leveling: true, rngGame: true },
        channels: { commandLogThread: '223456789012345678' },
        gag2Stock: { enabled: true, channels: { seed: '323456789012345678' }, roleIds: { seed: {} } },
        leveling: { enabled: true, xp: { min: 20, max: 30, cooldownSeconds: 90 } },
        rngGame: { enabled: true, gameChannelIds: ['423456789012345678'] },
      },
    },
  });

  assert.equal(state.meta.schemaVersion, config.SCHEMA_VERSION);
  assert.equal(state.guilds[guildId].enabled, false);
  assert.equal(state.meta.disabledGuilds[guildId].reason, 'maintenance');
  assert.equal(state.guilds[guildId].channels.commandLogThread, '223456789012345678');
  assert.equal(state.guilds[guildId].features.leveling, true);
  assert.equal(state.guilds[guildId].leveling.enabled, true);
  assert.equal(state.guilds[guildId].features.rngGame, undefined);
  assert.equal(state.guilds[guildId].rngGame, undefined);
  assert.equal(state.guilds[guildId].gag2Stock, undefined);
  assert.equal(state.guilds[guildId].features.gag2Stock, undefined);
});

test('dashboard retains leveling controls without RNG or stock navigation and APIs', () => {
  const html = read('admin/index.html');
  const dashboard = read('admin/app.js');
  const server = read('src/adminServer.js');
  assert.match(html, /data-view="leveling"/);
  assert.doesNotMatch(html, /data-view="rng-game"|id="rngGameChannels"|Crop Chances/i);
  assert.match(html, /id="xpDropList"/);
  assert.match(html, /id="xpDropChannel"/);
  assert.match(html, /id="xpDropTestButton"/);
  assert.match(dashboard, /normalizeLevelingConfig/);
  assert.doesNotMatch(dashboard, /normalizeRngGameConfig|renderRngGame/);
  assert.match(dashboard, /sendXpDropTest/);
  assert.match(dashboard, /list_claimed_user/);
  assert.match(dashboard, /data-xp-drop-duration-part/);
  assert.match(server, /xp-drops\\\/test/);
  assert.doesNotMatch(server, /crop-chances|admin\\\/chances|STUDS_TEXTURE_PATH/);
  assert.doesNotMatch(server, /gag2-stock|setup-progress|roleAssignment|roleSpecsForType/i);
});

test('obsolete RNG source, media, and report scripts are absent', () => {
  for (const target of [
    ['src', 'features', 'rng-game'],
    ['images', 'egg_open'],
    ['images', 'roulette'],
    ['images', 'RPS'],
  ]) assert.equal(fs.existsSync(path.join(root, ...target)), false, target.join('/'));
  for (let number = 0; number <= 36; number += 1) {
    assert.equal(fs.existsSync(path.join(root, `${number}.png`)), false, `${number}.png`);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'scripts')), ['generateEmojiData.js']);
});

