'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COMPONENTS_V2_FLAG,
  buildLevelUpPayload,
  sanitizeLevelUpMessage,
} = (() => {
  const module = require('../src/levelUpMessage');
  return { ...module, COMPONENTS_V2_FLAG: 32768 };
})();

const context = {
  mention: '<@234567890123456789>',
  username: 'member',
  display_name: 'Member',
  level: 10,
  previous_level: 9,
  server: 'CoinSprite',
  channel: '<#345678901234567890>',
  channel_id: '345678901234567890',
  user_id: '234567890123456789',
  avatar_url: 'https://cdn.example/avatar.png',
};

test('legacy level-up settings become the first editable container', () => {
  const config = sanitizeLevelUpMessage({
    enabled: true,
    content: 'Legacy message',
    accentColor: '#57f287',
    thumbnailUrl: '<avatar_url>',
    imageUrl: '',
  });
  assert.equal(config.containers.length, 1);
  assert.equal(config.containers[0].text, 'Legacy message');
  assert.equal(config.content, 'Legacy message');
});

test('level-up payload preserves outside text and multiple containers', () => {
  const payload = buildLevelUpPayload({
    enabled: true,
    outsideContent: 'Congratulations <@mention>',
    containers: [
      { id: 'first', text: '## Level <level>', accentColor: '#57F287', thumbnailUrl: '<avatar_url>', imageUrl: '' },
      { id: 'second', text: 'Second container', accentColor: '#5865F2', thumbnailUrl: '', imageUrl: 'https://cdn.example/banner.png' },
    ],
  }, context);

  assert.equal(payload.flags, COMPONENTS_V2_FLAG);
  assert.equal(payload.components[0].type, 10);
  assert.match(payload.components[0].content, /Congratulations/);
  const containers = payload.components.filter((component) => component.type === 17);
  assert.equal(containers.length, 2);
  assert.equal(containers[0].accent_color, 0x57F287);
  assert.equal(containers[1].accent_color, 0x5865F2);
  assert.equal(containers[1].components.at(-1).type, 12);
});

test('all containers may be removed while retaining outside message text', () => {
  const config = sanitizeLevelUpMessage({ enabled: true, outsideContent: 'Outside only', containers: [] });
  assert.deepEqual(config.containers, []);
  const payload = buildLevelUpPayload(config, context);
  assert.deepEqual(payload.components, [{ type: 10, content: 'Outside only' }]);
});
