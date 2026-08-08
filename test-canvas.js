const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
async function run() {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  // create dummy image
  ctx.fillStyle = 'red';
  ctx.fillRect(0,0,100,100);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync('/tmp/dummy.png', buf);

  try {
    const img = await loadImage(fs.readFileSync('/tmp/dummy.png'));
    console.log("loadImage(Buffer) success! width:", img.width);
  } catch (e) {
    console.error("loadImage(Buffer) failed:", e.message);
  }
}
run();
