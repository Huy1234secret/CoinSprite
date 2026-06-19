const assert = require('node:assert/strict');
const { test } = require('node:test');
const { moderationIgnoreReason } = require('../src/moderationMessageFilter');

test('AI moderation ignores only content-free message shapes', () => {
  assert.equal(moderationIgnoreReason({}, 'https://example.com/path'), 'link-only');
  assert.equal(moderationIgnoreReason({}, '<https://example.com/path>'), 'link-only');
  assert.equal(moderationIgnoreReason({}, '😀🔥'), 'emoji-only');
  assert.equal(moderationIgnoreReason({}, '<:coin:123456789012345678>'), 'emoji-only');
  assert.equal(moderationIgnoreReason({}, '<@123456789012345678>'), 'single-mention');
  assert.equal(moderationIgnoreReason({
    content: '',
    attachments: new Map([['1', { name: 'proof.png', contentType: 'image/png' }]]),
  }), 'image-only');
});

test('AI moderation checks Burmese and mixed-content messages', () => {
  assert.equal(moderationIgnoreReason({}, 'စောက်ပေါပါကွာ'), '');
  assert.equal(moderationIgnoreReason({}, 'do u guys think they will do a collaboration with hanimne in utdx'), '');
  assert.equal(moderationIgnoreReason({}, 'hello 😀'), '');
  assert.equal(moderationIgnoreReason({}, '<@123456789012345678> stop'), '');
  assert.equal(moderationIgnoreReason({}, 'https://example.com context'), '');
  assert.equal(moderationIgnoreReason({
    content: 'caption',
    attachments: new Map([['1', { name: 'proof.png', contentType: 'image/png' }]]),
  }), '');
  assert.equal(moderationIgnoreReason({
    content: '',
    attachments: new Map([['1', { name: 'notes.txt', contentType: 'text/plain' }]]),
  }), '');
});
