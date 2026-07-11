const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_ATTACHMENT_BYTES,
  createBugReport,
  listBugReports,
  updateBugReportStatus,
} = require('../src/bugReportStore');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-bugs-')), 'bug-reports.json');
}

const session = {
  user: {
    id: '123456789012345678',
    username: 'tester',
    globalName: 'Tester',
  },
};

test('bug reports save reporter, attachment, and owner status updates', () => {
  const filePath = tempFile();
  const report = createBugReport({
    title: 'Dashboard picker broke',
    severity: 'high',
    category: 'Dashboard',
    guildId: '234567890123456789',
    description: 'The channel picker crashes after one click.',
    expected: 'The picker should stay open.',
    steps: 'Open dashboard\nClick picker',
    contact: '@tester',
    attachment: {
      name: 'proof.txt',
      type: 'text/plain',
      size: 4,
      data: Buffer.from('test').toString('base64'),
    },
  }, session, { filePath, now: Date.parse('2026-07-11T05:00:00.000Z') });

  assert.equal(report.status, 'open');
  assert.equal(report.severity, 'high');
  assert.equal(report.reporter.id, session.user.id);
  assert.equal(report.attachment.name, 'proof.txt');
  assert.equal(listBugReports({ filePath }).length, 1);

  const updated = updateBugReportStatus(report.id, 'reviewed', { filePath, now: Date.parse('2026-07-11T05:05:00.000Z') });
  assert.equal(updated.status, 'reviewed');
  assert.equal(listBugReports({ filePath })[0].status, 'reviewed');
});

test('bug reports reject missing descriptions and oversized attachments', () => {
  const filePath = tempFile();
  assert.throws(() => createBugReport({ title: 'No body' }, session, { filePath }), /description is required/i);
  assert.throws(() => createBugReport({
    title: 'Huge upload',
    description: 'upload too large',
    attachment: {
      name: 'big.bin',
      type: 'application/octet-stream',
      size: MAX_ATTACHMENT_BYTES + 1,
      data: Buffer.alloc(16).toString('base64'),
    },
  }, session, { filePath }), /Attachment must be/);
});
