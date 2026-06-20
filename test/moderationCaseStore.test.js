const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-warnings-'));
process.env.MODERATION_CASE_STORE_PATH = path.join(directory, 'moderation-cases.json');
const store = require('../src/moderationCaseStore');
const { parseDuration, validateEvidence } = require('../src/warningService');

after(() => fs.rmSync(directory, { recursive: true, force: true }));

function warning(overrides = {}) {
  return store.createCase({
    guildId: '123456789012345678',
    memberId: '234567890123456789',
    moderatorId: '345678901234567890',
    source: 'manual',
    reason: 'Test warning',
    points: 2,
    expiresAt: Date.now() + 86400000,
    ...overrides,
  });
}

test('warning cases receive stable unique IDs and accumulate active points', () => {
  const first = warning();
  const second = warning({ points: 3 });
  assert.equal(first.id, 'W-000001');
  assert.equal(second.id, 'W-000002');
  assert.equal(store.activePoints(first.guildId, first.memberId), 5);
});

test('expired and pardoned cases remain in history but lose active points', () => {
  const expired = warning({ memberId: '456789012345678901', expiresAt: Date.now() - 1 });
  assert.equal(store.activePoints(expired.guildId, expired.memberId), 0);
  assert.equal(store.getCase(expired.guildId, expired.id).status, 'expired');

  const active = warning({ memberId: '567890123456789012', points: 4 });
  assert.equal(store.activePoints(active.guildId, active.memberId), 4);
  store.pardonCase(active.guildId, active.id, '345678901234567890', 'Appeal accepted');
  assert.equal(store.activePoints(active.guildId, active.memberId), 0);
  assert.equal(store.getCase(active.guildId, active.id).status, 'pardoned');
});

test('threshold claims are idempotent and re-arm after points fall below a threshold', () => {
  const record = warning({ memberId: '678901234567890123', points: 5 });
  const first = store.claimCrossedThresholds(record.guildId, record.memberId, [3, 5, 8]);
  assert.deepEqual(first.thresholds, [3, 5]);
  assert.deepEqual(store.claimCrossedThresholds(record.guildId, record.memberId, [3, 5, 8]).thresholds, []);

  store.updateCase(record.guildId, record.id, { points: 2 });
  warning({ memberId: record.memberId, points: 3 });
  assert.deepEqual(store.claimCrossedThresholds(record.guildId, record.memberId, [3, 5, 8]).thresholds, [3, 5]);
});

test('case updates validate points and preserve audit fields', () => {
  const record = warning({ memberId: '789012345678901234' });
  const updated = store.updateCase(record.guildId, record.id, { reason: 'Updated reason', points: 99, evidence: 'https://example.com/proof' });
  assert.equal(updated.reason, 'Updated reason');
  assert.equal(updated.points, 10);
  assert.equal(updated.evidence, 'https://example.com/proof');
  assert.equal(updated.createdAt, record.createdAt);
});

test('duration and evidence helpers accept supported values and reject unsafe input', () => {
  const now = 1000;
  assert.equal(parseDuration('30m', 90, now), now + 30 * 60000);
  assert.equal(parseDuration('never', 90, now), null);
  assert.equal(validateEvidence('https://discord.com/channels/1/2/3'), 'https://discord.com/channels/1/2/3');
  assert.throws(() => parseDuration('tomorrow', 90, now), /Expiry/);
  assert.throws(() => validateEvidence('javascript:alert(1)'), /http or https/);
});
