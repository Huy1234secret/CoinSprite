const fs = require('fs');
const path = require('path');
const https = require('https');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const assetDir = path.join(__dirname, '..', 'data', 'shop-assets');

const assetsToDownload = [
  {
    filename: 'currency.png',
    url: 'https://github.com/twitter/twemoji/raw/master/assets/72x72/1f4b0.png'
  },
  {
    filename: 'rarity-common.png',
    url: 'https://github.com/twitter/twemoji/raw/master/assets/72x72/2b50.png'
  },
  {
    filename: 'rarity-legendary.png',
    url: 'https://github.com/twitter/twemoji/raw/master/assets/72x72/1f451.png'
  },
  {
    filename: 'item-blade.png',
    url: 'https://placehold.co/600x600/4e5d94/FFFFFF/png?text=Placeholder+Blade'
  },
  {
    filename: 'item-scout.png',
    url: 'https://placehold.co/600x600/437c90/FFFFFF/png?text=Scout+Map'
  },
  {
    filename: 'item-cape.png',
    url: 'https://placehold.co/600x600/6f1d1b/FFFFFF/png?text=Crimson+Cloak'
  },
  {
    filename: 'item-brew.png',
    url: 'https://placehold.co/600x600/2f3e46/FFFFFF/png?text=Alchemist+Brew'
  }
];

function downloadFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const status = response.statusCode;

        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          if (redirectCount >= 5) {
            response.resume();
            return reject(new Error(`Too many redirects while downloading ${url}`));
          }

          const redirectUrl = new URL(response.headers.location, url).toString();
          response.resume();
          return downloadFile(redirectUrl, destination, redirectCount + 1).then(resolve).catch(reject);
        }

        if (status !== 200) {
          response.resume();
          return reject(new Error(`Failed to download ${url}. Status code: ${status}`));
        }

        const fileStream = fs.createWriteStream(destination);

        response.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(resolve));
        fileStream.on('error', (error) => {
          fs.unlink(destination, () => reject(error));
        });
      })
      .on('error', (error) => {
        fs.unlink(destination, () => reject(error));
      });
  });
}

async function ensureShopAssets() {
  fs.mkdirSync(assetDir, { recursive: true });

  const downloads = assetsToDownload.map(async (asset) => {
    const destination = path.join(assetDir, asset.filename);
    if (!fs.existsSync(destination)) {
      await downloadFile(asset.url, destination);
    }
    return destination;
  });

  await Promise.all(downloads);

  return {
    currencyIcon: path.join(assetDir, 'currency.png'),
    rarities: {
      common: path.join(assetDir, 'rarity-common.png'),
      legendary: path.join(assetDir, 'rarity-legendary.png')
    },
    items: {
      blade: path.join(assetDir, 'item-blade.png'),
      scout: path.join(assetDir, 'item-scout.png'),
      cape: path.join(assetDir, 'item-cape.png'),
      brew: path.join(assetDir, 'item-brew.png')
    }
  };
}

const applyText = (canvas, text, baseFontSize, maxWidth) => {
  const ctx = canvas.getContext('2d');
  let fontSize = baseFontSize;
  do {
    ctx.font = `bold ${fontSize -= 2}px sans-serif`;
  } while (ctx.measureText(text).width > maxWidth && fontSize > 10);
  return ctx.font;
};

function roundedImageClip(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.clip();
}

async function loadImageSafe(source) {
  if (!source) {
    console.warn('Skipping image load because source was falsy:', source);
    return null;
  }

  try {
    return await loadImage(source);
  } catch (error) {
    console.warn(`Failed to load image ${source}:`, error);
    return null;
  }
}

async function createShopImage(items, currencyIconPath) {
  const cardW = 300;
  const cardH = 380;
  const gap = 20;
  const margin = 20;

  const canvasW = (cardW * 2) + gap + (margin * 2);
  const canvasH = (cardH * 2) + gap + (margin * 2);

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2F3136';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const currencyIcon = currencyIconPath ? await loadImageSafe(currencyIconPath) : null;

  for (let i = 0; i < 4; i++) {
    const item = items[i] || { name: 'Empty', price: 0 };

    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (cardW + gap);
    const y = margin + row * (cardH + gap);

    ctx.fillStyle = '#202225';
    ctx.fillRect(x, y, cardW, cardH);

    const headerH = 50;
    const iconSize = 35;
    const padding = 10;

    const rarityX = x + cardW - iconSize - padding;
    const rarityY = y + (headerH - iconSize) / 2;

    const rarityImg = item.rarityURL ? await loadImageSafe(item.rarityURL) : null;
    if (rarityImg) {
      ctx.drawImage(rarityImg, rarityX, rarityY, iconSize, iconSize);
    } else {
      ctx.beginPath();
      ctx.arc(rarityX + iconSize / 2, rarityY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'purple';
      ctx.fill();
    }

    const maxTextW = cardW - iconSize - (padding * 3);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = applyText(canvas, item.name, 32, maxTextW);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.name, x + padding, y + headerH / 2);

    const imgSize = cardW - (padding * 2);
    const imgX = x + padding;
    const imgY = y + headerH;
    const radius = 15;

    ctx.save();
    roundedImageClip(ctx, imgX, imgY, imgSize, imgSize, radius);

    const itemImg = item.imageURL ? await loadImageSafe(item.imageURL) : null;
    if (itemImg) {
      ctx.drawImage(itemImg, imgX, imgY, imgSize, imgSize);
    } else {
      const grd = ctx.createLinearGradient(imgX, imgY, imgX, imgY + imgSize);
      grd.addColorStop(0, '#4e5d94');
      grd.addColorStop(1, '#23272a');
      ctx.fillStyle = grd;
      ctx.fillRect(imgX, imgY, imgSize, imgSize);
    }

    ctx.restore();

    const footerY = imgY + imgSize + 15;
    const currencySize = 30;

    if (currencyIcon) {
      ctx.drawImage(currencyIcon, x + padding, footerY, currencySize, currencySize);
    } else {
      ctx.beginPath();
      ctx.arc(x + padding + currencySize / 2, footerY + currencySize / 2, currencySize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
    }

    const priceX = x + padding + currencySize + 10;
    const maxPriceW = cardW - (padding * 2) - currencySize - 10;

    ctx.fillStyle = '#FFD700';
    ctx.font = applyText(canvas, item.price.toLocaleString(), 30, maxPriceW);
    ctx.textAlign = 'left';
    ctx.fillText(item.price.toLocaleString(), priceX, footerY + currencySize / 2);
  }

  return canvas.toBuffer();
}

function getPlaceholderItems(assetPaths) {
  return [
    {
      name: 'Placeholder Blade',
      price: 1200,
      imageURL: assetPaths.items.blade,
      rarityURL: assetPaths.rarities.legendary
    },
    {
      name: 'Scout Map',
      price: 850,
      imageURL: assetPaths.items.scout,
      rarityURL: assetPaths.rarities.common
    },
    {
      name: 'Crimson Cloak',
      price: 1500,
      imageURL: assetPaths.items.cape,
      rarityURL: assetPaths.rarities.legendary
    },
    {
      name: 'Alchemist Brew',
      price: 500,
      imageURL: assetPaths.items.brew,
      rarityURL: assetPaths.rarities.common
    }
  ];
}

module.exports = {
  ensureShopAssets,
  createShopImage,
  getPlaceholderItems
};
