const { createCanvas, loadImage } = require('@napi-rs/canvas');

// === CONFIGURATION ===
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// === JUNGLE THEME PALETTE ===
const PALETTE = {
    bgGradientTop: '#0f2015',    // Deep dark forest green
    bgGradientBot: '#1b3a26',    // Lighter foliage green
    
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

// === HELPER: SAFE IMAGE LOADER ===
// Prevents "TypeError: unsupported image source" crash
async function safeLoad(source) {
    if (!source || typeof source !== 'string') return null;
    try {
        return await loadImage(source);
    } catch (err) {
        // console.warn(`[Canvas Warning] Failed to load image: ${source}`);
        return null;
    }
}

// === GRAPHICS HELPERS ===

function drawRoundedRect(ctx, x, y, width, height, radius = 10) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
}

function drawBackground(ctx) {
    // 1. Base Gradient
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, PALETTE.bgGradientTop);
    grad.addColorStop(1, PALETTE.bgGradientBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 2. Vignette (Dark Corners)
    const radial = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.3,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.9
    );
    radial.addColorStop(0, 'rgba(0,0,0,0)');
    radial.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 3. Center Vine Divider
    ctx.strokeStyle = 'rgba(100, 150, 100, 0.2)';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 15]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 20);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawAvatar(ctx, img, x, y, size, borderColor) {
    const r = size / 2;
    const cx = x + r;
    const cy = y + r;

    ctx.save();
    
    // Shadow
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Clip & Draw Image
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (img) {
        ctx.drawImage(img, x, y, size, size);
    } else {
        // Fallback placeholder if image failed to load
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y, size, size);
    }
    ctx.restore();

    // Border Ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
}

function drawHpBar(ctx, x, y, width, height, current, max) {
    const radius = 6;
    // Prevent division by zero
    const safeMax = Math.max(max || 100, 1); 
    const safeCurrent = Math.max(0, current || 0);
    const pct = Math.max(0, Math.min(1, safeCurrent / safeMax));
    
    // 1. Background (Red - Missing HP)
    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
    ctx.fillStyle = PALETTE.hpBg;
    ctx.fill();

    // 2. Foreground (Green - Current HP)
    ctx.fillStyle = PALETTE.hpFill;
    ctx.fillRect(x, y, width * pct, height);
    
    // 3. Glassy Shine (Optional)
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y, width, height/2);
    ctx.restore();

    // 4. Border
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 5. Text (Centered)
    ctx.fillStyle = PALETTE.hpText;
    // Fallback font stack ensures something always renders
    ctx.font = 'bold 14px Sans-Serif'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    
    const textX = x + width / 2;
    const textY = y + height / 2 + 1;
    ctx.fillText(`${safeCurrent} / ${safeMax}`, textX, textY);
    ctx.shadowBlur = 0;
}

function drawEffectSlots(ctx, effects, x, y, size = 20) {
    if (!effects || !Array.isArray(effects) || effects.length === 0) return;
    
    ctx.font = `${size}px Sans-Serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    effects.slice(0, 5).forEach((eff, i) => {
        if (!eff) return;
        const dx = x + i * (size + 5);
        
        // Dark backing circle for readability
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(dx + size/2, y, size/2 + 2, 0, Math.PI*2);
        ctx.fill();
        
        ctx.fillStyle = '#fff'; // Fallback color for text/emoji
        ctx.fillText(eff, dx, y + 2);
    });
}

// === COMPONENT: MAIN PLAYER CARD ===
function drawPlayerMainCard(ctx, player, x, y, w, h) {
    // Card Background
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = PALETTE.cardBg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.cardBorderPlayer;
    ctx.stroke();
    
    // Avatar
    const avatarSize = h - 30;
    const avatarX = x + 20;
    const avatarY = y + 15;
    drawAvatar(ctx, player.image, avatarX, avatarY, avatarSize, PALETTE.cardBorderPlayer);

    // Info Area
    const infoX = avatarX + avatarSize + 20;
    const infoW = w - (infoX - x) - 20;

    // Name
    ctx.fillStyle = PALETTE.textMain;
    ctx.font = 'bold 28px Serif';
    ctx.textAlign = 'left';
    ctx.fillText(player.name || 'Unknown Player', infoX, y + 40);

    // Level
    ctx.fillStyle = PALETTE.textAccent;
    ctx.font = 'bold 18px Sans-Serif';
    ctx.fillText(`Lv. ${player.level || 1}`, infoX, y + 70);

    // Effect Slots (next to Level)
    drawEffectSlots(ctx, player.effects, infoX + 80, y + 68, 22);

    // HP Bar
    const barH = 24;
    const barY = y + h - barH - 25;
    drawHpBar(ctx, infoX, barY, infoW, barH, player.hp, player.maxHp);

    ctx.restore();
}

// === COMPONENT: SMALL UNIT CARD (Pet/Enemy) ===
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
    const avatarY = y + (h - avatarSize) / 2 - 10; 
    drawAvatar(ctx, unit.image, avatarX, avatarY, avatarSize, borderColor);

    // Rarity Badge (Enemy Only)
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
        
        ctx.font = '14px Sans-Serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unit.rarity, bx + badgeSize/2, by + badgeSize/2 + 2);
    }

    // Info Area
    const infoX = avatarX + avatarSize + 15;
    const infoW = (x + w) - infoX - 10;

    // Level
    ctx.fillStyle = PALETTE.textAccent;
    ctx.font = 'bold 14px Sans-Serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv. ${unit.level || 1}`, infoX, y + 30);

    // Effects
    drawEffectSlots(ctx, unit.effects, infoX + 50, y + 30, 16);

    // HP Bar
    const barH = 18;
    const barY = y + h - barH - 15;
    drawHpBar(ctx, infoX - 5, barY, infoW, barH, unit.hp, unit.maxHp);

    ctx.restore();
}

// === MAIN GENERATOR FUNCTION ===
async function createHuntBattleImage({ player, enemies }) {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // --- 1. Load Assets Safely ---
    const playerImg = await safeLoad(player.avatar);

    const petImages = await Promise.all(
        (player.pets || []).map(p => safeLoad(p.avatar))
    );

    const enemyImages = await Promise.all(
        (enemies || []).map(e => safeLoad(e.avatar))
    );

    // --- 2. Draw Scene ---
    drawBackground(ctx);

    // --- 3. Player Zone (Left) ---
    const ZONE_PAD = 40;
    const PLAYER_ZONE_W = (CANVAS_WIDTH / 2) - ZONE_PAD;
    
    // Main Card
    const mainCardH = 160;
    const mainCardW = PLAYER_ZONE_W - 20;
    const mainCardX = ZONE_PAD;
    const mainCardY = 60;

    drawPlayerMainCard(ctx, { ...player, image: playerImg }, mainCardX, mainCardY, mainCardW, mainCardH);

    // Pet Cards (3 Slots)
    const petY = mainCardY + mainCardH + 30;
    const petH = 110;
    const petGap = 15;
    const petW = (mainCardW - (petGap * 2)) / 3;

    for (let i = 0; i < 3; i++) {
        const px = mainCardX + i * (petW + petGap);
        const petData = player.pets ? player.pets[i] : null;

        if (petData) {
             drawSmallCard(ctx, { ...petData, image: petImages[i] }, px, petY, petW, petH, false);
        } else {
             // Empty Slot
             ctx.save();
             drawRoundedRect(ctx, px, petY, petW, petH, 12);
             ctx.fillStyle = 'rgba(0,0,0,0.3)';
             ctx.fill();
             ctx.strokeStyle = 'rgba(255,255,255,0.1)';
             ctx.stroke();
             ctx.restore();
        }
    }

    // --- 4. Enemy Zone (Right) ---
    const ENEMY_ZONE_X = CANVAS_WIDTH / 2 + 20;
    const ENEMY_ZONE_W = (CANVAS_WIDTH / 2) - 60;
    const ENEMY_ZONE_Y_START = 60;
    const ENEMY_ZONE_H = CANVAS_HEIGHT - 100;

    // Ensure enemies array exists and limit to 5
    const enemyList = enemies || [];
    const enemyCount = Math.min(enemyList.length, 5);
    
    const cardH = 110;
    const cardW = 280; 
    
    // Calculate Layout Positions
    let enemyPositions = [];
    
    if (enemyCount <= 3) {
        // Single Column Centered
        const totalH = enemyCount * cardH + (enemyCount - 1) * 20;
        let startY = ENEMY_ZONE_Y_START + (ENEMY_ZONE_H - totalH) / 2;
        const centerX = ENEMY_ZONE_X + (ENEMY_ZONE_W - cardW) / 2;
        
        for(let i=0; i<enemyCount; i++) {
            enemyPositions.push({ x: centerX, y: startY + i * (cardH + 20) });
        }
    } else {
        // Two Columns Grid
        const col1X = ENEMY_ZONE_X + 20;
        const col2X = ENEMY_ZONE_X + ENEMY_ZONE_W - cardW - 20;
        const rowGap = 30;
        const startY = ENEMY_ZONE_Y_START + 80;
        
        for(let i=0; i<enemyCount; i++) {
            const col = i % 2; // 0 = left, 1 = right
            const row = Math.floor(i / 2);
            const ex = col === 0 ? col1X : col2X;
            const ey = startY + row * (cardH + rowGap);
            enemyPositions.push({ x: ex, y: ey });
        }
        // Center the 5th element
        if (enemyCount === 5) {
            enemyPositions[4].x = ENEMY_ZONE_X + (ENEMY_ZONE_W - cardW) / 2;
        }
    }

    // Draw Enemy Cards
    for (let i = 0; i < enemyCount; i++) {
        const pos = enemyPositions[i];
        // Ensure we pass the image from our safe-loaded array
        drawSmallCard(ctx, { ...enemyList[i], image: enemyImages[i] }, pos.x, pos.y, cardW, cardH, true);
    }

    // --- 5. VS Overlay ---
    ctx.save();
    ctx.font = 'bold italic 80px Serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 20;
    
    const vsGrad = ctx.createLinearGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2 - 40, CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 40);
    vsGrad.addColorStop(0, '#ffffff');
    vsGrad.addColorStop(1, '#999');
    
    ctx.fillStyle = vsGrad;
    ctx.fillText('VS', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = { createHuntBattleImage };
