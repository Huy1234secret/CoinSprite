const assert = require('assert');

function safeCardMediaUrl(value, userId) {
  let url = String(value || '').trim();
  try {
    if (url.startsWith('http')) url = new URL(url).pathname;
  } catch {}
  const match = url.match(/^\/level-card-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  return match && match[1] === String(userId) ? url : '';
}

console.log(safeCardMediaUrl("https://panel.coin-sprite.com/level-card-media/12345678901234567/0123456789abcdef0123456789abcdef.png", "12345678901234567"));
