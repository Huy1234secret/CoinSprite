const fs = require('fs');
const path = require('path');
const { saveLevelCardDesign, renderLevelCard, LEVEL_CARD_MEDIA_DIR } = require('./src/leveling');

async function test() {
  const userId = '12345678901234567';

  fs.mkdirSync(path.join(LEVEL_CARD_MEDIA_DIR, userId), { recursive: true });
  const bgPath = path.join(LEVEL_CARD_MEDIA_DIR, userId, '0123456789abcdef0123456789abcdef.png');
  // Create a 1x1 png file buffer
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(bgPath, pixel);

  const bgUrl = `/level-card-media/${userId}/0123456789abcdef0123456789abcdef.png`;

  saveLevelCardDesign(userId, {
    background: {
      imageUrl: bgUrl,
      scale: 1,
      x: 0,
      y: 0
    }
  });

  const user = {
    id: userId,
    username: 'TestUser',
    globalName: 'Test Global'
  };

  const stats = {
    rank: 1,
    level: 5,
    xp: 500,
    required: 1000
  };

  const imgBuffer = await renderLevelCard(user, stats);
  fs.writeFileSync('test-out.png', imgBuffer);
  console.log("Written test-out.png");
}

test().catch(console.error);
