'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildTicketMessagePayload, sanitizeTicketMessage } = require('../src/ticketConfig');

test('ticket messages preserve one root line and multiple removable containers', () => {
  const message = sanitizeTicketMessage({
    outsideContent: 'Outside <server>',
    containers: [
      { id: 'first', text: 'First <ticket_name>', accentColor: '#112233', thumbnailUrl: '', imageUrl: '' },
      { id: 'second', text: 'Second container', accentColor: '#445566', thumbnailUrl: '', imageUrl: '' },
    ],
  });

  assert.equal(message.outsideContent, 'Outside <server>');
  assert.equal(message.containers.length, 2);

  const payload = buildTicketMessagePayload(message, { server: 'CoinSprite', ticketName: 'Support' });
  assert.equal(payload.components[0].type, 10);
  assert.equal(payload.components[0].content, 'Outside CoinSprite');
  assert.deepEqual(payload.components.slice(1).map((component) => component.type), [17, 17]);
  assert.equal(payload.components[1].accent_color, 0x112233);
  assert.equal(payload.components[2].accent_color, 0x445566);
});

test('legacy ticket message fields migrate to the first rich container', () => {
  const message = sanitizeTicketMessage({
    content: 'Legacy content',
    accentColor: '#57F287',
    thumbnailUrl: '',
    imageUrl: '',
  });

  assert.equal(message.outsideContent, '');
  assert.equal(message.containers.length, 1);
  assert.equal(message.containers[0].text, 'Legacy content');
  assert.equal(message.containers[0].accentColor, '#57F287');
});

test('ticket panel channel checks tolerate non-function isTextBased values', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'commands', 'ticket-system.js'), 'utf8');
  assert.match(source, /function isTextBasedChannel\(channel\)/);
  assert.match(source, /typeof channel\.isTextBased === 'function'/);
  assert.match(source, /typeof channel\.isTextBased === 'boolean'/);
  assert.doesNotMatch(source, /\?\.isTextBased\(\)/);
});
