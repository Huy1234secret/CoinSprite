const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { RARITY_EMOJIS } = require('./shop');

const SHOP_PREVIEW_WIDTH = 1200;
const SHOP_PREVIEW_HEIGHT = 800;
const ITEM_PLACEHOLDER_EMOJI = '🛒';
const DEFAULT_CURRENCY_ICON = '🪙';

const SHOP_PADDING = 20;
const SHOP_COLS = 3;
const SHOP_ROWS = 2;
const SHOP_BACKGROUND_COLOR = '#2f3136';
const SHOP_CARD_BG_COLOR = '#202225';
const SHOP_TEXT_COLOR = '#ffffff';

const DISCORD_EMOJIS = {
  currency: '1474301520022470738',
  rarity: {
    common: '1447459423185272952',
    uncommon: '1447459432165408789',
    rare: '1447459432165408789',
    epic: '1447459425303527465',
    legendary: '1447459428273098835',
    mythical: '1447459430760317172',
    secret: '1447459434677665874',
  },
};

const RARITY_COLORS = {
  common: '#95a5a6',
  uncommon: '#2ecc71',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f1c40f',
  mythical: '#e74c3c',
  secret: '#000000',
};

const RARITY_EMOJI_SOURCES = {
  common: RARITY_EMOJIS.common,
  rare: RARITY_EMOJIS.rare,
  epic: RARITY_EMOJIS.epic,
  legendary: RARITY_EMOJIS.legendary,
  mythical: RARITY_EMOJIS.mythical,
  secret: RARITY_EMOJIS.secret,
};

// === BASIC CONFIG ===
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// Card & panel sizing
const MAIN_CARD_HEIGHT = 180;   // player main card
const PET_CARD_HEIGHT = 130;    // pets / enemies
const PANEL_TOP_OFFSET = 52;
const PANEL_GAP_MAIN_TO_ROW = 28;
const PANEL_BOTTOM_PADDING = 26;
const PANEL_HEIGHT =
  PANEL_TOP_OFFSET + MAIN_CARD_HEIGHT + PANEL_GAP_MAIN_TO_ROW + PET_CARD_HEIGHT + PANEL_BOTTOM_PADDING;

// === JUNGLE COLOR PALETTE ===
const COLORS = {
  bgTop: '#020a05',
  bgBottom: '#03140d',
  panelFill: '#050b08',
  panelBorderPlayer: '#2ecc71',
  panelBorderEnemy: '#e74c3c',
  cardFillTop: '#071710',
  cardFillBottom: '#050e09',
  hpBg: '#08130b',
  hpBorder: '#295437',
  textMain: '#f6ffe9',
  textSoft: '#c4dfc7',
};

// ================== HELPERS ==================

function truncateWithEllipsis(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function drawRoundedRect(ctx, x, y, width, height, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBackground(ctx) {
  // Jungle gradient
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  grad.addColorStop(0, COLORS.bgTop);
  grad.addColorStop(0.5, '#04150d');
  grad.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Soft jungle glows behind each side
  const radius = CANVAS_HEIGHT * 0.7;

  const leftGlow = ctx.createRadialGradient(
    CANVAS_WIDTH * 0.24,
    CANVAS_HEIGHT * 0.4,
    0,
    CANVAS_WIDTH * 0.24,
    CANVAS_HEIGHT * 0.4,
    radius,
  );
  leftGlow.addColorStop(0, 'rgba(46, 204, 113, 0.26)');
  leftGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const rightGlow = ctx.createRadialGradient(
    CANVAS_WIDTH * 0.76,
    CANVAS_HEIGHT * 0.4,
    0,
    CANVAS_WIDTH * 0.76,
    CANVAS_HEIGHT * 0.4,
    radius,
  );
  rightGlow.addColorStop(0, 'rgba(231, 76, 60, 0.24)');
  rightGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rightGlow;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Simple vine strokes (lightweight)
  ctx.strokeStyle = 'rgba(27, 94, 32, 0.35)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const offsetX = i * 60;
    ctx.beginPath();
    ctx.moveTo(40 + offsetX, CANVAS_HEIGHT);
    ctx.bezierCurveTo(
      120 + offsetX,
      CANVAS_HEIGHT * 0.75,
      20 + offsetX,
      CANVAS_HEIGHT * 0.4,
      80 + offsetX,
      0,
    );
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(56, 142, 60, 0.32)';
  for (let i = 0; i < 3; i++) {
    const offsetX = i * 60;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH - 40 - offsetX, CANVAS_HEIGHT);
    ctx.bezierCurveTo(
      CANVAS_WIDTH - 120 - offsetX,
      CANVAS_HEIGHT * 0.75,
      CANVAS_WIDTH - 20 - offsetX,
      CANVAS_HEIGHT * 0.4,
      CANVAS_WIDTH - 80 - offsetX,
      0,
    );
    ctx.stroke();
  }

  // Center divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_WIDTH / 2, 40);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAvatar(ctx, image, x, y, size, accentColor, options = {}) {
  const { rarityEmoji } = options;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;

  ctx.save();

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor || 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Circular mask
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#0a120c';
    ctx.fillRect(x, y, size, size);
  }

  ctx.restore();

  // Rarity badge (for enemies)
  if (rarityEmoji) {
    const badgeSize = Math.round(size * 0.35);
    const bx = x - badgeSize * 0.25;
    const by = y + size - badgeSize * 0.75;

    drawRoundedRect(ctx, bx, by, badgeSize, badgeSize, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(badgeSize * 0.7)}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rarityEmoji, bx + badgeSize / 2, by + badgeSize / 2 + 1);
  }
}

function drawHealthBar(ctx, x, y, width, height, value, maxValue) {
  const safeMax = Math.max(1, maxValue || 1);
  const hp = Math.max(0, Math.min(value || 0, safeMax));
  const ratio = hp / safeMax;
  const filledWidth = Math.max(3, width * ratio);

  // Background
  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = COLORS.hpBg;
  ctx.fill();
  ctx.strokeStyle = COLORS.hpBorder;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Fill (green → yellow → red)
  const grad = ctx.createLinearGradient(x, y, x + width, y);
  grad.addColorStop(0, '#2ecc71');
  grad.addColorStop(0.5, '#f1c40f');
  grad.addColorStop(1, '#e74c3c');

  drawRoundedRect(ctx, x, y, filledWidth, height, height / 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // HP text inside the bar
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(height * 0.7)}px Sans-Serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hp}/${safeMax} HP`, x + width / 2, y + height / 2 + 0.5);
}

function drawEffectSlots(ctx, effects, x, y, maxSlots, slotSize, gap) {
  if (!effects || !effects.length) return;

  const count = Math.min(effects.length, maxSlots);
  for (let i = 0; i < count; i++) {
    const sx = x + i * (slotSize + gap);
    const sy = y;

    drawRoundedRect(ctx, sx, sy, slotSize, slotSize, 6);
    ctx.fillStyle = 'rgba(3, 25, 16, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(131, 232, 176, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const data = effects[i];
    let iconText = '';
    if (typeof data === 'string') {
      iconText = data;
    } else if (data && typeof data === 'object') {
      iconText = data.emoji || data.icon || data.short || '';
    }
    if (iconText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(slotSize * 0.7)}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconText, sx + slotSize / 2, sy + slotSize / 2 + 0.5);
    }
  }
}

function drawSidePanel(ctx, x, y, width, height, accentColor, title, align) {
  ctx.save();

  drawRoundedRect(ctx, x, y, width, height, 26);
  ctx.fillStyle = COLORS.panelFill;
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // header banner
  const bannerWidth = 140;
  const bannerHeight = 32;
  const bannerX = align === 'left' ? x + 24 : x + width - bannerWidth - 24;
  const bannerY = y - bannerHeight / 2;

  drawRoundedRect(ctx, bannerX, bannerY, bannerWidth, bannerHeight, 16);
  const bannerGrad = ctx.createLinearGradient(
    bannerX,
    bannerY,
    bannerX + bannerWidth,
    bannerY + bannerHeight,
  );
  if (align === 'left') {
    bannerGrad.addColorStop(0, '#66bb6a');
    bannerGrad.addColorStop(1, '#a5d6a7');
  } else {
    bannerGrad.addColorStop(0, '#ef5350');
    bannerGrad.addColorStop(1, '#ffb74d');
  }
  ctx.fillStyle = bannerGrad;
  ctx.fill();

  ctx.fillStyle = '#02110b';
  ctx.font = 'bold 18px Sans-Serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, bannerX + bannerWidth / 2, bannerY + bannerHeight / 2);

  ctx.restore();
}

// === GENERIC UNIT CARD ===
//
// variants:
// - 'playerMain': main player card with name + hunt level + effects
// - 'ally': pet / army (no name, level + effects)
// - 'enemy': monster (no name, level + effects + rarity badge on avatar)
function drawUnitCard(ctx, unit, x, y, width, height, options = {}) {
  const variant = options.variant || 'ally';
  const accentColor = options.accentColor || 'rgba(255,255,255,0.6)';
  const isMain = variant === 'playerMain';
  const isEnemy = variant === 'enemy';

  ctx.save();

  const radius = isMain ? 22 : 18;
  drawRoundedRect(ctx, x, y, width, height, radius);
  const cardGrad = ctx.createLinearGradient(x, y, x, y + height);
  cardGrad.addColorStop(0, COLORS.cardFillTop);
  cardGrad.addColorStop(1, COLORS.cardFillBottom);
  ctx.fillStyle = cardGrad;
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  const padding = isMain ? 18 : 12;
  const innerX = x + padding;
  const innerY = y + padding;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const avatarSize = isMain
    ? Math.min(innerH * 0.9, innerW * 0.4)
    : Math.min(innerH * 0.85, innerW * 0.55);
  const avatarX = innerX;
  const avatarY = innerY + (innerH - avatarSize) / 2;

  const rarityIcon = isEnemy
    ? unit.rarityEmoji || unit.rarityIcon || unit.rarity || null
    : null;

  drawAvatar(ctx, unit.image, avatarX, avatarY, avatarSize, accentColor, {
    rarityEmoji: rarityIcon,
  });

  const infoX = avatarX + avatarSize + (isMain ? 16 : 10);
  const infoRight = innerX + innerW;
  const infoWidth = Math.max(0, infoRight - infoX);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (isMain) {
    const name = truncateWithEllipsis(
      ctx,
      unit.name || unit.username || 'Unknown',
      infoWidth,
    );
    ctx.fillStyle = COLORS.textMain;
    ctx.font = 'bold 24px Sans-Serif';
    ctx.fillText(name, infoX, innerY + 6);

    const huntLevel = unit.huntLevel != null ? unit.huntLevel : unit.level || 1;
    ctx.fillStyle = COLORS.textSoft;
    ctx.font = '16px Sans-Serif';
    ctx.fillText(`Hunt Lv. ${huntLevel}`, infoX, innerY + 30);

    // effects row
    const effectsY = innerY + 44;
    drawEffectSlots(ctx, unit.effects || [], infoX, effectsY, 4, 22, 6);
  } else {
    const lvl = unit.level || 1;
    ctx.fillStyle = COLORS.textSoft;
    ctx.font = '16px Sans-Serif';
    ctx.fillText(`Lv. ${lvl}`, infoX, innerY + 14);

    const effectsY = innerY + 26;
    drawEffectSlots(ctx, unit.effects || [], infoX, effectsY, 3, 18, 4);
  }

  // HP bar: full width, under card, same style for pets & enemies
  const hpBarHeight = isMain ? 18 : 14;
  const hpBarX = innerX;
  const hpBarY = y + height - padding - hpBarHeight;
  const hpBarWidth = width - padding * 2;
  drawHealthBar(
    ctx,
    hpBarX,
    hpBarY,
    hpBarWidth,
    hpBarHeight,
    unit.health ?? unit.hp ?? 0,
    unit.maxHealth ?? unit.maxHp ?? 1,
  );

  ctx.restore();
}

// === ENEMY LAYOUT (1–5 cards) ===
function layoutEnemySlots(count, areaX, areaY, areaW, areaH) {
  const n = Math.max(1, Math.min(5, count || 0));
  const gap = 18;

  let rows;
  let topCount;
  let bottomCount;

  if (n <= 3) {
    rows = 1;
    topCount = n;
  } else {
    rows = 2;
    topCount = 3;
    bottomCount = n - 3;
  }

  const cardHeight =
    rows === 1
      ? Math.min(PET_CARD_HEIGHT + 10, areaH - gap * 2)
      : Math.min(PET_CARD_HEIGHT, (areaH - gap * 3) / 2);

  const positions = [];

  function layoutRow(rowIndex, countInRow) {
    if (!countInRow) return;
    const widthAvailable = areaW - gap * (countInRow + 1);
    const cardWidth = Math.min(220, widthAvailable / countInRow);
    const y = areaY + gap + rowIndex * (cardHeight + gap);

    for (let i = 0; i < countInRow; i++) {
      const x = areaX + gap + i * (cardWidth + gap);
      positions.push({ x, y, width: cardWidth, height: cardHeight });
    }
  }

  if (rows === 1) {
    layoutRow(0, topCount);
  } else {
    layoutRow(0, topCount);
    layoutRow(1, bottomCount);
  }

  // center single enemy
  if (n === 1 && positions[0]) {
    const p = positions[0];
    p.x = areaX + (areaW - p.width) / 2;
    p.y = areaY + (areaH - cardHeight) / 2;
  }

  return positions.slice(0, n);
}

// ================== PLAYER SIDE ==================

function drawPlayerSide(ctx, player) {
  const marginX = 40;
  const panelWidth = CANVAS_WIDTH / 2 - marginX * 1.5;
  const x = marginX;
  const y = 60;

  drawSidePanel(
    ctx,
    x,
    y,
    panelWidth,
    PANEL_HEIGHT,
    COLORS.panelBorderPlayer,
    'PLAYER',
    'left',
  );

  const mainCardX = x + 26;
  const mainCardY = y + PANEL_TOP_OFFSET;
  const mainCardW = panelWidth - 52;
  const mainCardH = MAIN_CARD_HEIGHT;

  drawUnitCard(
    ctx,
    {
      ...player,
    },
    mainCardX,
    mainCardY,
    mainCardW,
    mainCardH,
    {
      variant: 'playerMain',
      accentColor: COLORS.panelBorderPlayer,
    },
  );

  // 3 pet / army cards
  const pets = Array.isArray(player.team) ? player.team.slice(0, 3) : [];
  const rowY = mainCardY + mainCardH + PANEL_GAP_MAIN_TO_ROW;
  const slots = 3;
  const gap = 16;
  const slotWidth = (panelWidth - 52 - gap * (slots - 1)) / slots;
  const slotHeight = PET_CARD_HEIGHT;

  for (let i = 0; i < slots; i++) {
    const pet = pets[i] || {};
    const slotX = mainCardX + i * (slotWidth + gap);

    drawUnitCard(
      ctx,
      {
        ...pet,
      },
      slotX,
      rowY,
      slotWidth,
      slotHeight,
      {
        variant: 'ally',
        accentColor: pet.accentColor || '#7fbf8c',
      },
    );
  }
}

// ================== ENEMY SIDE ==================

function drawEnemySide(ctx, enemies) {
  const marginX = 40;
  const panelWidth = CANVAS_WIDTH / 2 - marginX * 1.5;
  const x = CANVAS_WIDTH - panelWidth - marginX;
  const y = 60;

  drawSidePanel(
    ctx,
    x,
    y,
    panelWidth,
    PANEL_HEIGHT,
    COLORS.panelBorderEnemy,
    'ENEMIES',
    'right',
  );

  const areaX = x + 26;
  const areaY = y + PANEL_TOP_OFFSET;
  const areaW = panelWidth - 52;
  const areaH = PANEL_HEIGHT - PANEL_TOP_OFFSET - PANEL_BOTTOM_PADDING;

  const list = Array.isArray(enemies) ? enemies : [];
  const positions = layoutEnemySlots(list.length, areaX, areaY, areaW, areaH);

  for (let i = 0; i < positions.length; i++) {
    const enemy = list[i] || {};
    const pos = positions[i];

    drawUnitCard(
      ctx,
      {
        ...enemy,
      },
      pos.x,
      pos.y,
      pos.width,
      pos.height,
      {
        variant: 'enemy',
        accentColor: enemy.accentColor || COLORS.panelBorderEnemy,
      },
    );
  }
}

// ================== VS MARKER ==================

function drawVsMarker(ctx) {
  ctx.save();
  const cx = CANVAS_WIDTH / 2;
  const cy = CANVAS_HEIGHT / 2;

  ctx.fillStyle = '#fdfcf5';
  ctx.font = 'bold 64px Serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', cx, cy - 4);

  // ring
  const ringR = 70;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, ringR + 30);
  glow.addColorStop(0, 'rgba(255,255,255,0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR + 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ================== IMAGE LOADING ==================

async function loadImageSafe(source) {
  if (!source) return null;
  try {
    return await loadImage(source);
  } catch (err) {
    console.warn('Failed to load image:', err?.message || err);
    return null;
  }
}

// ================== MAIN ENTRY ==================

async function createHuntBattleImage({ player, enemies }) {
  if (!player) {
    throw new Error('createHuntBattleImage: "player" is required');
  }

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);

  // Player + pets
  const playerAvatar = await loadImageSafe(player.avatar);
  const preparedTeam = await Promise.all(
    (player.team || []).slice(0, 3).map(async (slot) => ({
      ...slot,
      image: await loadImageSafe(slot?.avatar),
    })),
  );

  const preparedPlayer = {
    ...player,
    image: playerAvatar,
    team: preparedTeam,
  };

  // Enemies (1–5)
  const enemyList = Array.isArray(enemies) ? enemies.slice(0, 5) : [];
  const preparedEnemies = await Promise.all(
    enemyList.map(async (enemy) => ({
      ...enemy,
      image: await loadImageSafe(enemy.avatar),
    })),
  );

  drawPlayerSide(ctx, preparedPlayer);
  drawEnemySide(ctx, preparedEnemies);
  drawVsMarker(ctx);

  return canvas.toBuffer('image/png');
}

// ================== SHOP PREVIEW HELPERS ==================

function getEmojiUrl(id) {
  return `https://cdn.discordapp.com/emojis/${id}.png`;
}

function getEmojiImageSource(emoji) {
  if (!emoji) {
    return null;
  }

  if (/^\d+$/.test(emoji)) {
    return getEmojiUrl(emoji);
  }

  const match = String(emoji).match(/<a?:[^:]+:(\d+)>/);
  if (match) {
    return getEmojiUrl(match[1]);
  }

  return null;
}

function getRarityEmojiSource(rarity) {
  if (!rarity) {
    return null;
  }

  const rarityKey = String(rarity).toLowerCase();
  const emoji = RARITY_EMOJI_SOURCES[rarityKey];
  return getEmojiImageSource(emoji);
}

function resolveEmojiSource(source) {
  if (!source) {
    return null;
  }

  if (/^https?:\/\//.test(source)) {
    return source;
  }

  if (/^\d+$/.test(source)) {
    return getEmojiUrl(source);
  }

  return source;
}

function getPlaceholderItems() {
  return [
    { name: 'Steel Sword', price: 150, stock: 5, rarity: 'common', image: null },
    { name: 'Golden Apple', price: 50, stock: 99, rarity: 'uncommon', image: null },
    { name: 'Dragon Egg', price: 5000, stock: 1, rarity: 'legendary', image: null },
    { name: 'Health Potion', price: 25, stock: 15, rarity: 'common', image: null },
    { name: 'Magic Wand', price: 1200, stock: 3, rarity: 'rare', image: null },
    { name: 'Ancient Shield', price: 850, stock: 2, rarity: 'epic', image: null },
  ];
}

async function ensureShopAssets() {
  return {
    currencyIcon: DISCORD_EMOJIS.currency,
    rarities: DISCORD_EMOJIS.rarity,
  };
}

async function createShopImage(items = getPlaceholderItems(), currencyIconId = DISCORD_EMOJIS.currency) {
  const canvas = createCanvas(SHOP_PREVIEW_WIDTH, SHOP_PREVIEW_HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = SHOP_BACKGROUND_COLOR;
  ctx.fillRect(0, 0, SHOP_PREVIEW_WIDTH, SHOP_PREVIEW_HEIGHT);

  const cardWidth = (SHOP_PREVIEW_WIDTH - SHOP_PADDING * (SHOP_COLS + 1)) / SHOP_COLS;
  const rows = Math.max(SHOP_ROWS, Math.ceil(items.length / SHOP_COLS));
  const cardHeight = (SHOP_PREVIEW_HEIGHT - SHOP_PADDING * (rows + 1)) / rows;

  const currencyIcon = await loadImageSafe(resolveEmojiSource(currencyIconId));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const colIndex = i % SHOP_COLS;
    const rowIndex = Math.floor(i / SHOP_COLS);

    const x = SHOP_PADDING + colIndex * (cardWidth + SHOP_PADDING);
    const y = SHOP_PADDING + rowIndex * (cardHeight + SHOP_PADDING);

    await drawCard(ctx, x, y, cardWidth, cardHeight, item, currencyIcon);
  }

  return canvas.toBuffer('image/png');
}

async function drawCard(ctx, x, y, w, h, item, currencyIcon) {
  const radius = 15;
  const rarity = item.rarity || 'common';
  const rarityColor = RARITY_COLORS[rarity] || '#ffffff';

  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = SHOP_CARD_BG_COLOR;
  ctx.fill();
  ctx.strokeStyle = rarityColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  const imgSize = Math.min(120, w * 0.7);
  const imgX = x + w / 2 - imgSize / 2;
  const imgY = y + 25;

  const itemEmoji = item.emoji || ITEM_PLACEHOLDER_EMOJI;
  const itemEmojiSource = getEmojiImageSource(itemEmoji);
  if (itemEmojiSource) {
    const img = await loadImageSafe(itemEmojiSource);
    if (img) {
      ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
    } else {
      drawPlaceholderImage(ctx, imgX, imgY, imgSize, rarityColor);
    }
  } else {
    drawPlaceholderImage(ctx, imgX, imgY, imgSize, rarityColor);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(imgSize * 0.5)}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(itemEmoji, imgX + imgSize / 2, imgY + imgSize / 2 + 2);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = 'bold 26px Sans-Serif';
  ctx.fillStyle = SHOP_TEXT_COLOR;
  ctx.fillText(item.name || 'Mystery Item', x + w / 2, y + imgSize + 70);

  const rarityY = y + imgSize + 90;
  const rarityText = rarity.toUpperCase();
  const rarityEmojiSource = getRarityEmojiSource(rarity);
  ctx.font = '18px Sans-Serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = rarityColor;
  if (rarityEmojiSource) {
    const rarityEmojiImage = await loadImageSafe(rarityEmojiSource);
    if (rarityEmojiImage) {
      const iconSize = 18;
      const gap = 8;
      const textWidth = ctx.measureText(rarityText).width;
      const groupWidth = iconSize + gap + textWidth;
      const startX = x + w / 2 - groupWidth / 2;
      ctx.drawImage(rarityEmojiImage, startX, rarityY + 6, iconSize, iconSize);
      ctx.textAlign = 'left';
      ctx.fillText(rarityText, startX + iconSize + gap, rarityY + 22);
    } else {
      ctx.fillText(rarityText, x + w / 2, rarityY + 22);
    }
  } else {
    ctx.fillText(rarityText, x + w / 2, rarityY + 22);
  }

  const priceY = y + h - 70;
  const iconSize = 28;
  ctx.font = 'bold 24px Sans-Serif';
  ctx.textAlign = 'center';

  const priceText = `${item.price ?? 0}`;
  const priceWidth = ctx.measureText(priceText).width;

  const fullPriceWidth = priceWidth + 10 + iconSize;
  const priceStartX = x + w / 2 - fullPriceWidth / 2;

  ctx.fillStyle = '#f1c40f';
  ctx.textAlign = 'left';
  ctx.fillText(priceText, priceStartX, priceY + 22);

  if (currencyIcon) {
    ctx.drawImage(currencyIcon, priceStartX + priceWidth + 10, priceY, iconSize, iconSize);
  } else {
    ctx.fillText('Gold', priceStartX + priceWidth + 10, priceY + 22);
  }

  ctx.textAlign = 'center';
  ctx.font = '20px Sans-Serif';
  ctx.fillStyle = '#95a5a6';
  const stockText = item.stock != null ? `Stock: ${item.stock}` : 'Stock: --';
  ctx.fillText(stockText, x + w / 2, y + h - 20);
}

function roundedRect(ctx, x, y, width, height, radius) {
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
}

function drawPlaceholderImage(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = '#2c2f33';
  ctx.fillRect(x, y, size, size);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = 'bold 16px Sans-Serif';
  ctx.textAlign = 'center';
  ctx.fillText('ITEM', x + size / 2, y + size / 2 + 5);
  ctx.restore();
}

module.exports = {
  createHuntBattleImage,
  ensureShopAssets,
  createShopImage,
  getPlaceholderItems,
  ITEM_PLACEHOLDER_EMOJI,
};
