const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RAINBOW_COLORS,
  RAINBOW_ROLE_ID,
  RAINBOW_ROLE_INTERVAL_MS,
  createRainbowRoleScheduler,
} = require('../src/rainbowRole');

function createClientWithRole(role) {
  return {
    guilds: {
      cache: new Map([['guild-1', {
        roles: { fetch: async (roleId) => (roleId === RAINBOW_ROLE_ID ? role : null) },
      }]]),
    },
  };
}

test('rainbow role constants use the requested role and five-second interval', () => {
  assert.equal(RAINBOW_ROLE_ID, '1544751586490716220');
  assert.equal(RAINBOW_ROLE_INTERVAL_MS, 5_000);
  assert.deepEqual(RAINBOW_COLORS.map((color) => color.name), [
    'red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet',
  ]);
});

test('scheduler cycles through every rainbow color and wraps around', async () => {
  const changes = [];
  const role = {
    editable: true,
    setColor: async (value, reason) => changes.push({ value, reason }),
  };
  const scheduler = createRainbowRoleScheduler(createClientWithRole(role));

  for (let index = 0; index <= RAINBOW_COLORS.length; index += 1) {
    const result = await scheduler.tick();
    assert.equal(result.updated, true);
  }

  assert.deepEqual(
    changes.map((change) => change.value),
    [...RAINBOW_COLORS, RAINBOW_COLORS[0]].map((color) => color.value),
  );
});

test('scheduler does not overlap slow Discord role edits', async () => {
  let finishFirstUpdate;
  const role = {
    editable: true,
    setColor: () => new Promise((resolve) => { finishFirstUpdate = resolve; }),
  };
  const scheduler = createRainbowRoleScheduler(createClientWithRole(role));

  const firstUpdate = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const secondUpdate = await scheduler.tick();
  assert.deepEqual(secondUpdate, { updated: false, reason: 'busy' });

  finishFirstUpdate();
  assert.equal((await firstUpdate).updated, true);
});

test('start is idempotent and schedules the requested five-second cadence', () => {
  const scheduled = [];
  const scheduler = createRainbowRoleScheduler({ guilds: { cache: new Map() } }, {
    setInterval(callback, intervalMs) {
      scheduled.push({ callback, intervalMs });
      return { id: scheduled.length };
    },
    clearInterval() {},
  });

  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].intervalMs, 5_000);
});

test('an uneditable role is left unchanged and produces a useful log', async () => {
  const logs = [];
  const role = { editable: false, setColor: async () => assert.fail('must not edit role') };
  const scheduler = createRainbowRoleScheduler(createClientWithRole(role), {
    log: (message) => logs.push(message),
  });

  assert.deepEqual(await scheduler.tick(), { updated: false, reason: 'not-editable' });
  assert.match(logs[0], /grant Manage Roles/);
});
