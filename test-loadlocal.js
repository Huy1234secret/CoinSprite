const { renderLevelCard, loadLocalCardImage, LEVEL_CARD_MEDIA_DIR } = require('./src/leveling');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function test() {
  const userId = '11111111111111111';
  const id = crypto.randomBytes(16).toString('hex');
  const bgPath = path.join(LEVEL_CARD_MEDIA_DIR, userId, `${id}.png`);

  fs.mkdirSync(path.dirname(bgPath), { recursive: true });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(bgPath, pixel);

  const bgUrl = `/level-card-media/${userId}/${id}.png`;

  // Test loadLocalCardImage directly
  const image = await loadLocalCardImage(bgUrl, userId);
  if (!image) {
    console.error("FAILED to load local image!");
  } else {
    console.log("Successfully loaded local image, width:", image.width);
  }
}
test().catch(console.error);
