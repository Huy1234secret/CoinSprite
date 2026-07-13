const assert = require('node:assert/strict');
const test = require('node:test');

const { roleSpecsForType } = require('../src/gag2Stock/catalog');
const {
  buildCategoryRolePayload,
  buildRoleAssignmentPanelPayload,
} = require('../src/gag2Stock/roleAssignment');

function idForIndex(index) {
  return String(100000000000000000n + BigInt(index));
}

function configFor(options = {}) {
  return {
    gag2Stock: {
      channels: {
        seed: options.seedChannel || '',
        gear: options.gearChannel || '',
        crate: options.crateChannel || '',
        weather: options.weatherChannel || '',
        moon: options.moonChannel || '',
        sell: options.sellChannel || '',
        roleAssign: options.roleAssignChannel || '',
      },
      roleIds: options.roleIds || {},
    },
  };
}

function roleIdsForType(type) {
  return Object.fromEntries(roleSpecsForType(type).map((spec, index) => [spec.key, idForIndex(index + 1)]));
}

function fakeGuildWithRoles(roleIds) {
  const roles = new Map(Object.values(roleIds).map((roleId) => [roleId, { id: roleId }]));
  return {
    roles: {
      cache: roles,
      fetch: async () => roles,
    },
  };
}

function fakeMemberWithRoles(roleIds) {
  return {
    roles: {
      cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
    },
  };
}

test('GAG2 role assignment panel shows five category buttons and skips moon prediction', () => {
  const payload = buildRoleAssignmentPanelPayload(configFor({
    seedChannel: '123456789012345678',
    sellChannel: '223456789012345678',
    roleAssignChannel: '323456789012345678',
  }));

  assert.equal(payload.flags, 32768);
  assert.deepEqual(payload.allowedMentions.roles, []);
  assert.match(payload.components[0].components[0].content, /## Role assignment/);

  const buttons = payload.components[0].components.find((component) => component.type === 1).components;
  assert.deepEqual(buttons.map((button) => button.label), ['Seed', 'Gear', 'Crate', 'Weather', 'Sell price']);
  assert.ok(buttons.every((button) => !button.custom_id.includes('moon')));
  assert.equal(buttons.find((button) => button.label === 'Seed').disabled, false);
  assert.equal(buttons.find((button) => button.label === 'Gear').disabled, true);
  assert.equal(buttons.find((button) => button.label === 'Sell price').disabled, false);
});

test('GAG2 category role payload lists assigned roles and splits large role lists into multiple selects', async () => {
  const roleIds = roleIdsForType('seed');
  const firstRoleId = roleIds.carrot;
  const payload = await buildCategoryRolePayload(
    fakeGuildWithRoles(roleIds),
    fakeMemberWithRoles([firstRoleId]),
    configFor({
      seedChannel: '123456789012345678',
      roleAssignChannel: '323456789012345678',
      roleIds: { seed: roleIds },
    }),
    'seed',
    { ephemeral: true },
  );

  const container = payload.components[0];
  const selectRows = container.components.filter((component) => component.type === 1);
  const firstSelect = selectRows[0].components[0];
  const secondSelect = selectRows[1].components[0];

  assert.equal(payload.flags, 32768 | 64);
  assert.deepEqual(payload.allowedMentions.roles, []);
  assert.equal(container.accent_color, 0x57f287);
  assert.equal(container.components[0].type, 9);
  assert.match(container.components[0].components[0].content, /## Seed roles/);
  assert.match(container.components[0].components[0].content, new RegExp(`<@&${firstRoleId}>`));
  assert.equal(selectRows.length, 2);
  assert.equal(firstSelect.placeholder, 'Select roles (1/2)');
  assert.equal(firstSelect.options.length, 25);
  assert.equal(secondSelect.options.length, 6);
  assert.deepEqual(firstSelect.options[0].emoji, {
    id: '1525195196864925817',
    name: 'carrot',
    animated: false,
  });
  assert.equal(firstSelect.options[0].description, undefined);
});

test('GAG2 sell price role assignment only lists multiplier roles', async () => {
  const roleIds = roleIdsForType('sell');
  const payload = await buildCategoryRolePayload(
    fakeGuildWithRoles(roleIds),
    fakeMemberWithRoles([roleIds.common_2x]),
    configFor({
      sellChannel: '223456789012345678',
      roleAssignChannel: '323456789012345678',
      roleIds: { sell: roleIds },
    }),
    'sell',
    { ephemeral: true },
  );

  const selectRows = payload.components[0].components.filter((component) => component.type === 1);
  const options = selectRows.flatMap((row) => row.components[0].options);

  assert.equal(selectRows.length, 1);
  assert.match(payload.components[0].components[0].accessory.media.url, /1525368044824825976/);
  assert.equal(options.length, 16);
  assert.ok(options.some((option) => option.label === 'Common 2x'));
  assert.ok(options.some((option) => option.label === 'Super 4x'));
  assert.ok(options.some((option) => option.label === 'Secret 2x'));
  assert.ok(options.some((option) => option.label === 'Secret 4x'));
  assert.ok(options.every((option) => option.label.endsWith('2x') || option.label.endsWith('4x')));
  assert.equal(options.find((option) => option.label === 'Moon Bloom'), undefined);
});
