const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  getEnabledGuildIds,
  getGuildConfig,
  isGuildGag2StockEnabled,
} = require('../serverConfig');
const {
  COMPONENTS_V2_FLAG,
  GREEN,
  STATE_PATH,
} = require('./config');
const {
  SHECKLES_EMOJI,
  customEmojiImageUrl,
  emojiForType,
  roleSpecsForType,
} = require('./catalog');
const { loadState, saveState } = require('./stateStore');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xFFFFFF;
const RED = 0xed4245;
const NO_MENTIONS = { parse: [], users: [], roles: [] };
const ROLE_ASSIGN_CHANNEL_KEY = 'roleAssign';
const ROLE_ASSIGN_TYPES = ['seed', 'gear', 'crate', 'weather', 'sell'];
const CUSTOM_ID_PREFIX = 'gag2role';
const MAX_SELECT_OPTIONS = 25;

const ROLE_ASSIGN_LABELS = {
  seed: 'Seed',
  gear: 'Gear',
  crate: 'Crate',
  weather: 'Weather',
  sell: 'Sell price',
};

const THUMBNAIL_KEYS = {
  seed: ['seed', 'carrot'],
  gear: ['gear', 'common_sprinkler'],
  crate: ['crate', 'boombox_crate'],
  weather: ['weather', 'goldmoon'],
};

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function assignmentBucket(state) {
  state.roleAssignmentPanels ||= {};
  return state.roleAssignmentPanels;
}

function categoryLabel(type) {
  return ROLE_ASSIGN_LABELS[type] || type || 'Role';
}

function isCategoryBound(config, type) {
  return Boolean(cleanDiscordId(config?.gag2Stock?.channels?.[type]));
}

function roleAssignmentChannelId(config) {
  return cleanDiscordId(config?.gag2Stock?.channels?.[ROLE_ASSIGN_CHANNEL_KEY]);
}

async function getSendableChannel(client, channelId) {
  const id = cleanDiscordId(channelId);
  if (!id) return null;
  const channel = client?.channels?.cache?.get?.(id) || await client?.channels?.fetch?.(id).catch(() => null);
  const textBased = typeof channel?.isTextBased === 'function' ? channel.isTextBased() : channel?.isTextBased !== false;
  return textBased && typeof channel?.send === 'function' ? channel : null;
}

function parseComponentEmoji(emoji) {
  const text = String(emoji || '').trim();
  if (!text) return undefined;
  const match = text.match(/^<a?:([a-z0-9_]+):(\d{16,20})>$/i);
  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: text.startsWith('<a:'),
    };
  }
  return { name: text };
}

function chunkOptions(options) {
  const chunks = [];
  for (let index = 0; index < options.length; index += MAX_SELECT_OPTIONS) {
    chunks.push(options.slice(index, index + MAX_SELECT_OPTIONS));
  }
  return chunks;
}

function categoryThumbnailUrl(type) {
  if (type === 'sell') return customEmojiImageUrl(SHECKLES_EMOJI);
  const [catalogType, key] = THUMBNAIL_KEYS[type] || [];
  return customEmojiImageUrl(emojiForType(catalogType, { key }));
}

function roleOptionsForCategory(config, type, roles = null) {
  const roleIds = config?.gag2Stock?.roleIds?.[type] || {};
  return roleSpecsForType(type)
    .map((spec) => ({
      ...spec,
      roleId: cleanDiscordId(roleIds[spec.key]),
    }))
    .filter((spec) => spec.roleId && (!roles || roles.has(spec.roleId)));
}

async function fetchGuildRoles(guild) {
  return await guild?.roles?.fetch?.().catch(() => null) || guild?.roles?.cache || null;
}

async function roleOptionsForGuildCategory(guild, config, type) {
  return roleOptionsForCategory(config, type, await fetchGuildRoles(guild));
}

function assignedRoleMentions(member, options) {
  const memberRoles = member?.roles?.cache;
  if (!memberRoles) return [];
  return options
    .filter((option) => memberRoles.has(option.roleId))
    .map((option) => `<@&${option.roleId}>`);
}

function buildSelectRows(type, options, disabled = false) {
  return chunkOptions(options).map((chunk, index, chunks) => ({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `${CUSTOM_ID_PREFIX}:select:${type}:${index}`,
        placeholder: chunks.length > 1 ? `Select roles (${index + 1}/${chunks.length})` : 'Select roles',
        min_values: 1,
        max_values: Math.min(MAX_SELECT_OPTIONS, chunk.length),
        disabled,
        options: chunk.map((option) => {
          const menuOption = {
            label: option.roleName,
            value: option.key,
          };
          const emoji = parseComponentEmoji(option.emoji);
          if (emoji) menuOption.emoji = emoji;
          return menuOption;
        }),
      },
    ],
  }));
}

function messageFlags(ephemeral = false) {
  return COMPONENTS_V2_FLAG | (ephemeral ? EPHEMERAL_FLAG : 0);
}

function buildRoleAssignmentPanelPayload(config) {
  return {
    allowedMentions: NO_MENTIONS,
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: WHITE,
        components: [
          {
            type: 10,
            content: [
              '## Role assignment',
              '* Get role notifications here!',
            ].join('\n'),
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: ROLE_ASSIGN_TYPES.map((type) => ({
              type: 2,
              custom_id: `${CUSTOM_ID_PREFIX}:open:${type}`,
              label: categoryLabel(type),
              style: 2,
              disabled: !isCategoryBound(config, type),
            })),
          },
        ],
      },
    ],
  };
}

function buildCategoryUnavailablePayload(type, message, ephemeral = true) {
  return {
    allowedMentions: NO_MENTIONS,
    flags: messageFlags(ephemeral),
    components: [
      {
        type: 17,
        accent_color: RED,
        components: [
          {
            type: 10,
            content: [
              `## ${categoryLabel(type)} roles`,
              `-# ${message}`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

async function buildCategoryRolePayload(guild, member, config, type, options = {}) {
  const roleOptions = await roleOptionsForGuildCategory(guild, config, type);
  const assigned = assignedRoleMentions(member, roleOptions);
  const assignedText = assigned.length ? assigned.join(' ') : 'N/A';
  const statusLine = options.status ? `-# ${options.status}` : '';
  const content = [
    `## ${categoryLabel(type)} roles`,
    `-# Assigned roles: ${assignedText}`,
    statusLine,
  ].filter(Boolean).join('\n');
  const thumbnailUrl = categoryThumbnailUrl(type);
  const firstComponent = thumbnailUrl
    ? {
      type: 9,
      components: [{ type: 10, content }],
      accessory: { type: 11, media: { url: thumbnailUrl } },
    }
    : { type: 10, content };
  const panelComponents = [firstComponent, { type: 14, divider: true, spacing: 1 }];
  const rows = buildSelectRows(type, roleOptions, Boolean(options.disabled));
  if (rows.length) {
    panelComponents.push(...rows);
  } else {
    panelComponents.push({
      type: 10,
      content: '-# No roles are available for this category yet.',
    });
  }

  return {
    allowedMentions: NO_MENTIONS,
    flags: messageFlags(Boolean(options.ephemeral)),
    components: [
      {
        type: 17,
        accent_color: GREEN,
        components: panelComponents,
      },
    ],
  };
}

async function deleteStoredPanel(client, record, guildId) {
  const channel = await getSendableChannel(client, record?.channelId);
  if (!channel || !record?.messageId) return false;
  const message = await channel.messages?.fetch?.(record.messageId).catch(() => null);
  if (!message) return false;
  return await message.delete().then(() => true).catch((error) => {
    logCommandSystem(`GAG2 role assignment panel delete failed in guild ${guildId}: ${error?.message || 'unknown error'}`);
    return false;
  });
}

async function syncGag2RoleAssignmentPanel(client, guildId, options = {}) {
  const statePath = options.statePath || STATE_PATH;
  const state = loadState(statePath);
  const bucket = assignmentBucket(state);
  const record = bucket[guildId] || {};
  const config = getGuildConfig(guildId);
  const channelId = isGuildGag2StockEnabled(guildId) ? roleAssignmentChannelId(config) : '';

  if (!channelId) {
    await deleteStoredPanel(client, record, guildId);
    delete bucket[guildId];
    saveState(state, statePath);
    return null;
  }

  const channel = await getSendableChannel(client, channelId);
  if (!channel) return null;

  if (record.channelId && record.channelId !== channelId) {
    await deleteStoredPanel(client, record, guildId);
  }

  const payload = buildRoleAssignmentPanelPayload(config);
  let message = null;
  if (record.channelId === channelId && record.messageId) {
    const existing = await channel.messages?.fetch?.(record.messageId).catch(() => null);
    message = await existing?.edit?.(payload).catch((error) => {
      logCommandSystem(`GAG2 role assignment panel edit failed in guild ${guildId}: ${error?.message || 'unknown error'}`);
      return null;
    });
  }
  if (!message) message = await channel.send(payload);

  bucket[guildId] = {
    channelId,
    messageId: message.id,
    updatedAt: new Date().toISOString(),
  };
  saveState(state, statePath);
  return message;
}

async function syncAllGag2RoleAssignmentPanels(client, options = {}) {
  for (const guildId of getEnabledGuildIds()) {
    await syncGag2RoleAssignmentPanel(client, guildId, options).catch((error) => {
      logCommandSystem(`GAG2 role assignment panel sync failed for guild ${guildId}: ${error?.message || 'unknown error'}`);
    });
  }
}

function parseCustomId(customId) {
  const parts = String(customId || '').split(':');
  if (parts[0] !== CUSTOM_ID_PREFIX) return null;
  return {
    action: parts[1] || '',
    type: parts[2] || '',
    page: parts[3] || '',
  };
}

function categoryIsSelectable(type) {
  return ROLE_ASSIGN_TYPES.includes(type);
}

async function memberForInteraction(interaction) {
  return await interaction.guild?.members?.fetch?.(interaction.user.id).catch(() => null)
    || interaction.member
    || null;
}

async function replyUnavailable(interaction, type, message) {
  const payload = buildCategoryUnavailablePayload(type, message, true);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload).catch(() => null);
  return interaction.reply(payload).catch(() => null);
}

async function handleOpenCategory(interaction, type) {
  const config = getGuildConfig(interaction.guildId);
  if (!isGuildGag2StockEnabled(interaction.guildId) || !config) {
    await replyUnavailable(interaction, type, 'GAG2 stock is not enabled for this server.');
    return true;
  }
  if (!isCategoryBound(config, type)) {
    await replyUnavailable(interaction, type, 'This category is not connected to a stock channel right now.');
    return true;
  }
  const member = await memberForInteraction(interaction);
  await interaction.reply(await buildCategoryRolePayload(interaction.guild, member, config, type, { ephemeral: true }));
  return true;
}

async function handleSelectCategory(interaction, type) {
  const config = getGuildConfig(interaction.guildId);
  if (!isGuildGag2StockEnabled(interaction.guildId) || !config || !isCategoryBound(config, type)) {
    await interaction.update(buildCategoryUnavailablePayload(type, 'This category is no longer connected to a stock channel.', false)).catch(() => null);
    return true;
  }

  const member = await memberForInteraction(interaction);
  if (!member?.roles?.cache) {
    await interaction.update(buildCategoryUnavailablePayload(type, 'Could not read your server roles. Try again in a moment.', false)).catch(() => null);
    return true;
  }
  const roleOptions = await roleOptionsForGuildCategory(interaction.guild, config, type);
  const byKey = new Map(roleOptions.map((option) => [option.key, option]));
  const selected = [...new Set((interaction.values || []).map((value) => String(value || '').trim()).filter(Boolean))]
    .map((key) => byKey.get(key))
    .filter(Boolean);

  await interaction.update(await buildCategoryRolePayload(interaction.guild, member, config, type, {
    disabled: true,
    status: `Assigning ${selected.length} roles`,
  }));

  const me = interaction.guild?.members?.me || await interaction.guild?.members?.fetchMe?.().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    await interaction.editReply(await buildCategoryRolePayload(interaction.guild, member, config, type, {
      status: 'The bot needs Manage Roles permission to update notification roles.',
    })).catch(() => null);
    return true;
  }

  let failed = 0;
  for (const option of selected) {
    const hasRole = member?.roles?.cache?.has?.(option.roleId);
    const action = hasRole
      ? member.roles.remove(option.roleId, 'CoinSprite GAG2 role assignment')
      : member.roles.add(option.roleId, 'CoinSprite GAG2 role assignment');
    await action.catch((error) => {
      failed += 1;
      logCommandSystem(`GAG2 role assignment ${hasRole ? 'remove' : 'add'} failed in guild ${interaction.guildId} (${option.roleName}): ${error?.message || 'unknown error'}`);
    });
  }

  const updatedMember = await memberForInteraction(interaction);
  await interaction.editReply(await buildCategoryRolePayload(interaction.guild, updatedMember, getGuildConfig(interaction.guildId) || config, type, {
    status: failed ? `${failed} role updates failed. Check the bot role position.` : '',
  })).catch(() => null);
  return true;
}

async function handleGag2RoleAssignmentInteraction(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (!interaction.inGuild?.()) {
    if (interaction.isRepliable?.()) await interaction.reply({ content: 'Role assignment only works inside a server.', flags: EPHEMERAL_FLAG }).catch(() => null);
    return true;
  }
  if (!categoryIsSelectable(parsed.type)) {
    if (interaction.isRepliable?.()) await replyUnavailable(interaction, parsed.type || 'Role', 'This role category is not available.');
    return true;
  }
  if (parsed.action === 'open' && interaction.isButton?.()) return handleOpenCategory(interaction, parsed.type);
  if (parsed.action === 'select' && interaction.isStringSelectMenu?.()) return handleSelectCategory(interaction, parsed.type);
  return true;
}

module.exports = {
  ROLE_ASSIGN_CHANNEL_KEY,
  ROLE_ASSIGN_TYPES,
  buildCategoryRolePayload,
  buildRoleAssignmentPanelPayload,
  handleGag2RoleAssignmentInteraction,
  syncAllGag2RoleAssignmentPanels,
  syncGag2RoleAssignmentPanel,
};
