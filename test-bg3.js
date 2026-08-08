const urlStr = "https://panel.coin-sprite.com/level-card-media/12345678901234567/0123456789abcdef0123456789abcdef.png";

let url = String(urlStr || '').trim();
try {
  if (url.startsWith('http')) url = new URL(url).pathname;
} catch {}
console.log("pathname:", url);
