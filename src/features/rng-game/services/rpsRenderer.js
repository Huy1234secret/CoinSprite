const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { INDEX_CANVAS_FONT_FAMILY } = require('../../../canvasFonts');
const {
  RPS_ASSETS,
  RPS_CANVAS_HEIGHT,
  RPS_CANVAS_WIDTH,
  RPS_IMAGE_DIRECTORY,
  RPS_LAYOUTS,
  RPS_STATES,
} = require('../config/rps');

const AVATAR_CACHE_MS = 5 * 60 * 1_000;
const MAX_AVATAR_CACHE = 100;
const TERMINAL = new Set([RPS_STATES.FINISHED]);

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fittedSize(image, maximumWidth, maximumHeight) {
  const scale = Math.min(maximumWidth / image.width, maximumHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

function fittedUsername(context, name, maximumWidth, initialSize) {
  const normalized = String(name || 'Player').replace(/[\r\n\t]/g, ' ').trim() || 'Player';
  let size = initialSize;
  let text = normalized;
  while (size > 12) {
    context.font = `700 ${size}px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
    if (context.measureText(text).width <= maximumWidth) return { text, size };
    size -= 1;
  }
  context.font = `700 ${size}px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
  while (text.length > 1 && context.measureText(`${text}…`).width > maximumWidth) text = text.slice(0, -1);
  return { text: text === normalized ? text : `${text}…`, size };
}

function participantStatus(game, participant, index) {
  if (game.state === RPS_STATES.FINISHED) return participant.resultStatus;
  if (game.state === RPS_STATES.LOBBY) return participant.accepted ? 'READY' : null;
  if (participant.choice) return 'READY';
  if (game.state === RPS_STATES.IN_PROGRESS && game.currentTurn === index) return 'TURN';
  return null;
}

function botStatus(game) {
  if (game.state === RPS_STATES.FINISHED) {
    if (game.resultType === 'draw') return 'DRAW';
    return game.winnerUserId === 'bot' ? 'WIN' : 'LOSE';
  }
  return game.mode === 'bot' && game.state !== RPS_STATES.CHOOSING_MODE ? 'READY' : null;
}

function renderParticipants(game, botProfile = {}) {
  const participants = game.participants.map((participant, index) => ({
    ...participant,
    status: participantStatus(game, participant, index),
    committed: Boolean(participant.choice),
  }));
  if (game.mode === 'bot') {
    participants.push({
      userId: 'bot',
      displayName: botProfile.displayName || 'Bot',
      avatarUrl: botProfile.avatarUrl || '',
      choice: game.botChoice,
      committed: game.state !== RPS_STATES.CHOOSING_MODE,
      status: botStatus(game),
      resultStatus: botStatus(game),
    });
  }
  return participants;
}

class RpsTableRenderer {
  constructor(options = {}) {
    this.imageDirectory = options.imageDirectory || RPS_IMAGE_DIRECTORY;
    this.loadImage = options.loadImage || loadImage;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.clock = options.clock || Date.now;
    this.assetsPromise = null;
    this.avatarCache = new Map();
    this.handPatchCache = new WeakMap();
  }

  assetPath(filename) {
    return path.join(this.imageDirectory, filename);
  }

  async assets() {
    if (!this.assetsPromise) this.assetsPromise = this.loadAssets();
    return this.assetsPromise;
  }

  async loadAssets() {
    const required = [
      ...Object.values(RPS_ASSETS),
      ...Object.values(RPS_LAYOUTS).map((layout) => layout.table),
    ];
    const unique = [...new Set(required)];
    for (const filename of unique) {
      const filePath = this.assetPath(filename);
      if (!fs.existsSync(filePath)) throw new Error(`Required RPS asset is missing: ${filePath}`);
    }
    const loaded = Object.fromEntries(await Promise.all(unique.map(async (filename) => [
      filename,
      await this.loadImage(this.assetPath(filename)),
    ])));
    for (const layout of Object.values(RPS_LAYOUTS)) {
      const table = loaded[layout.table];
      if (table.width !== RPS_CANVAS_WIDTH || table.height !== RPS_CANVAS_HEIGHT) {
        throw new Error(`RPS table ${layout.table} must be ${RPS_CANVAS_WIDTH}x${RPS_CANVAS_HEIGHT}; found ${table.width}x${table.height}.`);
      }
    }
    for (const filename of Object.values(RPS_ASSETS)) {
      const card = loaded[filename];
      if (card.width !== 800 || card.height !== 1_100) {
        throw new Error(`RPS card ${filename} must be 800x1100; found ${card.width}x${card.height}.`);
      }
    }
    return loaded;
  }

  pruneAvatarCache() {
    const now = this.clock();
    for (const [key, entry] of this.avatarCache) {
      if (entry.expiresAt <= now) this.avatarCache.delete(key);
    }
    while (this.avatarCache.size > MAX_AVATAR_CACHE) this.avatarCache.delete(this.avatarCache.keys().next().value);
  }

  async avatar(url) {
    if (!url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    this.pruneAvatarCache();
    const cached = this.avatarCache.get(parsed.href);
    if (cached) return cached.image;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      let response;
      try {
        response = await this.fetchImpl(parsed.href, { signal: controller.signal, cache: 'no-store' });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 8 * 1024 * 1024) return null;
      const image = await this.loadImage(buffer);
      this.avatarCache.set(parsed.href, { image, expiresAt: this.clock() + AVATAR_CACHE_MS });
      return image;
    } catch {
      return null;
    }
  }

  feltPatch(baseContext, seat) {
    const cached = this.handPatchCache.get(seat);
    if (cached) return cached;
    const { x, y, width, height, textureSource } = seat.handMask;
    const source = baseContext.getImageData(0, 0, RPS_CANVAS_WIDTH, RPS_CANVAS_HEIGHT).data;
    const patch = createCanvas(width, height);
    const patchContext = patch.getContext('2d');
    const output = patchContext.createImageData(width, height);
    const at = (sampleX, sampleY, channel) => {
      const safeX = Math.max(0, Math.min(RPS_CANVAS_WIDTH - 1, sampleX));
      const safeY = Math.max(0, Math.min(RPS_CANVAS_HEIGHT - 1, sampleY));
      return source[((safeY * RPS_CANVAS_WIDTH) + safeX) * 4 + channel];
    };
    for (let row = 0; row < height; row += 1) {
      const rowY = y + row;
      const left = [0, 0, 0];
      const right = [0, 0, 0];
      const textureMean = [0, 0, 0];
      for (let sample = 10; sample <= 18; sample += 2) {
        for (let channel = 0; channel < 3; channel += 1) {
          left[channel] += at(x - sample, rowY, channel);
          right[channel] += at(x + width + sample, rowY, channel);
        }
      }
      for (let column = 0; column < width; column += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          textureMean[channel] += at(textureSource.x + column, textureSource.y + row, channel);
        }
      }
      const edgeSamples = 5;
      const textureSamples = Math.ceil(width / 4);
      for (let channel = 0; channel < 3; channel += 1) {
        left[channel] /= edgeSamples;
        right[channel] /= edgeSamples;
        textureMean[channel] /= textureSamples;
      }
      for (let column = 0; column < width; column += 1) {
        const progress = width === 1 ? 0 : column / (width - 1);
        const outputIndex = ((row * width) + column) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const background = left[channel] + ((right[channel] - left[channel]) * progress);
          const texture = at(textureSource.x + column, textureSource.y + row, channel) - textureMean[channel];
          output.data[outputIndex + channel] = Math.max(0, Math.min(255, Math.round(background + (texture * 0.15))));
        }
        output.data[outputIndex + 3] = 255;
      }
    }
    patchContext.putImageData(output, 0, 0);
    this.handPatchCache.set(seat, patch);
    return patch;
  }

  hideHand(context, baseContext, table, seat) {
    const { x, y, width, height } = seat.handMask;
    context.save();
    roundedRect(context, x, y, width, height, 14);
    context.clip();
    context.drawImage(this.feltPatch(baseContext, seat), x, y);
    context.restore();
    this.restoreProfileRing(context, table, seat);
  }

  restoreProfileRing(context, table, seat) {
    context.save();
    context.beginPath();
    context.arc(seat.profile.x, seat.profile.y, seat.profile.outerRadius, 0, Math.PI * 2);
    context.clip();
    context.drawImage(table, 0, 0);
    context.restore();
  }

  async drawProfile(context, participant, seat, isLoser, isWinner) {
    const { x, y, avatarRadius } = seat.profile;
    if (isWinner) {
      context.save();
      context.shadowColor = '#37f07c';
      context.shadowBlur = 24;
      context.strokeStyle = '#4ade80';
      context.lineWidth = 8;
      context.beginPath();
      context.arc(x, y, avatarRadius + 7, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    context.save();
    context.beginPath();
    context.arc(x, y, avatarRadius, 0, Math.PI * 2);
    context.clip();
    const avatar = await this.avatar(participant.avatarUrl);
    if (avatar) {
      const sourceSize = Math.min(avatar.width, avatar.height);
      const sourceX = (avatar.width - sourceSize) / 2;
      const sourceY = (avatar.height - sourceSize) / 2;
      context.drawImage(
        avatar, sourceX, sourceY, sourceSize, sourceSize,
        x - avatarRadius, y - avatarRadius, avatarRadius * 2, avatarRadius * 2,
      );
    } else {
      const gradient = context.createLinearGradient(x - avatarRadius, y - avatarRadius, x + avatarRadius, y + avatarRadius);
      gradient.addColorStop(0, '#334155');
      gradient.addColorStop(1, '#0f172a');
      context.fillStyle = gradient;
      context.fillRect(x - avatarRadius, y - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      context.fillStyle = '#cbd5e1';
      context.font = `800 ${Math.round(avatarRadius * 0.8)}px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(participant.displayName || '?').slice(0, 1).toUpperCase(), x, y - 4);
    }
    if (isLoser) {
      context.fillStyle = 'rgba(8, 10, 15, 0.62)';
      context.fillRect(x - avatarRadius, y - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      context.fillStyle = 'rgba(120, 15, 22, 0.22)';
      context.fillRect(x - avatarRadius, y - avatarRadius, avatarRadius * 2, avatarRadius * 2);
    }
    context.restore();
    this.drawUsername(context, participant.displayName, seat.username);
    if (participant.status) this.drawStatus(context, participant.status, seat.status);
  }

  drawUsername(context, name, bounds) {
    context.save();
    roundedRect(context, bounds.x, bounds.y, bounds.width, bounds.height, 8);
    context.fillStyle = 'rgba(8, 15, 20, 0.82)';
    context.fill();
    const fitted = fittedUsername(context, name, bounds.width - 12, Math.min(22, bounds.height - 7));
    context.font = `700 ${fitted.size}px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fitted.text, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 1);
    context.restore();
  }

  drawStatus(context, status, bounds) {
    const colors = {
      TURN: ['#f8d55f', '#2b2105'],
      READY: ['#60a5fa', '#071a34'],
      WIN: ['#4ade80', '#062c16'],
      LOSE: ['#7f1d1d', '#ffffff'],
      DRAW: ['#9ca3af', '#111827'],
    };
    const [fill, text] = colors[status] || colors.DRAW;
    context.save();
    roundedRect(context, bounds.x, bounds.y, bounds.width, bounds.height, 9);
    context.fillStyle = fill;
    context.fill();
    context.font = `800 17px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
    context.fillStyle = text;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(status, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 1);
    context.restore();
  }

  drawCard(context, image, seat, darkened) {
    const size = fittedSize(image, seat.card.maxWidth, seat.card.maxHeight);
    const x = seat.card.x - size.width / 2;
    const y = seat.card.y - size.height / 2;
    context.drawImage(image, x, y, size.width, size.height);
    if (darkened) {
      context.save();
      roundedRect(context, x, y, size.width, size.height, 8);
      context.clip();
      context.fillStyle = 'rgba(8, 10, 15, 0.62)';
      context.fillRect(x, y, size.width, size.height);
      context.fillStyle = 'rgba(120, 15, 22, 0.20)';
      context.fillRect(x, y, size.width, size.height);
      context.restore();
    }
  }

  drawGuides(context, layout) {
    context.save();
    context.lineWidth = 3;
    context.font = `800 20px "${INDEX_CANVAS_FONT_FAMILY}", sans-serif`;
    context.textAlign = 'center';
    layout.seats.forEach((seat, index) => {
      context.strokeStyle = '#ff3bd4';
      context.strokeRect(seat.handMask.x, seat.handMask.y, seat.handMask.width, seat.handMask.height);
      context.strokeStyle = '#38bdf8';
      context.beginPath();
      context.arc(seat.profile.x, seat.profile.y, seat.profile.avatarRadius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = '#facc15';
      context.strokeRect(seat.username.x, seat.username.y, seat.username.width, seat.username.height);
      context.strokeStyle = '#fb7185';
      context.strokeRect(seat.status.x, seat.status.y, seat.status.width, seat.status.height);
      context.fillStyle = '#ffffff';
      context.fillText(`SEAT ${index + 1}`, seat.profile.x, seat.profile.y);
      context.fillStyle = '#22d3ee';
      context.fillRect(seat.card.x - 6, seat.card.y - 6, 12, 12);
    });
    context.restore();
  }

  async render(game, options = {}) {
    const participants = renderParticipants(game, options.botProfile);
    const layout = RPS_LAYOUTS[participants.length];
    if (!layout) throw new Error(`No RPS table layout exists for ${participants.length} participants.`);
    const assets = await this.assets();
    const table = assets[layout.table];
    const canvas = createCanvas(RPS_CANVAS_WIDTH, RPS_CANVAS_HEIGHT);
    const context = canvas.getContext('2d');
    const baseCanvas = createCanvas(RPS_CANVAS_WIDTH, RPS_CANVAS_HEIGHT);
    const baseContext = baseCanvas.getContext('2d');
    baseContext.drawImage(table, 0, 0);
    context.drawImage(table, 0, 0);
    const revealed = TERMINAL.has(game.state);

    participants.forEach((participant, index) => {
      if (participant.committed || options.hideAllHands) this.hideHand(context, baseContext, table, layout.seats[index]);
    });

    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index];
      const status = participant.status;
      const isLoser = revealed && status === 'LOSE';
      if (participant.committed || options.hideAllHands) {
        const assetName = revealed && participant.choice ? RPS_ASSETS[participant.choice] : RPS_ASSETS.card;
        this.drawCard(context, assets[assetName], layout.seats[index], isLoser);
      }
    }
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index];
      const status = participant.status;
      const isLoser = revealed && status === 'LOSE';
      const isWinner = revealed && status === 'WIN';
      this.restoreProfileRing(context, table, layout.seats[index]);
      await this.drawProfile(context, participant, layout.seats[index], isLoser, isWinner);
    }
    if (options.guides) this.drawGuides(context, layout);
    return canvas.toBuffer('image/png');
  }

  clear() {
    this.avatarCache.clear();
    this.assetsPromise = null;
    this.handPatchCache = new WeakMap();
  }
}

module.exports = {
  AVATAR_CACHE_MS,
  RpsTableRenderer,
  fittedSize,
  fittedUsername,
  renderParticipants,
};
