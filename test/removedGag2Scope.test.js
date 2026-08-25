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

test('global command synchronization sends an empty list and guild commands remain feature-scoped', () => {
  const { GLOBAL_APPLICATION_COMMANDS, featureCommandsForConfig } = require('../src/applicationCommands');
  assert.deepEqual(GLOBAL_APPLICATION_COMMANDS, []);
  assert.match(read('index.js'), /client\.application\.commands\.set\(GLOBAL_APPLICATION_COMMANDS\)/);

  const base = {
    enabled: true,
    features: { leveling: false, rngGame: false },
    leveling: { enabled: false },
    rngGame: { enabled: false },
  };
  assert.deepEqual(featureCommandsForConfig(base), []);
  assert.deepEqual(featureCommandsForConfig({
    ...base,
    features: { ...base.features, leveling: true },
    leveling: { enabled: true },
  }).map((command) => command.name), ['level', 'leaderboard', 'level-set', 'xp-add', 'leveling-setup']);
  assert.ok(featureCommandsForConfig({
    ...base,
    features: { ...base.features, rngGame: true },
    rngGame: { enabled: true },
  }).some((command) => command.name === 'shop'));
});

test('schema 15 strips obsolete stock data while preserving unrelated settings', () => {
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

  assert.equal(state.meta.schemaVersion, 15);
  assert.equal(state.guilds[guildId].enabled, false);
  assert.equal(state.meta.disabledGuilds[guildId].reason, 'maintenance');
  assert.equal(state.guilds[guildId].channels.commandLogThread, '223456789012345678');
  assert.equal(state.guilds[guildId].features.leveling, true);
  assert.equal(state.guilds[guildId].leveling.enabled, true);
  assert.equal(state.guilds[guildId].features.rngGame, true);
  assert.equal(state.guilds[guildId].rngGame.enabled, true);
  assert.equal(state.guilds[guildId].gag2Stock, undefined);
  assert.equal(state.guilds[guildId].features.gag2Stock, undefined);
});

test('dashboard retains leveling and RNG controls without stock navigation or APIs', () => {
  const html = read('admin/index.html');
  const dashboard = read('admin/app.js');
  const server = read('src/adminServer.js');
  assert.match(html, /data-view="leveling"/);
  assert.match(html, /data-view="rng-game"/);
  assert.match(html, /id="rngGameChannels" multiple/);
  assert.match(dashboard, /normalizeLevelingConfig/);
  assert.match(dashboard, /normalizeRngGameConfig/);
  assert.doesNotMatch(server, /gag2-stock|setup-progress|roleAssignment|roleSpecsForType/i);
});

test('shop and RNG economy remain reachable after external stock removal', () => {
  const commandSource = read('src/features/rng-game/commands/index.js');
  const featureSource = read('src/features/rng-game/index.js');
  const shopSource = read('src/features/rng-game/services/shopService.js');
  assert.match(commandSource, /setName\('shop'\)/);
  assert.match(featureSource, /shopService/);
  assert.match(shopSource, /restock/i);
});
