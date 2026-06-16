const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessagePayload, formatPlaceholders, sanitizeTemplate } = require('../src/messageTemplates');

test('sanitizes message component rows within Discord limits', () => {
  const template = sanitizeTemplate({
    id: 'welcome',
    componentRows: [{
      type: 'buttons',
      buttons: Array.from({ length: 8 }, (_, index) => ({ label: `Button ${index + 1}`, response: 'OK' })),
    }, {
      type: 'select',
      minValues: 9,
      maxValues: 99,
      options: [{ label: 'One', response: 'First' }, { label: 'Two', response: 'Second' }],
    }],
  });

  assert.equal(template.componentRows[0].buttons.length, 5);
  assert.equal(template.componentRows[1].minValues, 2);
  assert.equal(template.componentRows[1].maxValues, 2);
});

test('expands guild, channel, and user placeholders', () => {
  const context = {
    guild: { id: '100', name: 'CoinSprite', memberCount: 42 },
    channel: { id: '200', name: 'general' },
    user: { id: '300', username: 'sprite', globalName: 'Sprite User' },
  };
  assert.equal(
    formatPlaceholders('<guild-name> <channel> <@mention> <display-name> <member-count>', context),
    'CoinSprite <#200> <@300> Sprite User 42',
  );
});

test('builds Components V2 buttons and selection panels', () => {
  const payload = buildMessagePayload({
    id: 'welcome',
    content: 'Hello <@mention> in <guild-name>',
    containers: [],
    componentRows: [{
      id: 'links',
      type: 'buttons',
      buttons: [
        { id: 'rules', label: 'Rules', style: 'link', url: 'https://example.com/rules' },
        { id: 'hello', label: 'Say hello', style: 'primary', response: 'Hello!' },
      ],
    }, {
      id: 'roles',
      type: 'select',
      placeholder: 'Choose a role',
      options: [{ id: 'red', label: 'Red', response: 'Red selected' }],
    }],
  }, {
    guild: { id: '100', name: 'CoinSprite' },
    channel: { id: '200', name: 'general' },
    user: { id: '300', username: 'sprite' },
  });

  assert.equal(payload.flags, 32768);
  assert.equal(payload.components[0].content, 'Hello <@300> in CoinSprite');
  assert.equal(payload.components[1].components[0].style, 5);
  assert.equal(payload.components[1].components[1].custom_id, 'message-template:welcome:links-hello');
  assert.equal(payload.components[2].components[0].type, 3);
  assert.deepEqual(payload.allowedMentions.users, ['300']);
});

test('preserves component actions while sanitizing message templates', () => {
  const template = sanitizeTemplate({
    id: 'action-panel',
    containers: [],
    componentRows: [{
      id: 'row',
      type: 'buttons',
      buttons: [{
        id: 'open',
        label: 'Open',
        style: 'primary',
        actions: [
          { type: 'send_message', templateId: 'Follow Up!' },
          { type: 'give_role', roleId: '123456789012345678', reverse: 'true' },
        ],
      }],
    }, {
      id: 'select',
      type: 'select',
      options: [{ id: 'legacy', label: 'Legacy', response: 'Legacy response' }],
    }],
  });

  assert.deepEqual(template.componentRows[0].buttons[0].actions, [
    { type: 'send_message', templateId: 'follow-up' },
    { type: 'give_role', roleId: '123456789012345678', reverse: true },
  ]);
  assert.deepEqual(template.componentRows[1].options[0].actions, [
    { type: 'legacy_response', response: 'Legacy response' },
  ]);
});
