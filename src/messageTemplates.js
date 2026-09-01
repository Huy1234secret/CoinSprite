const crypto = require('crypto');
const { ButtonStyle, ChannelType } = require('discord.js');
const {
  appendValidatedInteractionActionRows,
  componentMessagePayload,
  deliveryPermissions,
  interpolateTemplate,
  resolvedLayout,
  safeMediaUrl,
  templateVariables,
} = require('./messageComposer');

const TEMPLATE_VERSION = 2;
const LEGACY_TEMPLATE_VERSION = 1;
const MESSAGE_TEMPLATE_CUSTOM_ID_PREFIX = 'mt';
const MESSAGE_TEMPLATE_LIMITS = Object.freeze({
  folders: 50,
  templates: 100,
  name: 80,
  description: 500,
  content: 4000,
  media: 10,
  separators: 4,
  additionalContainers: 2,
  buttons: 25,
  buttonLabel: 80,
  dropdownOptions: 25,
  dropdownLabel: 100,
  dropdownDescription: 100,
  dropdownPlaceholder: 150,
  customId: 100,
});
const MESSAGE_TEMPLATE_BUTTON_STYLES = Object.freeze(['Primary', 'Secondary', 'Success', 'Danger']);
const MESSAGE_TEMPLATE_ACTION_TYPES = Object.freeze(['send_message', 'give_role', 'remove_role', 'dm_message']);
const BUTTON_STYLE_VALUES = Object.freeze({
  Primary: ButtonStyle.Primary ?? 1,
  Secondary: ButtonStyle.Secondary ?? 2,
  Success: ButtonStyle.Success ?? 3,
  Danger: ButtonStyle.Danger ?? 4,
});
const GENERIC_TEMPLATE_VARIABLES = Object.freeze([
  'server', 'server_icon', 'channel', 'timestamp', 'separator',
]);
const MEDIA_TEMPLATE_VARIABLES = new Set(['{server_icon}', '{user_avatar}', '{user_profile}']);
const DEFAULT_TEMPLATE_LAYOUT = Object.freeze({
  container: true,
  accentColor: '#b9f547',
  thumbnailEnabled: false,
  thumbnailUrl: '',
  galleryUrls: Object.freeze([]),
});
const DEFAULT_MESSAGE_TEMPLATES_CONFIG = Object.freeze({
  folders: Object.freeze([]),
  items: Object.freeze([]),
});
const DEFAULT_TEMPLATE_CONTROLS = Object.freeze({
  type: 'none',
  buttons: Object.freeze([]),
  dropdown: Object.freeze({
    placeholder: 'Choose an option',
    allowMultiple: false,
    options: Object.freeze([]),
  }),
});
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const DISCORD_ID_PATTERN = /^\d{16,20}$/;

class MessageTemplateError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_TEMPLATE') {
    super(message);
    this.name = 'MessageTemplateError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanName(value, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MESSAGE_TEMPLATE_LIMITS.name) || fallback;
}

function cleanDescription(value) {
  return String(value ?? '').replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MESSAGE_TEMPLATE_LIMITS.description);
}

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return DISCORD_ID_PATTERN.test(text) ? text : '';
}

function cleanText(value, maximum, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) || fallback;
}

function cleanHexColor(value, fallback = DEFAULT_TEMPLATE_LAYOUT.accentColor) {
  const text = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function cleanMediaTemplate(value) {
  const text = String(value || '').trim().slice(0, 2000);
  if (MEDIA_TEMPLATE_VARIABLES.has(text.toLowerCase())) return text.toLowerCase();
  return safeMediaUrl(text);
}

function cleanContent(value) {
  const content = String(value ?? '').replace(/\u0000/g, '').slice(0, MESSAGE_TEMPLATE_LIMITS.content);
  const parts = content.split(/\{separator\}/gi);
  return parts.length > MESSAGE_TEMPLATE_LIMITS.separators + 1
    ? [...parts.slice(0, MESSAGE_TEMPLATE_LIMITS.separators), parts.slice(MESSAGE_TEMPLATE_LIMITS.separators).join('\n')].join('{separator}')
    : content;
}

function cleanTimestamp(value, fallback = '1970-01-01T00:00:00.000Z') {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function deterministicId(kind, value, index) {
  const digest = crypto.createHash('sha256')
    .update(`${kind}:${index}:${JSON.stringify(value ?? null)}`)
    .digest('hex').slice(0, 24);
  return `${kind}_${digest}`;
}

function normalizedId(kind, value, index, seen) {
  const candidate = String(value?.id || '').trim();
  let id = ID_PATTERN.test(candidate) && !seen.has(candidate) ? candidate : deterministicId(kind, value, index);
  let suffix = 1;
  while (seen.has(id)) id = `${deterministicId(kind, value, index)}_${suffix++}`.slice(0, 64);
  seen.add(id);
  return id;
}

function normalizeTemplateLayout(value) {
  const source = isObject(value) ? value : {};
  return {
    container: source.container !== false,
    accentColor: cleanHexColor(source.accentColor),
    thumbnailEnabled: source.thumbnailEnabled === true,
    thumbnailUrl: cleanMediaTemplate(source.thumbnailUrl),
    galleryUrls: [...new Set((Array.isArray(source.galleryUrls) ? source.galleryUrls : [])
      .map(cleanMediaTemplate).filter(Boolean))].slice(0, MESSAGE_TEMPLATE_LIMITS.media),
  };
}

function normalizeAdditionalTemplateContainers(value) {
  return (Array.isArray(value) ? value : []).slice(0, MESSAGE_TEMPLATE_LIMITS.additionalContainers).map((container) => ({
    content: cleanContent(container?.content),
    layout: { ...normalizeTemplateLayout(container?.layout), container: true },
  }));
}

function normalizeTemplateControlEmoji(value) {
  const source = isObject(value) ? value : {};
  const id = cleanDiscordId(source.id);
  const name = cleanText(source.name, 100);
  if (!name) return { id: '', name: '', animated: false, source: 'default' };
  return {
    id,
    name,
    animated: Boolean(id && source.animated === true),
    source: id && source.source === 'bot' ? 'bot' : id ? 'group' : 'default',
  };
}

function discordControlEmoji(value) {
  const emoji = normalizeTemplateControlEmoji(value);
  if (!emoji.name) return undefined;
  return emoji.id
    ? { id: emoji.id, name: emoji.name, animated: emoji.animated }
    : { name: emoji.name };
}

function normalizeButtonStyle(value) {
  if (MESSAGE_TEMPLATE_BUTTON_STYLES.includes(value)) return value;
  return MESSAGE_TEMPLATE_BUTTON_STYLES.find((style) => BUTTON_STYLE_VALUES[style] === Number(value)) || 'Secondary';
}

function normalizeTemplateAction(value) {
  const source = isObject(value) ? value : {};
  const type = MESSAGE_TEMPLATE_ACTION_TYPES.includes(source.type) ? source.type : 'send_message';
  if (['give_role', 'remove_role'].includes(type)) return { type, roleId: cleanDiscordId(source.roleId) };
  return { type, templateId: ID_PATTERN.test(String(source.templateId || '')) ? String(source.templateId) : '' };
}

function normalizeTemplateControls(value) {
  const source = isObject(value) ? value : {};
  const buttonIds = new Set();
  const buttons = (Array.isArray(source.buttons) ? source.buttons : [])
    .slice(0, MESSAGE_TEMPLATE_LIMITS.buttons)
    .map((button, index) => ({
      id: normalizedId('control', button, index, buttonIds),
      emoji: normalizeTemplateControlEmoji(button?.emoji),
      label: cleanText(button?.label, MESSAGE_TEMPLATE_LIMITS.buttonLabel, `Button ${index + 1}`),
      style: normalizeButtonStyle(button?.style),
      sortOrder: Number.isFinite(Number(button?.sortOrder)) ? Math.max(0, Math.round(Number(button.sortOrder))) : index,
      action: normalizeTemplateAction(button?.action),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((button, index) => ({ ...button, sortOrder: index }));
  const dropdownSource = isObject(source.dropdown) ? source.dropdown : {};
  const optionIds = new Set();
  const options = (Array.isArray(dropdownSource.options) ? dropdownSource.options : [])
    .slice(0, MESSAGE_TEMPLATE_LIMITS.dropdownOptions)
    .map((option, index) => ({
      id: normalizedId('control', option, index, optionIds),
      emoji: normalizeTemplateControlEmoji(option?.emoji),
      title: cleanText(option?.title, MESSAGE_TEMPLATE_LIMITS.dropdownLabel, `Option ${index + 1}`),
      description: cleanText(option?.description, MESSAGE_TEMPLATE_LIMITS.dropdownDescription),
      sortOrder: Number.isFinite(Number(option?.sortOrder)) ? Math.max(0, Math.round(Number(option.sortOrder))) : index,
      action: normalizeTemplateAction(option?.action),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((option, index) => ({ ...option, sortOrder: index }));
  return {
    type: ['button', 'dropdown'].includes(source.type) ? source.type : 'none',
    buttons,
    dropdown: {
      placeholder: cleanText(dropdownSource.placeholder, MESSAGE_TEMPLATE_LIMITS.dropdownPlaceholder, 'Choose an option'),
      allowMultiple: dropdownSource.allowMultiple === true,
      options,
    },
  };
}

function normalizeMessageTemplatesConfig(value) {
  const source = isObject(value) ? value : {};
  const folderIds = new Set();
  const folders = (Array.isArray(source.folders) ? source.folders : [])
    .slice(0, MESSAGE_TEMPLATE_LIMITS.folders)
    .map((folder, index) => {
      const createdAt = cleanTimestamp(folder?.createdAt);
      return {
        id: normalizedId('folder', folder, index, folderIds),
        name: cleanName(folder?.name, `Folder ${index + 1}`),
        createdAt,
        updatedAt: cleanTimestamp(folder?.updatedAt, createdAt),
      };
    });
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const itemIds = new Set();
  const items = (Array.isArray(source.items) ? source.items : [])
    .slice(0, MESSAGE_TEMPLATE_LIMITS.templates)
    .map((item, index) => {
      const createdAt = cleanTimestamp(item?.createdAt);
      return {
        id: normalizedId('template', item, index, itemIds),
        folderId: validFolderIds.has(String(item?.folderId || '')) ? String(item.folderId) : null,
        name: cleanName(item?.name, `Template ${index + 1}`),
        description: cleanDescription(item?.description),
        version: TEMPLATE_VERSION,
        content: cleanContent(item?.content),
        layout: normalizeTemplateLayout(item?.layout),
        additionalContainers: normalizeAdditionalTemplateContainers(item?.additionalContainers),
        controls: Number(item?.version) === LEGACY_TEMPLATE_VERSION
          ? clone(DEFAULT_TEMPLATE_CONTROLS)
          : normalizeTemplateControls(item?.controls),
        defaultChannelId: cleanDiscordId(item?.defaultChannelId),
        enabled: item?.enabled !== false,
        createdAt,
        updatedAt: cleanTimestamp(item?.updatedAt, createdAt),
      };
    });
  return { folders, items };
}

function assertAllowedFields(value, fields, label) {
  if (!isObject(value)) throw new MessageTemplateError(`${label} must be a JSON object.`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) throw new MessageTemplateError(`Unknown ${label.toLowerCase()} field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function requireName(value, label = 'Template name') {
  const raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!raw) throw new MessageTemplateError(`${label} is required.`);
  if (raw.length > MESSAGE_TEMPLATE_LIMITS.name) throw new MessageTemplateError(`${label} must be ${MESSAGE_TEMPLATE_LIMITS.name} characters or fewer.`);
  return raw;
}

function validateMediaTemplate(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  const cleaned = cleanMediaTemplate(text);
  if (!cleaned) throw new MessageTemplateError(`${label} must be an HTTPS/HTTP image URL or a supported media variable.`);
  return cleaned;
}

function parseTemplateContent(value, label = 'Template content') {
  if (typeof value !== 'string') throw new MessageTemplateError(`${label} must be a string.`);
  if (value.length > MESSAGE_TEMPLATE_LIMITS.content) throw new MessageTemplateError(`${label} must be ${MESSAGE_TEMPLATE_LIMITS.content} characters or fewer.`);
  const separators = value.match(/\{separator\}/gi)?.length || 0;
  if (separators > MESSAGE_TEMPLATE_LIMITS.separators) throw new MessageTemplateError(`${label} supports up to ${MESSAGE_TEMPLATE_LIMITS.separators} dividers.`);
  return cleanContent(value);
}

function parseTemplateLayout(value, label = 'Layout') {
  assertAllowedFields(value, ['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'], label);
  if (typeof value.container !== 'boolean') throw new MessageTemplateError(`${label}.container must be true or false.`);
  if (typeof value.thumbnailEnabled !== 'boolean') throw new MessageTemplateError(`${label}.thumbnailEnabled must be true or false.`);
  if (!/^#[0-9a-f]{6}$/i.test(String(value.accentColor || ''))) throw new MessageTemplateError(`${label}.accentColor must be a six-digit hex color.`);
  if (!Array.isArray(value.galleryUrls)) throw new MessageTemplateError(`${label}.galleryUrls must be an array.`);
  if (value.galleryUrls.length > MESSAGE_TEMPLATE_LIMITS.media) throw new MessageTemplateError(`A gallery supports up to ${MESSAGE_TEMPLATE_LIMITS.media} images.`);
  const mediaPrefix = label === 'Layout' ? '' : `${label} `;
  const thumbnailUrl = validateMediaTemplate(value.thumbnailUrl, `${mediaPrefix}Thumbnail`);
  const galleryUrls = [...new Set(value.galleryUrls.map((url, index) => validateMediaTemplate(url, `${mediaPrefix}Gallery image ${index + 1}`)).filter(Boolean))];
  return {
    container: value.container,
    accentColor: cleanHexColor(value.accentColor),
    thumbnailEnabled: value.thumbnailEnabled,
    thumbnailUrl,
    galleryUrls,
  };
}

function parseTemplateControlEmoji(value, label) {
  assertAllowedFields(value, ['id', 'name', 'animated', 'source'], label);
  if (value.id && !cleanDiscordId(value.id)) throw new MessageTemplateError(`${label}.id must be a Discord ID.`);
  if (value.name !== undefined && typeof value.name !== 'string') throw new MessageTemplateError(`${label}.name must be a string.`);
  if (value.animated !== undefined && typeof value.animated !== 'boolean') throw new MessageTemplateError(`${label}.animated must be true or false.`);
  if (value.source !== undefined && !['default', 'group', 'bot'].includes(value.source)) throw new MessageTemplateError(`${label}.source is invalid.`);
  return normalizeTemplateControlEmoji(value);
}

function parseTemplateAction(value, label, options = {}) {
  if (!isObject(value)) throw new MessageTemplateError(`${label} must be a JSON object.`);
  if (!MESSAGE_TEMPLATE_ACTION_TYPES.includes(value.type)) throw new MessageTemplateError(`${label}.type is invalid.`);
  const templateAction = ['send_message', 'dm_message'].includes(value.type);
  assertAllowedFields(value, templateAction ? ['type', 'templateId'] : ['type', 'roleId'], label);
  if (templateAction) {
    const templateId = String(value.templateId || '');
    if (!ID_PATTERN.test(templateId)) throw new MessageTemplateError(`${label}.templateId is invalid.`);
    if (options.collection && !templateById(options.collection, templateId) && !options.allowedMissingTemplateIds?.has?.(templateId)) {
      throw new MessageTemplateError(`${label} must reference a Message Template in this server.`, 400, 'MISSING_ACTION_TEMPLATE');
    }
    return { type: value.type, templateId };
  }
  const roleId = cleanDiscordId(value.roleId);
  if (!roleId) throw new MessageTemplateError(`${label}.roleId must be a Discord ID.`);
  return { type: value.type, roleId };
}

function parseTemplateControls(value, options = {}) {
  assertAllowedFields(value, ['type', 'buttons', 'dropdown'], 'Controls');
  if (!['none', 'button', 'dropdown'].includes(value.type)) throw new MessageTemplateError('controls.type must be none, button, or dropdown.');
  if (!Array.isArray(value.buttons)) throw new MessageTemplateError('controls.buttons must be an array.');
  if (value.buttons.length > MESSAGE_TEMPLATE_LIMITS.buttons) throw new MessageTemplateError(`Button controls support up to ${MESSAGE_TEMPLATE_LIMITS.buttons} buttons.`);
  const seenButtonIds = new Set();
  const buttons = value.buttons.map((button, index) => {
    const label = `Controls button ${index + 1}`;
    assertAllowedFields(button, ['id', 'emoji', 'label', 'style', 'sortOrder', 'action'], label);
    if (!ID_PATTERN.test(String(button.id || '')) || seenButtonIds.has(button.id)) throw new MessageTemplateError(`${label}.id must be unique and stable.`);
    seenButtonIds.add(button.id);
    if (typeof button.label !== 'string' || !button.label.trim() || button.label.trim().length > MESSAGE_TEMPLATE_LIMITS.buttonLabel) throw new MessageTemplateError(`${label}.label must be between 1 and ${MESSAGE_TEMPLATE_LIMITS.buttonLabel} characters.`);
    if (!MESSAGE_TEMPLATE_BUTTON_STYLES.includes(button.style)) throw new MessageTemplateError('Button style must be Primary, Secondary, Success, or Danger.');
    if (!Number.isInteger(button.sortOrder) || button.sortOrder < 0) throw new MessageTemplateError(`${label}.sortOrder must be a non-negative integer.`);
    return {
      id: button.id,
      emoji: parseTemplateControlEmoji(button.emoji, `${label} emoji`),
      label: cleanText(button.label, MESSAGE_TEMPLATE_LIMITS.buttonLabel),
      style: button.style,
      sortOrder: button.sortOrder,
      action: parseTemplateAction(button.action, `${label} action`, options),
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder).map((button, index) => ({ ...button, sortOrder: index }));
  assertAllowedFields(value.dropdown, ['placeholder', 'allowMultiple', 'options'], 'Controls dropdown');
  if (typeof value.dropdown.placeholder !== 'string' || !value.dropdown.placeholder.trim() || value.dropdown.placeholder.trim().length > MESSAGE_TEMPLATE_LIMITS.dropdownPlaceholder) throw new MessageTemplateError(`controls.dropdown.placeholder must be between 1 and ${MESSAGE_TEMPLATE_LIMITS.dropdownPlaceholder} characters.`);
  if (typeof value.dropdown.allowMultiple !== 'boolean') throw new MessageTemplateError('controls.dropdown.allowMultiple must be true or false.');
  if (!Array.isArray(value.dropdown.options)) throw new MessageTemplateError('controls.dropdown.options must be an array.');
  if (value.dropdown.options.length > MESSAGE_TEMPLATE_LIMITS.dropdownOptions) throw new MessageTemplateError(`Dropdown controls support up to ${MESSAGE_TEMPLATE_LIMITS.dropdownOptions} options.`);
  const seenOptionIds = new Set();
  const dropdownOptions = value.dropdown.options.map((option, index) => {
    const label = `Controls dropdown option ${index + 1}`;
    assertAllowedFields(option, ['id', 'emoji', 'title', 'description', 'sortOrder', 'action'], label);
    if (!ID_PATTERN.test(String(option.id || '')) || seenOptionIds.has(option.id)) throw new MessageTemplateError(`${label}.id must be unique and stable.`);
    seenOptionIds.add(option.id);
    if (typeof option.title !== 'string' || !option.title.trim() || option.title.trim().length > MESSAGE_TEMPLATE_LIMITS.dropdownLabel) throw new MessageTemplateError(`${label}.title must be between 1 and ${MESSAGE_TEMPLATE_LIMITS.dropdownLabel} characters.`);
    if (typeof option.description !== 'string' || option.description.trim().length > MESSAGE_TEMPLATE_LIMITS.dropdownDescription) throw new MessageTemplateError(`${label}.description must be ${MESSAGE_TEMPLATE_LIMITS.dropdownDescription} characters or fewer.`);
    if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) throw new MessageTemplateError(`${label}.sortOrder must be a non-negative integer.`);
    return {
      id: option.id,
      emoji: parseTemplateControlEmoji(option.emoji, `${label} emoji`),
      title: cleanText(option.title, MESSAGE_TEMPLATE_LIMITS.dropdownLabel),
      description: cleanText(option.description, MESSAGE_TEMPLATE_LIMITS.dropdownDescription),
      sortOrder: option.sortOrder,
      action: parseTemplateAction(option.action, `${label} action`, options),
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder).map((option, index) => ({ ...option, sortOrder: index }));
  return {
    type: value.type,
    buttons,
    dropdown: {
      placeholder: cleanText(value.dropdown.placeholder, MESSAGE_TEMPLATE_LIMITS.dropdownPlaceholder),
      allowMultiple: value.dropdown.allowMultiple,
      options: dropdownOptions,
    },
  };
}

function parseTemplateDocument(value, options = {}) {
  const version = Number(value?.version);
  assertAllowedFields(value, version === LEGACY_TEMPLATE_VERSION
    ? ['version', 'content', 'layout', 'additionalContainers']
    : ['version', 'content', 'layout', 'additionalContainers', 'controls'], 'Template JSON');
  if (![LEGACY_TEMPLATE_VERSION, TEMPLATE_VERSION].includes(version)) throw new MessageTemplateError(`Template JSON version must be ${LEGACY_TEMPLATE_VERSION} or ${TEMPLATE_VERSION}.`);
  const additional = value.additionalContainers === undefined ? [] : value.additionalContainers;
  if (!Array.isArray(additional)) throw new MessageTemplateError('additionalContainers must be an array.');
  if (additional.length > MESSAGE_TEMPLATE_LIMITS.additionalContainers) throw new MessageTemplateError(`Templates support up to ${MESSAGE_TEMPLATE_LIMITS.additionalContainers} additional containers.`);
  return {
    version: TEMPLATE_VERSION,
    content: parseTemplateContent(value.content, 'Template content'),
    layout: parseTemplateLayout(value.layout),
    additionalContainers: additional.map((container, index) => {
      const label = `Additional container ${index + 1}`;
      assertAllowedFields(container, ['content', 'layout'], label);
      return {
        content: parseTemplateContent(container.content, `${label} content`),
        layout: { ...parseTemplateLayout(container.layout, `${label} layout`), container: true },
      };
    }),
    controls: version === LEGACY_TEMPLATE_VERSION
      ? clone(DEFAULT_TEMPLATE_CONTROLS)
      : parseTemplateControls(value.controls, options),
  };
}

function templateDocument(item) {
  const normalized = normalizeMessageTemplatesConfig({ items: [item] }).items[0];
  return {
    version: TEMPLATE_VERSION,
    content: normalized?.content || '',
    layout: normalized?.layout || clone(DEFAULT_TEMPLATE_LAYOUT),
    additionalContainers: normalized?.additionalContainers || [],
    controls: normalized?.controls || clone(DEFAULT_TEMPLATE_CONTROLS),
  };
}

function nextId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function folderById(collection, id) {
  return collection.folders.find((folder) => folder.id === String(id || '')) || null;
}

function templateById(collection, id) {
  return collection.items.find((item) => item.id === String(id || '')) || null;
}

function assertFolder(collection, folderId) {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  const id = String(folderId);
  if (!folderById(collection, id)) throw new MessageTemplateError('The selected folder does not exist.', 400, 'MISSING_FOLDER');
  return id;
}

function createFolder(collection, body, now = new Date()) {
  assertAllowedFields(body, ['name'], 'Folder');
  if (collection.folders.length >= MESSAGE_TEMPLATE_LIMITS.folders) throw new MessageTemplateError(`A server can have up to ${MESSAGE_TEMPLATE_LIMITS.folders} template folders.`);
  const timestamp = cleanTimestamp(now);
  const folder = { id: nextId('folder'), name: requireName(body.name, 'Folder name'), createdAt: timestamp, updatedAt: timestamp };
  collection.folders.push(folder);
  return folder;
}

function renameFolder(collection, id, body, now = new Date()) {
  assertAllowedFields(body, ['name'], 'Folder');
  const folder = folderById(collection, id);
  if (!folder) throw new MessageTemplateError('Template folder not found.', 404, 'FOLDER_NOT_FOUND');
  folder.name = requireName(body.name, 'Folder name');
  folder.updatedAt = cleanTimestamp(now);
  return folder;
}

function deleteFolder(collection, id, now = new Date()) {
  const index = collection.folders.findIndex((folder) => folder.id === String(id || ''));
  if (index < 0) throw new MessageTemplateError('Template folder not found.', 404, 'FOLDER_NOT_FOUND');
  const [folder] = collection.folders.splice(index, 1);
  const updatedAt = cleanTimestamp(now);
  let moved = 0;
  for (const item of collection.items) {
    if (item.folderId !== folder.id) continue;
    item.folderId = null;
    item.updatedAt = updatedAt;
    moved += 1;
  }
  return { folder, moved };
}

function createTemplate(collection, body = {}, now = new Date(), options = {}) {
  assertAllowedFields(body, ['name', 'description', 'folderId', 'defaultChannelId', 'enabled', 'content', 'layout', 'additionalContainers', 'controls', 'document'], 'Template');
  if (collection.items.length >= MESSAGE_TEMPLATE_LIMITS.templates) throw new MessageTemplateError(`A server can have up to ${MESSAGE_TEMPLATE_LIMITS.templates} templates.`);
  if (body.document !== undefined && (body.content !== undefined || body.layout !== undefined || body.additionalContainers !== undefined || body.controls !== undefined)) {
    throw new MessageTemplateError('Provide either document or content/layout/additionalContainers/controls, not both.');
  }
  if (body.description !== undefined && String(body.description).length > MESSAGE_TEMPLATE_LIMITS.description) {
    throw new MessageTemplateError(`Description must be ${MESSAGE_TEMPLATE_LIMITS.description} characters or fewer.`);
  }
  if (body.defaultChannelId && !cleanDiscordId(body.defaultChannelId)) throw new MessageTemplateError('Default destination channel is invalid.');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new MessageTemplateError('enabled must be true or false.');
  const document = body.document !== undefined
    ? parseTemplateDocument(body.document, { collection, allowedMissingTemplateIds: options.allowedMissingTemplateIds })
    : parseTemplateDocument({
      version: TEMPLATE_VERSION,
      content: String(body.content || ''),
      layout: body.layout || clone(DEFAULT_TEMPLATE_LAYOUT),
      additionalContainers: body.additionalContainers || [],
      controls: body.controls || clone(DEFAULT_TEMPLATE_CONTROLS),
    }, { collection, allowedMissingTemplateIds: options.allowedMissingTemplateIds });
  const timestamp = cleanTimestamp(now);
  const item = {
    id: nextId('template'),
    folderId: assertFolder(collection, body.folderId),
    name: requireName(body.name),
    description: cleanDescription(body.description),
    ...document,
    defaultChannelId: cleanDiscordId(body.defaultChannelId),
    enabled: body.enabled !== false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  validateTemplateControlPayload(item);
  collection.items.push(item);
  return item;
}

function updateTemplate(collection, id, body, now = new Date()) {
  assertAllowedFields(body, ['name', 'description', 'folderId', 'defaultChannelId', 'enabled', 'document'], 'Template update');
  const item = templateById(collection, id);
  if (!item) throw new MessageTemplateError('Message template not found.', 404, 'TEMPLATE_NOT_FOUND');
  if (body.name !== undefined) item.name = requireName(body.name);
  if (body.description !== undefined) {
    if (String(body.description).length > MESSAGE_TEMPLATE_LIMITS.description) throw new MessageTemplateError(`Description must be ${MESSAGE_TEMPLATE_LIMITS.description} characters or fewer.`);
    item.description = cleanDescription(body.description);
  }
  if (body.folderId !== undefined) item.folderId = assertFolder(collection, body.folderId);
  if (body.defaultChannelId !== undefined) {
    if (body.defaultChannelId && !cleanDiscordId(body.defaultChannelId)) throw new MessageTemplateError('Default destination channel is invalid.');
    item.defaultChannelId = cleanDiscordId(body.defaultChannelId);
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new MessageTemplateError('enabled must be true or false.');
    item.enabled = body.enabled;
  }
  if (body.document !== undefined) {
    const allowedMissingTemplateIds = new Set([
      ...(item.controls?.buttons || []),
      ...(item.controls?.dropdown?.options || []),
    ].map((entry) => entry.action?.templateId).filter(Boolean));
    Object.assign(item, parseTemplateDocument(body.document, { collection, allowedMissingTemplateIds }));
  }
  item.updatedAt = cleanTimestamp(now);
  validateTemplateControlPayload(item);
  return item;
}

function duplicateTemplate(collection, id, now = new Date()) {
  const source = templateById(collection, id);
  if (!source) throw new MessageTemplateError('Message template not found.', 404, 'TEMPLATE_NOT_FOUND');
  if (collection.items.length >= MESSAGE_TEMPLATE_LIMITS.templates) throw new MessageTemplateError(`A server can have up to ${MESSAGE_TEMPLATE_LIMITS.templates} templates.`);
  const base = `${source.name} copy`;
  let name = base.slice(0, MESSAGE_TEMPLATE_LIMITS.name);
  let number = 2;
  while (collection.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    const suffix = ` ${number++}`;
    name = `${base.slice(0, MESSAGE_TEMPLATE_LIMITS.name - suffix.length)}${suffix}`;
  }
  const document = templateDocument(source);
  for (const button of document.controls.buttons) button.id = nextId('control');
  for (const option of document.controls.dropdown.options) option.id = nextId('control');
  const allowedMissingTemplateIds = new Set([
    ...(source.controls?.buttons || []),
    ...(source.controls?.dropdown?.options || []),
  ].map((entry) => entry.action?.templateId).filter(Boolean));
  return createTemplate(collection, {
    name,
    description: source.description,
    folderId: source.folderId,
    defaultChannelId: source.defaultChannelId,
    enabled: source.enabled,
    document,
  }, now, { allowedMissingTemplateIds });
}

function deleteTemplate(collection, id) {
  const index = collection.items.findIndex((item) => item.id === String(id || ''));
  if (index < 0) throw new MessageTemplateError('Message template not found.', 404, 'TEMPLATE_NOT_FOUND');
  return collection.items.splice(index, 1)[0];
}

function itemVariableNames(item) {
  return templateVariables(
    item?.content,
    item?.layout?.thumbnailUrl,
    item?.layout?.galleryUrls,
    (item?.additionalContainers || []).flatMap((container) => [container.content, container.layout?.thumbnailUrl, container.layout?.galleryUrls]),
  );
}

function unresolvedVariables(item, supported = GENERIC_TEMPLATE_VARIABLES) {
  const allowed = new Set([...supported].map((value) => String(value).replace(/[{}]/g, '').toLowerCase()));
  allowed.add('separator');
  return itemVariableNames(item).filter((name) => !allowed.has(name));
}

function genericTemplateValues(guild, channel, nowMs = Date.now()) {
  let serverIcon = '';
  try { serverIcon = String(guild?.iconURL?.({ extension: 'png', size: 256 }) || ''); } catch {}
  return {
    server: String(guild?.name || 'Server'),
    server_icon: serverIcon,
    channel: channel?.id ? `<#${channel.id}>` : '#channel',
    timestamp: `<t:${Math.floor((Number(nowMs) || Date.now()) / 1000)}:F>`,
  };
}

function compactDigest(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, length);
}

function encodeGuildId(guildId) {
  const id = cleanDiscordId(guildId);
  return id ? BigInt(id).toString(36) : '';
}

function decodeGuildId(value) {
  const text = String(value || '').toLowerCase();
  if (!/^[0-9a-z]{1,16}$/.test(text)) return '';
  let result = 0n;
  for (const character of text) {
    const digit = BigInt(Number.parseInt(character, 36));
    if (digit < 0n || digit >= 36n) return '';
    result = result * 36n + digit;
  }
  const id = result.toString(10);
  return cleanDiscordId(id) && encodeGuildId(id) === text ? id : '';
}

function templateIdentityToken(templateId) {
  return compactDigest(`template:${templateId}`);
}

function templateControlIdentityToken(controlId) {
  return compactDigest(`control:${controlId}`);
}

function templateControlRevisionToken(item, type, control = null) {
  const value = type === 'dropdown'
    ? item?.controls?.dropdown
    : control;
  return compactDigest(`revision:${item?.updatedAt || ''}:${type}:${JSON.stringify(value || null)}`, 12);
}

function templateButtonCustomId(guildId, item, button) {
  return `${MESSAGE_TEMPLATE_CUSTOM_ID_PREFIX}:${encodeGuildId(guildId)}:b:${templateIdentityToken(item?.id)}:${templateControlIdentityToken(button?.id)}:${templateControlRevisionToken(item, 'button', button)}`;
}

function templateSelectCustomId(guildId, item) {
  return `${MESSAGE_TEMPLATE_CUSTOM_ID_PREFIX}:${encodeGuildId(guildId)}:d:${templateIdentityToken(item?.id)}:${templateControlRevisionToken(item, 'dropdown')}`;
}

function templateOptionValue(option) {
  return templateControlIdentityToken(option?.id);
}

function parseTemplateControlCustomId(value) {
  const text = String(value || '');
  if (!text.startsWith(`${MESSAGE_TEMPLATE_CUSTOM_ID_PREFIX}:`) || text.length > MESSAGE_TEMPLATE_LIMITS.customId) return null;
  let match = text.match(/^mt:([0-9a-z]{1,16}):b:([a-zA-Z0-9_-]{16}):([a-zA-Z0-9_-]{16}):([a-zA-Z0-9_-]{12})$/);
  if (match) {
    const guildId = decodeGuildId(match[1]);
    return guildId ? { guildId, type: 'button', templateToken: match[2], controlToken: match[3], revisionToken: match[4] } : null;
  }
  match = text.match(/^mt:([0-9a-z]{1,16}):d:([a-zA-Z0-9_-]{16}):([a-zA-Z0-9_-]{12})$/);
  if (!match) return null;
  const guildId = decodeGuildId(match[1]);
  return guildId ? { guildId, type: 'dropdown', templateToken: match[2], controlToken: '', revisionToken: match[3] } : null;
}

function assertConfiguredAction(action, label) {
  if (['send_message', 'dm_message'].includes(action?.type) && ID_PATTERN.test(String(action.templateId || ''))) return;
  if (['give_role', 'remove_role'].includes(action?.type) && cleanDiscordId(action.roleId)) return;
  throw new MessageTemplateError(`Configure the action for ${label} before sending.`, 400, 'INCOMPLETE_CONTROL_ACTION');
}

function templateButtonActionRows(item, guildId) {
  const buttons = item.controls.buttons.map((button, index) => {
    assertConfiguredAction(button.action, `button ${index + 1}`);
    const component = {
      type: 2,
      style: BUTTON_STYLE_VALUES[button.style],
      custom_id: templateButtonCustomId(guildId, item, button),
      label: button.label,
    };
    const emoji = discordControlEmoji(button.emoji);
    if (emoji) component.emoji = emoji;
    return component;
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push({ type: 1, components: buttons.slice(index, index + 5) });
  return rows;
}

function templateDropdownActionRows(item, guildId) {
  if (!item.controls.dropdown.options.length) return [];
  const options = item.controls.dropdown.options.map((option, index) => {
    assertConfiguredAction(option.action, `dropdown option ${index + 1}`);
    const component = { label: option.title, value: templateOptionValue(option) };
    if (option.description) component.description = option.description;
    const emoji = discordControlEmoji(option.emoji);
    if (emoji) component.emoji = emoji;
    return component;
  });
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: templateSelectCustomId(guildId, item),
      placeholder: item.controls.dropdown.placeholder,
      min_values: 1,
      max_values: item.controls.dropdown.allowMultiple ? Math.min(MESSAGE_TEMPLATE_LIMITS.dropdownOptions, options.length) : 1,
      options,
    }],
  }];
}

function templateControlActionRows(item, guildId) {
  const controls = normalizeTemplateControls(item?.controls);
  if (controls.type === 'none') return [];
  if (!encodeGuildId(guildId)) throw new MessageTemplateError('Interactive controls require an originating Discord server.', 400, 'MISSING_CONTROL_GUILD');
  const normalized = { ...item, controls };
  if (controls.type === 'button') return templateButtonActionRows(normalized, guildId);
  return templateDropdownActionRows(normalized, guildId);
}

function validateTemplateControlPayload(item, guildId = '123456789012345678') {
  const controls = normalizeTemplateControls(item?.controls);
  if (controls.type === 'none') return item;
  const entries = controls.type === 'button' ? controls.buttons : controls.dropdown.options;
  if (!entries.length) throw new MessageTemplateError(`Add at least one ${controls.type === 'button' ? 'button' : 'dropdown option'} or choose no controls.`);
  const payload = componentMessagePayload(item?.content, item?.layout, {
    label: item?.name || 'Message Template',
    fallbackText: '-# Message template',
    additionalContainers: item?.additionalContainers,
    allowedUsers: [],
  });
  try { appendValidatedInteractionActionRows(payload, templateControlActionRows({ ...item, controls }, guildId)); }
  catch (error) { throw new MessageTemplateError(error.message, 400, 'INVALID_CONTROL_COMPONENTS'); }
  return item;
}

function buildTemplatePayload(item, guild, channel, options = {}) {
  const missing = unresolvedVariables(item);
  if (missing.length) throw new MessageTemplateError(`Resolve context-specific variable${missing.length === 1 ? '' : 's'} before sending: ${missing.map((name) => `{${name}}`).join(', ')}.`, 400, 'UNRESOLVED_VARIABLES');
  const values = genericTemplateValues(guild, channel, options.nowMs);
  const layout = resolvedLayout(item.layout, values);
  const body = interpolateTemplate(item.content, values).slice(0, MESSAGE_TEMPLATE_LIMITS.content);
  const additionalContainers = (item.additionalContainers || []).map((container) => ({
    content: interpolateTemplate(container.content, values).slice(0, MESSAGE_TEMPLATE_LIMITS.content),
    layout: resolvedLayout(container.layout, values),
  }));
  const payload = componentMessagePayload(body, layout, {
    label: item.name,
    fallbackText: '-# Message template',
    additionalContainers,
    allowedUsers: [],
  });
  const rows = templateControlActionRows(item, guild?.id);
  try { return appendValidatedInteractionActionRows(payload, rows); }
  catch (error) { throw new MessageTemplateError(error.message, 400, 'INVALID_CONTROL_COMPONENTS'); }
}

async function resolveTemplateChannel(guild, channelId) {
  if (!guild || !cleanDiscordId(channelId)) return null;
  return guild.channels?.cache?.get?.(channelId)
    || await guild.channels?.fetch?.(channelId).catch(() => null)
    || null;
}

function unsupportedDestination(channel) {
  return [ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel?.type);
}

async function sendTemplate(item, guild, options = {}) {
  if (!item) throw new MessageTemplateError('Message template not found.', 404, 'TEMPLATE_NOT_FOUND');
  if (!options.test && item.enabled === false) throw new MessageTemplateError('Enable this template before sending it.', 400, 'TEMPLATE_DISABLED');
  const channelId = cleanDiscordId(options.channelId || item.defaultChannelId);
  if (!channelId) throw new MessageTemplateError('Choose a destination channel.', 400, 'MISSING_CHANNEL');
  const channel = await resolveTemplateChannel(guild, channelId);
  if (!channel || unsupportedDestination(channel)) throw new MessageTemplateError('The selected destination is unavailable or unsupported.', 400, 'MISSING_CHANNEL');
  const payload = buildTemplatePayload(item, guild, channel, options);
  const resolved = resolvedLayout(item.layout, genericTemplateValues(guild, channel, options.nowMs));
  const resolvedAdditional = (item.additionalContainers || []).map((container) => resolvedLayout(container.layout, genericTemplateValues(guild, channel, options.nowMs)));
  const needsEmbedLinks = Boolean((resolved.thumbnailEnabled && resolved.thumbnailUrl) || resolved.galleryUrls.length
    || resolvedAdditional.some((layout) => (layout.thumbnailEnabled && layout.thumbnailUrl) || layout.galleryUrls.length));
  const permissions = await deliveryPermissions(channel, guild, needsEmbedLinks);
  if (!permissions.ok) throw new MessageTemplateError(`CoinSprite is missing ${permissions.missing.join(', ')} in that channel.`, 403, 'MISSING_PERMISSIONS');
  let message;
  try { message = await channel.send(payload); } catch {
    throw new MessageTemplateError('Discord rejected the message. Check the channel permissions and try again.', 502, 'SEND_FAILED');
  }
  return { channel, message, payload };
}

module.exports = {
  BUTTON_STYLE_VALUES,
  DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  DEFAULT_TEMPLATE_CONTROLS,
  DEFAULT_TEMPLATE_LAYOUT,
  GENERIC_TEMPLATE_VARIABLES,
  MESSAGE_TEMPLATE_ACTION_TYPES,
  MESSAGE_TEMPLATE_BUTTON_STYLES,
  MESSAGE_TEMPLATE_CUSTOM_ID_PREFIX,
  MESSAGE_TEMPLATE_LIMITS,
  MessageTemplateError,
  TEMPLATE_VERSION,
  buildTemplatePayload,
  createFolder,
  createTemplate,
  deleteFolder,
  deleteTemplate,
  duplicateTemplate,
  genericTemplateValues,
  itemVariableNames,
  normalizeMessageTemplatesConfig,
  normalizeTemplateAction,
  normalizeTemplateControlEmoji,
  normalizeTemplateControls,
  normalizeTemplateLayout,
  parseTemplateControlCustomId,
  parseTemplateDocument,
  renameFolder,
  sendTemplate,
  templateById,
  templateButtonCustomId,
  templateControlActionRows,
  templateControlIdentityToken,
  templateControlRevisionToken,
  templateDocument,
  templateIdentityToken,
  templateOptionValue,
  templateSelectCustomId,
  unresolvedVariables,
  updateTemplate,
  validateTemplateControlPayload,
};
