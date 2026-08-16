const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { INDEX_CANVAS_FONT_FAMILY } = require('../../../canvasFonts');
const {
  ROULETTE_CANVAS_HEIGHT,
  ROULETTE_CANVAS_WIDTH,
  ROULETTE_GEOMETRY,
  ROULETTE_IMAGE_DIRECTORY,
  ROULETTE_STATES,
  ROULETTE_TABLE_ASSET,
  anchorFor,
  numberCoordinates,
} = require('../config/roulette');
const { betCoversResult, canonicalBet, winningBetRegions } = require('./rouletteRules');

const CHIP_RADIUS = 26;
const SEAT_COLORS = Object.freeze(['#38bdf8', '#f472b6', '#a3e635', '#c084fc']);
const CLUSTER_OFFSETS = Object.freeze({
  1: Object.freeze([[0, 0]]),
  2: Object.freeze([[-33, 0], [33, 0]]),
  3: Object.freeze([[-33, 22], [33, 22], [0, -34]]),
  4: Object.freeze([[-33, -33], [33, -33], [-33, 33], [33, 33]]),
});

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '?';
}

function clusteredBets(game) {
  const seatByUser = new Map(game.participants.map((participant) => [participant.userId, participant.seat]));
  const groups = new Map();
  for (const bet of game.bets.filter((entry) => entry.state !== 'REFUNDED')) {
    if (!groups.has(bet.anchorKey)) groups.set(bet.anchorKey, []);
    groups.get(bet.anchorKey).push(bet);
  }
  const result = [];
  for (const bets of groups.values()) {
    bets.sort((left, right) => (seatByUser.get(left.userId) ?? 99) - (seatByUser.get(right.userId) ?? 99));
    const offsets = CLUSTER_OFFSETS[Math.min(4, bets.length)];
    bets.forEach((bet, index) => {
      const anchor = anchorFor(bet.type, bet.target);
      result.push({ ...bet, x: anchor.x + offsets[index][0], y: anchor.y + offsets[index][1] });
    });
  }
  return result;
}

function winningChipBets(game) {
  if (game?.state !== ROULETTE_STATES.FINISHED || game.winningNumber == null) return [];
  return clusteredBets(game).filter((bet) => betCoversResult(bet, game.winningNumber));
}

class RouletteTableRenderer {
  constructor(options = {}) {
    this.imageDirectory = options.imageDirectory || ROULETTE_IMAGE_DIRECTORY;
    this.loadImage = options.loadImage || loadImage;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.assetPromise = null;
    this.avatarCache = new Map();
  }

  async table() {
    if (!this.assetPromise) {
      const assetPath = path.join(this.imageDirectory, ROULETTE_TABLE_ASSET);
      if (!fs.existsSync(assetPath)) throw new Error(`Required roulette asset is missing: ${assetPath}`);
      this.assetPromise = this.loadImage(assetPath).then((image) => {
        if (image.width !== ROULETTE_CANVAS_WIDTH || image.height !== ROULETTE_CANVAS_HEIGHT) {
          throw new Error(`Roulette table must be ${ROULETTE_CANVAS_WIDTH}x${ROULETTE_CANVAS_HEIGHT}; found ${image.width}x${image.height}.`);
        }
        return image;
      });
    }
    return this.assetPromise;
  }

  async avatar(url) {
    if (!url) return null;
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'https:') return null;
    if (this.avatarCache.has(parsed.href)) return this.avatarCache.get(parsed.href);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      let response;
      try { response = await this.fetchImpl(parsed.href, { signal: controller.signal, cache: 'no-store' }); } finally { clearTimeout(timer); }
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 8 * 1024 * 1024) return null;
      const image = await this.loadImage(buffer);
      this.avatarCache.set(parsed.href, image);
      return image;
    } catch { return null; }
  }

  highlightResult(context, number) {
    const point = numberCoordinates(number);
    context.save();
    context.shadowColor = '#fde047';
    context.shadowBlur = 22;
    context.strokeStyle = '#fff4a3';
    context.lineWidth = 7;
    if (number === 0) {
      roundedRect(context, 73, 43, 122, 367, 32);
      context.stroke();
    } else {
      const { bounds } = point;
      context.strokeRect(bounds.left + 4, bounds.top + 4, bounds.right - bounds.left - 8, bounds.bottom - bounds.top - 8);
    }
    context.restore();
    const ballX = number === 0 ? point.x + 38 : point.x + 27;
    const ballY = number === 0 ? point.y - 45 : point.y - 38;
    context.save();
    context.shadowColor = '#facc15';
    context.shadowBlur = 14;
    const gradient = context.createRadialGradient(ballX - 5, ballY - 6, 2, ballX, ballY, 15);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.58, '#fff7cc');
    gradient.addColorStop(1, '#d6a928');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(ballX, ballY, 15, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  highlightWinningRegion(context, bet) {
    const gold = '#fde047';
    const point = anchorFor(bet.type, bet.target);
    context.save();
    context.strokeStyle = gold;
    context.fillStyle = 'rgba(250, 204, 21, 0.15)';
    context.lineWidth = 4;
    context.shadowColor = 'rgba(250, 204, 21, 0.72)';
    context.shadowBlur = 7;

    if (bet.type === 'straight') {
      const { bounds } = numberCoordinates(Number(bet.target));
      roundedRect(context, bounds.left + 7, bounds.top + 7, bounds.right - bounds.left - 14, bounds.bottom - bounds.top - 14, Number(bet.target) === 0 ? 24 : 8);
      context.fill();
      context.stroke();
    } else if (bet.type === 'split') {
      const [firstNumber, secondNumber] = bet.covered;
      const first = numberCoordinates(firstNumber);
      const second = numberCoordinates(secondNumber);
      context.beginPath();
      if (Math.abs(first.x - second.x) > Math.abs(first.y - second.y)) {
        context.moveTo(point.x, point.y - 28);
        context.lineTo(point.x, point.y + 28);
      } else {
        context.moveTo(point.x - 28, point.y);
        context.lineTo(point.x + 28, point.y);
      }
      context.stroke();
    } else if (bet.type === 'street') {
      roundedRect(context, point.x - 27, point.y - 7, 54, 14, 7);
      context.fill();
      context.stroke();
    } else if (bet.type === 'corner') {
      context.beginPath();
      context.arc(point.x, point.y, 15, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (bet.type === 'six_line') {
      roundedRect(context, point.x - 8, point.y - 31, 16, 62, 8);
      context.fill();
      context.stroke();
    } else if (['trio_012', 'trio_023', 'first_four'].includes(bet.type)) {
      context.beginPath();
      context.arc(point.x, point.y, bet.type === 'first_four' ? 19 : 15, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (point.bounds) {
      const { bounds } = point;
      roundedRect(context, bounds.left + 5, bounds.top + 5, bounds.right - bounds.left - 10, bounds.bottom - bounds.top - 10, 12);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  highlightWinningRegions(context, number) {
    for (const bet of winningBetRegions(number)) this.highlightWinningRegion(context, bet);
  }

  async drawChip(context, participant, bet, finished, winningNumber) {
    const winner = finished && betCoversResult(bet, winningNumber);
    context.save();
    if (finished && !winner) context.globalAlpha = 0.38;
    context.shadowColor = 'rgba(0, 0, 0, 0.85)';
    context.shadowBlur = 12;
    context.fillStyle = '#0b1018';
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS + 6, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = SEAT_COLORS[participant.seat % SEAT_COLORS.length];
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS + 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f8fafc';
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS - 4, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS - 7, 0, Math.PI * 2);
    context.clip();
    const avatar = await this.avatar(participant.avatarUrl);
    if (avatar) {
      const size = Math.min(avatar.width, avatar.height);
      context.drawImage(avatar, (avatar.width - size) / 2, (avatar.height - size) / 2, size, size,
        bet.x - CHIP_RADIUS + 7, bet.y - CHIP_RADIUS + 7, (CHIP_RADIUS - 7) * 2, (CHIP_RADIUS - 7) * 2);
    } else {
      context.fillStyle = '#182235';
      context.fillRect(bet.x - CHIP_RADIUS, bet.y - CHIP_RADIUS, CHIP_RADIUS * 2, CHIP_RADIUS * 2);
      context.fillStyle = '#ffffff';
      context.font = `800 15px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(initials(participant.displayName), bet.x, bet.y + 1);
    }
    context.restore();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS + 3, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawWinningChipGlow(context, bet) {
    context.save();
    context.shadowColor = '#facc15';
    context.shadowBlur = 26;
    context.strokeStyle = '#fde047';
    context.lineWidth = 7;
    context.beginPath();
    context.arc(bet.x, bet.y, CHIP_RADIUS + 8, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawGuides(context) {
    context.save();
    context.font = `700 11px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let number = 0; number <= 36; number += 1) {
      const point = numberCoordinates(number);
      context.strokeStyle = '#22d3ee';
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(point.x - 8, point.y); context.lineTo(point.x + 8, point.y); context.moveTo(point.x, point.y - 8); context.lineTo(point.x, point.y + 8); context.stroke();
      context.fillStyle = '#ffffff'; context.fillText(String(number), point.x, point.y - 13);
    }
    context.strokeStyle = '#fb3bd4';
    for (let first = 1; first <= 36; first += 1) {
      for (const second of [first + 1, first + 3]) {
        try {
          const canonical = canonicalBet('split', `${first}-${second}`);
          const point = anchorFor(canonical.type, canonical.target);
          context.strokeRect(point.x - 3, point.y - 3, 6, 6);
        } catch { /* non-edge */ }
      }
    }
    context.fillStyle = 'rgba(15, 23, 42, 0.55)';
    const boxes = [...ROULETTE_GEOMETRY.dozens, ...ROULETTE_GEOMETRY.columns, ...Object.values(ROULETTE_GEOMETRY.outside)];
    for (const box of boxes) {
      context.strokeStyle = '#facc15';
      context.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    }
    const labels = ['dozen_1', 'dozen_2', 'dozen_3', 'column_1', 'column_2', 'column_3', 'low', 'even', 'red', 'black', 'odd', 'high'];
    for (const label of labels) {
      const point = anchorFor(label, label);
      context.fillStyle = '#ffffff'; context.fillText(label, point.x, point.y + 16);
    }
    for (let first = 1; first <= 34; first += 3) {
      const street = anchorFor('street', String(first));
      context.fillStyle = '#4ade80'; context.fillText(`S${first}`, street.x, street.y - 10);
      if (first <= 31) {
        const six = anchorFor('six_line', String(first));
        context.fillStyle = '#fda4af'; context.fillText(`6L${first}`, six.x, six.y + 12);
      }
    }
    for (const [type, label] of [['trio_012', 'T012'], ['trio_023', 'T023'], ['first_four', 'F4']]) {
      const point = anchorFor(type, type);
      context.fillStyle = '#fde047';
      context.fillText(label, point.x + (type === 'first_four' ? 14 : -18), point.y + (type === 'first_four' ? 16 : 4));
    }
    for (let first = 1; first <= 32; first += 1) {
      if (((first - 1) % 3) > 1) continue;
      try {
        const corner = canonicalBet('corner', `${first},${first + 1},${first + 3},${first + 4}`);
        const point = anchorFor(corner.type, corner.target);
        context.fillStyle = '#fb7185'; context.fillRect(point.x - 3, point.y - 3, 6, 6);
      } catch { /* grid edge */ }
    }
    context.restore();
  }

  async render(game, options = {}) {
    const canvas = createCanvas(ROULETTE_CANVAS_WIDTH, ROULETTE_CANVAS_HEIGHT);
    const context = canvas.getContext('2d');
    context.drawImage(await this.table(), 0, 0);
    const finished = game.state === ROULETTE_STATES.FINISHED && game.winningNumber != null;
    if (finished) {
      this.highlightWinningRegions(context, game.winningNumber);
      this.highlightResult(context, game.winningNumber);
    }
    const participants = new Map(game.participants.map((participant) => [participant.userId, participant]));
    const bets = clusteredBets(game);
    for (const bet of bets) {
      const participant = participants.get(bet.userId);
      if (participant) await this.drawChip(context, participant, bet, finished, game.winningNumber);
    }
    if (finished) {
      for (const bet of bets.filter((entry) => betCoversResult(entry, game.winningNumber))) {
        this.drawWinningChipGlow(context, bet);
      }
    }
    if (options.guides) this.drawGuides(context);
    return canvas.toBuffer('image/png');
  }

  clear() { this.assetPromise = null; this.avatarCache.clear(); }
}

module.exports = {
  CHIP_RADIUS,
  CLUSTER_OFFSETS,
  RouletteTableRenderer,
  SEAT_COLORS,
  clusteredBets,
  initials,
  winningChipBets,
};
