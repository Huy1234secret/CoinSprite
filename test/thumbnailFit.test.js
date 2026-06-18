const assert = require('node:assert/strict');
const { test } = require('node:test');

test('thumbnail timeouts fail quietly and enter a retry cooldown', async () => {
  const nativeFetch = global.fetch;
  const nativeWarn = console.warn;
  let fetches = 0;
  let warnings = 0;

  global.fetch = async () => {
    fetches += 1;
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    throw error;
  };
  console.warn = () => { warnings += 1; };

  try {
    delete require.cache[require.resolve('../src/thumbnailFit')];
    const { fitMessageThumbnailSquares } = require('../src/thumbnailFit');
    const payload = {
      components: [{
        type: 17,
        components: [{
          type: 10,
          content: 'Test',
          accessory: { type: 11, media: { url: 'https://example.com/slow.png' } },
        }],
      }],
    };

    assert.equal(await fitMessageThumbnailSquares(payload), payload);
    assert.equal(await fitMessageThumbnailSquares(payload), payload);
    assert.equal(fetches, 1);
    assert.equal(warnings, 0);
  } finally {
    global.fetch = nativeFetch;
    console.warn = nativeWarn;
  }
});
