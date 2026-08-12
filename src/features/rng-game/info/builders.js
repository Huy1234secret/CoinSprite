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
const MAX_TEXT_DISPLAY_LENGTH = 4_000;
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
  const valueText = String(value || '');
  if (valueText.length <= maximum) return valueText;
  return `${valueText.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function escapeDiscordText(value) {
  return String(value || '')
    .replace(/[\r\n\0]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([*_~|>`])/g, '\\$1')
    .replace(/@/g, '@\u200b');
}

function textComponents(content, maximum = MAX_TEXT_DISPLAY_LENGTH) {
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

function configuredPrefix(command) {
  const match = String(command.prefixes[0] || '').match(/^([^\s!]+!)/);
  return match?.[1] || '';
}

function renderGuideTokens(value, commands, context = {}) {
  return String(value || '').replace(/\[\[([a-z0-9:-]+)\]\]/gi, (_match, key) => {
    const related = commandByKey(key, commands);
    return related ? commandMention(related.path, context.commandIds) : `\`/${String(key).replaceAll(':', ' ')}\``;
  });
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
    '-# Choose a command below to open its complete player guide.',
  ];
  if (context.notice) sections.push('', `> ${escapeDiscordText(context.notice).slice(0, 300)}`);
  if (quickStart.length) {
    sections.push('', '## Quick Start', '', ...quickStart.map((command) => landingCommandLine(command, context)));
  }
  sections.push('', '## Browse Commands', '', '*Select a command to view usage, requirements, mechanics, results, and troubleshooting.*');
  for (const group of groupedCommands(commands)) {
    sections.push('', `### ${group.category}`, '', ...group.commands.map((command) => landingCommandLine(command, context)));
  }
  sections.push('', '-# *Tip: Slash-command mentions can be pressed to insert the command.*');
  return sections.join('\n');
}

function selectCustomId(ownerId, selectorPage) {
  return `rng:info:command:v${INFO_MESSAGE_VERSION}:${ownerId || '0'}:${selectorPage}`;
}

function browseCustomId(ownerId, selectorPage, stateIndex, guidePage = 1) {
  return `rng:info:browse:v${INFO_MESSAGE_VERSION}:${ownerId || '0'}:${selectorPage}:${stateIndex}:${guidePage}`;
}

function detailCustomId(ownerId, stateIndex, guidePage, selectorPage) {
  return `rng:info:detail:v${INFO_MESSAGE_VERSION}:${ownerId}:${stateIndex}:${guidePage}:${selectorPage}`;
}

function homeCustomId(ownerId) {
  return `rng:info:home:v${INFO_MESSAGE_VERSION}:${ownerId}`;
}

function commandSelector(commands, context = {}) {
  const paginated = paginateCommands(commands, context.selectorPage ?? context.page);
  const options = paginated.commands.map((command) => {
    const emoji = resolvedEmoji(command, context).component;
    return {
      label: truncate(`/${command.path} — ${command.description}`, 100),
      value: truncate(command.key, 100),
      description: 'Open the complete command guide.',
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
        label: 'Previous Commands',
        custom_id: browseCustomId(context.ownerId, Math.max(1, paginated.page - 1), stateIndex, context.guidePage),
        disabled: paginated.page === 1,
      },
      {
        type: 2,
        style: SECONDARY,
        label: 'Next Commands',
        custom_id: browseCustomId(context.ownerId, Math.min(paginated.pageCount, paginated.page + 1), stateIndex, context.guidePage),
        disabled: paginated.page === paginated.pageCount,
      },
    );
  }
  if (context.ownerId && context.ownerId !== '0' && context.selectedKey) {
    buttons.push({ type: 2, style: SECONDARY, label: 'All Commands', custom_id: homeCustomId(context.ownerId) });
  }
  if (buttons.length) rows.push({ type: 1, components: buttons });
  return { page: paginated.page, pageCount: paginated.pageCount, rows };
}

function infoMessagePayload(_botUserId, context = {}, options = {}) {
  const commands = context.commands || commandCatalog();
  const commandIds = normalizeCommandIds(context.commandIds);
  const selector = commandSelector(commands, { ...context, commandIds, guidePage: 1 });
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

function optionLine(option) {
  const attributes = [];
  const type = OPTION_TYPE_NAMES[option.type];
  if (type) attributes.push(type);
  attributes.push(option.required ? 'required' : 'optional');
  if (option.min_value !== undefined) attributes.push(`minimum \`${option.min_value}\``);
  if (option.max_value !== undefined) attributes.push(`maximum \`${option.max_value}\``);
  if (Array.isArray(option.choices) && option.choices.length) {
    attributes.push(`choices: ${option.choices.map((choice) => `\`${choice.name}\``).join(', ')}`);
  }
  return `* \`${option.name}\` — ${option.description} *(${attributes.join('; ')})*`;
}

function listBlock(heading, values, commands, context, ordered = false) {
  if (!values?.length) return '';
  const lines = values.map((value, index) => `${ordered ? `${index + 1}.` : '*'} ${renderGuideTokens(value, commands, context)}`);
  return `## ${heading}\n\n${lines.join('\n')}`;
}

function invocationBlock(command, context) {
  const mention = commandMention(command.path, context.commandIds);
  const blocks = [`## Invocations\n\n**Slash:** ${mention}`];
  const prefix = configuredPrefix(command);
  if (command.prefixes.length) {
    blocks[0] += `\n**Configured prefix:** \`${prefix}\``;
    blocks[0] += `\n**Prefix forms:** ${prefixesText(command)}`;
    if (command.prefixes.length > 1) blocks[0] += `\n**Aliases:** ${command.prefixes.slice(1).map((value) => `\`${value}\``).join(', ')}`;
  }
  const slashArguments = command.options.map((option) => option.required ? `<${option.name}>` : `[${option.name}]`).join(' ');
  const syntax = [`* ${mention}${slashArguments ? ` \`${slashArguments}\`` : ''}`, ...command.prefixes.map((value) => `* \`${value}\``)];
  blocks.push(`### Exact Syntax\n\n${syntax.join('\n')}`);
  if (command.options.length) blocks.push(`### Slash Arguments\n\n${command.options.map(optionLine).join('\n')}`);
  if (command.controls.length) blocks.push(`### Interactive Inputs\n\n${command.controls.map((item) => `* ${renderGuideTokens(item, context.commands, context)}`).join('\n')}`);
  return blocks.join('\n\n');
}

function guidePages(command, context = {}) {
  const commands = context.commands || commandCatalog();
  const renderContext = { ...context, commands };
  const prefix = configuredPrefix(command);
  const identity = [
    `**Category:** ${command.category}`,
    `**Slash:** ${commandMention(command.path, context.commandIds)}`,
  ];
  if (command.prefixes.length) identity.push(`**Prefix:** ${prefixesText(command)}`, `**Configured prefix:** \`${prefix}\``);
  const pages = [
    {
      id: 'overview',
      label: 'Overview',
      blocks: [
        `## At a Glance\n\n${identity.join('\n')}\n\n${command.purpose}`,
        '## Availability\n\n* Server-only; the RNG feature must be owner-unlocked and enabled.\n* Use a configured RNG game channel or a post whose parent forum is configured.\n* The command and every guide control are limited to their invoking player where ownership applies.',
        listBlock('Important', command.warnings, commands, renderContext),
      ],
    },
    {
      id: 'usage',
      label: 'Usage & Requirements',
      blocks: [
        invocationBlock(command, renderContext),
        listBlock('Requirements', command.requirements, commands, renderContext),
        listBlock('How It Works', command.steps, commands, renderContext, true),
      ],
    },
    {
      id: 'mechanics',
      label: 'Mechanics',
      blocks: [listBlock('Mechanics, Costs & Limits', command.mechanics, commands, renderContext)],
    },
    {
      id: 'results',
      label: 'Results & Interactions',
      blocks: [
        listBlock('Results & Rewards', command.results, commands, renderContext),
        listBlock('Related Systems', command.interactions, commands, renderContext),
        listBlock('Restrictions & Conflicts', command.restrictions, commands, renderContext),
      ],
    },
    {
      id: 'troubleshooting',
      label: 'Examples & Troubleshooting',
      blocks: [
        listBlock('Examples', [
          ...(command.prefixes.length ? [`**Simplest prefix:** \`${command.prefixes[0]}\``] : []),
          ...command.examples,
        ], commands, renderContext),
        listBlock('Common Problems', command.failures, commands, renderContext),
        listBlock('Tips', command.tips, commands, renderContext),
        listBlock('Warnings', command.warnings, commands, renderContext),
      ],
    },
  ].map((page) => ({ ...page, blocks: page.blocks.filter(Boolean) }))
    .filter((page) => page.blocks.length);

  return pages.map((page, index) => {
    const content = [
      `# ${resolvedEmoji(command, context).text} \`/${command.path}\``,
      '',
      `-# ${page.label} • Page ${index + 1}/${pages.length}`,
      '',
      ...page.blocks,
      '',
      `-# *${command.purpose}*`,
    ].join('\n');
    if (content.length > MAX_TEXT_DISPLAY_LENGTH) {
      throw new RangeError(`Guide page ${command.key}:${page.id} exceeds ${MAX_TEXT_DISPLAY_LENGTH} characters.`);
    }
    return Object.freeze({ ...page, content, page: index + 1, pageCount: pages.length });
  });
}

function guideNavigation(command, commands, context, selectedPage, selectorPage) {
  const stateIndex = commands.findIndex((candidate) => candidate.key === command.key) + 1;
  return {
    type: 1,
    components: [
      {
        type: 2, style: SECONDARY, label: 'Previous',
        custom_id: detailCustomId(context.ownerId, stateIndex, Math.max(1, selectedPage.page - 1), selectorPage),
        disabled: selectedPage.page === 1,
      },
      {
        type: 2, style: SECONDARY, label: `Page ${selectedPage.page}/${selectedPage.pageCount}`,
        custom_id: detailCustomId(context.ownerId, stateIndex, selectedPage.page, selectorPage), disabled: true,
      },
      {
        type: 2, style: SECONDARY, label: 'Next',
        custom_id: detailCustomId(context.ownerId, stateIndex, Math.min(selectedPage.pageCount, selectedPage.page + 1), selectorPage),
        disabled: selectedPage.page === selectedPage.pageCount,
      },
      {
        type: 2, style: SECONDARY, label: 'Overview',
        custom_id: detailCustomId(context.ownerId, stateIndex, 1, selectorPage), disabled: selectedPage.page === 1,
      },
    ],
  };
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
  const selectorPage = context.selectorPage ?? context.page ?? pageForCommand(command.key, commands);
  const pages = guidePages(command, { ...context, commandIds, commands });
  const guidePage = Math.max(1, Math.min(pages.length, Math.floor(Number(context.guidePage) || 1)));
  const selectedPage = pages[guidePage - 1];
  const selector = commandSelector(commands, {
    ...context,
    commandIds,
    ownerId: context.ownerId,
    selectorPage,
    guidePage,
    selectedKey: command.key,
  });
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: selectedPage.content },
      guideNavigation(command, commands, context, selectedPage, selector.page),
      { type: 14, divider: true, spacing: 2 },
      ...selector.rows,
    ],
  }], options);
}

module.exports = {
  browseCustomId,
  commandPayload,
  commandSelector,
  configuredPrefix,
  detailCustomId,
  escapeDiscordText,
  guidePages,
  homeCustomId,
  infoMessagePayload,
  landingContent,
  renderGuideTokens,
  selectCustomId,
  textComponents,
  truncate,
};
