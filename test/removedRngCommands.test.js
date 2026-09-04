const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { createRngGameFeature, RNG_GAME_COMMANDS } = require('../src/features/rng-game');
const { WORK_COMMANDS } = require('../src/features/work');

const REMOVED_SLASH_COMMANDS = [
  'roll', 'inventory', 'sell', 'balance', 'auto-roll', 'upgrade', 'index', 'stat',
  'shop', 'use', 'exchange-token', 'g-rps', 'g-roulette', 'g-work',
];
const REMOVED_PREFIX_COMMANDS = [
  'c!roll', 'c!inventory', 'c!sell', 'c!balance', 'c!auto roll', 'c!auto-roll',
  'c!upgrade', 'c!index', 'c!stat', 'c!shop', 'c!use Common Egg',
];

test('removed RNG, economy, casino, and work commands are not exported or registered', () => {
  assert.deepEqual(RNG_GAME_COMMANDS, []);
  assert.deepEqual(WORK_COMMANDS, []);
  const config = {
    enabled: true,
    features: { leveling: false, rngGame: true },
    leveling: { enabled: false },
    rngGame: { enabled: true },
  };
  const registered = featureCommandsForConfig(config).map((command) => command.name);
  for (const command of REMOVED_SLASH_COMMANDS) assert.equal(registered.includes(command), false, command);
});

test('removed slash and prefix command inputs are ignored without replies or state changes', async () => {
  const game = createRngGameFeature({ databasePath: ':memory:' });
  let replies = 0;
  for (const commandName of REMOVED_SLASH_COMMANDS) {
    const handled = await game.handleInteraction({
      commandName,
      customId: '',
      isChatInputCommand: () => true,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      user: { id: `slash-${commandName}` },
      reply: async () => { replies += 1; },
    });
    assert.equal(handled, false, commandName);
  }
  for (const content of REMOVED_PREFIX_COMMANDS) {
    const handled = await game.handleMessage({
      content,
      author: { id: `prefix-${content}`, bot: false },
      reply: async () => { replies += 1; },
    });
    assert.equal(handled, false, content);
  }
  assert.equal(replies, 0);
  assert.equal(game.db.prepare('SELECT COUNT(*) AS count FROM rng_players').get().count, 0n);
  game.close();
});

test('removed command implementations and documentation are absent', () => {
  const root = path.join(__dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'src/features/rng-game/commands/index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/features/work/commands.js')), false);
  const documented = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const runtime = [
    'src/features/rng-game/index.js',
    'src/features/rng-game/components/builders.js',
    'src/features/rng-game/components/rpsHandler.js',
    'src/features/work/index.js',
    'src/features/work/components/handler.js',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  for (const command of [...REMOVED_PREFIX_COMMANDS, ...REMOVED_SLASH_COMMANDS.map((name) => `/${name}`)]) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const commandPattern = new RegExp(`${escaped}(?![\\w-])`);
    assert.equal(commandPattern.test(documented), false, `README: ${command}`);
    assert.equal(commandPattern.test(runtime), false, `runtime: ${command}`);
  }
});
