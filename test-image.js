const { loadImage } = require('@napi-rs/canvas');

async function test() {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  const img = await loadImage(pixel);
  console.log('img.width:', img.width);
  console.log('img.height:', img.height);
}
test().catch(console.error);
