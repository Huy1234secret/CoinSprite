const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

async function test() {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  const img = await loadImage(pixel);

  const c1 = createCanvas(100, 100);
  c1.getContext('2d').drawImage(img, 0, 0);

  const c2 = createCanvas(100, 100);
  c2.getContext('2d').drawImage(img, 0, 0);

  console.log("Success! Image can be drawn twice.");
}
test().catch(console.error);
