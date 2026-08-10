const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createRuntimeStarter,
  normalizeRuntimeRole,
  requireSchedulerRole,
  resolveRuntimeRole,
  runtimeCapabilities,
  runtimeDiagnostic,
} = require('../src/runtimeRole');
const { startGag2StockPoster } = require('../src/gag2Stock/manager');

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('missing COINSPRITE_RUNTIME_ROLE falls back to combined', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: undefined }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('empty COINSPRITE_RUNTIME_ROLE falls back to combined', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('invalid role falls back to combined', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'fish' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('invalid role does not become combined in resolveRuntimeRole', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'fish', NODE_ENV: '' }, () => {
    assert.equal(resolveRuntimeRole(), null);
  });
});

test('panel role disables scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'panel', NODE_ENV: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'panel');
    assert.equal(result.schedulerEnabled, false);
  });
});

test('bot role enables scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'bot', NODE_ENV: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'bot');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('combined role enables scheduler in non-production', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('combined role falls back with warning in production', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: 'production' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
  });
});

test('combined role falls back with warning in staging', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: 'staging' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
  });
});

test('case insensitive role matching', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'BOT', NODE_ENV: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'bot');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('role with whitespace is trimmed', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: '  panel  ', NODE_ENV: '' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.role, 'panel');
    assert.equal(result.schedulerEnabled, false);
  });
});

test('exactly one bot runtime starts scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'bot', NODE_ENV: 'production' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.schedulerEnabled, true);
  });
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'panel', NODE_ENV: 'production' }, () => {
    const result = requireSchedulerRole();
    assert.equal(result.schedulerEnabled, false);
  });
});

test('runtime roles expose only their intended operational capabilities', () => {
  assert.deepEqual(runtimeCapabilities('bot'), {
    role: 'bot', bot: true, panel: false, stockPoster: true,
  });
  assert.deepEqual(runtimeCapabilities('panel'), {
    role: 'panel', bot: false, panel: true, stockPoster: false,
  });
  assert.deepEqual(runtimeCapabilities('combined'), {
    role: 'combined', bot: true, panel: true, stockPoster: true,
  });
});

test('runtime starter is idempotent and keeps panel and bot initializers isolated', async () => {
  const counts = { common: 0, bot: 0, panel: 0 };
  const initializers = {
    common: () => { counts.common += 1; },
    bot: () => { counts.bot += 1; },
    panel: () => { counts.panel += 1; },
  };

  const panel = createRuntimeStarter('panel', initializers);
  await panel.start();
  await panel.start();
  assert.deepEqual(counts, { common: 1, bot: 0, panel: 1 });

  const bot = createRuntimeStarter('bot', initializers);
  await bot.start();
  assert.deepEqual(counts, { common: 2, bot: 1, panel: 1 });
});

test('one bot plus two panel runtimes starts one operational scheduler owner', async () => {
  let operationalStarts = 0;
  const starters = ['bot', 'panel', 'panel'].map((role) => createRuntimeStarter(role, {
    bot: () => { operationalStarts += 1; },
  }));

  await Promise.all(starters.map((starter) => starter.start()));
  assert.equal(operationalStarts, 1);
});

test('stock poster fails closed when called from a panel runtime', async () => {
  const logs = [];
  const result = await startGag2StockPoster({}, {
    runtimeRole: 'panel',
    logSystem: (line) => logs.push(line),
  });
  assert.equal(result, null);
  assert.match(logs[0], /refused to start in panel runtime/i);
});

test('deployment scripts use explicit runtime entrypoints', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['deploy:bot'], 'node src/entrypoints/bot.js');
  assert.equal(pkg.scripts['deploy:panel'], 'node src/entrypoints/panel.js');
  assert.equal(pkg.scripts.start, 'node src/entrypoints/combined.js');

  for (const role of ['bot', 'panel', 'combined']) {
    const source = fs.readFileSync(path.join(root, 'src', 'entrypoints', `${role}.js`), 'utf8');
    assert.match(source, new RegExp(`COINSPRITE_RUNTIME_ROLE = '${role}'`));
  }
});

test('runtime diagnostics identify topology without including credentials', () => {
  const line = runtimeDiagnostic('panel', { shard: { ids: [0] } });
  assert.match(line, /role=panel/);
  assert.match(line, /stockPoster=disabled/);
  assert.match(line, /shard=0/);
  assert.doesNotMatch(line, /token|secret|password/i);
});
