const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  getBalance,
  addBalance,
  spendBalance,
  addJackpotBalance,
  recordGamblingEarnings,
  getLastBetInput,
  setLastBetInput,
} = require('../src/gamblingStore');
const leveling = require('../src/levelingManager');
const { unlockBullseyeAchievement } = require('../src/achievementSystem');
const {
  PRCOIN,
  JPCOIN,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  formatNumber,
} = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const PRCOIN_MIN_BET = 1;
const PRCOIN_MAX_BET = 100_000;
const SPIN_TIME_MS = 7_000;
const BLACK_ACCENT = 0x111214;
const RADIO_GROUP_COMPONENT_TYPE = 21;
const WIN_EMOJI = '<:Y_:1498173245981986869>';
const LOSE_EMOJI = '<:N_:1498173244031631400>';
const NEUTRAL_EMOJI = '<:neutral:1498631195108446228>';
const ROULETTE_STRAIGHT_WIN_CHANNEL_ID = '1498300014114377860';

const ROULETTE_DIR = path.join(__dirname, '..', 'roulette');
const ROULETTE_IMAGES_DIR = path.join(ROULETTE_DIR, 'images');
const ROULETTE_GIFS_DIR = path.join(ROULETTE_DIR, 'gifs');
const ROULETTE_CACHE_DIR = path.join(__dirname, '..', 'data', 'roulette-cache');

const RESULT_NUMBERS = ['00', '0', ...Array.from({ length: 36 }, (_, index) => String(index + 1))];
const RED_NUMBERS = new Set(['1', '3', '5', '7', '9', '12', '14', '16', '18', '19', '21', '23', '25', '27', '30', '32', '34', '36']);
const BLACK_NUMBERS = new Set(['2', '4', '6', '8', '10', '11', '13', '15', '17', '20', '22', '24', '26', '28', '29', '31', '33', '35']);

const ROWS = Array.from({ length: 12 }, (_, index) => {
  const start = (index * 3) + 1;
  return {
    key: `row_${index + 1}`,
    label: `Row ${index + 1}: ${start}-${start + 1}-${start + 2}`,
    numbers: [String(start), String(start + 1), String(start + 2)],
  };
});

const LINES = Array.from({ length: 11 }, (_, index) => {
  const start = (index * 3) + 1;
  return {
    key: `line_${index + 1}`,
    label: `Line ${index + 1}: ${start}-${start + 1}-${start + 2}-${start + 3}-${start + 4}-${start + 5}`,
    numbers: [String(start), String(start + 1), String(start + 2), String(start + 3), String(start + 4), String(start + 5)],
  };
});

const DOZENS = [
  { key: 'dozen_1', label: '1st 12: 1➜12', display: '📦 1st 12 (1-12)', numbers: rangeStrings(1, 12) },
  { key: 'dozen_2', label: '2nd 12: 13➜24', display: '📦 2nd 12 (13-24)', numbers: rangeStrings(13, 24) },
  { key: 'dozen_3', label: '3rd 12: 25➜36', display: '📦 3rd 12 (25-36)', numbers: rangeStrings(25, 36) },
];

const COLUMNS = [
  { key: 'column_1', label: 'Column 1', display: '🧱 Column 1', numbers: ['1', '4', '7', '10', '13', '16', '19', '22', '25', '28', '31', '34'] },
  { key: 'column_2', label: 'Column 2', display: '🧱 Column 2', numbers: ['2', '5', '8', '11', '14', '17', '20', '23', '26', '29', '32', '35'] },
  { key: 'column_3', label: 'Column 3', display: '🧱 Column 3', numbers: ['3', '6', '9', '12', '15', '18', '21', '24', '27', '30', '33', '36'] },
];

const PAYOUTS = {
  straight: 36,
  split: 18,
  street: 12,
  corner: 9,
  line: 6,
  dozen: 3,
  column: 3,
  color: 2,
  parity: 2,
  range: 2,
};

const activeGames = new Map();

function rangeStrings(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function randomOutlineColor() {
  const colors = ['#ff4fd8', '#57f287', '#fee75c', '#5865f2', '#00d4ff', '#ff8c42', '#b35cff', '#ffffff'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function ensureCacheDir() {
  fs.mkdirSync(ROULETTE_CACHE_DIR, { recursive: true });
}

function findAssetFile(dir, baseNames, extensions) {
  const names = Array.isArray(baseNames) ? baseNames : [baseNames];
  for (const baseName of names) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${baseName}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findAssetContaining(dir, token, extensions) {
  if (!token || !fs.existsSync(dir)) return null;

  const normalizedToken = String(token).toLowerCase();
  const extensionSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!extensionSet.has(extension)) continue;
    const basename = path.basename(file, extension).toLowerCase();
    if (basename.includes(normalizedToken)) {
      return path.join(dir, file);
    }
  }

  return null;
}

function getTableAssetPath() {
  return findAssetFile(
    ROULETTE_DIR,
    ['roulette table', 'roulette-table', 'roulette_table', 'table'],
    ['.png', '.jpg', '.jpeg', '.webp'],
  );
}

function getResultImagePath(resultNumber) {
  return findAssetContaining(ROULETTE_IMAGES_DIR, `RW${resultNumber}`, ['.png', '.jpg', '.jpeg', '.webp']);
}

function getSpinStillPath(resultNumber) {
  return findAssetContaining(ROULETTE_IMAGES_DIR, `RW${resultNumber}`, ['.png', '.jpg', '.jpeg', '.webp']);
}

function getSpinGifPath(resultNumber) {
  return (
    findAssetContaining(ROULETTE_GIFS_DIR, `RW${resultNumber}`, ['.gif'])
    || findAssetContaining(ROULETTE_IMAGES_DIR, `RW${resultNumber}`, ['.gif'])
  );
}

function mediaGallery(fileName) {
  return {
    type: 12,
    items: [
      {
        media: { url: `attachment://${fileName}` },
      },
    ],
  };
}

function getNumberColor(number) {
  const key = String(number);
  if (key === '0' || key === '00') return 'green';
  if (RED_NUMBERS.has(key)) return 'red';
  return 'black';
}

function getResultAccent(number) {
  const color = getNumberColor(number);
  if (color === 'red') return RED_ACCENT;
  if (color === 'green') return GREEN_ACCENT;
  return BLACK_ACCENT;
}

function normalizeNumber(raw) {
  const value = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (value === '00' || value === 'double zero' || value === 'doublezero') return '00';
  if (value === '0' || value === 'zero') return '0';
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 36) return null;
  return String(number);
}

function parseNumberList(raw) {
  const matches = String(raw || '').toLowerCase().match(/double\s*zero|00|\d+/g) || [];
  return matches.map(normalizeNumber).filter(Boolean);
}

function uniqueNumbers(numbers) {
  return Array.from(new Set(numbers));
}

function numberPosition(number) {
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 36) return null;
  return {
    row: (numeric - 1) % 3,
    column: Math.floor((numeric - 1) / 3),
  };
}

function areAdjacentSplit(a, b) {
  if (a === b) return false;
  const specialSplits = new Set(['00:0', '0:1', '0:2', '00:2', '00:3']);
  const sortedSpecial = [a, b].sort((left, right) => RESULT_NUMBERS.indexOf(left) - RESULT_NUMBERS.indexOf(right)).join(':');
  if (specialSplits.has(sortedSpecial)) return true;

  const posA = numberPosition(a);
  const posB = numberPosition(b);
  if (!posA || !posB) return false;

  const sameStreet = posA.column === posB.column && Math.abs(posA.row - posB.row) === 1;
  const sameColumn = posA.row === posB.row && Math.abs(posA.column - posB.column) === 1;
  return sameStreet || sameColumn;
}

function getValidCornerSets() {
  const sets = [];
  for (let street = 0; street < 11; street += 1) {
    for (let row = 0; row < 2; row += 1) {
      const first = (street * 3) + row + 1;
      sets.push([first, first + 1, first + 3, first + 4].map(String));
    }
  }
  return sets;
}

const VALID_CORNERS = getValidCornerSets();

function isValidCorner(numbers) {
  const sorted = [...numbers].sort((a, b) => Number(a) - Number(b)).join(':');
  return VALID_CORNERS.some((corner) => [...corner].sort((a, b) => Number(a) - Number(b)).join(':') === sorted);
}

function getSubmittedComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  const stack = [...getSubmittedComponents(interaction)];
  while (stack.length) {
    const component = stack.shift();
    if (!component) continue;

    if (component.custom_id === customId || component.customId === customId) {
      return component;
    }

    if (component.component) stack.push(component.component);
    if (Array.isArray(component.components)) stack.push(...component.components);
  }
  return null;
}

function getSubmittedValue(interaction, customId) {
  const component = findSubmittedComponent(interaction, customId);
  if (!component) {
    try {
      return interaction.fields.getTextInputValue(customId);
    } catch {
      return null;
    }
  }

  if (Array.isArray(component.values) && component.values.length) return component.values[0];
  if (Array.isArray(component.selected_values) && component.selected_values.length) return component.selected_values[0];
  if (component.value !== undefined) return component.value;
  if (component.selected_value !== undefined) return component.selected_value;

  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return null;
  }
}

function parseBetAmount(raw) {
  const rawValue = String(raw || '');
  const compact = rawValue.replace(/,/g, '').replace(/\s+/g, '');
  return {
    amount: Math.floor(Number(compact)),
    currency: 'prcoin',
  };
}

function getBetUnit(currency) {
  return PRCOIN;
}

function getBetUnitLabel(currency) {
  return 'PRcoin';
}

function getBetRange(currency) {
  return { min: PRCOIN_MIN_BET, max: PRCOIN_MAX_BET };
}

function buildBetSelect(game, disabled = false, placeholder = 'place a Bet') {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `roulette:select:${game.userId}:${game.id}`,
        placeholder,
        min_values: 1,
        max_values: 1,
        disabled,
        options: [
          { emoji: { name: '🎯' }, label: 'Straight', value: 'straight', description: 'Pick 1 exact number.' },
          { emoji: { name: '✌️' }, label: 'Split', value: 'split', description: 'Bet between two adjacent numbers.' },
          { emoji: { name: '🔺' }, label: 'Street', value: 'street', description: 'Pick 3 numbers in the same row.' },
          { emoji: { name: '◼️' }, label: 'Corner', value: 'corner', description: 'Pick 4 touching numbers in a square.' },
          { emoji: { name: '🧱' }, label: 'Line', value: 'line', description: 'Pick 6 numbers from 2 connected rows.' },
          { emoji: { name: '📦' }, label: 'Dozen', value: 'dozen', description: 'Pick one group of 12 numbers.' },
          { emoji: { name: '🧱' }, label: 'Column', value: 'column', description: 'Pick one vertical column.' },
          { emoji: { name: '🔴' }, label: 'Color', value: 'color', description: 'Pick Red or Black.' },
          { emoji: { name: '🔢' }, label: 'Odd / Even', value: 'parity', description: 'Pick Odd or Even.' },
          { emoji: { name: '⬇️' }, label: 'Low / High', value: 'range', description: 'Pick Low or High.' },
        ],
      },
    ],
  };
}

function buildStartButton(game, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `roulette:start:${game.userId}:${game.id}`,
        label: 'START',
        style: 3,
        disabled,
      },
    ],
  };
}

function buildBetText(game) {
  if (!game.betSelection) {
    return [
      `### Welcome ${game.userMention} to Roulette game!`,
      '* Choose and place your bet so the game can begin!.',
    ].join('\n');
  }

  const base = [
    `### Welcome ${game.userMention} to Roulette game!`,
    '* You\'ve placed a bet on:',
  ];

  if (game.status === 'finished' && game.resultNumber) {
    const result = game.lastOutcome;
    if (result?.win) {
      base.push(`-# * ${game.userMention} ➜ ${game.betSelection.display} - Win: ${formatNumber(result.payout)} ${getBetUnit(game.betCurrency)} \`(Bet: ${formatNumber(game.bet)} ${getBetUnitLabel(game.betCurrency)})\` ${WIN_EMOJI}`);
    } else {
      base.push(`-# * ${game.userMention} ➜ ${game.betSelection.display} - Lose: ${formatNumber(game.bet)} ${getBetUnit(game.betCurrency)} \`(Bet: ${formatNumber(game.bet)} ${getBetUnitLabel(game.betCurrency)})\` ${LOSE_EMOJI}`);
    }
    base.push(`-# Result: **${game.resultNumber}** (${getNumberColor(game.resultNumber).toUpperCase()})`);
    return base.join('\n');
  }

  base.push(`-# * ${game.userMention} ➜ ${game.betSelection.display} - Bet: ${formatNumber(game.bet)} ${getBetUnit(game.betCurrency)} ${NEUTRAL_EMOJI}`);
  return base.join('\n');
}

function makeTextDisplay(content) {
  return { type: 10, content };
}

function buildStraightWinContainer(game, payout) {
  return {
    type: 17,
    accent_color: 0xffd84d,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: [
              `Congratulation ${game.userMention} has won a **Straight** bet in Roulette! 🏆`,
              `* Earned: ${formatNumber(payout)} ${getBetUnit(game.betCurrency)} \`(bet ${formatNumber(game.bet)})\``,
              `* Bonus: 1 ${JPCOIN} for winning a Straight bet`,
            ].join('\n'),
          },
        ],
        accessory: {
          type: 11,
          media: { url: game.avatarUrl },
        },
      },
    ],
  };
}

async function announceStraightWin(game, payout) {
  const channel = game.message?.guild?.channels?.cache?.get(ROULETTE_STRAIGHT_WIN_CHANNEL_ID)
    || await game.message?.guild?.channels?.fetch(ROULETTE_STRAIGHT_WIN_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return;

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [buildStraightWinContainer(game, payout)],
  }).catch(() => null);
}

function buildModalComponents(betType, defaultBetInput = '') {
  const betInput = {
    type: 18,
    label: 'Question 2: Bet amount',
    component: {
      type: 4,
      custom_id: 'bet',
      style: 1,
      required: true,
      min_length: 1,
      max_length: 12,
      placeholder: 'Example: 100',
      ...(defaultBetInput ? { value: defaultBetInput } : {}),
    },
  };

  if (betType === 'straight') {
    return [
      {
        type: 18,
        label: 'Question 1: What number? (00, 0, or 1-36)',
        component: {
          type: 4,
          custom_id: 'numbers',
          style: 1,
          required: true,
          min_length: 1,
          max_length: 2,
          placeholder: 'Example: 17',
        },
      },
      betInput,
    ];
  }

  if (betType === 'split') {
    return [
      {
        type: 18,
        label: 'Question 1: What 2 adjacent numbers?',
        component: {
          type: 4,
          custom_id: 'numbers',
          style: 1,
          required: true,
          min_length: 3,
          max_length: 20,
          placeholder: 'Example: 1 2 or 1,4',
        },
      },
      betInput,
    ];
  }

  if (betType === 'street') {
    return [
      {
        type: 18,
        label: 'Question 1: Which row?',
        component: {
          type: 3,
          custom_id: 'choice',
          placeholder: 'Select a row',
          min_values: 1,
          max_values: 1,
          required: true,
          options: ROWS.map((row) => ({ label: row.label, value: row.key })),
        },
      },
      betInput,
    ];
  }

  if (betType === 'corner') {
    return [
      {
        type: 18,
        label: 'Question 1: What 4 numbers?',
        component: {
          type: 4,
          custom_id: 'numbers',
          style: 1,
          required: true,
          min_length: 7,
          max_length: 30,
          placeholder: 'Example: 1 2 4 5',
        },
      },
      betInput,
    ];
  }

  if (betType === 'line') {
    return [
      {
        type: 18,
        label: 'Question 1: Which line?',
        component: {
          type: 3,
          custom_id: 'choice',
          placeholder: 'Select a line',
          min_values: 1,
          max_values: 1,
          required: true,
          options: LINES.map((line) => ({ label: line.label, value: line.key })),
        },
      },
      betInput,
    ];
  }

  if (betType === 'dozen') {
    return [
      {
        type: 18,
        label: 'Question 1: Which group?',
        component: {
          type: 3,
          custom_id: 'choice',
          placeholder: 'Select a group',
          min_values: 1,
          max_values: 1,
          required: true,
          options: DOZENS.map((group) => ({ label: group.label, value: group.key })),
        },
      },
      betInput,
    ];
  }

  if (betType === 'column') {
    return [
      {
        type: 18,
        label: 'Question 1: Which column?',
        component: {
          type: 3,
          custom_id: 'choice',
          placeholder: 'Select a column',
          min_values: 1,
          max_values: 1,
          required: true,
          options: COLUMNS.map((column) => ({ label: column.label, value: column.key })),
        },
      },
      betInput,
    ];
  }

  if (betType === 'color') {
    return [
      {
        type: 18,
        label: 'Question 1: Choose one',
        component: {
          type: RADIO_GROUP_COMPONENT_TYPE,
          custom_id: 'choice',
          required: true,
          options: [
            { label: 'Red', value: 'red' },
            { label: 'Black', value: 'black' },
          ],
        },
      },
      betInput,
    ];
  }

  if (betType === 'parity') {
    return [
      {
        type: 18,
        label: 'Question 1: Choose one',
        component: {
          type: RADIO_GROUP_COMPONENT_TYPE,
          custom_id: 'choice',
          required: true,
          options: [
            { label: 'Odd', value: 'odd' },
            { label: 'Even', value: 'even' },
          ],
        },
      },
      betInput,
    ];
  }

  return [
    {
      type: 18,
      label: 'Question 1: Choose one',
      component: {
        type: RADIO_GROUP_COMPONENT_TYPE,
        custom_id: 'choice',
        required: true,
        options: [
          { label: 'Low (1-18)', value: 'low' },
          { label: 'High (19-36)', value: 'high' },
        ],
      },
    },
    betInput,
  ];
}

function getModalTitle(betType) {
  const labels = {
    straight: 'Straight Bet',
    split: 'Split Bet',
    street: 'Street Bet',
    corner: 'Corner Bet',
    line: 'Line Bet',
    dozen: 'Dozen Bet',
    column: 'Column Bet',
    color: 'Color Bet',
    parity: 'Odd / Even Bet',
    range: 'Low / High Bet',
  };
  return labels[betType] || 'Roulette Bet';
}

function makeSelectionFromModal(betType, interaction) {
  const rawNumbers = getSubmittedValue(interaction, 'numbers');
  const choice = getSubmittedValue(interaction, 'choice');

  if (betType === 'straight') {
    const number = normalizeNumber(rawNumbers);
    if (!number) throw new Error('Choose one valid number: 00, 0, or 1-36.');
    return {
      type: 'straight',
      display: `🎯 Straight ${number}`,
      numbers: [number],
      tokenTargets: [number],
    };
  }

  if (betType === 'split') {
    const numbers = uniqueNumbers(parseNumberList(rawNumbers));
    if (numbers.length !== 2 || !areAdjacentSplit(numbers[0], numbers[1])) {
      throw new Error('Split needs exactly 2 adjacent numbers. Example: 1 2, 1 4, 0 1, or 00 3.');
    }
    return {
      type: 'split',
      display: `✌️ Split ${numbers.join(' + ')}`,
      numbers,
      tokenTargets: numbers,
    };
  }

  if (betType === 'street') {
    const row = ROWS.find((item) => item.key === choice);
    if (!row) throw new Error('Choose a valid street row.');
    return {
      type: 'street',
      display: `🔺 Street ${row.label}`,
      numbers: row.numbers,
      tokenTargets: row.numbers,
    };
  }

  if (betType === 'corner') {
    const numbers = uniqueNumbers(parseNumberList(rawNumbers));
    if (numbers.length !== 4 || numbers.some((number) => number === '0' || number === '00') || !isValidCorner(numbers)) {
      throw new Error('Corner needs 4 numbers that touch in a square. Example: 1 2 4 5.');
    }
    return {
      type: 'corner',
      display: `◼️ Corner ${numbers.join('-')}`,
      numbers,
      tokenTargets: numbers,
    };
  }

  if (betType === 'line') {
    const line = LINES.find((item) => item.key === choice);
    if (!line) throw new Error('Choose a valid six line.');
    return {
      type: 'line',
      display: `🧱 ${line.label}`,
      numbers: line.numbers,
      tokenTargets: line.numbers,
    };
  }

  if (betType === 'dozen') {
    const group = DOZENS.find((item) => item.key === choice);
    if (!group) throw new Error('Choose a valid dozen group.');
    return {
      type: 'dozen',
      display: group.display,
      numbers: group.numbers,
      areaKey: group.key,
    };
  }

  if (betType === 'column') {
    const column = COLUMNS.find((item) => item.key === choice);
    if (!column) throw new Error('Choose a valid column.');
    return {
      type: 'column',
      display: column.display,
      numbers: column.numbers,
      areaKey: column.key,
    };
  }

  if (betType === 'color') {
    if (!['red', 'black'].includes(choice)) throw new Error('Choose Red or Black.');
    return {
      type: 'color',
      display: choice === 'red' ? '🔴 Red' : '⚫ Black',
      numbers: choice === 'red' ? [...RED_NUMBERS] : [...BLACK_NUMBERS],
      areaKey: choice,
      choice,
    };
  }

  if (betType === 'parity') {
    if (!['odd', 'even'].includes(choice)) throw new Error('Choose Odd or Even.');
    const numbers = rangeStrings(1, 36).filter((number) => (Number(number) % 2 === 0) === (choice === 'even'));
    return {
      type: 'parity',
      display: choice === 'odd' ? '🔢 Odd' : '🔢 Even',
      numbers,
      areaKey: choice,
      choice,
    };
  }

  if (!['low', 'high'].includes(choice)) throw new Error('Choose Low or High.');
  return {
    type: 'range',
    display: choice === 'low' ? '⬇️ Low (1-18)' : '⬆️ High (19-36)',
    numbers: choice === 'low' ? rangeStrings(1, 18) : rangeStrings(19, 36),
    areaKey: choice,
    choice,
  };
}

function isBetWinner(selection, resultNumber) {
  return Boolean(selection?.numbers?.includes(String(resultNumber)));
}

function buildFallbackTableCanvas() {
  const canvas = createCanvas(501, 244);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b7d3b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(53, 5, 408, 137);
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let number = 1; number <= 36; number += 1) {
    const key = String(number);
    const rect = getNumberRect(key, 1, 1);
    ctx.fillStyle = RED_NUMBERS.has(key) ? '#d71920' : '#151515';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(key, rect.x + (rect.width / 2), rect.y + (rect.height / 2));
  }

  for (const zero of ['00', '0']) {
    const rect = getNumberRect(zero, 1, 1);
    ctx.fillStyle = '#0b7d3b';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(zero, rect.x + (rect.width / 2), rect.y + (rect.height / 2));
  }

  ctx.font = 'bold 15px sans-serif';
  for (const key of ['dozen_1', 'dozen_2', 'dozen_3', 'low', 'even', 'red', 'black', 'odd', 'high']) {
    const rect = getAreaRect(key, 1, 1);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText('1st 12', 121, 166);
  ctx.fillText('2nd 12', 257, 166);
  ctx.fillText('3rd 12', 393, 166);
  ctx.fillText('1 to 18', 87, 212);
  ctx.fillText('EVEN', 155, 212);
  ctx.fillText('RED', 223, 212);
  ctx.fillText('BLACK', 291, 212);
  ctx.fillText('ODD', 359, 212);
  ctx.fillText('19 to 36', 427, 212);
  return canvas;
}

function scaledRect(rect, scaleX, scaleY) {
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function getNumberRect(number, scaleX, scaleY) {
  if (number === '00') return scaledRect({ x: 6, y: 5, width: 47, height: 67 }, scaleX, scaleY);
  if (number === '0') return scaledRect({ x: 6, y: 72, width: 47, height: 70 }, scaleX, scaleY);

  const pos = numberPosition(number);
  if (!pos) return null;
  const rowFromTop = 2 - pos.row;
  return scaledRect({
    x: 53 + (pos.column * 34),
    y: 5 + (rowFromTop * 45.7),
    width: 34,
    height: 45.7,
  }, scaleX, scaleY);
}

function getAreaRect(key, scaleX, scaleY) {
  const areaRects = {
    dozen_1: { x: 53, y: 145, width: 136, height: 42 },
    dozen_2: { x: 189, y: 145, width: 136, height: 42 },
    dozen_3: { x: 325, y: 145, width: 136, height: 42 },
    low: { x: 53, y: 187, width: 68, height: 48 },
    even: { x: 121, y: 187, width: 68, height: 48 },
    red: { x: 189, y: 187, width: 68, height: 48 },
    black: { x: 257, y: 187, width: 68, height: 48 },
    odd: { x: 325, y: 187, width: 68, height: 48 },
    high: { x: 393, y: 187, width: 68, height: 48 },
    column_1: { x: 461, y: 96.4, width: 35, height: 45.7 },
    column_2: { x: 461, y: 50.7, width: 35, height: 45.7 },
    column_3: { x: 461, y: 5, width: 35, height: 45.7 },
  };
  return areaRects[key] ? scaledRect(areaRects[key], scaleX, scaleY) : null;
}

function getRectCenter(rect) {
  return {
    x: rect.x + (rect.width / 2),
    y: rect.y + (rect.height / 2),
  };
}

function averageCenters(rects) {
  const centers = rects.map(getRectCenter);
  return {
    x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
    y: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
  };
}

function drawHighlight(ctx, rect) {
  if (!rect) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 235, 59, 0.36)';
  ctx.strokeStyle = '#fff176';
  ctx.lineWidth = Math.max(2, Math.min(rect.width, rect.height) * 0.08);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawWinningHighlights(ctx, resultNumber, scaleX, scaleY) {
  const numberRect = getNumberRect(resultNumber, scaleX, scaleY);
  drawHighlight(ctx, numberRect);

  const numeric = Number(resultNumber);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 36) return;

  if (numeric <= 12) drawHighlight(ctx, getAreaRect('dozen_1', scaleX, scaleY));
  else if (numeric <= 24) drawHighlight(ctx, getAreaRect('dozen_2', scaleX, scaleY));
  else drawHighlight(ctx, getAreaRect('dozen_3', scaleX, scaleY));

  const columnIndex = ((numeric - 1) % 3) + 1;
  drawHighlight(ctx, getAreaRect(`column_${columnIndex}`, scaleX, scaleY));
  drawHighlight(ctx, getAreaRect(getNumberColor(resultNumber), scaleX, scaleY));
  drawHighlight(ctx, getAreaRect(numeric % 2 === 0 ? 'even' : 'odd', scaleX, scaleY));
  drawHighlight(ctx, getAreaRect(numeric <= 18 ? 'low' : 'high', scaleX, scaleY));
}

async function drawToken(ctx, avatarUrl, center, size, outlineColor) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#2b2d31';
  ctx.fill();
  ctx.clip();

  try {
    const avatar = await loadImage(avatarUrl);
    ctx.drawImage(avatar, center.x - (size / 2), center.y - (size / 2), size, size);
  } catch {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(center.x - (size / 2), center.y - (size / 2), size, size);
  }

  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.max(4, size * 0.15);
  ctx.stroke();
  ctx.restore();
}

async function renderTableImage(game, options = {}) {
  ensureCacheDir();
  let canvas;
  const tablePath = getTableAssetPath();
  if (tablePath) {
    try {
      const base = await loadImage(tablePath);
      canvas = createCanvas(base.width, base.height);
      const baseCtx = canvas.getContext('2d');
      baseCtx.drawImage(base, 0, 0, canvas.width, canvas.height);
    } catch {
      canvas = buildFallbackTableCanvas();
    }
  } else {
    canvas = buildFallbackTableCanvas();
  }

  const ctx = canvas.getContext('2d');
  const scaleX = canvas.width / 501;
  const scaleY = canvas.height / 244;

  if (options.highlightResult) {
    drawWinningHighlights(ctx, String(options.highlightResult), scaleX, scaleY);
  }

  if (game.betSelection) {
    let center = null;
    let tokenSize = Math.max(24, Math.min(34 * scaleX, 34 * scaleY));

    if (game.betSelection.areaKey) {
      const rect = getAreaRect(game.betSelection.areaKey, scaleX, scaleY);
      if (rect) {
        center = getRectCenter(rect);
        tokenSize = Math.max(28, Math.min(rect.width, rect.height) * 0.78);
      }
    } else if (Array.isArray(game.betSelection.tokenTargets)) {
      const rects = game.betSelection.tokenTargets
        .map((number) => getNumberRect(number, scaleX, scaleY))
        .filter(Boolean);
      if (rects.length) {
        center = averageCenters(rects);
        tokenSize = Math.max(24, Math.min(...rects.map((rect) => Math.min(rect.width, rect.height))) * 0.82);
      }
    }

    if (center) {
      await drawToken(ctx, game.avatarUrl, center, tokenSize, game.tokenOutlineColor);
    }
  }

  const filename = `roulette-table-${game.id}-${Date.now()}.png`;
  const filePath = path.join(ROULETTE_CACHE_DIR, filename);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return { attachment: new AttachmentBuilder(filePath, { name: filename }), fileName: filename };
}

function buildExternalMediaAttachments(game, options = {}) {
  const attachments = [];
  const components = [];

  if (options.spinResult) {
    const spinPath = getSpinGifPath(options.spinResult);
    if (spinPath) {
      const extension = path.extname(spinPath) || '.gif';
      const fileName = `RW${options.spinResult}${extension}`;
      attachments.push(new AttachmentBuilder(spinPath, { name: fileName }));
      components.push(mediaGallery(fileName));
    } else {
      components.push(makeTextDisplay(`-# 🎰 Roulette GIF missing while spinning. Result: **${options.spinResult}**`));
    }
  }

  if (options.resultImage) {
    const imagePath = getResultImagePath(options.resultImage);
    if (imagePath) {
      const extension = path.extname(imagePath) || '.png';
      const fileName = `RW${options.resultImage}${extension}`;
      attachments.push(new AttachmentBuilder(imagePath, { name: fileName }));
      components.push(mediaGallery(fileName));
    } else {
      components.push(makeTextDisplay(`-# 🎰 Roulette PNG result image missing. Result: **${options.resultImage}**`));
    }
  }

  return { attachments, components };
}

async function buildGamePayload(game, mode = 'normal') {
  const highlightResult = mode === 'finished' ? game.resultNumber : null;
  const tableRender = await renderTableImage(game, { highlightResult });
  const tableFileName = tableRender.fileName;
  const files = [tableRender.attachment];

  const container = {
    type: 17,
    accent_color: mode === 'finished' && game.resultNumber ? getResultAccent(game.resultNumber) : WHITE_ACCENT,
    components: [
      makeTextDisplay(buildBetText(game)),
      mediaGallery(tableFileName),
      { type: 14, divider: true, spacing: 1 },
    ],
  };

  if (mode === 'spinning') {
    const media = buildExternalMediaAttachments(game, { spinResult: game.resultNumber });
    files.push(...media.attachments);
    container.components.push(...media.components);
    container.components.push({ type: 14, divider: true, spacing: 1 });
    container.components.push(buildBetSelect(game, true, 're-place a Bet?'));
    container.components.push(buildStartButton(game, true));
  } else if (mode === 'finished') {
    const media = buildExternalMediaAttachments(game, { resultImage: game.resultNumber });
    files.push(...media.attachments);
    container.components.push(...media.components);
    container.components.push({ type: 14, divider: true, spacing: 1 });
    container.components.push(buildBetSelect(game, false, 're-place a Bet?'));
  } else if (game.betSelection) {
    if (game.lastSpinNumber) {
      const media = buildExternalMediaAttachments(game, {
        resultImage: game.lastSpinNumber,
      });
      files.push(...media.attachments);
      container.components.push(...media.components);
      container.components.push({ type: 14, divider: true, spacing: 1 });
    }
    container.components.push(buildBetSelect(game, false, game.status === 'finished' ? 're-place a Bet?' : 're-place a Bet?'));
    container.components.push(buildStartButton(game, false));
  } else {
    if (game.lastSpinNumber) {
      const media = buildExternalMediaAttachments(game, {
        resultImage: game.lastSpinNumber,
      });
      files.push(...media.attachments);
      container.components.push(...media.components);
      container.components.push({ type: 14, divider: true, spacing: 1 });
    }
    container.components.push(buildBetSelect(game, false, 'place a Bet'));
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
    files,
    attachments: [],
  };
}

async function updateGameMessage(interaction, game, payload) {
  game.message = interaction.message || game.message;

  if (typeof interaction.update === 'function' && !interaction.replied && !interaction.deferred) {
    try {
      await interaction.update(payload);
      return true;
    } catch {
      // Fall through to editing the stored message directly.
    }
  }

  if (typeof interaction.deferUpdate === 'function' && !interaction.replied && !interaction.deferred) {
    await interaction.deferUpdate().catch(() => null);
  }

  if (interaction.message?.editable) {
    await interaction.message.edit(payload).catch(() => null);
    return true;
  }

  if (game.message?.editable) {
    await game.message.edit(payload).catch(() => null);
    return true;
  }

  if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: 'Roulette message could not be updated.', flags: EPHEMERAL_FLAG }).catch(() => null);
  }
  return true;
}

async function replyError(interaction, message) {
  if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: message, flags: EPHEMERAL_FLAG }).catch(() => null);
  }
}

async function applyBet(interaction, game, betType) {
  let selection;
  try {
    selection = makeSelectionFromModal(betType, interaction);
  } catch (error) {
    await replyError(interaction, error.message || 'Invalid Roulette bet.');
    return true;
  }

  const parsedBet = parseBetAmount(getSubmittedValue(interaction, 'bet'));
  const bet = parsedBet.amount;
  const currency = parsedBet.currency;
  const range = getBetRange(currency);
  if (!Number.isFinite(bet) || bet < range.min || bet > range.max) {
    await replyError(interaction, `Bet must be between **${formatNumber(range.min)}** and **${formatNumber(range.max)}** for ${getBetUnit(currency)}.`);
    return true;
  }
  const canRefundCurrentBet = game.status === 'bet_placed' && game.bet > 0;
  const availableBalance = getBalance(game.userId) + (canRefundCurrentBet ? game.bet : 0);
  if (availableBalance < bet) {
    await replyError(interaction, `You need **${formatNumber(bet)}** ${getBetUnit(currency)} to place that bet. Your available balance is **${formatNumber(availableBalance)}** ${getBetUnit(currency)}.`);
    return true;
  }

  if (canRefundCurrentBet) {
    addBalance(game.userId, game.bet);
  }

  const spent = spendBalance(game.userId, bet);
  if (!spent) {
    await replyError(interaction, `You do not have enough ${getBetUnit(currency)} for that bet.`);
    return true;
  }

  game.bet = bet;
  game.betCurrency = currency;
  setLastBetInput(game.userId, getSubmittedValue(interaction, 'bet'), 'roulette');
  game.betSelection = selection;
  game.status = 'bet_placed';
  game.resultNumber = null;
  game.lastSpinNumber = null;
  game.lastOutcome = null;
  const payload = await buildGamePayload(game, 'normal');
  await updateGameMessage(interaction, game, payload);
  return true;
}

async function settleSpin(gameId) {
  const game = activeGames.get(gameId);
  if (!game || game.status !== 'spinning') return;

  const won = isBetWinner(game.betSelection, game.resultNumber);
  const multiplier = PAYOUTS[game.betSelection.type] || 0;
  const payout = won ? Math.max(0, Math.floor(game.bet * multiplier)) : 0;

  if (won && payout > 0) {
    addBalance(game.userId, payout);
    recordGamblingEarnings(game.userId, payout);
    if (game.guildId) leveling.addUserXp(game.guildId, game.userId, 10 * multiplier);
  }
  if (won && game.betSelection?.type === 'straight') {
    addJackpotBalance(game.userId, 1);
  }
  if (won && game.betSelection?.type === 'straight' && game.message?.channel) {
    await unlockBullseyeAchievement(game.message.channel, { id: game.userId });
    await announceStraightWin(game, payout);
  }

  game.status = 'finished';
  game.lastSpinNumber = game.resultNumber;
  game.lastOutcome = { win: won, payout };
  const payload = await buildGamePayload(game, 'finished');
  if (game.message?.editable) {
    await game.message.edit(payload).catch(() => null);
  }
}

async function startSpin(interaction, game) {
  if (!game.betSelection || game.status !== 'bet_placed') {
    await replyError(interaction, 'Place a Roulette bet before pressing START.');
    return true;
  }

  game.status = 'spinning';
  game.resultNumber = RESULT_NUMBERS[Math.floor(Math.random() * RESULT_NUMBERS.length)];
  game.lastOutcome = null;
  game.message = interaction.message || game.message;

  const payload = await buildGamePayload(game, 'spinning');
  await updateGameMessage(interaction, game, payload);

  setTimeout(() => {
    settleSpin(game.id).catch((error) => console.error('Roulette settle failed:', error));
  }, SPIN_TIME_MS);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Play American Roulette with PRcoin'),
  suppressCommandLog: true,

  async execute(interaction) {
    const game = {
      id: createGameId(),
      userId: interaction.user.id,
      userMention: `<@${interaction.user.id}>`,
      username: interaction.user.username,
      avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
      tokenOutlineColor: randomOutlineColor(),
      bet: 0,
      betCurrency: 'prcoin',
      guildId: interaction.guildId || null,
      betSelection: null,
      status: 'waiting',
      resultNumber: null,
      lastSpinNumber: null,
      lastOutcome: null,
      message: null,
    };

    activeGames.set(game.id, game);
    const payload = await buildGamePayload(game, 'normal');
    delete payload.attachments;
    const response = await interaction.reply({ ...payload, withResponse: true });
    game.message = response?.resource?.message ?? null;
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('roulette:'));
  },

  async handleInteraction(interaction) {
    const customId = interaction.customId;
    const isRouletteInteraction = typeof customId === 'string' && customId.startsWith('roulette:');
    if (!isRouletteInteraction) return false;

    const [prefix, action, ownerId, gameId, extra] = customId.split(':');
    if (prefix !== 'roulette') return false;

    if (ownerId !== interaction.user.id) {
      await replyError(interaction, 'You can only play your own Roulette game.');
      return true;
    }

    const game = activeGames.get(gameId);
    if (!game) {
      await replyError(interaction, 'This Roulette game is no longer active. Use /roulette to start a new one.');
      return true;
    }

    game.message = interaction.message || game.message;

    if (interaction.isStringSelectMenu?.() && action === 'select') {
      if (game.status === 'spinning') {
        await replyError(interaction, 'Roulette is spinning right now. Wait for the result first.');
        return true;
      }

      const betType = interaction.values?.[0];
      if (!PAYOUTS[betType]) {
        await replyError(interaction, 'Unknown Roulette bet type.');
        return true;
      }

      await interaction.showModal({
        custom_id: `roulette:modal:${interaction.user.id}:${game.id}:${betType}`,
        title: getModalTitle(betType),
        components: buildModalComponents(betType, getLastBetInput(interaction.user.id, 'roulette')),
      });
      return true;
    }

    if (interaction.isButton?.() && action === 'start') {
      await startSpin(interaction, game);
      return true;
    }

    if (interaction.isModalSubmit?.() && action === 'modal') {
      if (game.status === 'spinning') {
        await replyError(interaction, 'Roulette is spinning right now. Wait for the result first.');
        return true;
      }

      await applyBet(interaction, game, extra);
      return true;
    }

    return false;
  },
};
