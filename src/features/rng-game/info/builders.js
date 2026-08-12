const { v2Payload, WHITE } = require('../../shared/components');
const { resolveEmoji } = require('../../shared/emojis');
const {
  CATEGORY_ORDER,
  INFO_MESSAGE_VERSION,
  commandByKey,
  commandCatalog,
  pageForCommand,
  paginateCommands,
} = require('./catalog');
const { commandMention, normalizeCommandIds } = require('./mentions');

const SECONDARY = 2;
const OPTION_TYPE_NAMES = Object.freeze({
  3: 'Text',
  4: 'Integer',
  5: 'True or false',
  6: 'User',
  7: 'Channel',
  8: 'Role',
  9: 'User or role',
  10: 'Number',
  11: 'Attachment',
});

function truncate(value, maximum) {
  const text = String(value || '');
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function textComponents(content, maximum = 4_000) {
  const chunks = [];
  let current = '';
  for (const sourceLine of String(content || '').split('\n')) {
    const lines = sourceLine.length > maximum
      ? Array.from({ length: Math.ceil(sourceLine.length / maximum) }, (_, index) => sourceLine.slice(index * maximum, (index + 1) * maximum))
      : [sourceLine];
    for (const line of lines) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > maximum) {
        if (current) chunks.push(current);
        current = line;
      } else current = candidate;
    }
  }
  if (current) chunks.push(current);
  return (chunks.length ? chunks : ['Information is unavailable right now.'])
    .map((chunk) => ({ type: 10, content: chunk }));
}

function resolvedEmoji(command, context = {}) {
  return resolveEmoji(command.configuredEmoji, command.fallbackEmoji, context.client);
}

function prefixesText(command) {
  return command.prefixes.map((prefix) => `\`${prefix}\``).join(', ');
}

function landingCommandLine(command, context) {
  const emoji = resolvedEmoji(command, context).text;
  const mention = commandMention(command.path, context.commandIds);
  const prefix = command.prefixes.length ? ` • **Prefix:** ${prefixesText(command)}` : '';
  return `* ${emoji} ${mention}${prefix}`;
}

function groupedCommands(commands) {
  const groups = new Map();
  for (const command of commands) {
    const values = groups.get(command.category) || [];
    values.push(command);
    groups.set(command.category, values);
  }
  const ordered = CATEGORY_ORDER.filter((category) => groups.has(category));
  ordered.push(...[...groups.keys()].filter((category) => !ordered.includes(category)).sort());
  return ordered.map((category) => ({ category, commands: groups.get(category) }));
}

function landingContent(commands, context = {}) {
  const quickStartKeys = ['roll', 'inventory', 'index'];
  const quickStart = quickStartKeys.map((key) => commandByKey(key, commands)).filter(Boolean);
  const sections = [
    '# 🎲 RNG Game Commands',
    '',
    '-# Choose a command below to view its usage, rules, and examples.',
  ];
  if (context.notice) sections.push('', `> ${truncate(context.notice, 300)}`);
  if (quickStart.length) {
    sections.push('', '## Quick Start', '', ...quickStart.map((command) => landingCommandLine(command, context)));
  }
  sections.push('', '## Browse Commands', '', '*Select a command from the menu to open its full guide.*');
  for (const group of groupedCommands(commands)) {
    sections.push('', `### ${group.category}`, '', ...group.commands.map((command) => landingCommandLine(command, context)));
  }
  sections.push('', '-# *Tip: Slash-command mentions can be pressed to insert the command.*');
  return sections.join('\n');
}

function selectCustomId(ownerId, page) {
  return `rng:info:command:v${INFO_MESSAGE_VERSION}:${ownerId || '0'}:${page}`;
}

function browseCustomId(ownerId, page, stateIndex) {
  return `rng:info:browse:v${INFO_MESSAGE_VERSION}:${ownerId || '0'}:${page}:${stateIndex}`;
}

function homeCustomId(ownerId) {
  return `rng:info:home:v${INFO_MESSAGE_VERSION}:${ownerId}`;
}

function commandSelector(commands, context = {}) {
  const paginated = paginateCommands(commands, context.page);
  const options = paginated.commands.map((command) => {
    const emoji = resolvedEmoji(command, context).component;
    return {
      label: truncate(`/${command.path} — ${command.description}`, 100),
      value: truncate(command.key, 100),
      description: truncate('Open usage, rules, and examples.', 100),
      ...(emoji ? { emoji } : {}),
      ...(command.key === context.selectedKey ? { default: true } : {}),
    };
  });
  const rows = [{
    type: 1,
    components: [{
      type: 3,
      custom_id: selectCustomId(context.ownerId, paginated.page),
      placeholder: `Choose a command${paginated.pageCount > 1 ? ` • Page ${paginated.page}/${paginated.pageCount}` : ''}`,
      min_values: 1,
      max_values: 1,
      options,
    }],
  }];

  const selectedIndex = commands.findIndex((command) => command.key === context.selectedKey);
  const stateIndex = selectedIndex < 0 ? 0 : selectedIndex + 1;
  const buttons = [];
  if (paginated.pageCount > 1) {
    buttons.push(
      {
        type: 2,
        style: SECONDARY,
        label: 'Previous',
        custom_id: browseCustomId(context.ownerId, Math.max(1, paginated.page - 1), stateIndex),
        disabled: paginated.page === 1,
      },
      {
        type: 2,
        style: SECONDARY,
        label: 'Next',
        custom_id: browseCustomId(context.ownerId, Math.min(paginated.pageCount, paginated.page + 1), stateIndex),
        disabled: paginated.page === paginated.pageCount,
      },
    );
  }
  if (context.ownerId && context.ownerId !== '0' && context.selectedKey) {
    buttons.push({
      type: 2,
      style: SECONDARY,
      label: 'All Commands',
      custom_id: homeCustomId(context.ownerId),
    });
  }
  if (buttons.length) rows.push({ type: 1, components: buttons });
  return { page: paginated.page, pageCount: paginated.pageCount, rows };
}

function infoMessagePayload(_botUserId, context = {}, options = {}) {
  const commands = context.commands || commandCatalog();
  const commandIds = normalizeCommandIds(context.commandIds);
  const selector = commandSelector(commands, { ...context, commandIds });
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      ...textComponents(landingContent(commands, { ...context, commandIds })),
      { type: 14, divider: true, spacing: 2 },
      ...selector.rows,
    ],
  }], options);
}

function optionLines(options) {
  return (options || []).map((option) => {
    const type = OPTION_TYPE_NAMES[option.type];
    const requirement = option.required ? ' Required.' : '';
    const suffix = type ? ` (${type})` : '';
    return `* \`${option.name}\`${suffix} — ${option.description || 'No description provided.'}${requirement}`;
  });
}

function detailContent(command, context = {}) {
  const emoji = resolvedEmoji(command, context).text;
  const mention = commandMention(command.path, context.commandIds);
  const usage = command.prefixes.length
    ? `**Slash:** ${mention} • **Prefix:** ${prefixesText(command)}`
    : `**Slash:** ${mention}`;
  const sections = [
    `# ${emoji} \`/${command.path}\``,
    '',
    `-# ${command.description}`,
    '',
    '## How to Use',
    '',
    usage,
    '',
    '## What It Does',
    '',
    ...command.whatItDoes,
  ];
  const options = optionLines(command.options);
  if (options.length) sections.push('', '## Options', '', ...options);
  const examples = [mention];
  for (const example of command.slashExamples) examples.push(`${mention} \`${example}\``);
  examples.push(...command.prefixes.map((prefix) => `\`${prefix}\``));
  if (examples.length) sections.push('', '## Examples', '', ...examples.map((example) => `* ${example}`));
  if (command.important.length) {
    sections.push('', '## Important', '', ...command.important.map((item) => `**${item}**`));
  }
  if (command.tip) sections.push('', `-# *Tip: ${command.tip}*`);
  return sections.join('\n');
}

function commandPayload(commandKey, context = {}, options = {}) {
  const commands = context.commands || commandCatalog();
  const command = commandByKey(commandKey, commands);
  if (!command) {
    return infoMessagePayload(context.botUserId, {
      ...context,
      commands,
      notice: 'That command guide is no longer available. Choose a current command below.',
    }, options);
  }
  const commandIds = normalizeCommandIds(context.commandIds);
  const page = context.page || pageForCommand(command.key, commands);
  const selector = commandSelector(commands, {
    ...context,
    commandIds,
    ownerId: context.ownerId,
    page,
    selectedKey: command.key,
  });
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      ...textComponents(detailContent(command, { ...context, commandIds })),
      { type: 14, divider: true, spacing: 2 },
      ...selector.rows,
    ],
  }], options);
}

module.exports = {
  browseCustomId,
  commandPayload,
  commandSelector,
  detailContent,
  homeCustomId,
  infoMessagePayload,
  landingContent,
  selectCustomId,
  textComponents,
  truncate,
};
