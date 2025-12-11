const { createCanvas, loadImage, registerFont } = require('@napi-rs/canvas');

// === CONFIGURATION ===
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

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

// Draw the Background with a "Vignette" feel
function drawBackground(ctx) {
    // Linear gradient base
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, PALETTE.bgGradientTop);
    grad.addColorStop(1, PALETTE.bgGradientBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Vignette (dark corners)
    const radial = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.3,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.9
    );
    radial.addColorStop(0, 'rgba(0,0,0,0)');
    radial.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Center divider (Vine style - dashed)
    ctx.strokeStyle = 'rgba(100, 150, 100, 0.2)';
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
    ctx.fillText(`${current} / ${max}`, textX, textY);
    ctx.shadowBlur = 0;
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
    const avatarSize = 64;
    const avatarX = x + 15;
    const avatarY = y + (h - avatarSize) / 2 - 10; // moved up slightly to fit HP
    drawAvatar(ctx, unit.image, avatarX, avatarY, avatarSize, borderColor);

    // Rarity Badge (Enemy Only - Bottom Left of Avatar)
    if (isEnemy && unit.rarity) {
        const badgeSize = 24;
        const bx = avatarX - 5;
        const by = avatarY + avatarSize - 15;
        
        ctx.beginPath();
        ctx.arc(bx + badgeSize/2, by + badgeSize/2, badgeSize/2, 0, Math.PI*2);
        ctx.fillStyle = '#222';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        
        ctx.font = '16px Sans-Serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unit.rarity, bx + badgeSize/2, by + badgeSize/2 + 2);
    }

    // Info
    const infoX = avatarX + avatarSize + 15;
    const infoW = (x + w) - infoX - 10;

    // Level (Small text)
    ctx.fillStyle = PALETTE.textAccent;
    ctx.font = 'bold 14px Sans-Serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv. ${unit.level}`, infoX, y + 30);

    // Effects
    drawEffectSlots(ctx, unit.effects, infoX + 50, y + 30, 16);

    // HP Bar
    const barH = 18;
    const barY = y + h - barH - 15;
    drawHpBar(ctx, infoX - 5, barY, infoW, barH, unit.hp, unit.maxHp); // -5 to pull bar left slightly

    ctx.restore();
}


// === LAYOUT LOGIC ===

async function createHuntBattleImage({ player, enemies }) {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // 1. Load Assets
    const playerImg = await loadImage(player.avatar || 'https://via.placeholder.com/150');
    // Preload pet images
    const petImages = await Promise.all((player.pets || []).map(p => loadImage(p.avatar)));
    // Preload enemy images
    const enemyImages = await Promise.all((enemies || []).map(e => loadImage(e.avatar)));

    // 2. Draw Background
    drawBackground(ctx);

    // === PLAYER ZONE (LEFT) ===
    const ZONE_PAD = 40;
    const PLAYER_ZONE_W = (CANVAS_WIDTH / 2) - ZONE_PAD;
    
    // A. Main Player Card
    const mainCardH = 160;
    const mainCardW = PLAYER_ZONE_W - 20;
    const mainCardX = ZONE_PAD;
    const mainCardY = 60; // Top margin

    drawPlayerMainCard(ctx, { ...player, image: playerImg }, mainCardX, mainCardY, mainCardW, mainCardH);

    // B. Pet Cards (3 slots)
    const petY = mainCardY + mainCardH + 30; // Gap
    const petH = 110;
    const petGap = 15;
    const petW = (mainCardW - (petGap * 2)) / 3;

    for (let i = 0; i < 3; i++) {
        const px = mainCardX + i * (petW + petGap);
        // Draw empty slot frame if no pet
        if (player.pets && player.pets[i]) {
             drawSmallCard(ctx, { ...player.pets[i], image: petImages[i] }, px, petY, petW, petH, false);
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

    // === ENEMY ZONE (RIGHT) ===
    const ENEMY_ZONE_X = CANVAS_WIDTH / 2 + 20;
    const ENEMY_ZONE_W = (CANVAS_WIDTH / 2) - 60;
    const ENEMY_ZONE_Y_START = 60;
    const ENEMY_ZONE_H = CANVAS_HEIGHT - 100;

    // Logic to center 1-5 enemies
    const enemyCount = Math.min(enemies.length, 5);
    const cardH = 110;
    const cardW = 280; // Fixed width for enemy cards looks cleaner
    
    // We calculate positions to center them in the right panel
    let enemyPositions = [];
    
    if (enemyCount <= 3) {
        // Single Column centered vertically
        const totalH = enemyCount * cardH + (enemyCount - 1) * 20;
        let startY = ENEMY_ZONE_Y_START + (ENEMY_ZONE_H - totalH) / 2;
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
        
        // Simple alternating layout
        const startY = ENEMY_ZONE_Y_START + 80; // Push down a bit
        
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
        drawSmallCard(ctx, { ...enemies[i], image: enemyImages[i] }, pos.x, pos.y, cardW, cardH, true);
    }

    // === VS LABEL ===
    ctx.save();
    ctx.font = 'bold italic 80px Serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 20;
    
    // Text Gradient
    const vsGrad = ctx.createLinearGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2 - 40, CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 40);
    vsGrad.addColorStop(0, '#ffffff');
    vsGrad.addColorStop(1, '#999');
    
    ctx.fillStyle = vsGrad;
    ctx.fillText('VS', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = { createHuntBattleImage };
