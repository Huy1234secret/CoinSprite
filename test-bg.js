const { loadLocalCardImage, safeCardMediaUrl, normalizeLevelCardDesign } = require('./src/leveling');

const url = "https://panel.coin-sprite.com/level-card-media/12345/0123456789abcdef0123456789abcdef.png";
console.log("safeCardMediaUrl:", safeCardMediaUrl(url, "12345"));

const design = normalizeLevelCardDesign({ background: { imageUrl: url } }, "12345");
console.log("normalized background:", design.background);
