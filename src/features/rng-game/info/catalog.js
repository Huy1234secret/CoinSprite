const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../commands');
const { WORK_COMMANDS } = require('../../work/commands');
const { COMMAND_GUIDES } = require('./guides');

const INFO_MESSAGE_VERSION = 3;
const INFO_COMMAND_PAGE_SIZE = 25;
const INFO_SELECT_CUSTOM_ID = `rng:info:command:v${INFO_MESSAGE_VERSION}:0:1`;

const CATEGORY_ORDER = Object.freeze([
  'Core Game',
  'Progression',
  'Tokens & Activities',
]);

const REQUIRED_GUIDE_FIELDS = Object.freeze([
  'purpose',
  'requirements',
  'steps',
  'mechanics',
  'results',
  'interactions',
  'restrictions',
  'failures',
  'examples',
]);

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

function fallbackGuide(command) {
  return Object.freeze({
    category: 'Other Commands',
    fallbackEmoji: '🎮',
    configuredEmoji: '',
    purpose: command.description,
    controls: Object.freeze([]),
    requirements: Object.freeze(['Meet the normal command access requirements.']),
    steps: Object.freeze(['Run the command and follow the controls shown by the bot.']),
    mechanics: Object.freeze(['The registered command description is the only authoritative mechanic available.']),
    results: Object.freeze(['The bot returns the command result.']),
    interactions: Object.freeze(['No related command metadata is available.']),
    restrictions: Object.freeze(['Use only current controls.']),
    failures: Object.freeze(['Rerun the command if its controls expire.']),
    examples: Object.freeze([`**Slash:** \`/${command.path}\``]),
    tips: Object.freeze([]),
    warnings: Object.freeze([]),
  });
}

function auditCommandCatalog(commands, options = {}) {
  const errors = [];
  const keys = new Set();
  for (const command of commands) {
    if (keys.has(command.key)) errors.push(`duplicate command key: ${command.key}`);
    keys.add(command.key);
    if (options.requireExplicit !== false && command.hasExplicitGuide !== true) {
      errors.push(`missing explicit guide: ${command.key}`);
    }
    for (const field of REQUIRED_GUIDE_FIELDS) {
      const value = command[field];
      if (field === 'purpose' ? !String(value || '').trim() : !Array.isArray(value) || !value.length) {
        errors.push(`${command.key} missing ${field}`);
      }
    }
    if (!command.tips.length && !command.warnings.length) errors.push(`${command.key} missing tips or warnings`);
    for (const option of command.options) {
      if (!option.name || !option.description || !Number.isInteger(option.type)) {
        errors.push(`${command.key} has an undocumented or malformed option`);
      }
    }
  }
  if (errors.length) throw new Error(`RNG information catalog is incomplete:\n- ${errors.join('\n- ')}`);
  return Object.freeze({ commandCount: commands.length, optionCount: commands.reduce((sum, command) => sum + command.options.length, 0) });
}

function commandCatalog(definitions) {
  const explicitCatalog = definitions === undefined;
  const source = explicitCatalog ? slashCommands() : definitions;
  const prefixMap = prefixesByCommand();
  const commands = source.flatMap((definition) => expandCommand(commandJson(definition))).map((command) => {
    const configured = COMMAND_GUIDES[command.key] || COMMAND_GUIDES[command.root];
    const guide = configured || fallbackGuide(command);
    return Object.freeze({
      ...command,
      ...guide,
      hasExplicitGuide: Boolean(configured),
      prefixes: Object.freeze([...(prefixMap.get(command.root) || [])]),
    });
  });
  if (explicitCatalog) auditCommandCatalog(commands);
  return commands;
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
  REQUIRED_GUIDE_FIELDS,
  auditCommandCatalog,
  commandByKey,
  commandCatalog,
  expandCommand,
  pageForCommand,
  paginateCommands,
  prefixCommands,
  slashCommands,
};
