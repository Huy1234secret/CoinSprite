const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-case-pages-'));
process.env.MODERATION_CASE_STORE_PATH = path.join(directory, 'cases.json');
const store = require('../src/moderationCaseStore');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('case queries filter before returning bounded pagination metadata', () => {
  for (let index = 0; index < 5; index += 1) {
    store.createCase({
      guildId: '123456789012345678',
      targetUserId: index < 3 ? '223456789012345678' : '323456789012345678',
      authorId: '423456789012345678',
      type: index === 4 ? 'note' : 'warning',
      reason: 'Case ' + index,
      points: 1,
      expiresAt: null,
    });
  }

  const first = store.queryCases('123456789012345678', { page: 1, pageSize: 2 });
  assert.equal(first.cases.length, 2);
  assert.deepEqual(first.pagination, {
    page: 1,
    pageSize: 2,
    total: 5,
    totalPages: 3,
    hasPrevious: false,
    hasNext: true,
  });

  const filtered = store.queryCases('123456789012345678', {
    targetUserId: '223456789012345678',
    authorId: '423456789012345678',
    type: 'warning',
    page: 2,
    pageSize: 2,
  });
  assert.equal(filtered.pagination.total, 3);
  assert.equal(filtered.pagination.page, 2);
  assert.equal(filtered.cases.length, 1);
  assert.ok(filtered.cases.every((record) => record.targetUserId === '223456789012345678'));
});
