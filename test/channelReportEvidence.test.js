'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addReportAttachments,
  buildReportEvidenceText,
  evidenceAttachments,
  uploadedAttachmentUrls,
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

test('uploads copied evidence before rendering its gallery', () => {
  const message = fixture();
  const payload = { components: [{ type: 17, components: [{ type: 10, content: 'Report' }] }] };
  addReportAttachments(payload, message, { copyAttachments: true, includeGallery: false });

  const attachments = evidenceAttachments(message);
  assert.equal(payload.files.length, 3);
  assert.deepEqual(payload.files.map((file) => file.name), attachments.map((item) => item.copiedName));
  assert.equal(payload.components[0].components.some((component) => component.type === 12), false);
});

test('uses report-owned attachment URLs for links and gallery media', () => {
  const message = fixture();
  const attachments = evidenceAttachments(message);
  const sentReport = {
    attachments: new Map(attachments.map((attachment) => [
      attachment.copiedName,
      {
        name: attachment.copiedName,
        url: 'https://cdn.discordapp.com/report-evidence/' + attachment.copiedName,
      },
    ])),
  };
  const attachmentUrls = uploadedAttachmentUrls(sentReport);
  assert.equal(attachmentUrls.size, 3);

  const text = buildReportEvidenceText(message, { attachmentUrls });
  assert.ok(text.includes('[proof image.png](https://cdn.discordapp.com/report-evidence/01-proof_image.png)'));
  assert.ok(text.includes('[proof.mp4](https://cdn.discordapp.com/report-evidence/02-proof.mp4)'));
  assert.ok(text.includes('[notes.txt](https://cdn.discordapp.com/report-evidence/03-notes.txt)'));
  assert.equal(text.includes('https://cdn.example/proof.png'), false);

  const payload = { components: [{ type: 17, components: [] }] };
  addReportAttachments(payload, message, { copyAttachments: false, attachmentUrls });
  assert.equal(payload.files, undefined);
  const gallery = payload.components[0].components.find((component) => component.type === 12);
  assert.deepEqual(gallery.items.map((item) => item.media.url), [
    'https://cdn.discordapp.com/report-evidence/01-proof_image.png',
    'https://cdn.discordapp.com/report-evidence/02-proof.mp4',
  ]);
});

test('falls back to original attachment links if preserving evidence fails', () => {
  const message = fixture();
  const text = buildReportEvidenceText(message);
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
