const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.PUBLIC_WEB_BASE_URL = 'https://appeals.example.com';
const {
  COMPONENTS_V2_FLAG,
  caseDetailContainer,
  caseHistoryContainer,
  moderationErrorContainer,
  moderationSuccessContainer,
  warningNoticeContainer,
} = require('../src/moderationComponents');

function contentOf(payload) {
  return payload.components[0].components[0].content;
}

test('moderation result builders return Components V2 payloads', () => {
  const success = moderationSuccessContainer('Saved', 'Case updated.');
  const failure = moderationErrorContainer('Failed', 'Case was not found.');
  assert.equal(success.flags, COMPONENTS_V2_FLAG);
  assert.match(contentOf(success), /## Saved/);
  assert.match(contentOf(failure), /Case was not found/);
  assert.deepEqual(success.allowedMentions, { parse: [] });
});

test('warning notices preserve the existing warning information limits', () => {
  const payload = warningNoticeContainer({
    guildName: 'CoinSprite',
    points: 5,
    record: {
      id: 'W-000001',
      reason: 'Repeated harassment',
      points: 2,
      expiresAt: null,
      evidence: 'https://example.com/evidence',
    },
  });
  const text = contentOf(payload);
  assert.match(text, /W-000001/);
  assert.match(text, /Repeated harassment/);
  assert.match(text, /Active warnings:\*\* 5/);
  assert.equal(payload.components.at(-1).components[0].style, 5);
  assert.ok(text.length <= 3900);
});

test('case history and details include audit and message reference context', () => {
  const record = {
    id: 'W-000002',
    targetUserId: '123456789012345678',
    type: 'warning',
    status: 'active',
    points: 3,
    source: 'manual',
    reason: 'Spam',
    expiresAt: null,
    evidence: '',
    references: {
      notification: { status: 'dm', messageId: '223456789012345678' },
      staffLog: { messageId: '323456789012345678' },
    },
    events: [{
      type: 'case.created',
      actorId: '423456789012345678',
      createdAt: 1710000000000,
    }],
  };
  const history = caseHistoryContainer({ target: { username: 'target' }, cases: [record], activePoints: 3 });
  const detail = caseDetailContainer(record);
  assert.match(contentOf(history), /Warning history for target/);
  assert.match(contentOf(detail), /case\.created/);
  assert.match(contentOf(detail), /223456789012345678/);
  assert.match(contentOf(detail), /323456789012345678/);
});
