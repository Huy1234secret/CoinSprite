const { v2Payload, WHITE } = require('../../shared/components');
const { assertValidMessagePayload } = require('../../shared/discordPayload');
const { resolveEmoji } = require('../../shared/emojis');
const {
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

function landingContent(_commands, context = {}) {
  const sections = [
    '# 🎲 RNG Game Commands',
    '',
    '-# Choose a command below to open its complete player guide.',
  ];
  if (context.notice) sections.push('', `> ${escapeDiscordText(context.notice).slice(0, 300)}`);
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
      label: truncate(`/${command.path}`, 100),
      value: truncate(command.key, 100),
      description: truncate(command.description, 100),
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
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      ...textComponents(landingContent(commands, { ...context, commandIds })),
      { type: 14, divider: true, spacing: 2 },
      ...selector.rows,
    ],
  }], options));
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

function guideSections(command, context = {}) {
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

  return pages;
}

function packChunks(chunks, separator, maximum) {
  const packed = [];
  let current = '';
  for (const chunk of chunks.filter((value) => value !== '')) {
    const candidate = current ? `${current}${separator}${chunk}` : chunk;
    if (candidate.length <= maximum) current = candidate;
    else {
      if (current) packed.push(current);
      current = chunk;
    }
  }
  if (current) packed.push(current);
  return packed;
}

function splitByCharacters(value, maximum) {
  const chunks = [];
  let current = '';
  for (const character of Array.from(String(value || ''))) {
    if (current && current.length + character.length > maximum) {
      chunks.push(current);
      current = character;
    } else current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitParagraph(paragraph, maximum) {
  const lines = String(paragraph || '').split('\n').flatMap((line) => (
    line.length > maximum ? splitByCharacters(line, maximum) : [line]
  ));
  return packChunks(lines, '\n', maximum);
}

function splitSection(section, maximum) {
  const paragraphs = String(section || '').split(/\n{2,}/).flatMap((paragraph) => (
    paragraph.length > maximum ? splitParagraph(paragraph, maximum) : [paragraph]
  ));
  return packChunks(paragraphs, '\n\n', maximum);
}

function guidePages(command, context = {}) {
  const blocks = guideSections(command, context).flatMap((section) => section.blocks);
  const title = `# ${resolvedEmoji(command, context).text} \`/${command.path}\``;
  const singleContent = `${title}\n\n${blocks.join('\n\n')}`;
  if (singleContent.length <= MAX_TEXT_DISPLAY_LENGTH) {
    return [Object.freeze({ content: singleContent, page: 1, pageCount: 1 })];
  }

  const maximumIndicator = '-# Page 9999999999999999/9999999999999999';
  const maximumBodyLength = MAX_TEXT_DISPLAY_LENGTH - title.length - maximumIndicator.length - 4;
  if (maximumBodyLength < 1) throw new RangeError(`Guide title ${command.key} leaves no room for guide content.`);
  const fragments = blocks.flatMap((block) => splitSection(block, maximumBodyLength));
  const bodies = packChunks(fragments, '\n\n', maximumBodyLength);
  return bodies.map((body, index) => {
    const content = `${title}\n\n-# Page ${index + 1}/${bodies.length}\n\n${body}`;
    if (content.length > MAX_TEXT_DISPLAY_LENGTH) {
      throw new RangeError(`Guide page ${command.key}:${index + 1} exceeds ${MAX_TEXT_DISPLAY_LENGTH} characters.`);
    }
    return Object.freeze({ content, page: index + 1, pageCount: bodies.length });
  });
}

function guideNavigation(command, commands, context, selectedPage, selectorPage) {
  if (selectedPage.pageCount === 1) return null;
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
        custom_id: `rng:info:page:v${INFO_MESSAGE_VERSION}:${context.ownerId}:${stateIndex}:${selectedPage.page}:${selectorPage}`,
        disabled: true,
      },
      {
        type: 2, style: SECONDARY, label: 'Next',
        custom_id: detailCustomId(context.ownerId, stateIndex, Math.min(selectedPage.pageCount, selectedPage.page + 1), selectorPage),
        disabled: selectedPage.page === selectedPage.pageCount,
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
  const navigation = guideNavigation(command, commands, context, selectedPage, selector.page);
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: selectedPage.content },
      ...(navigation ? [navigation] : []),
      { type: 14, divider: true, spacing: 2 },
      ...selector.rows,
    ],
  }], options));
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
