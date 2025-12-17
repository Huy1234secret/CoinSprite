const { createCanvas, loadImage, registerFont } = require('@napi-rs/canvas');

// === CONFIGURATION ===
const CANVAS_WIDTH = 1280;
let CANVAS_HEIGHT = 480; // Updated dynamically based on card counts

// === JUNGLE THEME PALETTE ===
const PALETTE = {
    bgGradientTop: '#0f2015',    // Deep dark forest green
    bgGradientBot: '#1b3a26',    // Lighter foliage green
    panelBg: 'rgba(12, 28, 18, 0.75)', // Glassy dark green
    panelBorder: '#5c8a45',      // Vine color
    
    cardBg: '#1e2b22',           // Dark card background
    cardBorderPlayer: '#d4af37', // Gold border for player
    cardBorderPet: '#8b5a2b',    // Wood/Bronze for pets
    cardBorderEnemy: '#c94c4c',  // Reddish/Danger for enemies
    
    textMain: '#f0f7f2',         // Off-white
    textAccent: '#ffd700',       // Gold text
    
    hpFill: '#43a047',           // Vibrant Jungle Green
    hpBg: '#b71c1c',             // Deep Red
    hpText: '#ffffff'
};

// === HELPER FUNCTIONS ===

// Draw a rounded rectangle
function drawRoundedRect(ctx, x, y, width, height, radius = 10) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
}

// Draw leafy canopy silhouettes
function drawCanopy(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 40, 20, 0.55)';
    for (let i = 0; i < 8; i++) {
        const height = 80 + Math.random() * 80;
        const width = 180 + Math.random() * 160;
        const x = i * 180 + (Math.random() * 30 - 15);
        ctx.beginPath();
        ctx.ellipse(x, height / 2, width / 2, height / 2, Math.random() * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Draw foreground vines
function drawVines(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60, 120, 70, 0.6)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
        const startX = (i + 1) * (CANVAS_WIDTH / 6);
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        for (let y = 0; y <= CANVAS_HEIGHT; y += 60) {
            const sway = Math.sin((y / 60) + i) * 25;
            ctx.lineTo(startX + sway, y + 60);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// Draw fireflies / light orbs
function drawFireflies(ctx) {
    ctx.save();
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * CANVAS_WIDTH;
        const y = Math.random() * CANVAS_HEIGHT;
        const radius = 2 + Math.random() * 2;
        const alpha = 0.25 + Math.random() * 0.5;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
        grad.addColorStop(0, `rgba(255, 215, 120, ${alpha})`);
        grad.addColorStop(1, 'rgba(255, 215, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Draw foliage layers for jungle depth
function drawFoliage(ctx) {
    ctx.save();
    const layerColors = [
        'rgba(20, 60, 30, 0.55)',
        'rgba(25, 70, 35, 0.5)',
        'rgba(30, 80, 40, 0.45)'
    ];

    layerColors.forEach((color, idx) => {
        ctx.fillStyle = color;
        const baseY = CANVAS_HEIGHT - (idx * 20 + 30);
        for (let x = -50; x < CANVAS_WIDTH + 50; x += 120) {
            const height = 60 + Math.random() * 40;
            const width = 140 + Math.random() * 80;
            ctx.beginPath();
            ctx.ellipse(x + Math.random() * 40, baseY, width / 2, height / 2, Math.random() * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    ctx.restore();
}

// Draw the Background with a jungle feel
function drawBackground(ctx) {
    // Linear gradient base
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, '#0c1b10');
    grad.addColorStop(0.45, PALETTE.bgGradientTop);
    grad.addColorStop(1, PALETTE.bgGradientBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawCanopy(ctx);
    drawVines(ctx);
    drawFoliage(ctx);
    drawFireflies(ctx);

    // Vignette (dark corners)
    const radial = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.3,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.9
    );
    radial.addColorStop(0, 'rgba(0,0,0,0)');
    radial.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Center divider (subtle vine)
    ctx.strokeStyle = 'rgba(100, 150, 100, 0.25)';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 15]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 20);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20);
    ctx.stroke();
    ctx.setLineDash([]);
}

// Draw Avatar with circle crop and border
function drawAvatar(ctx, img, x, y, size, borderColor) {
    const r = size / 2;
    const cx = x + r;
    const cy = y + r;

    ctx.save();
    
    // Shadow behind avatar
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Clip Image
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (img) {
        ctx.drawImage(img, x, y, size, size);
    } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y, size, size);
    }
    ctx.restore();

    // Border ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
}

// Draw HP Bar (Green/Red with Text Inside)
function drawHpBar(ctx, x, y, width, height, current, max) {
    const radius = 6;
    const safeMax = Math.max(max, 1);
    const pct = Math.max(0, Math.min(1, current / safeMax));
    
    // Background (Red - Missing HP)
    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
    ctx.fillStyle = PALETTE.hpBg;
    ctx.fill();

    // Foreground (Green - Current HP)
    ctx.fillStyle = PALETTE.hpFill;
    // We draw a rect based on percentage
    ctx.fillRect(x, y, width * pct, height);
    
    // Glassy shine (optional polish)
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y, width, height/2);
    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text (Centered)
    ctx.fillStyle = PALETTE.hpText;
    ctx.font = 'bold 14px Sans-Serif'; // Ensure font is available or use generic
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    const textX = x + width / 2;
    const textY = y + height / 2 + 1; // +1 for visual centering
    const displayCurrent = formatAbbreviatedNumber(current);
    const displayMax = formatAbbreviatedNumber(max);
    ctx.fillText(`${displayCurrent} / ${displayMax}`, textX, textY);
    ctx.shadowBlur = 0;
}

function formatAbbreviatedNumber(value) {
    const units = [
        { value: 1_000_000_000_000, suffix: 't' },
        { value: 1_000_000_000, suffix: 'b' },
        { value: 1_000_000, suffix: 'm' },
        { value: 1_000, suffix: 'k' },
    ];

    for (const unit of units) {
        if (value >= unit.value) {
            const scaled = value / unit.value;
            const decimals = scaled < 10 && value % unit.value !== 0 ? 1 : 0;
            return `${parseFloat(scaled.toFixed(decimals))}${unit.suffix}`;
        }
    }

    return `${value}`;
}

// Draw Effect Slots (Placeholder squares/circles)
function drawEffectSlots(ctx, effects, x, y, size = 20) {
    if (!effects || effects.length === 0) return;
    
    // Assuming 'effects' is an array of strings/emojis. 
    // If images, you would need to load them first. 
    // Here we stick to text/emojis for simplicity.
    
    ctx.font = `${size}px Sans-Serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    effects.slice(0, 5).forEach((eff, i) => {
        const dx = x + i * (size + 5);
        // Draw a small backing glow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(dx + size/2, y, size/2 + 2, 0, Math.PI*2);
        ctx.fill();
        
        ctx.fillText(eff, dx, y + 2);
    });
}

// === CARD DRAWING FUNCTIONS ===

// 1. MAIN PLAYER CARD
function drawPlayerMainCard(ctx, player, x, y, w, h) {
    // Card Background
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = PALETTE.cardBg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.cardBorderPlayer; // Gold
    ctx.stroke();
    
    // Avatar (Left side)
    const avatarSize = h - 30; // 15px padding top/bottom
    const avatarX = x + 20;
    const avatarY = y + 15;
    drawAvatar(ctx, player.image, avatarX, avatarY, avatarSize, PALETTE.cardBorderPlayer);

    // Info Area
    const infoX = avatarX + avatarSize + 20;
    const infoW = w - (infoX - x) - 20;

    // Name & Level
    ctx.fillStyle = PALETTE.textMain;
    ctx.font = 'bold 28px Serif';
    ctx.textAlign = 'left';
    ctx.fillText(player.name, infoX, y + 40);

    // Level Badge
    ctx.fillStyle = PALETTE.textAccent;
    ctx.font = 'bold 18px Sans-Serif';
    ctx.fillText(`Hunt Lv. ${player.level}`, infoX, y + 70);

    // Effect Slots (Next to level)
    // pass simple array of emojis for demo: ['🔥', '🛡️']
    drawEffectSlots(ctx, player.effects, infoX + 120, y + 68, 22);

    // HP Bar (Bottom of info area)
    const barH = 24;
    const barY = y + h - barH - 25;
    drawHpBar(ctx, infoX, barY, infoW, barH, player.hp, player.maxHp);

    ctx.restore();
}

function drawRarityBadge(ctx, image, avatarX, avatarY, avatarSize) {
    if (!image) return;

    const badgeSize = Math.max(24, Math.round(avatarSize * 0.45));
    const bx = avatarX + avatarSize - badgeSize;
    const by = avatarY + avatarSize - badgeSize;

    const aspectRatio = image?.width && image?.height ? image.width / image.height : 1;
    let drawW = badgeSize;
    let drawH = badgeSize;

    if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
        if (aspectRatio >= 1) {
            drawH = Math.round(badgeSize / aspectRatio);
        } else {
            drawW = Math.round(badgeSize * aspectRatio);
        }
    }

    const offsetX = bx + (badgeSize - drawW) / 2;
    const offsetY = by + (badgeSize - drawH) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.drawImage(image, offsetX, offsetY, drawW, drawH);
    ctx.restore();
}

// 2. SMALL CARD (Pet / Army / Enemy)
function drawSmallCard(ctx, unit, x, y, w, h, isEnemy = false) {
    const borderColor = isEnemy ? PALETTE.cardBorderEnemy : PALETTE.cardBorderPet;

    // Background
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = PALETTE.cardBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    // Avatar
    const avatarSize = Math.min(h - 24, 96);
    const avatarX = x + 15;
    const avatarY = y + (h - avatarSize) / 2;
    drawAvatar(ctx, unit.image, avatarX, avatarY, avatarSize, borderColor);

    drawRarityBadge(ctx, unit.rarityImage, avatarX, avatarY, avatarSize);

    // Info
    const infoX = avatarX + avatarSize + 20;
    const infoW = (x + w) - infoX - 15;

    // Level (Small text)
    ctx.fillStyle = PALETTE.textAccent;
    ctx.font = 'bold 14px Sans-Serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv. ${unit.level}`, infoX, y + 35);

    // Effects
    drawEffectSlots(ctx, unit.effects, infoX + 50, y + 30, 16);

    // HP Bar
    const barH = 18;
    const barY = y + h - barH - 15;
    drawHpBar(ctx, infoX - 5, barY, infoW, barH, unit.hp, unit.maxHp); // -5 to pull bar left slightly

    ctx.restore();
}


// === LAYOUT LOGIC ===

const FALLBACK_IMAGE_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAn8B9HZTqz8AAAAASUVORK5CYII=';

async function safeLoadImage(src, fallback = FALLBACK_IMAGE_DATA) {
    const finalSrc = (typeof src === 'string' && src.trim()) ? src : fallback;
    try {
        return await loadImage(finalSrc);
    } catch (err) {
        return loadImage(fallback);
    }
}

function resolveEmojiUrl(emoji) {
    const match = emoji?.match(/<a?:[^:]+:(\d+)>/);
    if (match) {
        const isAnimated = emoji.startsWith('<a:');
        const ext = isAnimated ? 'gif' : 'png';
        return `https://cdn.discordapp.com/emojis/${match[1]}.${ext}?size=64&quality=lossless`;
    }

    const trimmed = emoji?.trim();
    if (!trimmed) {
        return null;
    }

    const codepoints = Array.from(trimmed)
        .map((char) => char.codePointAt(0)?.toString(16))
        .filter(Boolean)
        .join('-');

    if (!codepoints) {
        return null;
    }

    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoints}.png`;
}

async function loadRarityImage(emoji) {
    const url = resolveEmojiUrl(emoji);
    if (!url) {
        return null;
    }

    try {
        return await loadImage(url);
    } catch (err) {
        return null;
    }
}

function computeCanvasHeight(player, enemies) {
    const TOP_MARGIN = 40;
    // Keep only a slim buffer beneath the lowest card to avoid the large empty area
    const BOTTOM_PADDING = 12;

    // Player stack height (main card + pets if any)
    const mainCardH = 150;
    const petGap = 20;
    const petH = 110;
    const petCount = (player.pets || []).filter(Boolean).length;

    let playerHeight = TOP_MARGIN + mainCardH;
    if (petCount > 0) {
        playerHeight += petGap + petH;
    }

    // Enemy stack height, mirrors layout logic
    const enemyCount = Math.min((enemies || []).length, 5);
    const ENEMY_ZONE_Y_START = 40;
    const cardH = 110;
    let enemyHeight = ENEMY_ZONE_Y_START;

    if (enemyCount > 0) {
        if (enemyCount <= 3) {
            const gap = 20;
            enemyHeight += enemyCount * cardH + (enemyCount - 1) * gap;
        } else {
            const rowGap = 30;
            const rows = Math.ceil(enemyCount / 2);
            const startY = ENEMY_ZONE_Y_START;
            enemyHeight = startY + rows * cardH + (rows - 1) * rowGap;
        }
    }

    // Keep a sensible minimum height to preserve background details
    const minHeight = 220;
    return Math.max(minHeight, Math.max(playerHeight, enemyHeight) + BOTTOM_PADDING);
}

async function createHuntBattleImage({ player, enemies }) {
    CANVAS_HEIGHT = computeCanvasHeight(player, enemies);
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // 1. Load Assets with fallbacks to avoid unsupported sources
    const playerImg = await safeLoadImage(player.avatar);
    // Preload pet images
    const petImages = await Promise.all((player.pets || []).map(p => safeLoadImage(p.avatar)));
    const petRarityImages = await Promise.all((player.pets || []).map(p => loadRarityImage(p?.rarityEmoji || p?.rarityIcon)));
    // Preload enemy images
    const enemyImages = await Promise.all((enemies || []).map(e => safeLoadImage(e.avatar)));
    const enemyRarityImages = await Promise.all((enemies || []).map(e => loadRarityImage(e?.rarityEmoji || e?.rarityIcon)));

    // 2. Draw Background
    drawBackground(ctx);

    // === PLAYER ZONE (LEFT) ===
    const ZONE_PAD = 40;
    const PLAYER_ZONE_W = (CANVAS_WIDTH / 2) - ZONE_PAD;
    
    // A. Main Player Card
    const mainCardH = 150;
    const mainCardW = PLAYER_ZONE_W - 20;
    const mainCardX = ZONE_PAD;
    const mainCardY = 40; // Top margin, tightened for shorter canvas

    drawPlayerMainCard(ctx, { ...player, image: playerImg }, mainCardX, mainCardY, mainCardW, mainCardH);

    // B. Pet Cards (only draw when player has an army/pets)
    const hasPets = (player.pets || []).some(Boolean);
    if (hasPets) {
        const petY = mainCardY + mainCardH + 20; // Gap
        const petH = 110;
        const petGap = 15;
        const petW = (mainCardW - (petGap * 2)) / 3;

        for (let i = 0; i < 3; i++) {
            const px = mainCardX + i * (petW + petGap);
            if (player.pets && player.pets[i]) {
                 drawSmallCard(ctx, { ...player.pets[i], image: petImages[i], rarityImage: petRarityImages[i] }, px, petY, petW, petH, false);
            } else {
                 // Draw Empty Slot placeholder
                 ctx.save();
                 drawRoundedRect(ctx, px, petY, petW, petH, 12);
                 ctx.fillStyle = 'rgba(0,0,0,0.3)';
                 ctx.fill();
                 ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                 ctx.stroke();
                 ctx.restore();
            }
        }
    }

    // === ENEMY ZONE (RIGHT) ===
    const ENEMY_ZONE_X = CANVAS_WIDTH / 2 + 20;
    const ENEMY_ZONE_W = (CANVAS_WIDTH / 2) - 60;
    const ENEMY_ZONE_Y_START = 40;
    const ENEMY_ZONE_H = CANVAS_HEIGHT - 80;

    // Logic to center 1-5 enemies
    const enemyCount = Math.min(enemies.length, 5);
    const cardH = 110;
    const cardW = 280; // Fixed width for enemy cards looks cleaner
    
    // We calculate positions to center them in the right panel
    let enemyPositions = [];

    if (enemyCount <= 3) {
        // Single Column with matching top margin to player card
        let startY = ENEMY_ZONE_Y_START;
        const centerX = ENEMY_ZONE_X + (ENEMY_ZONE_W - cardW) / 2;

        for(let i=0; i<enemyCount; i++) {
            enemyPositions.push({ x: centerX, y: startY + i * (cardH + 20) });
        }
    } else {
        // Two Columns (Zig-zag or grid)
        // 4 enemies: 2x2. 5 enemies: 2 top, 3 bot or 3 top, 2 bot? Let's do 2 columns.
        const col1X = ENEMY_ZONE_X + 20;
        const col2X = ENEMY_ZONE_X + ENEMY_ZONE_W - cardW - 20;
        const rowGap = 30;

        // Simple alternating layout with consistent top margin
        const startY = ENEMY_ZONE_Y_START;
        
        for(let i=0; i<enemyCount; i++) {
            const col = i % 2; // 0 = left, 1 = right
            const row = Math.floor(i / 2);
            const ex = col === 0 ? col1X : col2X;
            const ey = startY + row * (cardH + rowGap);
            enemyPositions.push({ x: ex, y: ey });
        }
        
        // If 5th element (odd), center it below? Or just keep grid.
        // Let's Center the last one if it's alone in a row (element 5)
        if (enemyCount === 5) {
            enemyPositions[4].x = ENEMY_ZONE_X + (ENEMY_ZONE_W - cardW) / 2;
        }
    }

    // Draw Enemies
    for (let i = 0; i < enemyCount; i++) {
        const pos = enemyPositions[i];
        drawSmallCard(ctx, { ...enemies[i], image: enemyImages[i], rarityImage: enemyRarityImages[i] }, pos.x, pos.y, cardW, cardH, true);
    }

    return canvas.toBuffer('image/png');
}

module.exports = { createHuntBattleImage };
