const { renderPublishedLevelCard, renderLevelCard, saveLevelCardDesign, LEVEL_CARD_MEDIA_DIR } = require('./src/leveling');
const fs = require('fs');
const path = require('path');

async function test() {
  const userId = '12345678901234567';

  // Set up mock file
  fs.mkdirSync(path.join(LEVEL_CARD_MEDIA_DIR, userId), { recursive: true });
  const bgPath = path.join(LEVEL_CARD_MEDIA_DIR, userId, '0123456789abcdef0123456789abcdef.png');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(bgPath, pixel);

  // Save design
  saveLevelCardDesign(userId, {
    background: {
      imageUrl: `/level-card-media/${userId}/0123456789abcdef0123456789abcdef.png`,
      scale: 1,
      x: 0,
      y: 0
    }
  });

  const user = { id: userId, username: 'test' };
  const stats = { rank: 1, level: 1, xp: 0, required: 100 };

  // Test normal local render
  const localImage = await renderLevelCard(user, stats);
  console.log("Local render size:", localImage.length);

  // Test published fetch fallback
  const fallbackImage = await renderPublishedLevelCard(user, stats, { origin: '', key: '' });
  console.log("Fallback render size:", fallbackImage.length);
}

test().catch(console.error);
