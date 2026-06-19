const assert = require('node:assert/strict');
const { test } = require('node:test');
const { __test } = require('../commands/dm');

const FIRST_USER_ID = '123456789012345678';
const SECOND_USER_ID = '234567890123456789';

test('prefix DM parses a bracketed recipient list and mention option', () => {
  assert.deepEqual(
    __test.parsePrefixDm(`!DM [${FIRST_USER_ID}, ${SECOND_USER_ID}, ${FIRST_USER_ID}] hello there yes`),
    {
      userIds: [FIRST_USER_ID, SECOND_USER_ID],
      text: 'hello there',
      mentionUsers: true,
    },
  );
});

test('prefix DM keeps the legacy single-recipient shape', () => {
  assert.deepEqual(
    __test.parsePrefixDm(`!dm ${FIRST_USER_ID} hello no`),
    {
      userIds: [FIRST_USER_ID],
      text: 'hello',
      mentionUsers: false,
    },
  );
});

test('prefix DM returns useful errors for malformed input', () => {
  assert.match(__test.parsePrefixDm('!DM [] hello no').error, /At least one/);
  assert.match(__test.parsePrefixDm('!DM [123] hello no').error, /Invalid Discord user ID/);
  assert.match(__test.parsePrefixDm(`!DM [${FIRST_USER_ID}] hello`).error, /Usage/);
  assert.equal(__test.parsePrefixDm('ordinary message'), null);
});

test('prefix DM mention option mentions only the recipient', async () => {
  let payload = null;
  const user = {
    username: 'target',
    async send(value) { payload = value; },
  };
  const client = { users: { async fetch(userId) {
    assert.equal(userId, FIRST_USER_ID);
    return user;
  } } };

  await __test.sendDm(client, FIRST_USER_ID, 'hello', true);
  assert.deepEqual(payload, {
    content: `<@${FIRST_USER_ID}> hello`,
    allowedMentions: { parse: [], users: [FIRST_USER_ID] },
  });
});