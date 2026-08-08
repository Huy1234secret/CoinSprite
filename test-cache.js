const fs = require('fs');
const path = require('path');
const { renderLevelCard, LEVEL_CARD_MEDIA_DIR, safeCardMediaUrl } = require('./src/leveling');
const crypto = require('crypto');

async function test() {
  const userId = '99999999999999999';
  const id = crypto.randomBytes(16).toString('hex');
  const bgPath = path.join(LEVEL_CARD_MEDIA_DIR, userId, `${id}.png`);

  fs.mkdirSync(path.dirname(bgPath), { recursive: true });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(bgPath, pixel);

  const bgUrl = `/level-card-media/${userId}/${id}.png`;

  const design = { background: { imageUrl: bgUrl, scale: 1, x: 0, y: 0 } };
  const user = { id: userId, username: 'test' };
  const stats = { rank: 1, level: 1, xp: 0, required: 100 };

  console.log("Render 1");
  const img1 = await renderLevelCard(user, stats, design);
  console.log("img1 size:", img1.length);

  console.log("Render 2 (should hit cache)");
  const img2 = await renderLevelCard(user, stats, design);
  console.log("img2 size:", img2.length);
}
test();
