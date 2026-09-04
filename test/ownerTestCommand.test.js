const assert = require('node:assert/strict');
const test = require('node:test');

const { BURGER_EMOJIS } = require('../src/features/work/data/emojis');
const { createOwnerTestCommand, parseTestCommand } = require('../src/ownerTestCommand');

const GUILD = '123456789012345678';
const USER = '323456789012345678';

function message(content, overrides = {}) {
  const replies = [];
  return {
    guildId: GUILD,
    channelId: '223456789012345678',
    content,
    author: { id: USER },
    replies,
    async reply(payload) { replies.push(payload); return { id: '423456789012345678' }; },
    ...overrides,
  };
}

test('Burger Maker uses the requested CSBeef custom emoji', () => {
  assert.deepEqual(BURGER_EMOJIS.beef_patty, { name: 'CSBeef', id: '1545385864807325696' });
});

test('cstest parsing is case-insensitive and recognizes supported command aliases', () => {
  assert.deepEqual(parseTestCommand('cstest cswork'), {
    argument: 'cswork', route: 'cswork', content: 'cswork',
  });
  assert.deepEqual(parseTestCommand('  CSTEST /CS-WORK  '), {
    argument: '/CS-WORK', route: 'cswork', content: 'cswork',
  });
  assert.deepEqual(parseTestCommand(`cstest csbalance ${USER}`), {
    argument: `csbalance ${USER}`, route: 'csbalance', content: `csbalance ${USER}`,
  });
  assert.deepEqual(parseTestCommand('cstest cs-inventory'), {
    argument: 'cs-inventory', route: 'csinventory', content: 'csinventory',
  });
  assert.equal(parseTestCommand('notcstest cswork'), null);
  assert.deepEqual(parseTestCommand('cstest'), { argument: '', route: null, content: '' });
  assert.deepEqual(parseTestCommand('cstest unknown'), { argument: 'unknown', route: null, content: '' });
});

test('cstest ignores unsafe messages and blocks non-owners before dispatch', async () => {
  let dispatches = 0;
  const feature = createOwnerTestCommand({
    isOwner: () => false,
    routes: { cswork: async () => { dispatches += 1; return true; } },
  });
  const unsafe = [
    message('cstest cswork', { guildId: null }),
    message('cstest cswork', { author: { id: USER, bot: true } }),
    message('cstest cswork', { webhookId: 'hook' }),
    message('cstest cswork', { system: true }),
    message('hello'),
  ];
  for (const source of unsafe) assert.equal(await feature.handleMessage(source), false);

  const denied = message('cstest cswork');
  assert.equal(await feature.handleMessage(denied), true);
  assert.equal(dispatches, 0);
  assert.equal(denied.replies[0].content, 'This command can only be used by the bot owner.');
  assert.deepEqual(denied.replies[0].allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
});

test('bot owners can dispatch supported commands without mutating the source message', async () => {
  const seen = [];
  const source = message('cstest cswork');
  const feature = createOwnerTestCommand({
    isOwner: (candidate) => candidate.author.id === USER,
    routes: {
      cswork: async (forwarded) => {
        seen.push({ content: forwarded.content, guildId: forwarded.guildId, author: forwarded.author });
        await forwarded.reply({ content: 'work started' });
        return true;
      },
    },
  });
  assert.equal(await feature.handleMessage(source), true);
  assert.deepEqual(seen, [{ content: 'cswork', guildId: GUILD, author: source.author }]);
  assert.equal(source.content, 'cstest cswork');
  assert.deepEqual(source.replies, [{ content: 'work started' }]);
});

test('unsupported and invalid delegated commands are consumed before Counting', async () => {
  const unknown = message('cstest unknown');
  const invalid = message('cstest cswork extra');
  const feature = createOwnerTestCommand({
    isOwner: () => true,
    routes: { cswork: async () => false },
  });
  assert.equal(await feature.handleMessage(unknown), true);
  assert.match(unknown.replies[0].content, /Supported test commands/);
  assert.equal(await feature.handleMessage(invalid), true);
  assert.equal(invalid.replies[0].content, 'Invalid test command syntax for `cswork`.');
});
