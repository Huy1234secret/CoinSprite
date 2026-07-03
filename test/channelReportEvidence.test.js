'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addReportAttachments,
  buildReportEvidenceText,
  evidenceAttachments,
} = require('../src/channelReportEvidence');

function fixture() {
  return {
    id: '345678901234567890',
    guildId: '123456789012345678',
    channelId: '234567890123456789',
    url: 'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
    content: 'Exact **message** from <@456789012345678901>',
    attachments: new Map([
      ['image', { name: 'proof image.png', contentType: 'image/png', url: 'https://cdn.example/proof.png' }],
      ['video', { name: 'proof.mp4', contentType: 'video/mp4', url: 'https://cdn.example/proof.mp4' }],
      ['file', { name: 'notes.txt', contentType: 'text/plain', url: 'https://cdn.example/notes.txt' }],
    ]),
  };
}

test('evidence includes the jump link and exact message content', () => {
  const message = fixture();
  const text = buildReportEvidenceText(message);
  assert.ok(text.startsWith(message.url));
  assert.ok(text.includes(message.content));
  assert.ok(text.indexOf(message.content) > text.indexOf(message.url));
  assert.ok(text.includes('[proof image.png](https://cdn.example/proof.png)'));
  assert.ok(text.includes('[proof.mp4](https://cdn.example/proof.mp4)'));
  assert.ok(text.includes('[notes.txt](https://cdn.example/notes.txt)'));
});

test('uses direct media links in the gallery while retaining copied backup files', () => {
  const message = fixture();
  const payload = { components: [{ type: 17, components: [{ type: 10, content: 'Report' }] }] };
  addReportAttachments(payload, message, { copyAttachments: true });

  const attachments = evidenceAttachments(message);
  assert.equal(payload.files.length, 3);
  assert.deepEqual(payload.files.map((file) => file.name), attachments.map((item) => item.copiedName));

  const container = payload.components[0];
  const gallery = container.components.find((component) => component.type === 12);
  assert.equal(gallery.items.length, 2);
  assert.deepEqual(gallery.items.map((item) => item.media.url), [
    'https://cdn.example/proof.png',
    'https://cdn.example/proof.mp4',
  ]);
  const file = container.components.find((component) => component.type === 13);
  assert.ok(file.file.url.endsWith(attachments[2].copiedName));
});

test('fallback evidence uses attachment links and remote gallery media', () => {
  const message = fixture();
  const text = buildReportEvidenceText(message, { includeAttachmentLinks: true });
  assert.ok(text.includes('[proof image.png](https://cdn.example/proof.png)'));

  const payload = { components: [{ type: 17, components: [] }] };
  addReportAttachments(payload, message, { copyAttachments: false });
  assert.equal(payload.files, undefined);
  const gallery = payload.components[0].components.find((component) => component.type === 12);
  assert.deepEqual(gallery.items.map((item) => item.media.url), [
    'https://cdn.example/proof.png',
    'https://cdn.example/proof.mp4',
  ]);
});
