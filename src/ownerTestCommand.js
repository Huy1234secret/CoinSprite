const { ALLOWED_MENTIONS } = require('./features/shared/format');

const COMMAND_ALIASES = Object.freeze({
  cswork: Object.freeze({ route: 'cswork', command: 'cswork' }),
  'cs-work': Object.freeze({ route: 'cswork', command: 'cswork' }),
  csbalance: Object.freeze({ route: 'csbalance', command: 'csbalance' }),
  'cs-balance': Object.freeze({ route: 'csbalance', command: 'csbalance' }),
  csinventory: Object.freeze({ route: 'csinventory', command: 'csinventory' }),
  'cs-inventory': Object.freeze({ route: 'csinventory', command: 'csinventory' }),
});

function parseTestCommand(content) {
  const match = String(content || '').match(/^\s*cstest(?:\s+(.*?))?\s*$/i);
  if (!match) return null;
  const argument = String(match[1] || '').trim();
  const [rawName = '', ...args] = argument.split(/\s+/);
  const name = rawName.replace(/^\//, '').toLowerCase();
  const alias = COMMAND_ALIASES[name];
  return {
    argument,
    route: alias?.route || null,
    content: alias ? [alias.command, ...args].join(' ') : '',
  };
}

function forwardedMessage(message, content) {
  return new Proxy(message, {
    get(target, property) {
      if (property === 'content') return content;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createOwnerTestCommand(options = {}) {
  const routes = options.routes || {};

  async function reply(message, content) {
    await message.reply({ content, allowedMentions: ALLOWED_MENTIONS });
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system) return false;
    const parsed = parseTestCommand(message.content);
    if (!parsed) return false;
    if (!options.isOwner?.(message)) {
      await reply(message, 'This command can only be used by the bot owner.');
      return true;
    }
    const route = parsed.route && routes[parsed.route];
    if (!route) {
      await reply(message, 'Supported test commands: `cswork`, `csbalance`, and `csinventory`.');
      return true;
    }
    if (!await route(forwardedMessage(message, parsed.content))) {
      await reply(message, `Invalid test command syntax for \`${parsed.route}\`.`);
    }
    return true;
  }

  return { handleMessage };
}

module.exports = { COMMAND_ALIASES, createOwnerTestCommand, forwardedMessage, parseTestCommand };
