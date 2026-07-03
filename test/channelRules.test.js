'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyMessage,
  getGuildRules,
  isRuleViolation,
  normalizeRules,
  saveGuildRules,
} = require('../src/channelRules');

test('classifies every supported channel message context', () => {
  const message = {
    content: 'hello https://example.com',
    attachments: new Map([
      ['image', { name: 'photo.png', contentType: 'image/png' }],
      ['video', { name: 'clip.mp4', contentType: 'video/mp4' }],
      ['audio', { name: 'sound.mp3', contentType: 'audio/mpeg' }],
      ['file', { name: 'notes.pdf', contentType: 'application/pdf' }],
    ]),
    stickers: new Map([['sticker', { id: '1' }]]),
    embeds: [{ type: 'rich' }],
    poll: { question: 'Choose' },
  };

  assert.deepEqual(new Set(classifyMessage(message)), new Set([
    'text', 'link', 'image', 'video', 'audio', 'file', 'sticker', 'embed', 'poll',
  ]));
});

test('treats Discord voice messages separately from audio uploads', () => {
  const message = {
    content: '',
    flags: { has: (flag) => flag === 8192, bitfield: 8192 },
    attachments: new Map([['voice', { name: 'voice-message.ogg', contentType: 'audio/ogg' }]]),
  };

  assert.deepEqual(classifyMessage(message), ['voice_message']);
});

test('supports allowed and not-allowed context modes', () => {
  assert.equal(isRuleViolation({ mode: 'allowed', contexts: ['text', 'image'] }, ['text']), false);
  assert.equal(isRuleViolation({ mode: 'allowed', contexts: ['text'] }, ['text', 'image']), true);
  assert.equal(isRuleViolation({ mode: 'not_allowed', contexts: ['link'] }, ['text']), false);
  assert.equal(isRuleViolation({ mode: 'not_allowed', contexts: ['link'] }, ['text', 'link']), true);
});

test('normalizes channels, contexts, and action-specific settings', () => {
  const [rule] = normalizeRules([{
    id: 'Main Chat',
    name: 'Main chat',
    channelIds: ['1234567890123456', 'bad-id'],
    mode: 'not_allowed',
    contexts: ['voice_message', 'unknown'],
    actions: [
      { type: 'mute', time: '12h', reason: 'No voice messages' },
      { type: 'send_message', templateId: 'my-user-template', ephemeral: true },
      { type: 'unknown' },
    ],
  }]);

  assert.equal(rule.id, 'main-chat');
  assert.deepEqual(rule.channelIds, ['1234567890123456']);
  assert.deepEqual(rule.contexts, ['voice_message']);
  assert.deepEqual(rule.actions, [
    { type: 'mute', reason: 'No voice messages', time: '12h' },
    { type: 'send_message', templateId: 'my-user-template', ephemeral: true },
  ]);
});

test('persists normalized rules per guild', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-channel-rules-'));
  process.env.CHANNEL_RULES_STORE_PATH = path.join(directory, 'rules.json');
  try {
    const saved = saveGuildRules('1234567890123456', [{
      name: 'Images only',
      channelIds: ['1234567890123456'],
      mode: 'allowed',
      contexts: ['image'],
      actions: [{ type: 'delete' }],
    }]);
    assert.deepEqual(getGuildRules('1234567890123456'), saved);
    assert.equal(saved[0].actions[0].reason.length > 0, true);
  } finally {
    delete process.env.CHANNEL_RULES_STORE_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
