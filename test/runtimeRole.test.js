const assert = require('node:assert/strict');
const test = require('node:test');

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

test('missing COINSPRITE_RUNTIME_ROLE throws', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: undefined }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    assert.throws(() => requireSchedulerRole(), /missing or invalid/);
  });
});

test('empty COINSPRITE_RUNTIME_ROLE throws', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    assert.throws(() => requireSchedulerRole(), /missing or invalid/);
  });
});

test('invalid role throws', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'fish' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    assert.throws(() => requireSchedulerRole(), /missing or invalid/);
  });
});

test('invalid role does not become combined', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'fish', NODE_ENV: '' }, () => {
    const { resolveRuntimeRole } = require('../src/runtimeRole');
    assert.equal(resolveRuntimeRole(), null);
  });
});

test('panel role disables scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'panel', NODE_ENV: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.role, 'panel');
    assert.equal(result.schedulerEnabled, false);
  });
});

test('bot role enables scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'bot', NODE_ENV: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.role, 'bot');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('combined role enables scheduler in non-production', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.role, 'combined');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('combined role throws in production', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: 'production' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    assert.throws(() => requireSchedulerRole(), /not allowed in production/);
  });
});

test('combined role throws in staging', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'combined', NODE_ENV: 'staging' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    assert.throws(() => requireSchedulerRole(), /not allowed in production/);
  });
});

test('case insensitive role matching', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'BOT', NODE_ENV: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.role, 'bot');
    assert.equal(result.schedulerEnabled, true);
  });
});

test('role with whitespace is trimmed', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: '  panel  ', NODE_ENV: '' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.role, 'panel');
    assert.equal(result.schedulerEnabled, false);
  });
});

test('exactly one bot runtime starts scheduler', () => {
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'bot', NODE_ENV: 'production' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.schedulerEnabled, true);
  });
  withEnv({ COINSPRITE_RUNTIME_ROLE: 'panel', NODE_ENV: 'production' }, () => {
    const { requireSchedulerRole } = require('../src/runtimeRole');
    const result = requireSchedulerRole();
    assert.equal(result.schedulerEnabled, false);
  });
});
