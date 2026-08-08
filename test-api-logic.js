const { renderLevelCard, renderPublishedLevelCard } = require('./src/leveling');

async function test() {
  const user = { id: '123' };
  const stats = { rank: 1, level: 1, xp: 0, required: 100 };

  const options = {
    origin: 'http://localhost:3000',
    key: 'test',
    fetchImpl: async (url, opts) => {
      console.log('fetch called:', url);
      // Simulate fetch failure
      throw new Error('fetch failed');
    }
  };

  await renderPublishedLevelCard(user, stats, options);
}
test().catch(console.error);
