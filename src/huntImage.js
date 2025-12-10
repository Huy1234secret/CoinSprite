const { createCanvas, loadImage } = require('@napi-rs/canvas');

const CANVAS_WIDTH = 1500;
const CANVAS_HEIGHT = 800;
const BACKGROUND_COLOR = '#11131a';
const PANEL_COLOR = '#191c26';
const HIGHLIGHT_COLOR = '#3fc1c9';
const HEALTH_BAR_BG = '#2b2f3b';
const HEALTH_BAR_FILL = '#ef476f';
const SLOT_BG = '#1f2430';

function truncateWithEllipsis(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

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
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#0e1016');
  gradient.addColorStop(1, '#151822');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.strokeStyle = '#222836';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_WIDTH / 2, 40);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAvatar(ctx, image, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#2c3141';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function drawHealthBar(ctx, x, y, width, height, value, maxValue) {
  const safeMax = Math.max(maxValue, 1);
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const filledWidth = width * ratio;

  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = HEALTH_BAR_BG;
  ctx.fill();

  drawRoundedRect(ctx, x, y, filledWidth, height, height / 2);
  ctx.fillStyle = HEALTH_BAR_FILL;
  ctx.fill();
}

function drawShield(ctx, x, y, size, count) {
  ctx.save();
  ctx.font = `bold ${size - 6}px Sans-Serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🛡️', x + size / 2, y + size / 2 + 2);

  if (count > 0) {
    const badgeSize = size * 0.45;
    const badgeX = x + size - badgeSize + 4;
    const badgeY = y + size - badgeSize + 4;

    ctx.beginPath();
    ctx.fillStyle = '#2d9cdb';
    ctx.arc(badgeX + badgeSize / 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `bold ${badgeSize * 0.6}px Sans-Serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(count), badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1);
  }
  ctx.restore();
}

function drawSlot(ctx, slot, x, y, width, height, showName = false) {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, 16);
  ctx.fillStyle = SLOT_BG;
  ctx.fill();
  ctx.strokeStyle = slot.accentColor || HIGHLIGHT_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  const padding = 18;
  const avatarSize = Math.min(110, height - padding * 2);
  const avatarY = y + padding;
  drawAvatar(ctx, slot.image, x + padding, avatarY, avatarSize);

  const textX = x + padding + avatarSize + 16;
  const textWidth = width - (textX - x) - padding;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px Sans-Serif';
  const displayName = showName
    ? truncateWithEllipsis(ctx, slot.name ?? 'Unknown', textWidth)
    : slot.label ?? 'Companion';
  ctx.fillText(displayName, textX, avatarY + 8);

  ctx.fillStyle = '#8da2c0';
  ctx.font = '18px Sans-Serif';
  ctx.fillText(`Lv. ${slot.level ?? 1}`, textX, avatarY + 38);

  drawShield(ctx, textX, avatarY + 54, 42, slot.shield ?? 0);

  const barY = avatarY + avatarSize - 18;
  drawHealthBar(ctx, textX, barY, textWidth, 16, slot.health ?? 100, slot.maxHealth ?? 100);

  ctx.fillStyle = '#bfc7d5';
  ctx.font = '14px Sans-Serif';
  ctx.fillText(`${slot.health ?? 100} / ${slot.maxHealth ?? 100} HP`, textX, barY - 6);
  ctx.restore();
}

function drawPlayerSection(ctx, player) {
  const panelWidth = CANVAS_WIDTH * 0.48;
  const panelHeight = CANVAS_HEIGHT - 120;
  const x = CANVAS_WIDTH - panelWidth - 40;
  const y = 60;

  ctx.save();
  drawRoundedRect(ctx, x, y, panelWidth, panelHeight, 24);
  ctx.fillStyle = PANEL_COLOR;
  ctx.fill();
  ctx.strokeStyle = HIGHLIGHT_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#5ce1e6';
  ctx.font = 'bold 20px Sans-Serif';
  ctx.fillText('PLAYER', x + 26, y + 36);

  drawSlot(
    ctx,
    {
      ...player,
      label: player.name,
      maxHealth: player.maxHealth ?? 100,
      accentColor: HIGHLIGHT_COLOR,
    },
    x + 20,
    y + 52,
    panelWidth - 40,
    180,
    true,
  );

  const teamY = y + 260;
  const slotWidth = (panelWidth - 80) / 3;
  const slotHeight = 150;
  for (let i = 0; i < 3; i++) {
    const slot = player.team?.[i] ?? {};
    drawSlot(
      ctx,
      {
        name: slot.name ?? `Slot ${i + 1}`,
        label: slot.label ?? `Team ${i + 1}`,
        level: slot.level ?? Math.max(1, (player.level ?? 1) - 1),
        health: slot.health ?? 80,
        maxHealth: slot.maxHealth ?? 100,
        shield: slot.shield ?? 0,
        image: slot.image,
        accentColor: slot.accentColor ?? '#7b8ab8',
      },
      x + 30 + i * (slotWidth + 15),
      teamY,
      slotWidth,
      slotHeight,
    );
  }

  ctx.restore();
}

function layoutEnemySlots(count, areaX, areaY, areaWidth, areaHeight) {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / columns);
  const slotWidth = Math.min(200, (areaWidth - (columns + 1) * 16) / columns);
  const slotHeight = Math.min(170, (areaHeight - (rows + 1) * 16) / rows);

  const positions = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = areaX + 16 + col * (slotWidth + 16);
    const y = areaY + 16 + row * (slotHeight + 16);
    positions.push({ x, y, width: slotWidth, height: slotHeight });
  }
  return positions;
}

function drawEnemySection(ctx, enemies) {
  const panelWidth = CANVAS_WIDTH * 0.48;
  const panelHeight = CANVAS_HEIGHT - 120;
  const x = 40;
  const y = 60;

  ctx.save();
  drawRoundedRect(ctx, x, y, panelWidth, panelHeight, 24);
  ctx.fillStyle = PANEL_COLOR;
  ctx.fill();
  ctx.strokeStyle = '#ef476f';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#ff6b81';
  ctx.font = 'bold 20px Sans-Serif';
  ctx.fillText('ENEMIES', x + 26, y + 36);

  const positions = layoutEnemySlots(
    Math.max(1, Math.min(5, enemies.length)),
    x + 10,
    y + 52,
    panelWidth - 20,
    panelHeight - 80,
  );

  for (let i = 0; i < positions.length; i++) {
    const slotData = enemies[i] ?? {};
    const pos = positions[i];
    drawSlot(
      ctx,
      {
        ...slotData,
        label: slotData.label ?? `Enemy ${i + 1}`,
        maxHealth: slotData.maxHealth ?? 100,
        accentColor: slotData.accentColor ?? '#ef476f',
      },
      pos.x,
      pos.y,
      pos.width,
      pos.height,
      false,
    );
  }

  ctx.restore();
}

async function loadImageSafe(source) {
  if (!source) return null;
  try {
    return await loadImage(source);
  } catch (error) {
    console.warn('Failed to load image for hunt render:', error);
    return null;
  }
}

async function createHuntBattleImage({ player, enemies }) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);

  const playerAvatar = await loadImageSafe(player.avatar);
  const playerSlot = {
    ...player,
    image: playerAvatar,
    maxHealth: player.maxHealth ?? 100,
    shield: player.shield ?? player.defense ?? 0,
    level: player.level ?? 1,
  };

  const preparedEnemies = await Promise.all(
    enemies.slice(0, 5).map(async (enemy) => ({
      ...enemy,
      image: await loadImageSafe(enemy.avatar),
    })),
  );

  drawPlayerSection(ctx, playerSlot);
  drawEnemySection(ctx, preparedEnemies);

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px Sans-Serif';
  ctx.textAlign = 'center';
  ctx.fillText('VS', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { createHuntBattleImage };
