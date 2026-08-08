const url = '/level-card-media/12345/0123456789abcdef0123456789abcdef.png';
const bgMatch = url.match(/\/([a-f0-9]{32}\.(?:png|jpg|webp))$/);
console.log('bgMatch:', bgMatch);
