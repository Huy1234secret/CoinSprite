const { createCanvas, loadImage } = require('@napi-rs/canvas');

// === BASIC CONFIG ===
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720; // still 16:9, but content is shorter

// Card height presets (used for panel height)
const MAIN_CARD_HEIGHT = 180;   // main player card
const PARTY_CARD_HEIGHT = 140;  // 3 small party slots

// === COLOR PALETTE ===
const BG_TOP = '#05060a';
const BG_BOTTOM = '#141927';
const PANEL_FILL = '#161925';
const PANEL_ACCENT_PLAYER = '#3fc1c9'; // cyan
const PANEL_ACCENT_ENEMY = '#ef476f';  // red
const CARD_FILL = '#1d2233';
const CARD_FILL_ALT = '#191f2e';
const HP_BAR_BG = '#252a3a';
const HP_BAR_FILL = '#f45b69';
const HP_BAR_GLOW = '#ffd166';
const TEXT_MAIN = '#f7f8ff';
const TEXT_SOFT = '#a9b4d4';

// === HELPERS ===
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

function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const radial = ctx.createRadialGradient(
    CANVAS_WIDTH / 2,
    CANVAS_HEIGHT / 2,
    CANVAS_HEIGHT * 0.05,
    CANVAS_WIDTH / 2,
    CANVAS_HEIGHT / 2,
    CANVAS_HEIGHT * 0.7,
  );
  radial.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // center divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_WIDTH / 2, 40);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAvatar(ctx, image, x, y, size, accentColor) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;

  ctx.save();

  // glowing ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  const ringGrad = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 8);
  ringGrad.addColorStop(0, 'rgba(0,0,0,0)');
  ringGrad.addColorStop(1, `${accentColor}55`);
  ctx.strokeStyle = `${accentColor}cc`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = ringGrad;
  ctx.fill();

  // avatar circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#2a3042';
    ctx.fillRect(x, y, size, size);
  }

  ctx.restore();
}

function drawHealthBar(ctx, x, y, width, height, value, maxValue) {
  const safeMax = Math.max(maxValue, 1);
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const filledWidth = width * ratio;

  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = HP_BAR_BG;
  ctx.fill();

  drawRoundedRect(ctx, x, y, filledWidth, height, height / 2);
  const grad = ctx.createLinearGradient(x, y, x + width, y);
  grad.addColorStop(0, HP_BAR_FILL);
  grad.addColorStop(1, HP_BAR_GLOW);
  ctx.fillStyle = grad;
  ctx.fill();

  // top highlight
  if (filledWidth > 8) {
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 3);
    ctx.lineTo(x + filledWidth - 4, y + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawShield(ctx, x, y, size, value) {
  if (!value || value <= 0) return;

  ctx.save();
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  grad.addColorStop(0, '#1f8eed');
  grad.addColorStop(1, '#6dd5ff');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = '#e3f3ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.55}px Sans-Serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), cx, cy + 1);

  ctx.restore();
}

// === GENERIC UNIT CARD ===
// options:
//   variant: 'main' | 'small'
//   showName: boolean
//   accentColor: string
function drawUnitCard(ctx, unit, x, y, width, height, options = {}) {
  const {
    variant = 'main',
    showName = true,
    accentColor = '#ffffff',
  } = options;

  ctx.save();

  const radius = variant === 'main' ? 20 : 16;
  drawRoundedRect(ctx, x, y, width, height, radius);
  const cardGrad = ctx.createLinearGradient(x, y, x, y + height);
  cardGrad.addColorStop(0, CARD_FILL);
  cardGrad.addColorStop(1, CARD_FILL_ALT);
  ctx.fillStyle = cardGrad;
  ctx.fill();

  ctx.strokeStyle = `${accentColor}cc`;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // top highlight
  ctx.beginPath();
  ctx.moveTo(x + radius, y + 1.5);
  ctx.lineTo(x + width - radius, y + 1.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const padding = variant === 'main' ? 20 : 14;
  const innerX = x + padding;
  const innerY = y + padding;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const avatarSize = variant === 'main'
    ? Math.min(innerH * 0.7, innerW * 0.45)
    : Math.min(innerH * 0.8, innerW * 0.55);

  const avatarX = innerX;
  const avatarY = innerY + (innerH - avatarSize) / 2;

  drawAvatar(ctx, unit.image, avatarX, avatarY, avatarSize, accentColor);

  const infoX = avatarX + avatarSize + (variant === 'main' ? 18 : 12);
  const infoWidth = x + width - padding - infoX;

  // Name (optional)
  let levelY;
  if (showName) {
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = (variant === 'main' ? 'bold 26px Serif' : 'bold 20px Serif');
    const displayName = truncateWithEllipsis(
      ctx,
      unit.name ?? unit.label ?? 'Unknown',
      infoWidth,
    );
    ctx.fillText(displayName, infoX, innerY + 6);
    levelY = innerY + (variant === 'main' ? 38 : 32);
  } else {
    levelY = innerY + 12;
  }

  // Level
  ctx.fillStyle = TEXT_SOFT;
  ctx.font = (variant === 'main' ? '18px Sans-Serif' : '16px Sans-Serif');
  ctx.fillText(`Lv. ${unit.level ?? 1}`, infoX, levelY);

  // Shield
  const shieldSize = variant === 'main' ? 36 : 30;
  drawShield(ctx, infoX, levelY + 8, shieldSize, unit.shield ?? 0);

  // HP bar (bottom, full slot width for small cards)
  const hpBarHeight = variant === 'main' ? 18 : 14;
  let hpBarWidth;
  let hpBarX;

  if (variant === 'small') {
    // FULL WIDTH for team + enemies
    hpBarWidth = innerW;
    hpBarX = innerX;
  } else {
    hpBarWidth = infoWidth;
    hpBarX = infoX;
  }

  const hpBarY = y + height - padding - hpBarHeight - (variant === 'main' ? 8 : 4);

  drawHealthBar(
    ctx,
    hpBarX,
    hpBarY,
    hpBarWidth,
    hpBarHeight,
    unit.health ?? 100,
    unit.maxHealth ?? 100,
  );

  // HP text above bar
  ctx.fillStyle = '#dde4ff';
  ctx.font = (variant === 'main' ? '14px Sans-Serif' : '12px Sans-Serif');
  ctx.fillText(
    `${unit.health ?? 100} / ${unit.maxHealth ?? 100} HP`,
    hpBarX,
    hpBarY - 5,
  );

  ctx.restore();
}

// === ENEMY LAYOUT (auto size when many) ===
function layoutEnemySlotsRPG(count, areaX, areaY, areaWidth, areaHeight) {
  const clampedCount = Math.max(1, Math.min(5, count));

  let rows, colsTop, colsBottom;
  if (clampedCount === 1) {
    rows = 1;
    colsTop = 1;
  } else if (clampedCount <= 3) {
    rows = 1;
    colsTop = clampedCount;
  } else {
    rows = 2;
    colsTop = 3;
    colsBottom = clampedCount - 3;
  }

  const gap = 14;

  let cardHeight;
  if (clampedCount <= 2) {
    cardHeight = Math.min(190, areaHeight - gap * 2);
  } else if (clampedCount === 3) {
    cardHeight = Math.min(180, areaHeight - gap * 2);
  } else {
    cardHeight = Math.min(150, (areaHeight - gap * 3) / 2); // smaller when 4–5 enemies
  }

  const positions = [];

  function layoutRow(itemCount, rowIndex) {
    const rowY = areaY + gap + rowIndex * (cardHeight + gap);

    let maxWidth;
    if (clampedCount <= 2) maxWidth = 260;
    else if (clampedCount === 3) maxWidth = 240;
    else maxWidth = 220;

    const cardWidth = Math.min(
      maxWidth,
      (areaWidth - gap * (itemCount + 1)) / itemCount,
    );

    for (let i = 0; i < itemCount; i++) {
      const x = areaX + gap + i * (cardWidth + gap);
      positions.push({
        x,
        y: rowY,
        width: cardWidth,
        height: cardHeight,
      });
    }
  }

  if (rows === 1) {
    layoutRow(colsTop, 0);
  } else {
    layoutRow(colsTop, 0);
    layoutRow(colsBottom, 1);
  }

  if (clampedCount === 1) {
    const p = positions[0];
    const dx = (areaWidth - p.width) / 2;
    p.x = areaX + dx;
  }

  return positions.slice(0, clampedCount);
}

// === PLAYER SIDE ===
function drawPlayerSide(ctx, player) {
  const marginX = 32;
  const panelWidth = CANVAS_WIDTH / 2 - marginX * 1.5;
  const x = marginX;
  const y = 50;

  const topOffsetToMain = 40;
  const gapMainToParty = 32;
  const bottomPadding = 28;

  const panelHeight =
    topOffsetToMain +
    MAIN_CARD_HEIGHT +
    gapMainToParty +
    PARTY_CARD_HEIGHT +
    bottomPadding;

  ctx.save();

  // Panel frame (height reduced, bottom close to 3 slots)
  drawRoundedRect(ctx, x, y, panelWidth, panelHeight, 28);
  ctx.fillStyle = PANEL_FILL;
  ctx.fill();
  ctx.strokeStyle = `${PANEL_ACCENT_PLAYER}aa`;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Header banner: "PLAYER"
  const bannerHeight = 32;
  const bannerWidth = 120;
  drawRoundedRect(
    ctx,
    x + 18,
    y - bannerHeight / 2,
    bannerWidth,
    bannerHeight,
    16,
  );
  const bannerGrad = ctx.createLinearGradient(x, y, x + bannerWidth, y + bannerHeight);
  bannerGrad.addColorStop(0, '#26c6da');
  bannerGrad.addColorStop(1, '#00acc1');
  ctx.fillStyle = bannerGrad;
  ctx.fill();

  ctx.fillStyle = '#0c111c';
  ctx.font = 'bold 18px Serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLAYER', x + 18 + bannerWidth / 2, y);

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';

  // Main player card (shows name)
  const mainCardX = x + 24;
  const mainCardY = y + topOffsetToMain;
  const mainCardW = panelWidth - 48;
  const mainCardH = MAIN_CARD_HEIGHT;

  drawUnitCard(
    ctx,
    {
      ...player,
      maxHealth: player.maxHealth ?? 100,
      shield: player.shield ?? player.defense ?? 0,
    },
    mainCardX,
    mainCardY,
    mainCardW,
    mainCardH,
    {
      variant: 'main',
      showName: true,
      accentColor: PANEL_ACCENT_PLAYER,
    },
  );

  // 3 team slots (no names)
  const slotHeight = PARTY_CARD_HEIGHT;
  const partyY = mainCardY + mainCardH + gapMainToParty;
  const gap = 14;
  const slotCount = 3;
  const slotWidth = (panelWidth - 48 - gap * (slotCount - 1)) / slotCount;

  for (let i = 0; i < slotCount; i++) {
    const slotData = player.team?.[i] ?? {};
    const slotX = mainCardX + i * (slotWidth + gap);

    drawUnitCard(
      ctx,
      {
        ...slotData,
        health: slotData.health ?? 80,
        maxHealth: slotData.maxHealth ?? 100,
        level: slotData.level ?? Math.max(1, (player.level ?? 1) - 1),
        shield: slotData.shield ?? 0,
      },
      slotX,
      partyY,
      slotWidth,
      slotHeight,
      {
        variant: 'small',
        showName: false, // no names for 3 slots
        accentColor: slotData.accentColor ?? '#7b8ab8',
      },
    );
  }

  ctx.restore();
}

// === ENEMY SIDE ===
function drawEnemySide(ctx, enemies) {
  const marginX = 32;
  const panelWidth = CANVAS_WIDTH / 2 - marginX * 1.5;
  const x = CANVAS_WIDTH - panelWidth - marginX;
  const y = 50;

  const topOffset = 40;
  const bottomPadding = 28;
  // Use same panel height as player side (for symmetry)
  const panelHeight =
    topOffset +
    MAIN_CARD_HEIGHT +    // not actually used for a card here, but keeps same height
    32 +                  // spacing equivalent
    PARTY_CARD_HEIGHT +
    bottomPadding;

  ctx.save();

  drawRoundedRect(ctx, x, y, panelWidth, panelHeight, 28);
  ctx.fillStyle = PANEL_FILL;
  ctx.fill();
  ctx.strokeStyle = `${PANEL_ACCENT_ENEMY}aa`;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Header banner: ENEMIES
  const bannerHeight = 32;
  const bannerWidth = 130;
  drawRoundedRect(
    ctx,
    x + panelWidth - bannerWidth - 18,
    y - bannerHeight / 2,
    bannerWidth,
    bannerHeight,
    16,
  );
  const bannerGrad = ctx.createLinearGradient(
    x,
    y,
    x + bannerWidth,
    y + bannerHeight,
  );
  bannerGrad.addColorStop(0, '#ff5f6d');
  bannerGrad.addColorStop(1, '#ffc371');
  ctx.fillStyle = bannerGrad;
  ctx.fill();

  ctx.fillStyle = '#0c111c';
  ctx.font = 'bold 18px Serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ENEMIES', x + panelWidth - bannerWidth / 2 - 18, y);

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';

  const areaX = x + 18;
  const areaY = y + topOffset;
  const areaW = panelWidth - 36;
  const areaH = panelHeight - topOffset - bottomPadding;

  const enemyCount = Math.max(1, Math.min(5, enemies.length));
  const positions = layoutEnemySlotsRPG(enemyCount, areaX, areaY, areaW, areaH);

  for (let i = 0; i < positions.length; i++) {
    const src = enemies[i] ?? {};
    const pos = positions[i];

    drawUnitCard(
      ctx,
      {
        ...src,
        maxHealth: src.maxHealth ?? 100,
        shield: src.shield ?? 0,
      },
      pos.x,
      pos.y,
      pos.width,
      pos.height,
      {
        variant: 'small',
        showName: false, // no names for enemies
        accentColor: src.accentColor ?? PANEL_ACCENT_ENEMY,
      },
    );
  }

  ctx.restore();
}

// === IMAGE LOADING ===
async function loadImageSafe(source) {
  if (!source) return null;
  try {
    return await loadImage(source);
  } catch (err) {
    console.warn('Failed to load image:', err?.message || err);
    return null;
  }
}

// === MAIN ENTRY ===
async function createHuntBattleImage({ player, enemies }) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);

  // prepare player
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

  // prepare enemies (max 5)
  const preparedEnemies = await Promise.all(
    enemies.slice(0, 5).map(async (enemy) => ({
      ...enemy,
      image: await loadImageSafe(enemy.avatar),
    })),
  );

  drawPlayerSide(ctx, preparedPlayer);
  drawEnemySide(ctx, preparedEnemies);

  // VS text
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px Serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

  const vsRad = 70;
  const vsGrad = ctx.createRadialGradient(
    CANVAS_WIDTH / 2,
    CANVAS_HEIGHT / 2,
    0,
    CANVAS_WIDTH / 2,
    CANVAS_HEIGHT / 2,
    vsRad,
  );
  vsGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
  vsGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vsGrad;
  ctx.beginPath();
  ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, vsRad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { createHuntBattleImage };
