const path = require('path');

const RPS_IMAGE_DIRECTORY = path.join(__dirname, '..', '..', '..', '..', 'images', 'RPS');
const RPS_CANVAS_WIDTH = 1_672;
const RPS_CANVAS_HEIGHT = 941;
const RPS_LOBBY_TIMEOUT_MS = 5 * 60 * 1_000;
const RPS_TURN_TIMEOUT_MS = 5 * 60 * 1_000;

const RPS_STATES = Object.freeze({
  CHOOSING_MODE: 'CHOOSING_MODE',
  LOBBY: 'LOBBY',
  IN_PROGRESS: 'IN_PROGRESS',
  READY_TO_REVEAL: 'READY_TO_REVEAL',
  FINISHED: 'FINISHED',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED',
});

const RPS_EMOJIS = Object.freeze({
  bot: '<:bot:1536778286867153037>',
  player: '<:player:1536778284547964988>',
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
});

function seat(centerX, centerY, avatarRadius, handMask, cardCenter, cardMax, textureSource) {
  const outerRadius = avatarRadius + Math.max(16, Math.round(avatarRadius * 0.27));
  return Object.freeze({
    profile: Object.freeze({ x: centerX, y: centerY, avatarRadius, outerRadius }),
    handMask: Object.freeze({ ...handMask, textureSource: Object.freeze(textureSource) }),
    card: Object.freeze({ x: cardCenter.x, y: cardCenter.y, maxWidth: cardMax.width, maxHeight: cardMax.height }),
    username: Object.freeze({
      x: centerX - avatarRadius + 8,
      y: centerY + Math.round(avatarRadius * 0.34),
      width: (avatarRadius - 8) * 2,
      height: Math.max(25, Math.round(avatarRadius * 0.34)),
    }),
    status: Object.freeze({
      x: centerX - Math.round(avatarRadius * 0.7),
      y: centerY - avatarRadius - 34,
      width: Math.round(avatarRadius * 1.4),
      height: 28,
    }),
  });
}

const RPS_LAYOUTS = Object.freeze({
  2: Object.freeze({
    table: 'RPStable2.png',
    seats: Object.freeze([
      seat(286, 398, 84, { x: 145, y: 450, width: 286, height: 158 }, { x: 745, y: 470 }, { width: 130, height: 190 }, { x: 400, y: 100 }),
      seat(1376, 398, 84, { x: 1235, y: 450, width: 286, height: 158 }, { x: 927, y: 470 }, { width: 130, height: 190 }, { x: 400, y: 100 }),
    ]),
  }),
  3: Object.freeze({
    table: 'RPStable3.png',
    seats: Object.freeze([
      seat(836, 212, 79, { x: 704, y: 260, width: 267, height: 148 }, { x: 836, y: 375 }, { width: 110, height: 165 }, { x: 400, y: 100 }),
      seat(424, 605, 79, { x: 292, y: 650, width: 269, height: 150 }, { x: 725, y: 570 }, { width: 110, height: 165 }, { x: 400, y: 100 }),
      seat(1246, 605, 79, { x: 1115, y: 650, width: 267, height: 150 }, { x: 947, y: 570 }, { width: 110, height: 165 }, { x: 400, y: 100 }),
    ]),
  }),
  4: Object.freeze({
    table: 'RPStable4.png',
    seats: Object.freeze([
      seat(835, 152, 62, { x: 729, y: 188, width: 214, height: 119 }, { x: 836, y: 340 }, { width: 96, height: 144 }, { x: 400, y: 100 }),
      seat(224, 445, 62, { x: 119, y: 482, width: 208, height: 111 }, { x: 690, y: 470 }, { width: 96, height: 144 }, { x: 400, y: 100 }),
      seat(1441, 445, 62, { x: 1_337, y: 482, width: 209, height: 111 }, { x: 982, y: 470 }, { width: 96, height: 144 }, { x: 400, y: 100 }),
      seat(835, 703, 62, { x: 729, y: 740, width: 214, height: 116 }, { x: 836, y: 600 }, { width: 96, height: 144 }, { x: 400, y: 100 }),
    ]),
  }),
});

const RPS_ASSETS = Object.freeze({
  card: 'RPScard.png',
  rock: 'RPSrock.png',
  paper: 'RPSpaper.png',
  scissors: 'RPSscissors.png',
});

module.exports = {
  RPS_ASSETS,
  RPS_CANVAS_HEIGHT,
  RPS_CANVAS_WIDTH,
  RPS_EMOJIS,
  RPS_IMAGE_DIRECTORY,
  RPS_LAYOUTS,
  RPS_LOBBY_TIMEOUT_MS,
  RPS_STATES,
  RPS_TURN_TIMEOUT_MS,
};
