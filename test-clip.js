const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

async function test() {
  const canvas = createCanvas(100, 100);
  const context = canvas.getContext('2d');

  function roundedRect(context, x, y, width, height, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  context.fillStyle = 'red';
  context.fillRect(0, 0, 100, 100);

  context.save();
  roundedRect(context, 0, 0, 100, 100, 30);
  context.clip();

  // create a 100x100 green image buffer
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  const img = await loadImage(pixel);

  context.drawImage(img, 0, 0, 100, 100);
  context.restore();

  fs.writeFileSync('test-clip.png', canvas.toBuffer('image/png'));
  console.log('Saved test-clip.png');
}
test().catch(console.error);
