const fs = require('fs');
async function test() {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Create a 1x1 png file buffer
  const pixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
  const pixel = Buffer.from(pixelBase64, 'base64');

  // mock response
  const arrayBuffer = pixel.buffer.slice(pixel.byteOffset, pixel.byteOffset + pixel.byteLength);

  const image = Buffer.from(arrayBuffer);

  console.log('image length:', image.length);
  console.log('image starts with png:', image.subarray(0, png.length).equals(png));
  console.log('image equals original:', image.equals(pixel));
}
test();
