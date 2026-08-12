const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../commands');
const { WORK_COMMANDS } = require('../../work/commands');
const { MAX_BIG_CROP_TIER, MAX_LUCK_TIER } = require('../config/upgrades');
const { ROLL_COOLDOWN_MS } = require('../services/gameService');
const { DEFAULT_CAPACITY } = require('../repositories/gameRepository');
const { MAX_AUTO_ROLL_MINUTES } = require('../utils/autoRoll');
const {
  EXCHANGE_SHECKLES_PER_TOKEN,
  EXCHANGE_WINDOW_LIMIT,
} = require('../repositories/tokenRepository');
const { MIN_BET, MAX_BET } = require('../services/rpsRules');
const { WORK_RANKS } = require('../../work/ranks');

const INFO_MESSAGE_VERSION = 2;
const INFO_COMMAND_PAGE_SIZE = 25;
const INFO_SELECT_CUSTOM_ID = `rng:info:command:v${INFO_MESSAGE_VERSION}:0:1`;

const CATEGORY_ORDER = Object.freeze([
  'Core Game',
  'Progression',
  'Tokens & Activities',
]);

const COMMAND_GUIDES = Object.freeze({
  roll: {
    category: 'Core Game',
    fallbackEmoji: '🎲',
    configuredEmoji: process.env.RNG_INFO_ROLL_EMOJI,
    whatItDoes: [
      'Rolls one crop using your current Luck and BIG tiers, then stores the unique crop instance in your inventory.',
      'A successful roll also records discoveries and lifetime statistics.',
    ],
    important: [`Manual rolls share a \`${ROLL_COOLDOWN_MS / 1_000}-second\` cooldown and require a free inventory slot.`],
    tip: 'Open your inventory afterward to inspect the crop’s weight and value.',
  },
  inventory: {
    category: 'Core Game',
    fallbackEmoji: '🎒',
    configuredEmoji: process.env.RNG_INFO_INVENTORY_EMOJI,
    whatItDoes: [`Shows your crop instances, filters, values, and used capacity. New players start with \`${DEFAULT_CAPACITY}\` slots.`],
    important: ['Crop-name, rarity, and minimum-weight filters can be combined.'],
    tip: 'Use filters before selling when your inventory is crowded.',
  },
  sell: {
    category: 'Core Game',
    fallbackEmoji: '🪙',
    configuredEmoji: process.env.RNG_INFO_SELL_EMOJI,
    whatItDoes: ['Opens a persistent crop picker, then confirms the selected sale before removing crops and crediting Sheckles.'],
    important: ['Other RNG economy commands are locked while a sale is awaiting confirmation.'],
    tip: 'Review the selected crop count and total value before confirming.',
  },
  balance: {
    category: 'Core Game',
    fallbackEmoji: '💰',
    configuredEmoji: process.env.RNG_INFO_BALANCE_EMOJI,
    whatItDoes: ['Shows your current Sheckle balance and RPS token value.'],
    tip: 'Check your balance before buying upgrades or exchanging tokens.',
  },
  'auto-roll': {
    category: 'Progression',
    fallbackEmoji: '⏱️',
    configuredEmoji: process.env.RNG_INFO_AUTO_ROLL_EMOJI,
    whatItDoes: [`Previews and starts a paid scheduled roll job for up to \`${MAX_AUTO_ROLL_MINUTES / 1_440} day\`, with optional rarity-based auto-selling when space is needed.`],
    important: ['Manual rolling and selling stay unavailable until the active Auto Roll ends. Unprocessed paid rolls are refunded when the job cannot continue safely.'],
    tip: 'Review the live per-roll price and auto-sell rarities before confirming.',
  },
  upgrade: {
    category: 'Progression',
    fallbackEmoji: '⬆️',
    configuredEmoji: process.env.RNG_INFO_UPGRADE_EMOJI,
    whatItDoes: [`Opens upgrades for inventory capacity, Luck tiers \`0–${MAX_LUCK_TIER}\`, and BIG tiers \`0–${MAX_BIG_CROP_TIER}\`.`],
    important: ['Prices are recalculated and affordability is rechecked when a purchase is confirmed.'],
    tip: 'Luck changes rarity chances; BIG changes a crop’s final weight and value.',
  },
  index: {
    category: 'Progression',
    fallbackEmoji: '📚',
    configuredEmoji: process.env.RNG_INFO_INDEX_EMOJI,
    whatItDoes: ['Renders your personal crop discovery index with masked entries for crops you have not found.'],
    important: ['Selling a crop never removes its discovery from your index.'],
    tip: 'Return after a new discovery to see the updated entry.',
  },
  stat: {
    category: 'Progression',
    fallbackEmoji: '📊',
    configuredEmoji: process.env.RNG_INFO_STAT_EMOJI,
    whatItDoes: ['Shows lifetime rolls, Auto Rolls, sales, best crop, highest rarity, and weight records.'],
    tip: 'Statistics are historical, so sold crops still contribute to your records.',
  },
  'calculate-chance': {
    category: 'Progression',
    fallbackEmoji: '🍀',
    configuredEmoji: process.env.RNG_INFO_CHANCE_EMOJI,
    whatItDoes: ['Compares every visible crop’s base probability with the probability produced by your saved Luck tier.'],
    important: ['Undiscovered secret crops remain hidden from the comparison.'],
    tip: 'Use the linked chances page to explore the complete comparison.',
  },
  'exchange-token': {
    category: 'Tokens & Activities',
    fallbackEmoji: '🎟️',
    configuredEmoji: process.env.RNG_INFO_TOKEN_EMOJI,
    whatItDoes: [`Exchanges Sheckles for token value at \`${EXCHANGE_SHECKLES_PER_TOKEN.toLocaleString('en-US')} Sheckles\` per token.`],
    important: [`Each rolling four-hour window allows \`1–${EXCHANGE_WINDOW_LIMIT}\` token value.`],
    slashExamples: ['amount-token:10'],
    tip: 'Tokens are used for G-RPS wagers and can also be earned through G-Work.',
  },
  'g-rps': {
    category: 'Tokens & Activities',
    fallbackEmoji: '✂️',
    configuredEmoji: process.env.RNG_INFO_RPS_EMOJI,
    whatItDoes: [`Starts a Rock-Paper-Scissors table with token wagers from \`${MIN_BET.toLocaleString('en-US')}\` to \`${MAX_BET.toLocaleString('en-US')}\`.`],
    important: ['A wager can be won, lost, or returned after a draw; expired games are canceled safely.'],
    tip: 'Only wager tokens you are comfortable losing.',
  },
  'g-work': {
    category: 'Tokens & Activities',
    fallbackEmoji: '🍔',
    configuredEmoji: process.env.RNG_INFO_WORK_EMOJI,
    whatItDoes: [`Starts a timed work shift that rewards accuracy, streak progress, and advancement through ${WORK_RANKS.length} ranks.`],
    important: ['Work shifts have their own cooldown and expire if the order is not completed in time.'],
    tip: 'Higher ranks improve salary, while streaks reward consistent successful shifts.',
  },
});

function commandJson(command) {
  return command?.data?.toJSON ? command.data.toJSON() : command;
}

function slashCommands() {
  return [...RNG_GAME_COMMANDS, ...WORK_COMMANDS].map(commandJson);
}

function prefixCommands() {
  return [...PREFIX_COMMANDS.entries()].map(([prefix, slash]) => ({ prefix, slash }));
}

function prefixesByCommand() {
  const result = new Map();
  for (const [prefix, commandName] of PREFIX_COMMANDS) {
    const aliases = result.get(commandName) || [];
    aliases.push(prefix);
    result.set(commandName, aliases);
  }
  return result;
}

function expandCommand(command) {
  const root = String(command.name || '');
  const options = Array.isArray(command.options) ? command.options : [];
  const subcommands = options.filter((option) => option.type === 1);
  const groups = options.filter((option) => option.type === 2);
  if (!subcommands.length && !groups.length) {
    return [{
      root,
      path: root,
      key: root,
      description: String(command.description || ''),
      options: options.filter((option) => option.type !== 1 && option.type !== 2),
    }];
  }
  const expanded = subcommands.map((subcommand) => ({
    root,
    path: `${root} ${subcommand.name}`,
    key: `${root}:${subcommand.name}`,
    description: String(subcommand.description || command.description || ''),
    options: subcommand.options || [],
  }));
  for (const group of groups) {
    for (const subcommand of group.options || []) {
      if (subcommand.type !== 1) continue;
      expanded.push({
        root,
        path: `${root} ${group.name} ${subcommand.name}`,
        key: `${root}:${group.name}:${subcommand.name}`,
        description: String(subcommand.description || group.description || command.description || ''),
        options: subcommand.options || [],
      });
    }
  }
  return expanded;
}

function commandCatalog(definitions = slashCommands()) {
  const prefixMap = prefixesByCommand();
  return definitions.flatMap((definition) => expandCommand(commandJson(definition))).map((command) => {
    const guide = COMMAND_GUIDES[command.key] || COMMAND_GUIDES[command.root] || {};
    return Object.freeze({
      ...command,
      category: guide.category || 'Other Commands',
      configuredEmoji: guide.configuredEmoji || '',
      fallbackEmoji: guide.fallbackEmoji || '🎮',
      prefixes: Object.freeze([...(prefixMap.get(command.root) || [])]),
      whatItDoes: Object.freeze([...(guide.whatItDoes || [command.description])].filter(Boolean)),
      important: Object.freeze([...(guide.important || [])]),
      slashExamples: Object.freeze([...(guide.slashExamples || [])]),
      tip: String(guide.tip || ''),
    });
  });
}

function commandByKey(key, commands = commandCatalog()) {
  return commands.find((command) => command.key === String(key)) || null;
}

function paginateCommands(commands, requestedPage, pageSize = INFO_COMMAND_PAGE_SIZE) {
  const size = Math.max(1, Math.min(INFO_COMMAND_PAGE_SIZE, Math.floor(Number(pageSize) || INFO_COMMAND_PAGE_SIZE)));
  const pageCount = Math.max(1, Math.ceil(commands.length / size));
  const page = Math.max(1, Math.min(pageCount, Math.floor(Number(requestedPage) || 1)));
  return {
    page,
    pageCount,
    commands: commands.slice((page - 1) * size, page * size),
  };
}

function pageForCommand(key, commands = commandCatalog(), pageSize = INFO_COMMAND_PAGE_SIZE) {
  const index = commands.findIndex((command) => command.key === String(key));
  return index < 0 ? 1 : Math.floor(index / pageSize) + 1;
}

module.exports = {
  CATEGORY_ORDER,
  COMMAND_GUIDES,
  INFO_COMMAND_PAGE_SIZE,
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  commandByKey,
  commandCatalog,
  expandCommand,
  pageForCommand,
  paginateCommands,
  prefixCommands,
  slashCommands,
};
