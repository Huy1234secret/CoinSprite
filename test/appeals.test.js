'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-appeals-'));
process.env.MODERATION_APPEAL_STORE_PATH = path.join(directory, 'appeals.json');

const { sanitizeAppealConfig } = require('../src/appealConfig');
const appealStore = require('../src/appealStore');
const { validateSubmission } = require('../src/appealService');
const { sanitizeCommunityMessages } = require('../src/communityMessageConfig');
const warn = require('../commands/warn');

after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('appeal configuration sanitizes every field type and limits', () => {
  const config = sanitizeAppealConfig({
    enabled: true,
    logChannelId: '123456789012345678',
    cooldownSeconds: 999999999,
    maxSubmissionsPerCase: '',
    questions: [
      { type: 'text', label: 'Text', required: true, minLength: 20, maxLength: 10 },
      { type: 'number', label: 'Number', minimum: 10, maximum: 2, step: 0 },
      { type: 'choice', label: 'Choice', multiple: true, options: [{ label: 'One' }] },
      { type: 'checkbox', label: 'Confirm', required: true },
      { type: 'file', label: 'Files', maxFiles: 99, maxFileSizeMb: 99, allowedExtensions: ['.PNG', '../exe'] },
    ],
  });
  assert.equal(config.enabled, true);
  assert.equal(config.cooldownSeconds, 365 * 86400);
  assert.equal(config.maxSubmissionsPerCase, null);
  assert.equal(config.questions[0].maxLength, 20);
  assert.equal(config.questions[1].maximum, 10);
  assert.equal(config.questions[2].options.length, 2);
  assert.equal(config.questions[4].maxFiles, 5);
  assert.equal(config.questions[4].maxFileSizeMb, 10);
  assert.deepEqual(config.questions[4].allowedExtensions, ['png']);
  assert.equal(config.logMessage.componentRows.length, 0);
});

test('submission validation enforces required fields, choices, and file limits', () => {
  const config = sanitizeAppealConfig({
    questions: [
      { id: 'reason', type: 'text', label: 'Reason', required: true, minLength: 3, maxLength: 20 },
      { id: 'kind', type: 'choice', label: 'Kind', required: true, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      { id: 'score', type: 'number', label: 'Score', required: true, minimum: 1, maximum: 9, step: 2 },
      { id: 'proof', type: 'file', label: 'Proof', required: true, maxFiles: 1, maxFileSizeMb: 1, allowedExtensions: ['png'] },
      { id: 'confirm', type: 'checkbox', label: 'Confirm', required: true },
    ],
  });
  const files = [{ fieldId: 'proof', name: 'proof.png', contentType: 'image/png', buffer: Buffer.from('png') }];
  const answers = validateSubmission(config, { reason: 'Valid reason', kind: 'a', score: 3, confirm: true }, files);
  assert.equal(answers.length, 5);
  assert.throws(() => validateSubmission(config, { reason: 'no', kind: 'a', score: 3, confirm: true }, files), /too short/);
  assert.throws(() => validateSubmission(config, { reason: 'Valid', kind: 'x', score: 3, confirm: true }, files), /invalid choice/);
  assert.throws(() => validateSubmission(config, { reason: 'Valid', kind: 'a', score: 2, confirm: true }, files), /required step/);
  assert.throws(() => validateSubmission(config, { reason: 'Valid', kind: 'a', score: 3, confirm: false }, files), /must be checked/);
  assert.throws(() => validateSubmission(config, { reason: 'Valid', kind: 'a', score: 3, confirm: true }, [{ ...files[0], name: 'proof.exe' }]), /only accepts/);
});

test('appeal store enforces pending, cooldown, maximum, and atomic decisions', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const first = appealStore.createAppeal({ guildId, caseId: 'W-000001', userId, answers: [], formSnapshot: [] });
  assert.equal(appealStore.eligibility(guildId, first.caseId, userId, {}).code, 'pending');
  const claim = appealStore.beginDecision(guildId, first.id, '345678901234567890', 'deny');
  assert.equal(claim.ok, true);
  assert.equal(claim.appeal.status, 'processing');
  assert.equal(appealStore.beginDecision(guildId, first.id, '345678901234567890', 'deny').ok, false);
  appealStore.finishDecision(guildId, first.id, '345678901234567890', 'denied', 'Insufficient context');
  assert.equal(appealStore.eligibility(guildId, first.caseId, userId, { maxSubmissionsPerCase: 1 }).code, 'maximum');
  const cooldown = appealStore.eligibility(guildId, first.caseId, userId, { cooldownSeconds: 60 }, first.createdAt + 1000);
  assert.equal(cooldown.code, 'cooldown');
  assert.equal(appealStore.eligibility(guildId, first.caseId, userId, { cooldownSeconds: 60 }, first.createdAt + 61000).allowed, true);
});

test('legacy community strings migrate into private rich templates', () => {
  const config = sanitizeCommunityMessages({
    welcome: { enabled: true, channelId: '123456789012345678', message: 'Hello <@mention>' },
  });
  assert.equal(config.welcome.enabled, true);
  assert.equal(config.welcome.messageTemplate.content, '');
  assert.equal(config.welcome.messageTemplate.containers[0].text, 'Hello <@mention>');
  assert.deepEqual(config.welcome.messageTemplate.componentRows, []);
});

test('/warn requires time and exposes one Discord attachment without points', () => {
  const json = warn.data.toJSON();
  const names = json.options.map((option) => option.name);
  assert.deepEqual(names, ['user', 'reason', 'time', 'attachment', 'appealable']);
  assert.equal(json.options.find((option) => option.name === 'time').required, true);
  assert.equal(json.options.find((option) => option.name === 'attachment').type, 11);
  assert.equal(names.includes('points'), false);
});
