'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deleteRecentUserMessages,
  findRecentUserMessages,
  normalizeDeleteAmount,
} = require('../src/channelMessageDeletion');

function fakeMessage(id, authorId, createdTimestamp, deletedIds) {
  return {
    id,
    author: { id: authorId },
    createdTimestamp,
    deletable: true,
    delete: async () => {
      deletedIds.push(id);
    },
  };
}

test('delete amount defaults and clamps to the supported range', () => {
  assert.equal(normalizeDeleteAmount(''), 1);
  assert.equal(normalizeDeleteAmount(0), 1);
  assert.equal(normalizeDeleteAmount(25), 25);
  assert.equal(normalizeDeleteAmount(101), 100);
});

test('finds and deletes the newest matching user messages across history pages', async () => {
  const deletedIds = [];
  const targetId = '234567890123456789';
  const trigger = fakeMessage('trigger', targetId, 300, deletedIds);
  const recent = fakeMessage('recent', targetId, 200, deletedIds);
  const older = fakeMessage('older', targetId, 100, deletedIds);
  const unrelated = Array.from({ length: 98 }, (_, index) => (
    fakeMessage('other-' + index, '999999999999999999', 190 - index, deletedIds)
  ));
  const firstPage = new Map([trigger, recent, ...unrelated].map((message) => [message.id, message]));
  const secondPage = new Map([[older.id, older]]);
  const requests = [];

  trigger.channel = {
    messages: {
      fetch: async (options) => {
        requests.push(options);
        return requests.length === 1 ? firstPage : secondPage;
      },
    },
  };

  const found = await findRecentUserMessages(trigger, 3);
  assert.deepEqual(found.map((message) => message.id), ['trigger', 'recent', 'older']);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].limit, 100);
  assert.equal(typeof requests[1].before, 'string');

  requests.length = 0;
  const result = await deleteRecentUserMessages(trigger, 3);
  assert.deepEqual(result, { requested: 3, found: 3, deleted: 3 });
  assert.deepEqual(deletedIds, ['trigger', 'recent', 'older']);
});

test('an empty delete amount removes only the triggering message', async () => {
  const deletedIds = [];
  const trigger = fakeMessage('trigger', '234567890123456789', 300, deletedIds);
  trigger.channel = { messages: { fetch: async () => { throw new Error('history should not be fetched'); } } };

  const result = await deleteRecentUserMessages(trigger, '');
  assert.deepEqual(result, { requested: 1, found: 1, deleted: 1 });
  assert.deepEqual(deletedIds, ['trigger']);
});
