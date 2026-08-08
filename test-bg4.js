const { loadLocalCardImage, safeCardMediaUrl, normalizeLevelCardDesign } = require('./src/leveling');
console.log(safeCardMediaUrl("/level-card-media/12345678901234567/0123456789abcdef0123456789abcdef.png", "12345678901234567"));
