const { levelCardRenderOrigin } = require('./src/leveling.js');

async function testFetchFallback() {
  const origin = levelCardRenderOrigin({ PUBLIC_WEB_BASE_URL: 'https://panel.coin-sprite.com/' });
  const safePath = '/level-card-media/123/456.png'; // fake path
  const fetchUrl = `${origin}${safePath}`;
  console.log(`Fallback fetch URL would be: ${fetchUrl}`);
}
testFetchFallback();
