const { createCanvas, loadImage } = require('@napi-rs/canvas');

const THUMBNAIL_SIZE = 160;
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 2200;

function isRemoteImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cloneComponents(components) {
  return JSON.parse(JSON.stringify(components));
}

function collectThumbnailMedia(component, matches = []) {
  if (!component || typeof component !== 'object') return matches;
  const media = component.accessory?.type === 11 ? component.accessory.media : null;
  if (media?.url && isRemoteImageUrl(media.url)) matches.push(media);
  if (Array.isArray(component.components)) {
    component.components.forEach((child) => collectThumbnailMedia(child, matches));
  }
  if (Array.isArray(component.items)) {
    component.items.forEach((item) => collectThumbnailMedia(item, matches));
  }
  return matches;
}

async function fetchImageBuffer(url) {
  if (typeof fetch !== 'function') throw new Error('Image fetch is not available in this Node.js runtime.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CoinSprite thumbnail fitter' },
    });
    if (!response.ok) throw new Error(`Image request failed with ${response.status}.`);
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (length > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail image is too large.');
    const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (type && !type.startsWith('image/')) throw new Error('Thumbnail URL did not return an image.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail image is too large.');
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function squareThumbnailAttachment(url, index) {
  const source = await fetchImageBuffer(url);
  const image = await loadImage(source);
  if (!image.width || !image.height) throw new Error('Thumbnail image has invalid dimensions.');

  const canvas = createCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const scale = Math.min(THUMBNAIL_SIZE / image.width, THUMBNAIL_SIZE / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const x = Math.round((THUMBNAIL_SIZE - width) / 2);
  const y = Math.round((THUMBNAIL_SIZE - height) / 2);
  context.drawImage(image, x, y, width, height);

  const name = `coinsprite-thumbnail-${Date.now().toString(36)}-${index}.png`;
  return { attachment: canvas.toBuffer('image/png'), name };
}

async function fitMessageThumbnailSquares(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.components)) return payload;

  let components;
  try {
    components = cloneComponents(payload.components);
  } catch {
    return payload;
  }

  const mediaItems = [];
  components.forEach((component) => collectThumbnailMedia(component, mediaItems));
  if (!mediaItems.length) return payload;

  const files = payload.files ? (Array.isArray(payload.files) ? [...payload.files] : [payload.files]) : [];
  let converted = 0;
  for (const media of mediaItems) {
    try {
      const file = await squareThumbnailAttachment(media.url, files.length + converted + 1);
      files.push(file);
      media.url = `attachment://${file.name}`;
      converted += 1;
    } catch (error) {
      console.warn(`Could not fit thumbnail into a square: ${error?.message || error}`);
    }
  }

  if (!converted) return payload;
  return { ...payload, components, files };
}

module.exports = {
  fitMessageThumbnailSquares,
};
