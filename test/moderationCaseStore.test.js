const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-warnings-'));
process.env.MODERATION_CASE_STORE_PATH = path.join(directory, 'moderation-cases.json');
const store = require('../src/moderationCaseStore');
const { parseDuration, pardonWarning, validateEvidence } = require('../src/warningService');

after(() => fs.rmSync(directory, { recursive: true, force: true }));

function warning(overrides = {}) {
  return store.createCase({
    guildId: '123456789012345678',
    targetUserId: '234567890123456789',
    authorId: '345678901234567890',
    source: 'manual',
    reason: 'Test warning',
    points: 2,
    expiresAt: Date.now() + 86400000,
    ...overrides,
  });
}

test('warning cases use schema v4 while preserving compatibility aliases', () => {
  const first = warning();
  const second = warning({ points: 3 });
  assert.equal(first.id, 'W-000001');
  assert.equal(second.id, 'W-000002');
  assert.equal(first.type, 'warning');
  assert.equal(first.targetUserId, '234567890123456789');
  assert.equal(first.memberId, first.targetUserId);
  assert.equal(first.details.points, 2);
  assert.equal(first.warningCount, 1);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, 'case.created');
  assert.equal(store.activeWarningCount(first.guildId, first.targetUserId), 2);
  assert.equal(store.activePoints(first.guildId, first.targetUserId), 5);

  const persisted = JSON.parse(fs.readFileSync(store.STORE_PATH, 'utf8'));
  assert.equal(persisted.version, 4);
  assert.equal(persisted.guilds[first.guildId].cases[0].memberId, undefined);
  assert.equal(persisted.guilds[first.guildId].cases[0].delivery, undefined);
  assert.equal(persisted.guilds[first.guildId].cases[0].enforcementEvents, undefined);
});

test('sanction cases preserve evidence and appealability without affecting warning counts', () => {
  const record = store.createCase({
    guildId: '123456789012345678',
    type: 'ban',
    targetUserId: '934567890123456789',
    authorId: '345678901234567890',
    source: 'manual',
    reason: 'Repeated abuse',
    appealable: true,
    attachments: [{
      name: 'proof.png',
      contentType: 'image/png',
      size: 123,
      url: 'https://cdn.discordapp.com/proof.png',
      storedName: 'proof.png',
    }],
    expiresAt: Date.now() + 86400000,
  });
  assert.match(record.id, /^B-/);
  assert.equal(record.type, 'ban');
  assert.equal(record.appealable, true);
  assert.equal(record.attachments[0].storedName, 'proof.png');
  assert.equal(store.activeWarningCount(record.guildId, record.memberId), 0);
  assert.equal(store.queryCases(record.guildId, { type: 'ban' }).cases[0].id, record.id);
});

test('pardoning an active ban reverses enforcement before closing the case', async () => {
  const record = store.createCase({
    guildId: '123456789012345678',
    type: 'ban',
    targetUserId: '944567890123456789',
    authorId: '345678901234567890',
    source: 'manual',
    reason: 'Temporary ban',
    expiresAt: null,
  });
  let removedUserId = '';
  const result = await pardonWarning({
    guild: {
      id: record.guildId,
      bans: { remove: async (userId) => { removedUserId = userId; } },
    },
    caseId: record.id,
    moderatorId: '345678901234567890',
    reason: 'Appeal accepted',
  });
  assert.equal(removedUserId, record.memberId);
  assert.equal(result.case.status, 'pardoned');
  assert.ok(result.case.events.some((event) => event.type === 'enforcement.reversed' && event.data.action === 'unban'));
});

test('AutoMod warning sources receive the dedicated case type', () => {
  const record = warning({ source: 'automod_link' });
  assert.equal(record.type, 'automod_warning');
});

test('expired and pardoned cases remain in history with audit events but lose active warning count', () => {
  const expired = warning({ targetUserId: '456789012345678901', expiresAt: Date.now() - 1 });
  assert.equal(store.activeWarningCount(expired.guildId, expired.targetUserId), 0);
  assert.equal(store.activePoints(expired.guildId, expired.targetUserId), 0);
  const expiredRecord = store.getCase(expired.guildId, expired.id);
  assert.equal(expiredRecord.status, 'expired');
  assert.ok(expiredRecord.events.some((event) => event.type === 'case.expired'));

  const active = warning({ targetUserId: '567890123456789012', points: 4 });
  assert.equal(store.activeWarningCount(active.guildId, active.targetUserId), 1);
  assert.equal(store.activePoints(active.guildId, active.targetUserId), 4);
  store.pardonCase(active.guildId, active.id, '345678901234567890', 'Appeal accepted');
  assert.equal(store.activeWarningCount(active.guildId, active.targetUserId), 0);
  assert.equal(store.activePoints(active.guildId, active.targetUserId), 0);
  const pardoned = store.getCase(active.guildId, active.id);
  assert.equal(pardoned.status, 'pardoned');
  assert.equal(pardoned.pardonReason, 'Appeal accepted');
  assert.equal(pardoned.events.at(-1).type, 'case.pardoned');
});

test('threshold claims are idempotent and re-arm after warning count falls below a threshold', () => {
  const targetUserId = '678901234567890123';
  const firstWarning = warning({ targetUserId, points: 5 });
  warning({ targetUserId, points: 1 });
  warning({ targetUserId, points: 1 });

  const first = store.claimCrossedThresholds(firstWarning.guildId, targetUserId, [3, 5, 8]);
  assert.equal(first.warnings, 3);
  assert.deepEqual(first.thresholds, [3]);
  assert.deepEqual(store.claimCrossedThresholds(firstWarning.guildId, targetUserId, [3, 5, 8]).thresholds, []);

  store.pardonCase(firstWarning.guildId, firstWarning.id, '345678901234567890', 'Appeal accepted');
  assert.equal(store.activeWarningCount(firstWarning.guildId, targetUserId), 2);
  warning({ targetUserId, points: 10 });
  assert.deepEqual(store.claimCrossedThresholds(firstWarning.guildId, targetUserId, [3, 5, 8]).thresholds, [3]);

  warning({ targetUserId });
  warning({ targetUserId });
  assert.equal(store.activeWarningCount(firstWarning.guildId, targetUserId), 5);
  assert.deepEqual(store.claimCrossedThresholds(firstWarning.guildId, targetUserId, [3, 5, 8]).thresholds, [5]);
});

test('case updates append actor-aware audit events and keep legacy point compatibility', () => {
  const record = warning({ targetUserId: '789012345678901234' });
  const actorId = '345678901234567890';
  const updated = store.updateCase(
    record.guildId,
    record.id,
    { reason: 'Updated reason', points: 99, evidence: 'https://example.com/proof' },
    actorId,
  );
  assert.equal(updated.reason, 'Updated reason');
  assert.equal(updated.points, 10);
  assert.equal(store.activeWarningCount(updated.guildId, updated.targetUserId), 1);
  assert.equal(updated.evidence, 'https://example.com/proof');
  assert.equal(updated.createdAt, record.createdAt);
  const event = updated.events.at(-1);
  assert.equal(event.type, 'case.edited');
  assert.equal(event.actorId, actorId);
  assert.equal(event.data.changes.points.to, 10);
});

test('delivery, staff logs, and enforcement retain message references and events', () => {
  const record = warning({ targetUserId: '890123456789012345' });
  store.updateDelivery(record.guildId, record.id, {
    status: 'fallback',
    channelId: '901234567890123456',
    messageId: '012345678901234567',
  });
  store.updateStaffLog(record.guildId, record.id, {
    channelId: '112345678901234567',
    messageId: '212345678901234567',
  });
  store.appendEnforcement(record.guildId, record.id, {
    threshold: 3,
    action: 'timeout',
    reason: 'Reached 3 active warnings.',
    warningCount: 3,
    success: true,
    detail: '3600 seconds',
  });
  const updated = store.getCase(record.guildId, record.id);
  assert.equal(updated.references.notification.messageId, '012345678901234567');
  assert.equal(updated.references.staffLog.messageId, '212345678901234567');
  assert.deepEqual(
    updated.events.slice(-3).map((event) => event.type),
    ['notification.attempted', 'staff_log.sent', 'enforcement.completed'],
  );
  assert.equal(updated.enforcementEvents[0].action, 'timeout');
  assert.equal(updated.enforcementEvents[0].warningCount, 3);
});

test('v1 stores migrate once and preserve a backup', () => {
  const guildId = '323456789012345678';
  const oldState = {
    version: 1,
    guilds: {
      [guildId]: {
        nextCaseNumber: 2,
        crossedThresholds: {},
        cases: [{
          id: 'W-000001',
          guildId,
          memberId: '423456789012345678',
          moderatorId: '523456789012345678',
          source: 'manual',
          reason: 'Legacy warning',
          staffNotes: '',
          points: 4,
          evidence: '',
          sourceChannelId: '623456789012345678',
          sourceMessageId: '723456789012345678',
          createdAt: 1000,
          updatedAt: 2000,
          expiresAt: null,
          status: 'active',
          delivery: { status: 'dm', attemptedAt: 1500, channelId: '', messageId: '823456789012345678' },
          enforcementEvents: [],
        }],
      },
    },
  };
  fs.writeFileSync(store.STORE_PATH, JSON.stringify(oldState), 'utf8');
  const backup = store.__test.migrationBackupPath(1);
  if (fs.existsSync(backup)) fs.unlinkSync(backup);

  const migrated = store.__test.readState();
  assert.equal(migrated.version, 4);
  assert.equal(migrated.guilds[guildId].cases[0].targetUserId, '423456789012345678');
  assert.equal(migrated.guilds[guildId].cases[0].details.points, 4);
  assert.ok(migrated.guilds[guildId].cases[0].events.some((event) => event.type === 'notification.attempted'));
  assert.ok(fs.existsSync(backup));
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).version, 1);
});

test('invalid JSON fails closed instead of silently resetting moderation data', () => {
  fs.writeFileSync(store.STORE_PATH, '{invalid', 'utf8');
  assert.throws(() => store.__test.readState(), /invalid JSON/);
  assert.equal(fs.readFileSync(store.STORE_PATH, 'utf8'), '{invalid');
});

test('duration and evidence helpers accept supported values and reject unsafe input', () => {
  const now = 1000;
  assert.equal(parseDuration('30m', 90, now), now + 30 * 60000);
  assert.equal(parseDuration('never', 90, now), null);
  assert.equal(validateEvidence('https://discord.com/channels/1/2/3'), 'https://discord.com/channels/1/2/3');
  assert.throws(() => parseDuration('tomorrow', 90, now), /Expiry/);
  assert.throws(() => validateEvidence('javascript:alert(1)'), /http or https/);
});
