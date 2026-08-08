const fs = require('fs');
const { loadImage } = require('@napi-rs/canvas');

async function run() {
  const fetchUrl = 'https://picsum.photos/200/300';
  console.log(`Fetching ${fetchUrl}...`);
  try {
    const buf = await fetch(fetchUrl).then(res => {
      if (!res.ok) throw new Error('Failed');
      return res.arrayBuffer();
    });
    const image = await loadImage(Buffer.from(buf));
    console.log("Success! Image dimensions:", image.width, image.height);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
