const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'message-templates.json');
const COMPONENTS_V2_FLAG = 32768;
const EPHEMERAL_FLAG = 64;
const BUTTON_STYLES = new Set(['primary', 'secondary', 'success', 'danger', 'link']);
const BUTTON_STYLE_VALUES = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const COMPONENT_CUSTOM_ID_PREFIX = 'message-template:';
const ACTION_TYPES = new Set(['send_message', 'give_role', 'legacy_response']);
const DEFAULT_COMPONENT_RESPONSES = new Set(['Thanks, <@mention>!', 'You selected this option, <@mention>.']);

const DEFAULT_BOT_TEMPLATES = Object.freeze([
  {
    id: 'default-ai-moderation-alert',
    type: 'template',
    folderId: '',
    name: 'Default: AI moderation alert',
    content: '',
    containers: [{
      id: 'ai-moderation-alert',
      accentColor: '#9B59B6',
      text: [
        '## AI moderation report',
        '**User:** <@mention> (`<user-id>`)',
        '**Channel:** <channel>',
        '**Severity:** <severity>/10',
        '**Rules:**',
        '<broken-rules>',
        '<translation-section>',
        '<separator>',
        'Message: <message-link> “<message-content>”',
      ].join('\n'),
      thumbnailUrl: '<avatar_url>',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'default-ai-moderation-user-warning',
    type: 'template',
    folderId: '',
    name: 'Default: AI moderation user warning',
    content: '',
    containers: [{
      id: 'ai-moderation-user-warning',
      accentColor: '#9B59B6',
      text: [
        '## Message flagged',
        '<@mention>, your message in <channel> was flagged by AI moderation.',
        '<separator>',
        '**Severity:** <severity>/10',
        '**Rules:**',
        '<broken-rules>',
        '-# If this was a mistake, please contact staff.',
      ].join('\n'),
      thumbnailUrl: '',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'default-link-auto-moderation-alert',
    type: 'template',
    folderId: '',
    name: 'Default: Link Auto-Moderator alert',
    content: '',
    containers: [{
      id: 'link-auto-moderation-alert',
      accentColor: '#ED4245',
      text: [
        '## Link Auto-Moderator report',
        '**User:** <@mention> (`<user-id>`)',
        '**Channel:** <channel>',
        '**Action taken:** <moderation-action>',
        '**Reason:** <moderation-reason>',
        '<separator>',
        '**Blocked link**',
        '- Domain: `<blocked-domain>`',
        '- URL: <blocked-url>',
        '- Invite code: `<invite-code>`',
        '<separator>',
        '-# User message: “<message-content>”',
        '-# Report link: <message-link>',
      ].join('\n'),
      thumbnailUrl: '<avatar_url>',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  },
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, fallback = '', max = 4000) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}
function cleanOptionalText(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}
function cleanUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^<[@a-z0-9_-]+>$/i.test(text)) return text.slice(0, 1000);
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 1000) : '';
  } catch { return ''; }
}
function cleanColor(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : '#5865F2';
}
function cleanId(value, fallback = 'template') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
}
function cleanOptionalId(value) {
  const text = String(value || '').trim();
  return text ? cleanId(text, '') : '';
}
function cleanEmoji(value) {
  return String(value || '').trim().slice(0, 100);
}
function cleanRoleId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}
function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function defaultTemplate(index = 1) {
  return {
    id: `message-${Date.now().toString(36)}-${index}`,
    type: 'template',
    folderId: '',
    name: `Message template ${index}`,
    content: '',
    containers: [{
      id: `container-${Date.now().toString(36)}`,
      accentColor: '#5865F2',
      text: '## New message\nAdd your message here.',
      thumbnailUrl: '',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: false,
    defaultLocked: false,
    updatedAt: new Date().toISOString(),
  };
}

function defaultTemplateById(templateId) {
  return DEFAULT_BOT_TEMPLATES.find((template) => template.id === templateId) || null;
}

function mergeDefaultTemplate(baseDefault, saved) {
  const merged = {
    ...clone(baseDefault),
    ...(saved || {}),
    id: baseDefault.id,
    type: 'template',
    folderId: '',
    name: baseDefault.name,
    botDefault: true,
    defaultLocked: true,
  };
  const rootContent = String(merged.content || '').trim();
  merged.content = '';
  if (rootContent) {
    const containers = Array.isArray(merged.containers) && merged.containers.length
      ? merged.containers
      : clone(baseDefault.containers);
    containers[0] = {
      ...clone(baseDefault.containers[0]),
      ...(containers[0] || {}),
      text: String(containers[0]?.text || '').trim() || rootContent,
    };
    merged.containers = containers;
  }
  return merged;
}

function mergeDefaultTemplates(savedTemplates) {
  const byId = new Map((savedTemplates || []).map((template) => [template.id, template]));
  for (const template of DEFAULT_BOT_TEMPLATES) {
    byId.set(template.id, mergeDefaultTemplate(template, byId.get(template.id)));
  }
  return [...byId.values()];
}

function sanitizeContainer(value, index) {
  return {
    id: cleanId(value?.id, `container-${index + 1}`),
    accentColor: cleanColor(value?.accentColor),
    text: cleanOptionalText(value?.text, 4000),
    thumbnailUrl: cleanUrl(value?.thumbnailUrl),
    imageUrl: cleanUrl(value?.imageUrl),
  };
}

function sanitizeAction(value, fallbackResponse = '') {
  const source = value && typeof value === 'object' ? value : {};
  const requestedType = source.type || source.actionType;
  const type = ACTION_TYPES.has(requestedType) ? requestedType : 'send_message';
  if (type === 'give_role') {
    return { type: 'give_role', roleId: cleanRoleId(source.roleId), reverse: Boolean(source.reverse) };
  }
  if (type === 'legacy_response') {
    return {
      type: 'legacy_response',
      response: cleanText(source.response, fallbackResponse || 'This component has no response configured.', 2000),
    };
  }
  return { type: 'send_message', templateId: cleanId(source.templateId, '') };
}

function legacyActionFromItem(value, fallbackResponse) {
  if (value?.actionType === 'give_role' || value?.roleId) {
    return sanitizeAction({ type: 'give_role', roleId: value.roleId, reverse: value.reverse });
  }
  if (value?.actionType === 'send_message' || value?.templateId || DEFAULT_COMPONENT_RESPONSES.has(value?.response)) {
    return sanitizeAction({ type: 'send_message', templateId: value?.templateId || '' });
  }
  if (value?.response) return sanitizeAction({ type: 'legacy_response', response: value.response }, fallbackResponse);
  return sanitizeAction({ type: 'send_message', templateId: '' });
}

function sanitizeActions(value, fallbackResponse = '') {
  const source = Array.isArray(value?.actions) && value.actions.length
    ? value.actions
    : [legacyActionFromItem(value, fallbackResponse)];
  const used = new Set();
  return source
    .map((action) => sanitizeAction(action, fallbackResponse))
    .filter((action) => {
      if (used.has(action.type)) return false;
      used.add(action.type);
      return true;
    })
    .slice(0, 2);
}

function sanitizeButton(value, index) {
  const requestedStyle = BUTTON_STYLES.has(value?.style) ? value.style : 'primary';
  const url = requestedStyle === 'link' ? cleanUrl(value?.url) : '';
  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;
  const response = style === 'link' ? '' : cleanText(value?.response, 'This button has no response configured.', 2000);
  return {
    id: cleanId(value?.id, `button-${index + 1}`),
    label: cleanText(value?.label, `Button ${index + 1}`, 80),
    style,
    emoji: cleanEmoji(value?.emoji),
    url: style === 'link' ? url : '',
    response,
    actions: style === 'link' ? [] : sanitizeActions(value, response),
  };
}

function sanitizeSelectOption(value, index) {
  const response = cleanText(value?.response, 'This option has no response configured.', 2000);
  return {
    id: cleanId(value?.id || value?.value, `option-${index + 1}`),
    label: cleanText(value?.label, `Option ${index + 1}`, 100),
    description: cleanText(value?.description, '', 100),
    emoji: cleanEmoji(value?.emoji),
    response,
    actions: sanitizeActions(value, response),
  };
}

function sanitizeComponentRow(value, index) {
  const source = value && typeof value === 'object' ? value : {};
  const id = cleanId(source.id, `row-${index + 1}`);
  if (source.type === 'select') {
    const options = (Array.isArray(source.options) ? source.options : []).slice(0, 25).map(sanitizeSelectOption);
    const safeOptions = options.length ? options : [sanitizeSelectOption({}, 0)];
    const minValues = clampInteger(source.minValues, 0, safeOptions.length, 1);
    const maxValues = clampInteger(source.maxValues, Math.max(1, minValues), safeOptions.length, 1);
    return {
      id,
      type: 'select',
      placeholder: cleanText(source.placeholder, 'Choose an option', 150),
      minValues,
      maxValues,
      options: safeOptions,
    };
  }
  const buttons = (Array.isArray(source.buttons) ? source.buttons : []).slice(0, 5).map(sanitizeButton);
  return {
    id,
    type: 'buttons',
    buttons: buttons.length ? buttons : [sanitizeButton({}, 0)],
  };
}

function sanitizeTemplate(value, index = 0) {
  const source = value && typeof value === 'object' ? value : {};
  const type = source.type === 'folder' ? 'folder' : 'template';
  const botDefault = Boolean(source.botDefault);
  const defaultLocked = Boolean(source.defaultLocked || botDefault);
  if (type === 'folder') {
    return {
      id: cleanId(source.id, `folder-${index + 1}`),
      type: 'folder',
      folderId: '',
      name: cleanText(source.name, `Folder ${index + 1}`, 80),
      content: '',
      containers: [],
      componentRows: [],
      botDefault: false,
      defaultLocked: false,
      updatedAt: new Date().toISOString(),
    };
  }
  const hasContainerList = Array.isArray(source.containers);
  const containers = (hasContainerList ? source.containers : []).slice(0, 8).map(sanitizeContainer);
  const componentRows = (Array.isArray(source.componentRows) ? source.componentRows : []).slice(0, 5).map(sanitizeComponentRow);
  return {
    id: cleanId(source.id, `message-${index + 1}`),
    type: 'template',
    folderId: cleanOptionalId(source.folderId),
    name: cleanText(source.name, `Message template ${index + 1}`, 80),
    content: String(source.content || '').slice(0, 2000),
    containers: hasContainerList ? containers : defaultTemplate(index + 1).containers,
    componentRows,
    botDefault,
    defaultLocked,
    updatedAt: new Date().toISOString(),
  };
}

function loadAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveAll(state) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
function listStoredTemplates(guildId) {
  return clone((loadAll()[guildId] || []).map(sanitizeTemplate));
}
function listTemplates(guildId) {
  return mergeDefaultTemplates(listStoredTemplates(guildId)).map((template, index) => sanitizeTemplate(template, index));
}
function saveTemplate(guildId, value) {
  const state = loadAll();
  const list = state[guildId] || [];
  const defaultTemplateValue = defaultTemplateById(value?.id);
  const template = sanitizeTemplate(defaultTemplateValue ? mergeDefaultTemplate(defaultTemplateValue, value) : value, list.length);
  const index = list.findIndex((item) => item.id === template.id);
  if (index === -1) list.push(template); else list[index] = template;
  state[guildId] = list.slice(0, 140);
  saveAll(state);
  return clone(template);
}
function deleteTemplate(guildId, templateId) {
  if (defaultTemplateById(templateId)) return false;
  const state = loadAll();
  const list = state[guildId] || [];
  const target = list.find((item) => item.id === templateId);
  if (target?.defaultLocked || target?.botDefault) return false;
  const next = list.filter((item) => item.id !== templateId && item.folderId !== templateId);
  if (next.length === list.length) return false;
  state[guildId] = next;
  saveAll(state);
  return true;
}
function findTemplate(guildId, templateId) {
  return listTemplates(guildId).find((item) => item.id === templateId && item.type !== 'folder') || null;
}

function userAvatarUrl(user) {
  if (!user) return '';
  if (typeof user.displayAvatarURL === 'function') return user.displayAvatarURL({ extension: 'png', size: 128 });
  if (typeof user.avatarURL === 'function') return user.avatarURL({ extension: 'png', size: 128 });
  return String(user.avatarUrl || user.avatarURL || '');
}

function placeholderValues(context = {}) {
  const guild = context.guild || context.member?.guild || null;
  const channel = context.channel || null;
  const user = context.user || context.member?.user || null;
  const member = context.member || null;
  const displayName = member?.displayName || user?.globalName || user?.displayName || user?.username || 'Unknown user';
  const avatarUrl = userAvatarUrl(user);
  return new Map([
    ['guild-name', guild?.name || 'Unknown server'],
    ['server-name', guild?.name || 'Unknown server'],
    ['guild-id', guild?.id || ''],
    ['server-id', guild?.id || ''],
    ['member-count', String(guild?.memberCount ?? '')],
    ['channel', channel?.id ? `<#${channel.id}>` : '#unknown-channel'],
    ['channel-name', channel?.name || 'unknown-channel'],
    ['channel-id', channel?.id || ''],
    ['@mention', user?.id ? `<@${user.id}>` : '@unknown-user'],
    ['mention', user?.id ? `<@${user.id}>` : '@unknown-user'],
    ['username', user?.username || 'unknown-user'],
    ['display-name', displayName],
    ['display_name', displayName],
    ['user-id', user?.id || ''],
    ['user_id', user?.id || ''],
    ['avatar-url', avatarUrl],
    ['avatar_url', avatarUrl],
  ]);
}

function formatPlaceholders(value, context = {}) {
  const replacements = placeholderValues(context);
  return String(value || '').replace(/<([@a-z0-9_-]+)>/gi, (match, token) => replacements.get(token.toLowerCase()) ?? match);
}

function textComponents(text, thumbnailUrl, context) {
  const sections = formatPlaceholders(text, context).split(/<separator>/gi).map((part) => part.trim()).filter(Boolean);
  const result = [];
  sections.forEach((section, index) => {
    if (index) result.push({ type: 14, divider: true, spacing: 1 });
    if (index === 0 && thumbnailUrl) {
      result.push({ type: 9, components: [{ type: 10, content: section }], accessory: { type: 11, media: { url: thumbnailUrl } } });
    } else result.push({ type: 10, content: section });
  });
  return result;
}

function emojiData(value) {
  const text = cleanEmoji(value);
  if (!text) return undefined;
  const custom = text.match(/^<a?:([a-z0-9_]+):(\d{16,20})>$/i);
  return custom ? { name: custom[1], id: custom[2] } : { name: text };
}

function componentCustomId(templateId, rowId) {
  return `${COMPONENT_CUSTOM_ID_PREFIX}${cleanId(templateId)}:${cleanId(rowId)}`.slice(0, 100);
}

function buildComponentRow(template, row) {
  if (row.type === 'select') {
    return {
      type: 1,
      components: [{
        type: 3,
        custom_id: componentCustomId(template.id, row.id),
        placeholder: row.placeholder,
        min_values: row.minValues,
        max_values: row.maxValues,
        options: row.options.map((option) => ({
          label: option.label,
          value: option.id,
          ...(option.description ? { description: option.description } : {}),
          ...(emojiData(option.emoji) ? { emoji: emojiData(option.emoji) } : {}),
        })),
      }],
    };
  }
  return {
    type: 1,
    components: row.buttons.map((button) => ({
      type: 2,
      style: BUTTON_STYLE_VALUES[button.style],
      label: button.label,
      ...(emojiData(button.emoji) ? { emoji: emojiData(button.emoji) } : {}),
      ...(button.style === 'link'
        ? { url: button.url }
        : { custom_id: componentCustomId(template.id, `${row.id}-${button.id}`) }),
    })),
  };
}

function allowedMentions(context = {}) {
  const userId = context.user?.id || context.member?.user?.id;
  return { parse: [], users: userId ? [userId] : [] };
}

function buildMessagePayload(value, context = {}) {
  const template = sanitizeTemplate(value);
  const components = [];
  if (template.content.trim()) components.push({ type: 10, content: formatPlaceholders(template.content.trim(), context) });
  template.containers.forEach((container) => {
    const thumbnailUrl = cleanUrl(formatPlaceholders(container.thumbnailUrl, context));
    const imageUrl = cleanUrl(formatPlaceholders(container.imageUrl, context));
    const children = textComponents(container.text, thumbnailUrl, context);
    if (imageUrl) children.push({ type: 12, items: [{ media: { url: imageUrl } }] });
    if (children.length) components.push({ type: 17, accent_color: Number.parseInt(container.accentColor.slice(1), 16), components: children });
  });
  template.componentRows.forEach((row) => components.push(buildComponentRow(template, row)));
  return { flags: COMPONENTS_V2_FLAG, allowedMentions: allowedMentions(context), components };
}

function parseComponentCustomId(value) {
  const text = String(value || '');
  if (!text.startsWith(COMPONENT_CUSTOM_ID_PREFIX)) return null;
  const [templateId, ...componentParts] = text.slice(COMPONENT_CUSTOM_ID_PREFIX.length).split(':');
  const componentId = componentParts.join(':');
  return templateId && componentId ? { templateId, componentId } : null;
}

function interactionContext(interaction) {
  return {
    guild: interaction.guild,
    channel: interaction.channel,
    user: interaction.user,
    member: interaction.member,
  };
}

function buttonForComponent(template, componentId) {
  for (const row of template?.componentRows || []) {
    if (row.type !== 'buttons') continue;
    const button = row.buttons.find((item) => `${row.id}-${item.id}` === componentId);
    if (button) return button;
  }
  return null;
}

function selectedOptionsForComponent(template, componentId, values = []) {
  const row = template?.componentRows?.find((item) => item.type === 'select' && item.id === componentId);
  const selected = new Set(values || []);
  return (row?.options || []).filter((option) => selected.has(option.id));
}

function itemActions(item) {
  if (!item) return [];
  if (Array.isArray(item.actions) && item.actions.length) return item.actions;
  return sanitizeActions(item, item.response || '');
}

function componentActionsForInteraction(template, parsed, interaction) {
  if (interaction.isButton()) return itemActions(buttonForComponent(template, parsed.componentId));
  return selectedOptionsForComponent(template, parsed.componentId, interaction.values)
    .flatMap((option) => itemActions(option));
}

async function roleActionMember(interaction) {
  if (interaction.member?.roles?.add && interaction.member?.roles?.remove) return interaction.member;
  return interaction.guild?.members?.fetch?.(interaction.user.id).catch(() => null) || null;
}

async function runRoleAction(interaction, action) {
  const roleId = cleanRoleId(action.roleId);
  if (!roleId) return 'This role action is missing a role.';
  const member = await roleActionMember(interaction);
  if (!member?.roles?.add || !member?.roles?.remove) return 'I could not update your role in this server.';
  const hasRole = Boolean(member.roles.cache?.has(roleId));
  try {
    if (hasRole && action.reverse) {
      await member.roles.remove(roleId, 'Message template component action');
      return `Removed <@&${roleId}>.`;
    }
    if (!hasRole) {
      await member.roles.add(roleId, 'Message template component action');
      return `Added <@&${roleId}>.`;
    }
    return `You already have <@&${roleId}>.`;
  } catch {
    return 'I could not update the role. Check my Manage Roles permission and role order.';
  }
}

function withEphemeralFlag(payload) {
  return { ...payload, flags: (Number(payload.flags) || 0) | EPHEMERAL_FLAG };
}

async function sendInteractionMessage(interaction, payload, alreadyReplied) {
  if (!payload?.components?.length && !payload?.content) return false;
  if (alreadyReplied) {
    await interaction.followUp(payload);
    return true;
  }
  await interaction.reply(payload);
  return true;
}

async function runComponentActions(interaction, actions, context) {
  const textResponses = [];
  const templatePayloads = [];
  for (const action of actions) {
    if (action.type === 'give_role') {
      textResponses.push(await runRoleAction(interaction, action));
    } else if (action.type === 'legacy_response') {
      const response = formatPlaceholders(action.response, context).trim();
      if (response) textResponses.push(response);
    } else if (action.type === 'send_message') {
      if (!action.templateId) {
        textResponses.push('No message template is selected for this action.');
        continue;
      }
      const responseTemplate = findTemplate(interaction.guildId, action.templateId);
      if (!responseTemplate) {
        textResponses.push('The selected message template no longer exists.');
        continue;
      }
      const payload = buildMessagePayload(responseTemplate, context);
      if (!payload.components.length) {
        textResponses.push('The selected message template is empty and was not sent.');
        continue;
      }
      templatePayloads.push(payload);
    }
  }

  if (!textResponses.length && !templatePayloads.length) {
    await interaction.reply({ content: 'This message component is no longer configured.', flags: EPHEMERAL_FLAG });
    return;
  }

  let replied = false;
  for (const payload of templatePayloads) {
    const nextPayload = withEphemeralFlag(payload);
    if (!replied && textResponses.length) {
      nextPayload.components = [
        { type: 10, content: textResponses.splice(0).join('\n').slice(0, 2000) },
        ...(nextPayload.components || []),
      ];
    }
    replied = await sendInteractionMessage(interaction, nextPayload, replied) || replied;
  }

  if (textResponses.length) {
    const content = textResponses.join('\n').slice(0, 2000);
    replied = await sendInteractionMessage(interaction, {
      content,
      flags: EPHEMERAL_FLAG,
      allowedMentions: allowedMentions(context),
    }, replied) || replied;
  }
}

async function handleMessageTemplateInteraction(interaction) {
  if (!interaction?.isButton?.() && !interaction?.isStringSelectMenu?.()) return false;
  const parsed = parseComponentCustomId(interaction.customId);
  if (!parsed) return false;
  const template = findTemplate(interaction.guildId, parsed.templateId);
  if (!template) {
    await interaction.reply({ content: 'This message component is no longer configured.', flags: EPHEMERAL_FLAG }).catch(() => null);
    return true;
  }
  const context = interactionContext(interaction);
  const actions = componentActionsForInteraction(template, parsed, interaction);
  await runComponentActions(interaction, actions, context);
  return true;
}

function parseDiscordMessageLink(value, guildId) {
  const match = String(value || '').trim().match(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{16,20}|@me)\/(\d{16,20})\/(\d{16,20})/i);
  if (!match || match[1] !== String(guildId)) return null;
  return { channelId: match[2], messageId: match[3] };
}

module.exports = {
  DEFAULT_BOT_TEMPLATES,
  buildMessagePayload,
  defaultTemplate,
  deleteTemplate,
  findTemplate,
  formatPlaceholders,
  handleMessageTemplateInteraction,
  listTemplates,
  parseDiscordMessageLink,
  saveTemplate,
  sanitizeTemplate,
};
