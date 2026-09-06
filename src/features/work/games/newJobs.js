const { createCanvas } = require('@napi-rs/canvas');
const TIERS = ['easy', 'normal', 'hard', 'expert'];
const COLORS = ['🟥', '🟧', '🟨', '🟩'];
const PAIRS = [
  [['❤️', '💔'], ['😀', '😃'], ['🌕', '🌖']],
  [['😄', '😁'], ['😐', '😑'], ['😮', '😯']],
  [['💏', '👩‍❤️‍💋‍👨'], ['😙', '😚'], ['📁', '📂']],
  [['💏', '👩‍❤️‍💋‍👨'], ['👨‍👩‍👦', '👨‍👩‍👧'], ['🕛', '🕧']],
];
const pick = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
const tier = difficulty => Math.max(0, TIERS.indexOf(difficulty));
function createOddGame(difficulty, rng) {
  const level = tier(difficulty);
  const [normal, odd] = PAIRS[level][pick(rng, PAIRS[level].length)];
  return { normal, odd, count: 10 + level * 5, answer: pick(rng, 10 + level * 5), difficulty: level / 3 };
}
function applyOddAction(state, action) {
  const match = /^odd-(\d{1,2})$/.exec(action);
  if (!match || Number(match[1]) >= state.count) return { outcome: 'active' };
  return Number(match[1]) === state.answer ? { outcome: 'succeeded' }
    : { outcome: 'failed', reason: 'That emoji matches the others.' };
}
function createCashierGame(difficulty, rng) {
  const level = tier(difficulty);
  const total = (1 + pick(rng, [90, 900, 9000, 90000][level])) * (level ? 1 : 100);
  const unit = [1000, 5000, 10000, 100000][level];
  const paid = rng() < 0.04 ? total : (Math.floor(total / unit) + 1 + pick(rng, 3)) * unit;
  return { total, paid, difficulty: level / 3 };
}
function applyCashierAction(state, action) {
  if (!action.startsWith('answer:')) return { outcome: 'active' };
  const value = action.slice(7).trim();
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value);
  const cents = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : -1;
  return cents === state.paid - state.total ? { outcome: 'succeeded' }
    : { outcome: 'failed', reason: 'The change was incorrect.' };
}
function createColorGame(difficulty, rng) {
  const level = tier(difficulty), colors = COLORS.slice(0, level < 2 ? 2 : level + 1);
  const target = Array.from({ length: 9 }, () => pick(rng, colors.length));
  const cells = Array.from({ length: 9 }, () => pick(rng, colors.length));
  if (cells.every((value, i) => value === target[i])) cells[0] = (cells[0] + 1) % colors.length;
  return { colors, target, cells, difficulty: level / 3 };
}
function applyColorAction(state, action) {
  const match = /^color-([0-8])$/.exec(action);
  if (!match) return { outcome: 'active' };
  const i = Number(match[1]);
  state.cells[i] = (state.cells[i] + 1) % state.colors.length;
  return { outcome: state.cells.every((value, index) => value === state.target[index]) ? 'succeeded' : 'active' };
}
function createCaptchaGame(difficulty, rng) {
  const level = tier(difficulty), alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return { answer: Array.from({ length: 4 + level }, () => alphabet[pick(rng, alphabet.length)]).join(''),
    seed: pick(rng, 1000000), difficulty: level / 3 };
}
function applyCaptchaAction(state, action) {
  if (!action.startsWith('answer:')) return { outcome: 'active' };
  return action.slice(7).trim().toUpperCase() === state.answer ? { outcome: 'succeeded' }
    : { outcome: 'failed', reason: 'The CAPTCHA characters were incorrect.' };
}
function captchaImage(state) {
  const canvas = createCanvas(480, 125), ctx = canvas.getContext('2d');
  let seed = state.seed + 1;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#eef1e5'; ctx.fillRect(0, 0, 480, 125);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = '#a6afad'; ctx.fillRect(rng() * 480, rng() * 125, 2, 2);
  }
  [...state.answer].forEach((char, i) => {
    ctx.save(); ctx.translate(40 + i * (400 / state.answer.length), 83 + (rng() - .5) * 12);
    ctx.rotate((rng() - .5) * (.35 + state.difficulty * .25));
    ctx.font = 'bold 54px sans-serif'; ctx.fillStyle = ['#20384a', '#493452', '#245044'][i % 3];
    ctx.fillText(char, 0, 0); ctx.restore();
  });
  for (let i = 0; i < 2 + state.difficulty * 2; i++) {
    ctx.strokeStyle = '#718d9580'; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(0, rng() * 125); ctx.bezierCurveTo(120, rng() * 125, 320, rng() * 125, 480, rng() * 125); ctx.stroke();
  }
  return canvas.toBuffer('image/png');
}
module.exports = { createOddGame, applyOddAction, createCashierGame, applyCashierAction,
  createColorGame, applyColorAction, createCaptchaGame, applyCaptchaAction, captchaImage };
