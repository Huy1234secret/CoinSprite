const fs = require('fs');
const path = require('path');
const { loadImage } = require('@napi-rs/canvas');

const LEVEL_CARD_MEDIA_DIR = path.join(__dirname, 'data', 'level-card-media');
const levelCardAssetCache = new Map();
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';

function safeCardMediaUrl(value, userId) {
  return value; // mock
}

function levelCardRenderOrigin() {
  return '';
}

async function loadLocalCardImage(url, userId) {
  const safe = safeCardMediaUrl(url, userId);
  if (!safe) return null;
  const match = safe.match(/^\/level-card-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  if (!match) return null;
  const filePath = path.join(LEVEL_CARD_MEDIA_DIR, match[1], `${match[2]}.${match[3]}`);

  let fingerprint;
  let isRemote = false;
  try {
    const metadata = fs.statSync(filePath);
    fingerprint = `${metadata.size}:${metadata.mtimeMs}`;
  } catch {
    isRemote = true;
    fingerprint = 'remote';
  }

  const cached = levelCardAssetCache.get(safe);
  if (cached?.fingerprint === fingerprint) return cached.loading;

  let loading;
  if (isRemote) {
    const remoteOrigin = levelCardRenderOrigin() || DEFAULT_DASHBOARD_BASE_URL;
    loading = fetch(`${remoteOrigin}${safe}`).then(async res => {
      if (!res.ok) return null;
      return loadImage(Buffer.from(await res.arrayBuffer()));
    }).catch(() => null);
  } else {
    loading = Promise.resolve().then(() => loadImage(fs.readFileSync(filePath))).catch(() => null);
  }

  const entry = { fingerprint, loading };
  levelCardAssetCache.set(safe, entry);
  if (levelCardAssetCache.size > 200) levelCardAssetCache.delete(levelCardAssetCache.keys().next().value);
  const image = await loading;
  if (!image && levelCardAssetCache.get(safe) === entry) levelCardAssetCache.delete(safe);
  return image;
}

// Test with a real URL from our test files
loadLocalCardImage('/level-card-media/12345678901234567/0123456789abcdef0123456789abcdef.png', '12345678901234567')
  .then(img => console.log('Mock fetch result:', img ? 'Success' : 'Failed'))
  .catch(err => console.error(err));
