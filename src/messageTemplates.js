const crypto = require('crypto');
const { ChannelType } = require('discord.js');
const {
  componentMessagePayload,
  deliveryPermissions,
  interpolateTemplate,
  resolvedLayout,
  safeMediaUrl,
  templateVariables,
} = require('./messageComposer');

const TEMPLATE_VERSION = 1;
const MESSAGE_TEMPLATE_LIMITS = Object.freeze({
  folders: 50,
  templates: 100,
  name: 80,
  description: 500,
  content: 4000,
  media: 10,
  separators: 4,
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
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

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
  return /^\d{16,20}$/.test(text) ? text : '';
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

function parseTemplateDocument(value) {
  assertAllowedFields(value, ['version', 'content', 'layout'], 'Template JSON');
  if (Number(value.version) !== TEMPLATE_VERSION) throw new MessageTemplateError(`Template JSON version must be ${TEMPLATE_VERSION}.`);
  if (typeof value.content !== 'string') throw new MessageTemplateError('Template JSON content must be a string.');
  if (value.content.length > MESSAGE_TEMPLATE_LIMITS.content) throw new MessageTemplateError(`Template content must be ${MESSAGE_TEMPLATE_LIMITS.content} characters or fewer.`);
  const separators = value.content.match(/\{separator\}/gi)?.length || 0;
  if (separators > MESSAGE_TEMPLATE_LIMITS.separators) throw new MessageTemplateError(`Templates support up to ${MESSAGE_TEMPLATE_LIMITS.separators} dividers.`);
  assertAllowedFields(value.layout, ['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'], 'Layout');
  if (typeof value.layout.container !== 'boolean') throw new MessageTemplateError('layout.container must be true or false.');
  if (typeof value.layout.thumbnailEnabled !== 'boolean') throw new MessageTemplateError('layout.thumbnailEnabled must be true or false.');
  if (!/^#[0-9a-f]{6}$/i.test(String(value.layout.accentColor || ''))) throw new MessageTemplateError('layout.accentColor must be a six-digit hex color.');
  if (!Array.isArray(value.layout.galleryUrls)) throw new MessageTemplateError('layout.galleryUrls must be an array.');
  if (value.layout.galleryUrls.length > MESSAGE_TEMPLATE_LIMITS.media) throw new MessageTemplateError(`A gallery supports up to ${MESSAGE_TEMPLATE_LIMITS.media} images.`);
  const thumbnailUrl = validateMediaTemplate(value.layout.thumbnailUrl, 'Thumbnail');
  const galleryUrls = [...new Set(value.layout.galleryUrls.map((url, index) => validateMediaTemplate(url, `Gallery image ${index + 1}`)).filter(Boolean))];
  return {
    version: TEMPLATE_VERSION,
    content: cleanContent(value.content),
    layout: {
      container: value.layout.container,
      accentColor: cleanHexColor(value.layout.accentColor),
      thumbnailEnabled: value.layout.thumbnailEnabled,
      thumbnailUrl,
      galleryUrls,
    },
  };
}

function templateDocument(item) {
  const normalized = normalizeMessageTemplatesConfig({ items: [item] }).items[0];
  return {
    version: TEMPLATE_VERSION,
    content: normalized?.content || '',
    layout: normalized?.layout || clone(DEFAULT_TEMPLATE_LAYOUT),
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

function createTemplate(collection, body = {}, now = new Date()) {
  assertAllowedFields(body, ['name', 'description', 'folderId', 'defaultChannelId', 'enabled', 'content', 'layout', 'document'], 'Template');
  if (collection.items.length >= MESSAGE_TEMPLATE_LIMITS.templates) throw new MessageTemplateError(`A server can have up to ${MESSAGE_TEMPLATE_LIMITS.templates} templates.`);
  if (body.document !== undefined && (body.content !== undefined || body.layout !== undefined)) {
    throw new MessageTemplateError('Provide either document or content/layout, not both.');
  }
  if (body.description !== undefined && String(body.description).length > MESSAGE_TEMPLATE_LIMITS.description) {
    throw new MessageTemplateError(`Description must be ${MESSAGE_TEMPLATE_LIMITS.description} characters or fewer.`);
  }
  if (body.defaultChannelId && !cleanDiscordId(body.defaultChannelId)) throw new MessageTemplateError('Default destination channel is invalid.');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new MessageTemplateError('enabled must be true or false.');
  const document = body.document !== undefined
    ? parseTemplateDocument(body.document)
    : parseTemplateDocument({ version: TEMPLATE_VERSION, content: String(body.content || ''), layout: body.layout || clone(DEFAULT_TEMPLATE_LAYOUT) });
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
  if (body.document !== undefined) Object.assign(item, parseTemplateDocument(body.document));
  item.updatedAt = cleanTimestamp(now);
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
  return createTemplate(collection, {
    name,
    description: source.description,
    folderId: source.folderId,
    defaultChannelId: source.defaultChannelId,
    enabled: source.enabled,
    document: templateDocument(source),
  }, now);
}

function deleteTemplate(collection, id) {
  const index = collection.items.findIndex((item) => item.id === String(id || ''));
  if (index < 0) throw new MessageTemplateError('Message template not found.', 404, 'TEMPLATE_NOT_FOUND');
  return collection.items.splice(index, 1)[0];
}

function itemVariableNames(item) {
  return templateVariables(item?.content, item?.layout?.thumbnailUrl, item?.layout?.galleryUrls);
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

function buildTemplatePayload(item, guild, channel, options = {}) {
  const missing = unresolvedVariables(item);
  if (missing.length) throw new MessageTemplateError(`Resolve context-specific variable${missing.length === 1 ? '' : 's'} before sending: ${missing.map((name) => `{${name}}`).join(', ')}.`, 400, 'UNRESOLVED_VARIABLES');
  const values = genericTemplateValues(guild, channel, options.nowMs);
  const layout = resolvedLayout(item.layout, values);
  const body = interpolateTemplate(item.content, values).slice(0, MESSAGE_TEMPLATE_LIMITS.content);
  const content = options.test ? `-# TEST MESSAGE · ${item.name}\n${body}` : body;
  return componentMessagePayload(content, layout, {
    label: options.test ? 'Template test' : item.name,
    fallbackText: options.test ? `-# TEST MESSAGE · ${item.name}` : '-# Message template',
    allowedUsers: [],
  });
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
  const needsEmbedLinks = Boolean((resolved.thumbnailEnabled && resolved.thumbnailUrl) || resolved.galleryUrls.length);
  const permissions = await deliveryPermissions(channel, guild, needsEmbedLinks);
  if (!permissions.ok) throw new MessageTemplateError(`CoinSprite is missing ${permissions.missing.join(', ')} in that channel.`, 403, 'MISSING_PERMISSIONS');
  let message;
  try { message = await channel.send(payload); } catch {
    throw new MessageTemplateError('Discord rejected the message. Check the channel permissions and try again.', 502, 'SEND_FAILED');
  }
  return { channel, message, payload };
}

module.exports = {
  DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  DEFAULT_TEMPLATE_LAYOUT,
  GENERIC_TEMPLATE_VARIABLES,
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
  normalizeTemplateLayout,
  parseTemplateDocument,
  renameFolder,
  sendTemplate,
  templateById,
  templateDocument,
  unresolvedVariables,
  updateTemplate,
};
