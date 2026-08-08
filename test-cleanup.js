const { saveLevelCardDesign, LEVEL_CARD_MEDIA_DIR } = require('./src/leveling');
const fs = require('fs');
const path = require('path');

async function test() {
  const userId = '12345678901234567';
  fs.mkdirSync(path.join(LEVEL_CARD_MEDIA_DIR, userId), { recursive: true });

  // create dummy file
  const filename = '0123456789abcdef0123456789abcdef.png';
  fs.writeFileSync(path.join(LEVEL_CARD_MEDIA_DIR, userId, filename), 'dummy');

  const bgUrl = `/level-card-media/${userId}/${filename}`;

  saveLevelCardDesign(userId, {
    background: { imageUrl: bgUrl }
  });

  const exists = fs.existsSync(path.join(LEVEL_CARD_MEDIA_DIR, userId, filename));
  console.log("File exists after save:", exists);
}
test().catch(console.error);
