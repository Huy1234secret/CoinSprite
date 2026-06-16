const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'message-templates.json');
const COMPONENTS_V2_FLAG = 32768;
const EPHEMERAL_FLAG = 64;
const BUTTON_STYLES = new Set(['primary', 'secondary', 'success', 'danger', 'link']);
const BUTTON_STYLE_VALUES = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const COMPONENT_CUSTOM_ID_PREFIX = 'message-template:';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, fallback = '', max = 4000) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}
function cleanUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
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
function cleanEmoji(value) {
  return String(value || '').trim().slice(0, 100);
}
function cleanOptionalId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function cleanRoleId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}
function cleanBoolean(value) {
  return value === true || ['true', '1', 'on', 'yes'].includes(String(value || '').toLowerCase());
}
function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function cleanComponentAction(value) {
  const source = value && typeof value === 'object' ? value : {};
  const type = ['send_message', 'give_role', 'legacy_response'].includes(source.type || source.actionType)
    ? source.type || source.actionType
    : 'send_message';
  if (type === 'give_role') return { type, roleId: cleanRoleId(source.roleId), reverse: cleanBoolean(source.reverse) };
  if (type === 'legacy_response') return { type, response: cleanText(source.response, 'This action has no response configured.', 2000) };
  return { type: 'send_message', templateId: cleanOptionalId(source.templateId) };
}
function sanitizeComponentActions(value) {
  const source = value && typeof value === 'object' ? value : {};
  let actions = Array.isArray(source.actions) ? source.actions.slice(0, 2).map(cleanComponentAction) : [];
  if (!actions.length) {
    if (source.roleId || source.actionType === 'give_role') actions = [cleanComponentAction({ type: 'give_role', roleId: source.roleId, reverse: source.reverse })];
    else if (source.templateId || source.actionType === 'send_message') actions = [cleanComponentAction({ type: 'send_message', templateId: source.templateId })];
    else if (source.response) actions = [cleanComponentAction({ type: 'legacy_response', response: source.response })];
    else actions = [cleanComponentAction({ type: 'send_message' })];
  }
  const unique = [];
  for (const action of actions) {
    if (action.type !== 'legacy_response' && unique.some((item) => item.type === action.type)) continue;
    unique.push(action);
  }
  return unique.slice(0, 2);
}

function defaultTemplate(index = 1) {
  return {
    id: `message-${Date.now().toString(36)}-${index}`,
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
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeContainer(value, index) {
  return {
    id: cleanId(value?.id, `container-${index + 1}`),
    accentColor: cleanColor(value?.accentColor),
    text: cleanText(value?.text, 'Add your message here.', 4000),
    thumbnailUrl: cleanUrl(value?.thumbnailUrl),
    imageUrl: cleanUrl(value?.imageUrl),
  };
}

function sanitizeButton(value, index) {
  const requestedStyle = BUTTON_STYLES.has(value?.style) ? value.style : 'primary';
  const url = requestedStyle === 'link' ? cleanUrl(value?.url) : '';
  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;
  const actions = style === 'link' ? [] : sanitizeComponentActions(value);
  return {
    id: cleanId(value?.id, `button-${index + 1}`),
    label: cleanText(value?.label, `Button ${index + 1}`, 80),
    style,
    emoji: cleanEmoji(value?.emoji),
    url: style === 'link' ? url : '',
    response: '',
    actions,
  };
}

function sanitizeSelectOption(value, index) {
  const actions = sanitizeComponentActions(value);
  return {
    id: cleanId(value?.id || value?.value, `option-${index + 1}`),
    label: cleanText(value?.label, `Option ${index + 1}`, 100),
    description: cleanText(value?.description, '', 100),
    emoji: cleanEmoji(value?.emoji),
    response: '',
    actions,
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
  const hasContainerList = Array.isArray(source.containers);
  const containers = (hasContainerList ? source.containers : []).slice(0, 8).map(sanitizeContainer);
  const componentRows = (Array.isArray(source.componentRows) ? source.componentRows : []).slice(0, 5).map(sanitizeComponentRow);
  return {
    id: cleanId(source.id, `message-${index + 1}`),
    name: cleanText(source.name, `Message template ${index + 1}`, 80),
    content: String(source.content || '').slice(0, 2000),
    containers: hasContainerList ? containers : defaultTemplate(index + 1).containers,
    componentRows,
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
function listTemplates(guildId) {
  return clone((loadAll()[guildId] || []).map(sanitizeTemplate));
}
function saveTemplate(guildId, value) {
  const state = loadAll();
  const list = state[guildId] || [];
  const template = sanitizeTemplate(value, list.length);
  const index = list.findIndex((item) => item.id === template.id);
  if (index === -1) list.push(template); else list[index] = template;
  state[guildId] = list.slice(0, 100);
  saveAll(state);
  return clone(template);
}
function deleteTemplate(guildId, templateId) {
  const state = loadAll();
  const list = state[guildId] || [];
  const next = list.filter((item) => item.id !== templateId);
  if (next.length === list.length) return false;
  state[guildId] = next;
  saveAll(state);
  return true;
}
function findTemplate(guildId, templateId) {
  return listTemplates(guildId).find((item) => item.id === templateId) || null;
}

function placeholderValues(context = {}) {
  const guild = context.guild || context.member?.guild || null;
  const channel = context.channel || null;
  const user = context.user || context.member?.user || null;
  const member = context.member || null;
  const displayName = member?.displayName || user?.globalName || user?.displayName || user?.username || 'Unknown user';
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
    const children = textComponents(container.text, container.thumbnailUrl, context);
    if (container.imageUrl) children.push({ type: 12, items: [{ media: { url: container.imageUrl } }] });
    components.push({ type: 17, accent_color: Number.parseInt(container.accentColor.slice(1), 16), components: children });
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

async function componentRespond(interaction, payload) {
  const body = { ...payload, flags: Number(payload.flags || 0) | EPHEMERAL_FLAG };
  if (interaction.replied || interaction.deferred) return interaction.followUp(body);
  return interaction.reply(body);
}

async function executeComponentAction(interaction, action, context) {
  if (action.type === 'legacy_response') {
    return componentRespond(interaction, {
      content: formatPlaceholders(action.response, context),
      allowedMentions: allowedMentions(context),
    });
  }
  if (action.type === 'send_message') {
    const target = findTemplate(interaction.guildId, action.templateId);
    if (!target) throw new Error('The selected message template is no longer available.');
    return componentRespond(interaction, buildMessagePayload(target, context));
  }
  if (action.type === 'give_role') {
    const guild = interaction.guild;
    const member = interaction.member?.roles?.cache
      ? interaction.member
      : await guild?.members?.fetch(interaction.user.id).catch(() => null);
    const role = guild?.roles?.cache?.get(action.roleId) || await guild?.roles?.fetch(action.roleId).catch(() => null);
    if (!member || !role) throw new Error('The selected role is no longer available.');
    if (role.id === guild.id || role.managed || !role.editable) throw new Error('The bot cannot manage the selected role.');
    const hasRole = member.roles.cache.has(role.id);
    if (action.reverse && hasRole) {
      await member.roles.remove(role, 'Message component reverse role action');
      return componentRespond(interaction, { content: `Removed the **${role.name}** role.` });
    }
    if (hasRole) return componentRespond(interaction, { content: `You already have the **${role.name}** role.` });
    await member.roles.add(role, 'Message component role action');
    return componentRespond(interaction, { content: `Added the **${role.name}** role.` });
  }
  throw new Error('This message component has no action configured.');
}

async function handleMessageTemplateInteraction(interaction) {
  if (!interaction?.isButton?.() && !interaction?.isStringSelectMenu?.()) return false;
  const parsed = parseComponentCustomId(interaction.customId);
  if (!parsed) return false;
  const template = findTemplate(interaction.guildId, parsed.templateId);
  const actions = [];

  if (interaction.isButton()) {
    for (const row of template?.componentRows || []) {
      if (row.type !== 'buttons') continue;
      const button = row.buttons.find((item) => `${row.id}-${item.id}` === parsed.componentId);
      if (button) { actions.push(...(button.actions || [])); break; }
    }
  } else {
    const row = template?.componentRows?.find((item) => item.type === 'select' && item.id === parsed.componentId);
    const selected = new Set(interaction.values || []);
    for (const option of row?.options || []) {
      if (selected.has(option.id)) actions.push(...(option.actions || []));
    }
  }

  if (!template || !actions.length) {
    await componentRespond(interaction, { content: 'This message component is no longer configured.' }).catch(() => null);
    return true;
  }
  const context = interactionContext(interaction);
  for (const action of actions) {
    try {
      await executeComponentAction(interaction, action, context);
    } catch (error) {
      await componentRespond(interaction, { content: error.message || 'This action could not be completed.' }).catch(() => null);
    }
  }
  return true;
}

function parseDiscordMessageLink(value, guildId) {
  const match = String(value || '').trim().match(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{16,20}|@me)\/(\d{16,20})\/(\d{16,20})/i);
  if (!match || match[1] !== String(guildId)) return null;
  return { channelId: match[2], messageId: match[3] };
}

module.exports = {
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
