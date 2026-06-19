const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { __test } = require('../src/aiModeration');

const originalFetch = global.fetch;
const originalAttempts = process.env.OPENAI_MODERATION_MAX_ATTEMPTS;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalAttempts === undefined) delete process.env.OPENAI_MODERATION_MAX_ATTEMPTS;
  else process.env.OPENAI_MODERATION_MAX_ATTEMPTS = originalAttempts;
});

test('OpenAI requests retry a transient server failure', async () => {
  process.env.OPENAI_MODERATION_MAX_ATTEMPTS = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        async text() { return 'temporarily unavailable'; },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { output_text: '{}' }; },
    };
  };

  const result = await __test.postOpenAI('https://example.test', 'key', { model: 'test' });
  assert.equal(calls, 2);
  assert.deepEqual(result, { output_text: '{}' });
});

test('OpenAI requests do not retry a permanent client error', async () => {
  process.env.OPENAI_MODERATION_MAX_ATTEMPTS = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 400,
      async text() { return 'bad request'; },
    };
  };

  await assert.rejects(
    __test.postOpenAI('https://example.test', 'key', { model: 'test' }),
    /OpenAI request failed \(400\)/,
  );
  assert.equal(calls, 1);
});