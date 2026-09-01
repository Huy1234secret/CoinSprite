const crypto = require('crypto');
const {
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const {
  appendValidatedInteractionActionRows,
  componentMessagePayload,
  deliveryPermissions,
  interpolateTemplate,
  resolvedLayout,
} = require('./messageComposer');
const {
  DEFAULT_TEMPLATE_LAYOUT,
  genericTemplateValues,
  normalizeTemplateLayout,
} = require('./messageTemplates');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const REACTION_ROLE_CUSTOM_ID_PREFIX = 'rr';
const REACTION_ROLE_LIMITS = Object.freeze({
  templates: 100,
  name: 80,
  content: 4000,
  additionalContainers: 2,
  buttons: 25,
  buttonLabel: 80,
  dropdownOptions: 25,
  dropdownLabel: 100,
  dropdownDescription: 100,
  dropdownPlaceholder: 150,
  customId: 100,
});
const REACTION_ROLE_BUTTON_STYLES = Object.freeze(['Primary', 'Secondary', 'Success', 'Danger']);
const BUTTON_STYLE_VALUES = Object.freeze({
  Primary: ButtonStyle.Primary ?? 1,
  Secondary: ButtonStyle.Secondary ?? 2,
  Success: ButtonStyle.Success ?? 3,
  Danger: ButtonStyle.Danger ?? 4,
});
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const DISCORD_ID_PATTERN = /^\d{16,20}$/;
const DEFAULT_REACTION_ROLE_MESSAGE = Object.freeze({
  content: '## Choose your roles\nUse the controls below to update your server roles.',
  layout: DEFAULT_TEMPLATE_LAYOUT,
  additionalContainers: Object.freeze([]),
  sourceTemplateId: '',
});
const DEFAULT_REACTION_ROLES_CONFIG = Object.freeze({ items: Object.freeze([]) });

class ReactionRoleError extends Error {
  constructor(message, statusCode = 400, code = 'REACTION_ROLE_INVALID') {
    super(message);
    this.name = 'ReactionRoleError';
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

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return DISCORD_ID_PATTERN.test(text) ? text : '';
}

function cleanTimestamp(value, fallback = '1970-01-01T00:00:00.000Z') {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function cleanText(value, maximum, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) || fallback;
}

function cleanContent(value) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, REACTION_ROLE_LIMITS.content);
}

function deterministicId(kind, value, index) {
  return `${kind}_${crypto.createHash('sha256').update(`${kind}:${index}:${JSON.stringify(value ?? null)}`).digest('hex').slice(0, 24)}`;
}

function uniqueId(kind, value, index, seen) {
  const candidate = String(value?.id || '').trim();
  let id = ID_PATTERN.test(candidate) && !seen.has(candidate) ? candidate : deterministicId(kind, value, index);
  let suffix = 1;
  while (seen.has(id)) id = `${deterministicId(kind, value, index)}_${suffix++}`.slice(0, 64);
  seen.add(id);
  return id;
}

function nextId(kind) {
  return `${kind}_${crypto.randomBytes(12).toString('hex')}`;
}

function normalizeReactionRoleEmoji(value) {
  const source = isObject(value) ? value : {};
  const id = cleanDiscordId(source.id);
  const name = String(source.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  if (!name) return { id: '', name: '', animated: false, source: 'default' };
  return {
    id,
    name,
    animated: Boolean(id && source.animated === true),
    source: id && source.source === 'bot' ? 'bot' : id ? 'group' : 'default',
  };
}

function discordEmoji(emoji) {
  const normalized = normalizeReactionRoleEmoji(emoji);
  if (!normalized.name) return undefined;
  return normalized.id
    ? { id: normalized.id, name: normalized.name, animated: normalized.animated }
    : { name: normalized.name };
}

function normalizeMessage(value) {
  const source = isObject(value) ? value : {};
  return {
    content: cleanContent(source.content || DEFAULT_REACTION_ROLE_MESSAGE.content),
    layout: normalizeTemplateLayout(source.layout || DEFAULT_REACTION_ROLE_MESSAGE.layout),
    additionalContainers: (Array.isArray(source.additionalContainers) ? source.additionalContainers : [])
      .slice(0, REACTION_ROLE_LIMITS.additionalContainers)
      .map((container) => ({
        content: cleanContent(container?.content),
        layout: { ...normalizeTemplateLayout(container?.layout), container: true },
      })),
    sourceTemplateId: ID_PATTERN.test(String(source.sourceTemplateId || '')) ? String(source.sourceTemplateId) : '',
  };
}

function normalizeButtonStyle(value) {
  if (REACTION_ROLE_BUTTON_STYLES.includes(value)) return value;
  return REACTION_ROLE_BUTTON_STYLES.find((style) => BUTTON_STYLE_VALUES[style] === Number(value)) || 'Secondary';
}

function normalizeReactionRolesConfig(value) {
  const source = isObject(value) ? value : {};
  const itemIds = new Set();
  const items = (Array.isArray(source.items) ? source.items : [])
    .slice(0, REACTION_ROLE_LIMITS.templates)
    .map((item, itemIndex) => {
      const id = uniqueId('rr', item, itemIndex, itemIds);
      const buttonIds = new Set();
      const buttons = (Array.isArray(item?.buttons) ? item.buttons : [])
        .slice(0, REACTION_ROLE_LIMITS.buttons)
        .map((button, index) => ({
          id: uniqueId('button', button, index, buttonIds),
          emoji: normalizeReactionRoleEmoji(button?.emoji),
          label: cleanText(button?.label ?? button?.name, REACTION_ROLE_LIMITS.buttonLabel, `Role ${index + 1}`),
          style: normalizeButtonStyle(button?.style),
          roleId: cleanDiscordId(button?.roleId),
          sortOrder: Number.isFinite(Number(button?.sortOrder)) ? Math.max(0, Math.round(Number(button.sortOrder))) : index,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((button, index) => ({ ...button, sortOrder: index }));
      const optionIds = new Set();
      const dropdownSource = isObject(item?.dropdown) ? item.dropdown : {};
      const options = (Array.isArray(dropdownSource.options) ? dropdownSource.options : [])
        .slice(0, REACTION_ROLE_LIMITS.dropdownOptions)
        .map((option, index) => ({
          id: uniqueId('option', option, index, optionIds),
          emoji: normalizeReactionRoleEmoji(option?.emoji),
          title: cleanText(option?.title ?? option?.label, REACTION_ROLE_LIMITS.dropdownLabel, `Role ${index + 1}`),
          description: cleanText(option?.description, REACTION_ROLE_LIMITS.dropdownDescription),
          roleId: cleanDiscordId(option?.roleId),
          sortOrder: Number.isFinite(Number(option?.sortOrder)) ? Math.max(0, Math.round(Number(option.sortOrder))) : index,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((option, index) => ({ ...option, sortOrder: index }));
      const createdAt = cleanTimestamp(item?.createdAt);
      return {
        id,
        name: cleanText(item?.name, REACTION_ROLE_LIMITS.name, `Reaction Roles ${itemIndex + 1}`),
        enabled: item?.enabled !== false,
        message: normalizeMessage(item?.message),
        interactionType: item?.interactionType === 'dropdown' ? 'dropdown' : 'button',
        buttons,
        dropdown: {
          placeholder: cleanText(dropdownSource.placeholder, REACTION_ROLE_LIMITS.dropdownPlaceholder, 'Choose your roles'),
          allowMultiple: dropdownSource.allowMultiple === true,
          options,
        },
        channelId: cleanDiscordId(item?.channelId),
        publishedMessageId: cleanDiscordId(item?.publishedMessageId),
        createdAt,
        updatedAt: cleanTimestamp(item?.updatedAt, createdAt),
      };
    });
  return { items };
}

function assertAllowedFields(value, fields, label) {
  if (!isObject(value)) throw new ReactionRoleError(`${label} must be a JSON object.`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) throw new ReactionRoleError(`Unknown ${label.toLowerCase()} field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function assertInputShape(body, label, partial = false) {
  const fields = ['name', 'enabled', 'message', 'interactionType', 'buttons', 'dropdown', 'channelId', 'publishedMessageId'];
  assertAllowedFields(body, fields, label);
  if (body.name !== undefined && (!cleanText(body.name, REACTION_ROLE_LIMITS.name) || String(body.name).trim().length > REACTION_ROLE_LIMITS.name)) throw new ReactionRoleError(`Reaction Role name must be between 1 and ${REACTION_ROLE_LIMITS.name} characters.`);
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new ReactionRoleError('enabled must be true or false.');
  if (body.interactionType !== undefined && !['button', 'dropdown'].includes(body.interactionType)) throw new ReactionRoleError('interactionType must be button or dropdown.');
  if (body.message !== undefined) {
    assertAllowedFields(body.message, ['content', 'layout', 'additionalContainers', 'sourceTemplateId'], `${label} message`);
    if (body.message.layout !== undefined) assertAllowedFields(body.message.layout, ['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'], `${label} message layout`);
    if (body.message.additionalContainers !== undefined) {
      if (!Array.isArray(body.message.additionalContainers)) throw new ReactionRoleError('additionalContainers must be an array.');
      if (body.message.additionalContainers.length > REACTION_ROLE_LIMITS.additionalContainers) throw new ReactionRoleError(`Reaction Role messages support up to ${REACTION_ROLE_LIMITS.additionalContainers} additional containers.`);
      for (const [index, container] of body.message.additionalContainers.entries()) {
        assertAllowedFields(container, ['content', 'layout'], `${label} additional container ${index + 1}`);
        assertAllowedFields(container.layout, ['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'], `${label} additional container ${index + 1} layout`);
      }
    }
  }
  if (body.buttons !== undefined) {
    if (!Array.isArray(body.buttons)) throw new ReactionRoleError('buttons must be an array.');
    if (body.buttons.length > REACTION_ROLE_LIMITS.buttons) throw new ReactionRoleError(`Button mode supports up to ${REACTION_ROLE_LIMITS.buttons} buttons.`);
    for (const [index, button] of body.buttons.entries()) {
      assertAllowedFields(button, ['id', 'emoji', 'label', 'name', 'style', 'roleId', 'sortOrder'], `${label} button ${index + 1}`);
      if (button.emoji !== undefined) assertAllowedFields(button.emoji, ['id', 'name', 'animated', 'source'], `${label} button ${index + 1} emoji`);
      if (button.style !== undefined && !REACTION_ROLE_BUTTON_STYLES.includes(button.style) && !Object.values(BUTTON_STYLE_VALUES).includes(Number(button.style))) {
        throw new ReactionRoleError('Button style must be Primary, Secondary, Success, or Danger. Link and Premium buttons are not allowed.');
      }
    }
  }
  if (body.dropdown !== undefined) {
    assertAllowedFields(body.dropdown, ['placeholder', 'allowMultiple', 'options'], `${label} dropdown`);
    if (body.dropdown.options !== undefined) {
      if (!Array.isArray(body.dropdown.options)) throw new ReactionRoleError('dropdown.options must be an array.');
      if (body.dropdown.options.length > REACTION_ROLE_LIMITS.dropdownOptions) throw new ReactionRoleError(`Dropdown mode supports up to ${REACTION_ROLE_LIMITS.dropdownOptions} options.`);
      for (const [index, option] of body.dropdown.options.entries()) {
        assertAllowedFields(option, ['id', 'emoji', 'title', 'label', 'description', 'roleId', 'sortOrder'], `${label} dropdown option ${index + 1}`);
        if (option.emoji !== undefined) assertAllowedFields(option.emoji, ['id', 'name', 'animated', 'source'], `${label} dropdown option ${index + 1} emoji`);
      }
    }
  }
  if (!partial && body.name !== undefined && !cleanText(body.name, REACTION_ROLE_LIMITS.name)) throw new ReactionRoleError('Reaction Role name is required.');
}

function reactionRoleById(collection, id) {
  return collection.items.find((item) => item.id === String(id || '')) || null;
}

function validateReactionRoleTemplate(item, options = {}) {
  if (!item) throw new ReactionRoleError('Reaction Role template not found.', 404, 'REACTION_ROLE_NOT_FOUND');
  if (!cleanText(item.name, REACTION_ROLE_LIMITS.name)) throw new ReactionRoleError('Reaction Role name is required.');
  if (!['button', 'dropdown'].includes(item.interactionType)) throw new ReactionRoleError('Interaction type must be button or dropdown.');
  const entries = item.interactionType === 'button' ? item.buttons : item.dropdown.options;
  const limit = item.interactionType === 'button' ? REACTION_ROLE_LIMITS.buttons : REACTION_ROLE_LIMITS.dropdownOptions;
  if (entries.length > limit) throw new ReactionRoleError(`${item.interactionType === 'button' ? 'Buttons' : 'Dropdowns'} support up to ${limit} roles.`);
  if (options.forPublish && !entries.length) throw new ReactionRoleError('Add at least one role interaction before publishing.');
  const seenRoles = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry.roleId) throw new ReactionRoleError(`Choose a role for ${item.interactionType === 'button' ? 'button' : 'dropdown option'} ${index + 1}.`);
    if (seenRoles.has(entry.roleId)) throw new ReactionRoleError('Each role can be managed only once in a Reaction Role template.');
    seenRoles.add(entry.roleId);
    const customId = item.interactionType === 'button'
      ? reactionRoleButtonCustomId(item.id, entry.id)
      : reactionRoleSelectCustomId(item.id);
    if (customId.length > REACTION_ROLE_LIMITS.customId) throw new ReactionRoleError('An interaction custom ID exceeds Discord’s 100-character limit.');
  }
  if (options.forPublish && !item.channelId) throw new ReactionRoleError('Choose a destination channel before publishing.');
  buildReactionRolePayload(item, options.payloadOptions);
  return item;
}

function createReactionRoleTemplate(collection, body = {}, now = new Date()) {
  assertInputShape(body, 'Reaction Role');
  if (collection.items.length >= REACTION_ROLE_LIMITS.templates) throw new ReactionRoleError(`A server can have up to ${REACTION_ROLE_LIMITS.templates} Reaction Role templates.`);
  const timestamp = cleanTimestamp(now);
  const base = normalizeReactionRolesConfig({ items: [{
    id: nextId('rr'),
    name: body.name || `Reaction Roles ${collection.items.length + 1}`,
    enabled: body.enabled,
    message: body.message || clone(DEFAULT_REACTION_ROLE_MESSAGE),
    interactionType: body.interactionType,
    buttons: body.buttons,
    dropdown: body.dropdown,
    channelId: body.channelId,
    publishedMessageId: body.publishedMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }] }).items[0];
  validateReactionRoleTemplate(base);
  collection.items.push(base);
  return base;
}

function updateReactionRoleTemplate(collection, id, body, now = new Date()) {
  assertInputShape(body, 'Reaction Role update', true);
  const item = reactionRoleById(collection, id);
  if (!item) throw new ReactionRoleError('Reaction Role template not found.', 404, 'REACTION_ROLE_NOT_FOUND');
  const merged = clone(item);
  for (const field of ['name', 'enabled', 'interactionType', 'buttons', 'channelId', 'publishedMessageId']) {
    if (body[field] !== undefined) merged[field] = body[field];
  }
  if (body.message !== undefined) merged.message = { ...merged.message, ...body.message };
  if (body.dropdown !== undefined) merged.dropdown = { ...merged.dropdown, ...body.dropdown };
  merged.updatedAt = cleanTimestamp(now);
  const normalized = normalizeReactionRolesConfig({ items: [merged] }).items[0];
  normalized.id = item.id;
  normalized.createdAt = item.createdAt;
  validateReactionRoleTemplate(normalized);
  Object.assign(item, normalized);
  return item;
}

function duplicateReactionRoleTemplate(collection, id, now = new Date()) {
  const source = reactionRoleById(collection, id);
  if (!source) throw new ReactionRoleError('Reaction Role template not found.', 404, 'REACTION_ROLE_NOT_FOUND');
  const buttons = clone(source.buttons);
  const dropdown = clone(source.dropdown);
  buttons.forEach((button) => { delete button.id; });
  dropdown.options.forEach((option) => { delete option.id; });
  return createReactionRoleTemplate(collection, {
    name: `${source.name} copy`.slice(0, REACTION_ROLE_LIMITS.name),
    enabled: false,
    message: clone(source.message),
    interactionType: source.interactionType,
    buttons,
    dropdown,
    channelId: source.channelId,
    publishedMessageId: '',
  }, now);
}

function deleteReactionRoleTemplate(collection, id) {
  const index = collection.items.findIndex((item) => item.id === String(id || ''));
  if (index < 0) throw new ReactionRoleError('Reaction Role template not found.', 404, 'REACTION_ROLE_NOT_FOUND');
  return collection.items.splice(index, 1)[0];
}

function reactionRoleButtonCustomId(templateId, itemId) {
  return `${REACTION_ROLE_CUSTOM_ID_PREFIX}:${templateId}:button:${itemId}`;
}

function reactionRoleSelectCustomId(templateId) {
  return `${REACTION_ROLE_CUSTOM_ID_PREFIX}:${templateId}:select`;
}

function buttonActionRows(item) {
  const buttons = item.buttons.map((button) => {
    const component = {
      type: 2,
      style: BUTTON_STYLE_VALUES[button.style],
      custom_id: reactionRoleButtonCustomId(item.id, button.id),
      label: button.label,
    };
    const emoji = discordEmoji(button.emoji);
    if (emoji) component.emoji = emoji;
    return component;
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push({ type: 1, components: buttons.slice(index, index + 5) });
  return rows;
}

function dropdownActionRows(item) {
  if (!item.dropdown.options.length) return [];
  const options = item.dropdown.options.map((option) => {
    const component = { label: option.title, value: option.id };
    if (option.description) component.description = option.description;
    const emoji = discordEmoji(option.emoji);
    if (emoji) component.emoji = emoji;
    return component;
  });
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: reactionRoleSelectCustomId(item.id),
      placeholder: item.dropdown.placeholder,
      min_values: 1,
      max_values: item.dropdown.allowMultiple ? Math.min(25, options.length) : 1,
      options,
    }],
  }];
}

function buildReactionRolePayload(item, options = {}) {
  const values = options.values || {};
  const message = normalizeMessage(item?.message);
  const payload = componentMessagePayload(
    interpolateTemplate(message.content, values),
    resolvedLayout(message.layout, values),
    {
      label: item?.name || 'Reaction Roles',
      fallbackText: '-# Choose a role',
      additionalContainers: message.additionalContainers.map((container) => ({
        content: interpolateTemplate(container.content, values),
        layout: resolvedLayout(container.layout, values),
      })),
      allowedUsers: [],
    },
  );
  const rows = item?.interactionType === 'dropdown' ? dropdownActionRows(item) : buttonActionRows(item || { buttons: [] });
  return appendValidatedInteractionActionRows(payload, rows);
}

function configuredRoleIds(item) {
  return [...new Set((item.interactionType === 'dropdown' ? item.dropdown.options : item.buttons).map((entry) => entry.roleId).filter(Boolean))];
}

async function fetchGuildRoles(guild) {
  const roles = guild?.roles?.fetch
    ? await guild.roles.fetch().catch(() => guild?.roles?.cache)
    : guild?.roles?.cache;
  const botMember = guild?.members?.me || (guild?.members?.fetchMe
    ? await guild.members.fetchMe().catch(() => null)
    : null);
  return { roles: roles || new Map(), botMember };
}

function roleSafety(role, guild, botMember) {
  if (!role || role.id === guild?.id) return { ok: false, reason: 'The role no longer exists.' };
  if (role.managed) return { ok: false, reason: 'Managed and integration roles cannot be assigned.' };
  if (role.permissions?.has?.(PermissionFlagsBits.Administrator)) return { ok: false, reason: 'Administrator roles cannot be self-assigned.' };
  if (role.editable === false) return { ok: false, reason: 'The role is above CoinSprite in the role hierarchy.' };
  const highest = botMember?.roles?.highest;
  if (highest && typeof role.comparePositionTo === 'function' && role.comparePositionTo(highest) >= 0) {
    return { ok: false, reason: 'The role is above CoinSprite in the role hierarchy.' };
  }
  return { ok: true, reason: '' };
}

async function validateReactionRoleRoles(item, guild, options = {}) {
  const ids = configuredRoleIds(item);
  const { roles, botMember } = await fetchGuildRoles(guild);
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    throw new ReactionRoleError('CoinSprite needs the Manage Roles permission.', 403, 'MISSING_MANAGE_ROLES');
  }
  const valid = new Map();
  const invalid = [];
  for (const id of ids) {
    const role = roles?.get?.(id) || null;
    const safety = roleSafety(role, guild, botMember);
    if (safety.ok) valid.set(id, role);
    else invalid.push({ id, reason: safety.reason });
  }
  if (invalid.length && options.allowPartial !== true) {
    throw new ReactionRoleError(`One or more roles cannot be assigned: ${invalid.map((entry) => entry.reason).join(' ')}`, 400, 'UNASSIGNABLE_ROLE');
  }
  return { valid, invalid, botMember };
}

async function resolveReactionRoleChannel(guild, channelId) {
  if (!cleanDiscordId(channelId)) return null;
  const cached = guild?.channels?.cache?.get?.(channelId);
  if (cached) return cached;
  return guild?.channels?.fetch ? await guild.channels.fetch(channelId).catch(() => null) : null;
}

async function publishReactionRoleTemplate(item, guild, options = {}) {
  validateReactionRoleTemplate(item, { forPublish: true });
  const channel = await resolveReactionRoleChannel(guild, item.channelId);
  if (!channel) throw new ReactionRoleError('The selected destination channel no longer exists.', 400, 'MISSING_CHANNEL');
  const permissions = await deliveryPermissions(channel, guild);
  if (!permissions.ok) throw new ReactionRoleError(`CoinSprite is missing ${permissions.missing.join(', ')} in that channel.`, 403, 'MISSING_CHANNEL_PERMISSIONS');
  await validateReactionRoleRoles(item, guild);
  const payload = buildReactionRolePayload(item, { values: genericTemplateValues(guild, channel, options.nowMs) });
  let message = null;
  let updated = false;
  if (item.publishedMessageId) {
    message = await channel.messages?.fetch?.(item.publishedMessageId).catch(() => null);
    if (message?.edit) {
      try {
        message = await message.edit(payload);
        updated = true;
      } catch {
        message = null;
      }
    }
  }
  if (!message) {
    try { message = await channel.send(payload); }
    catch { throw new ReactionRoleError('Discord rejected the Reaction Role message. Check the channel permissions and try again.', 502, 'PUBLISH_FAILED'); }
  }
  return { channel, message, payload, updated };
}

function parseReactionRoleCustomId(value) {
  const text = String(value || '');
  if (!text.startsWith(`${REACTION_ROLE_CUSTOM_ID_PREFIX}:`) || text.length > REACTION_ROLE_LIMITS.customId) return null;
  let match = text.match(/^rr:([a-zA-Z0-9_-]{8,64}):button:([a-zA-Z0-9_-]{8,64})$/);
  if (match) return { templateId: match[1], type: 'button', itemId: match[2] };
  match = text.match(/^rr:([a-zA-Z0-9_-]{8,64}):select$/);
  return match ? { templateId: match[1], type: 'dropdown', itemId: '' } : null;
}

async function ephemeral(interaction, content) {
  const payload = { content, allowedMentions: { parse: [], users: [], roles: [] } };
  if (interaction.deferred || interaction.replied) return interaction.editReply?.(payload);
  return interaction.reply?.({ ...payload, flags: EPHEMERAL });
}

async function deferEphemeral(interaction) {
  if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === 'function') {
    await interaction.deferReply({ flags: EPHEMERAL });
  }
}

function memberHasRole(member, roleId) {
  return Boolean(member?.roles?.cache?.has?.(roleId));
}

async function addMemberRole(member, role) {
  await member.roles?.add?.(role);
}

async function removeMemberRole(member, role) {
  await member.roles?.remove?.(role);
}

function mentions(roles) {
  return roles.map((role) => `<@&${role.id}>`).join(', ');
}

async function handleReactionRoleInteraction(interaction, options = {}) {
  const parsed = parseReactionRoleCustomId(interaction?.customId);
  if (!parsed) return false;
  const getConfig = options.getGuildConfigRaw || require('./serverConfig').getGuildConfigRaw;
  const config = getConfig(interaction.guildId);
  const item = reactionRoleById(normalizeReactionRolesConfig(config?.reactionRoles), parsed.templateId);
  if (!item || !item.enabled) {
    await ephemeral(interaction, 'This Reaction Role message is no longer active.');
    return true;
  }
  if (String(interaction.channelId || '') !== item.channelId || String(interaction.message?.id || '') !== item.publishedMessageId) {
    await ephemeral(interaction, 'This Reaction Role control is no longer attached to the published message.');
    return true;
  }
  await deferEphemeral(interaction);
  const guild = interaction.guild;
  const memberId = interaction.user?.id || interaction.member?.id;
  const fetchedMember = guild?.members?.fetch ? await guild.members.fetch(memberId).catch(() => null) : null;
  const member = fetchedMember || interaction.member;
  if (!member) {
    await ephemeral(interaction, 'You are no longer a member of this server.');
    return true;
  }
  let roleCheck;
  try { roleCheck = await validateReactionRoleRoles(item, guild, { allowPartial: true }); }
  catch (error) {
    await ephemeral(interaction, error.message || 'CoinSprite cannot manage roles right now.');
    return true;
  }

  const given = [];
  const removed = [];
  const invalidIds = new Set(roleCheck.invalid.map((entry) => entry.id));
  if (parsed.type === 'button') {
    const button = item.buttons.find((entry) => entry.id === parsed.itemId);
    if (!button) {
      await ephemeral(interaction, 'That role button no longer exists.');
      return true;
    }
    if (invalidIds.has(button.roleId)) {
      await ephemeral(interaction, roleCheck.invalid.find((entry) => entry.id === button.roleId)?.reason || 'That role can no longer be assigned.');
      return true;
    }
    const role = roleCheck.valid.get(button.roleId);
    if (memberHasRole(member, role.id)) {
      await removeMemberRole(member, role);
      removed.push(role);
    } else {
      await addMemberRole(member, role);
      given.push(role);
    }
  } else {
    const selectedIds = new Set(Array.isArray(interaction.values) ? interaction.values : []);
    const selectedOptions = item.dropdown.options.filter((option) => selectedIds.has(option.id));
    if (!selectedOptions.length || (!item.dropdown.allowMultiple && selectedOptions.length !== 1)) {
      await ephemeral(interaction, 'Choose a valid role option.');
      return true;
    }
    const selectedRoleIds = new Set(selectedOptions.map((option) => option.roleId));
    for (const option of item.dropdown.options) {
      if (invalidIds.has(option.roleId)) continue;
      const role = roleCheck.valid.get(option.roleId);
      const shouldHave = selectedRoleIds.has(option.roleId);
      const hasRole = memberHasRole(member, option.roleId);
      if (shouldHave && !hasRole) { await addMemberRole(member, role); given.push(role); }
      if (!shouldHave && hasRole) { await removeMemberRole(member, role); removed.push(role); }
    }
  }

  let confirmation = 'Your roles are already up to date.';
  if (given.length && removed.length) confirmation = `Roles updated — Given: ${mentions(given)} · Removed: ${mentions(removed)}`;
  else if (given.length) confirmation = `${given.length === 1 ? 'Role given' : 'Roles given'}: ${mentions(given)}`;
  else if (removed.length) confirmation = `${removed.length === 1 ? 'Role removed' : 'Roles removed'}: ${mentions(removed)}`;
  if (roleCheck.invalid.length) confirmation += ` · ${roleCheck.invalid.length} unavailable configured role${roleCheck.invalid.length === 1 ? '' : 's'} skipped.`;
  await ephemeral(interaction, confirmation);
  (options.log || require('./commandLogger').logCommandSystem)(`Reaction Roles ${item.id} updated member ${member.id || interaction.user?.id || 'unknown'} in guild ${interaction.guildId}.`);
  return true;
}

module.exports = {
  BUTTON_STYLE_VALUES,
  DEFAULT_REACTION_ROLES_CONFIG,
  REACTION_ROLE_BUTTON_STYLES,
  REACTION_ROLE_CUSTOM_ID_PREFIX,
  REACTION_ROLE_LIMITS,
  ReactionRoleError,
  buildReactionRolePayload,
  configuredRoleIds,
  createReactionRoleTemplate,
  deleteReactionRoleTemplate,
  discordEmoji,
  duplicateReactionRoleTemplate,
  fetchGuildRoles,
  handleReactionRoleInteraction,
  normalizeReactionRoleEmoji,
  normalizeReactionRolesConfig,
  parseReactionRoleCustomId,
  publishReactionRoleTemplate,
  reactionRoleButtonCustomId,
  reactionRoleById,
  reactionRoleSelectCustomId,
  roleSafety,
  updateReactionRoleTemplate,
  validateReactionRoleRoles,
  validateReactionRoleTemplate,
};
