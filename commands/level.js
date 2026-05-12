const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');
const { LEVEL_ROLE_REWARDS, getEligibleRoleIds } = require('../src/levelRoleRewards');

const execFileAsync = promisify(execFile);
const LEVEL_UP_CHANNEL_ID = '1493909588775272448';
const LOW_XP_CATEGORY_ID = '1498006922912202948';
const BACKGROUND_LOG_THREAD_ID = '1502296881395536033';
const LOW_XP_AMOUNT = 0.5;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const BUTTON_STYLE_SECONDARY = 2;
const CARD_BACKGROUND_WIDTH = 740;
const CARD_BACKGROUND_HEIGHT = 278;
const DECORATE_PREFIX = 'level:decorate:';
const COLOR_PREFIX = 'level:color:';
const BACKGROUND_PREFIX = 'level:background:';
const COLOR_MODAL_PREFIX = 'level:color-modal:';
const BACKGROUND_MODAL_PREFIX = 'level:background-modal:';
const BACKGROUND_UPLOAD_ID = 'level_card_background_upload';
const ACCEPTED_BACKGROUND_IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.ico',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.pjp',
  '.pjpeg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);
const COLOR_FIELD_IDS = {
  usernameFillColor: 'level_card_username_fill_color',
  lineFillColor: 'level_card_line_fill_color',
  progressBarFillColor: 'level_card_progress_bar_fill_color',
  numberFillColor: 'level_card_number_fill_color',
};
const COLOR_PLACEHOLDER = 'Gradient: 255,0,0-10%;0,0,255-90%. RGB or Hex. Leave empty for no change.';
const LEVEL_FUN_MESSAGES = new Map([
  [5, 'Bro discovered the chat button.'],
  [10, 'Double digits? Okay, yapper training complete.'],
  [15, 'Slowly becoming a professional keyboard warrior.'],
  [20, 'Hydrate before the next yap session.'],
  [30, 'Chat activity detected. Grass not detected.'],
  [40, 'At this point, the keyboard fears you.'],
  [50, 'Halfway to “please go outside.”'],
  [60, 'The yap grind is getting concerning.'],
  [70, 'Bro is not chatting anymore, bro is farming XP.'],
  [80, 'Scientists are studying this level of activity.'],
  [90, 'So close to Level 100, your keyboard is crying.'],
  [100, 'Someone give them grass… or a trophy.'],
]);
function formatCountdown(endsAt) {
  if (!endsAt) return null;
  return `<t:${Math.floor(endsAt / 1000)}:R>`;
}

function punishmentNotice(summary) {
  const countdown = formatCountdown(summary.endsAt);
  if (summary.tier === 1) return `⚠️ You're earning 500% less XP, punishment ends ${countdown}.`;
  if (summary.tier === 2) return `⚠️ You're earning 1000% less XP, punishment ends ${countdown}.`;
  if (summary.tier === 3) return `⚠️ XP blacklisted, punishment ends ${countdown}.`;
  return null;
}

async function syncLevelRoles(guild, userId, level) {
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const eligibleRoleIds = getEligibleRoleIds(level);
  for (const roleId of eligibleRoleIds) {
    if (!member.roles.cache.has(roleId)) {
      // eslint-disable-next-line no-await-in-loop
      await member.roles.add(roleId).catch(() => null);
    }
  }
}

async function sendLevelUpMessage(guild, userId, newLevel) {
  await syncLevelRoles(guild, userId, newLevel);

  const channel = guild.channels.cache.get(LEVEL_UP_CHANNEL_ID)
    || await guild.channels.fetch(LEVEL_UP_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const funMessage = LEVEL_FUN_MESSAGES.get(newLevel) ? `\n${LEVEL_FUN_MESSAGES.get(newLevel)}` : '';
  const levelMessage = `<@${userId}> has leveled up to level ${newLevel}!${funMessage}`;

  await channel.send({
    allowedMentions: { users: [userId] },
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x57F287,
        components: [{ type: 10, content: levelMessage }],
      },
    ],
  });
}

async function handleLevelUpRange(guild, userId, oldLevel, newLevel) {
  if (!Number.isFinite(oldLevel) || !Number.isFinite(newLevel)) return;

  await syncLevelRoles(guild, userId, newLevel);

  if (newLevel <= oldLevel) return;
  for (let level = oldLevel + 1; level <= newLevel; level += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendLevelUpMessage(guild, userId, level);
  }
}

function isChannelInLowXpCategory(channel) {
  if (!channel) return false;
  if (channel.parentId === LOW_XP_CATEGORY_ID) return true;
  if (channel.isThread?.()) return channel.parent?.parentId === LOW_XP_CATEGORY_ID;
  return false;
}

function buildDecorationButtonRow(userId, mode = 'closed') {
  if (mode === 'open') {
    return [{
      type: 1,
      components: [
        { type: 2, custom_id: `${COLOR_PREFIX}${userId}`, label: 'Change color', style: BUTTON_STYLE_SECONDARY },
        { type: 2, custom_id: `${BACKGROUND_PREFIX}${userId}`, label: 'Change background', style: BUTTON_STYLE_SECONDARY },
      ],
    }];
  }

  return [{
    type: 1,
    components: [{ type: 2, custom_id: `${DECORATE_PREFIX}${userId}`, label: 'Edit Decoration', style: BUTTON_STYLE_SECONDARY }],
  }];
}

function assertOwner(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  interaction.reply({ content: 'Only the owner of this rank card can edit its decoration.', flags: EPHEMERAL_FLAG }).catch(() => null);
  return false;
}

function getColorModal(userId) {
  const field = (key, label) => ({
    type: 1,
    components: [{
      type: 4,
      custom_id: COLOR_FIELD_IDS[key],
      label,
      style: 2,
      required: false,
      placeholder: COLOR_PLACEHOLDER,
      max_length: 250,
    }],
  });

  return {
    custom_id: `${COLOR_MODAL_PREFIX}${userId}`,
    title: 'Change rank card colors',
    components: [
      field('usernameFillColor', 'Username fill color'),
      field('lineFillColor', 'Line fill color'),
      field('progressBarFillColor', 'Progress bar fill color'),
      field('numberFillColor', 'Number fill color'),
    ],
  };
}

function getBackgroundModal(userId) {
  return {
    custom_id: `${BACKGROUND_MODAL_PREFIX}${userId}`,
    title: 'Change rank card background',
    components: [{
      type: 18,
      label: 'Upload an image file',
      description: 'Upload any image type (JPG, PNG, GIF, WebP, etc.); the bot saves it as 740x278 PNG.',
      component: {
        type: 19,
        custom_id: BACKGROUND_UPLOAD_ID,
        min_values: 1,
        max_values: 1,
        required: true,
      },
    }],
  };
}

function getSubmittedComponent(interaction, customId) {
  const stack = [...(interaction.components ?? interaction?.data?.components ?? [])];
  while (stack.length) {
    const item = stack.shift();
    const component = item?.component ?? item;
    if (component?.custom_id === customId || component?.customId === customId) return component;
    if (Array.isArray(item?.components)) stack.push(...item.components);
    if (Array.isArray(component?.components)) stack.push(...component.components);
  }
  return null;
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [value];
}

function getCollectionItem(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === 'function') return collection.get(id) ?? null;
  return collection[id] ?? null;
}

function getResolvedAttachment(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments
    ?? interaction?.resolved?.attachments
    ?? interaction?.fields?.resolved?.attachments
    ?? null;
  return getCollectionItem(resolved, id);
}

function getBackgroundUpload(interaction) {
  if (typeof interaction?.fields?.getUploadedFiles === 'function') {
    const fromFields = collectionToArray(interaction.fields.getUploadedFiles(BACKGROUND_UPLOAD_ID));
    if (fromFields.length > 0) return fromFields[0];
  }

  const component = getSubmittedComponent(interaction, BACKGROUND_UPLOAD_ID);
  const fromComponent = collectionToArray(component?.attachments);
  if (fromComponent.length > 0) return fromComponent[0];

  const values = component?.values ?? component?.value ?? [];
  const ids = Array.isArray(values) ? values : [values];
  for (const id of ids) {
    const attachment = getResolvedAttachment(interaction, id);
    if (attachment) return attachment;
  }

  return Array.from(interaction?.attachments?.values?.() ?? [])[0] ?? null;
}

function getAttachmentUrl(attachment) {
  return attachment?.url || attachment?.attachment || null;
}

function getAttachmentFilename(attachment) {
  return attachment?.name || attachment?.filename || 'rank-card-background.png';
}

function getAttachmentContentType(attachment) {
  return String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
}

function getAttachmentExtension(attachment) {
  const filename = getAttachmentFilename(attachment);
  const fromName = path.extname(filename.split('?')[0]).toLowerCase();
  if (fromName) return fromName;

  const url = getAttachmentUrl(attachment);
  if (!url) return '';
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return path.extname(String(url).split('?')[0]).toLowerCase();
  }
}

function isImageUpload(attachment) {
  const contentType = getAttachmentContentType(attachment);
  if (contentType.startsWith('image/')) return true;

  const extension = getAttachmentExtension(attachment);
  return ACCEPTED_BACKGROUND_IMAGE_EXTENSIONS.has(extension);
}

async function getRankCardPayload(guild, user) {
  const leaderboard = manager.getSortedLeaderboard(guild.id);
  const entry = leaderboard.find((row) => row.userId === user.id);
  const rank = Math.max(1, leaderboard.findIndex((row) => row.userId === user.id) + 1);
  const stats = manager.getProgress(entry?.totalXp || 0);
  await syncLevelRoles(guild, user.id, stats.level);
  const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
  const attachment = await manager.buildLevelCard({
    guildId: guild.id,
    userId: user.id,
    username: user.username,
    avatarUrl,
    rank,
    stats,
  });
  return { attachment, stats };
}

function getNonEmptyColorChanges(interaction) {
  const changes = {};
  for (const [key, fieldId] of Object.entries(COLOR_FIELD_IDS)) {
    const value = interaction.fields.getTextInputValue(fieldId)?.trim();
    if (value) changes[key] = value;
  }
  return changes;
}

async function optimizePng(filePath) {
  try {
    await execFileAsync('oxipng', ['-o', '4', '--strip', 'safe', filePath], { timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

async function saveUploadedBackground(interaction, upload) {
  const url = getAttachmentUrl(upload);
  if (!url) throw new Error('The uploaded file could not be read.');

  const response = await fetch(url);
  if (!response.ok) throw new Error('The uploaded image could not be downloaded.');
  const responseType = String(response.headers.get('content-type') || '').toLowerCase();
  if (responseType && !responseType.startsWith('image/') && responseType !== 'application/octet-stream' && !isImageUpload(upload)) {
    throw new Error('Please upload an image file, not a document or archive.');
  }

  const inputBuffer = Buffer.from(await response.arrayBuffer());
  let image;
  try {
    image = await loadImage(inputBuffer);
  } catch {
    throw new Error('That image file type could not be decoded. Please try JPG, PNG, GIF, WebP, SVG, BMP, TIFF, AVIF, or HEIC/HEIF.');
  }

  if (!image.width || !image.height) throw new Error('The uploaded image has invalid dimensions.');

  const canvas = createCanvas(CARD_BACKGROUND_WIDTH, CARD_BACKGROUND_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, CARD_BACKGROUND_WIDTH, CARD_BACKGROUND_HEIGHT);
  const scale = Math.max(CARD_BACKGROUND_WIDTH / image.width, CARD_BACKGROUND_HEIGHT / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const drawX = (CARD_BACKGROUND_WIDTH - drawW) / 2;
  const drawY = (CARD_BACKGROUND_HEIGHT - drawH) / 2;
  ctx.drawImage(image, drawX, drawY, drawW, drawH);

  const filePath = manager.getUserCardBackgroundPath(interaction.user.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  const optimized = await optimizePng(filePath);
  return { filePath, optimized };
}

async function logBackgroundUpload(interaction, filePath, optimized) {
  const channel = await interaction.guild.channels.fetch(BACKGROUND_LOG_THREAD_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    content: `Rank card background updated by <@${interaction.user.id}> (${interaction.user.id}). PNG optimization: ${optimized ? 'oxipng applied' : 'oxipng unavailable/skipped'}.`,
    files: [{ attachment: filePath, name: `${interaction.user.id}-rank-card-background.png` }],
  }).catch(() => null);
}

async function editRankCardMessage(interaction, mode = 'open') {
  if (typeof interaction.deferUpdate === 'function' && !interaction.replied && !interaction.deferred) {
    const acknowledged = await interaction.deferUpdate().then(() => true).catch(() => false);
    if (!acknowledged) return;
  }

  const { attachment } = await getRankCardPayload(interaction.guild, interaction.user);
  const payload = {
    content: '',
    files: [attachment],
    attachments: [],
    components: buildDecorationButtonRow(interaction.user.id, mode),
  };

  if (interaction.message?.editable) {
    await interaction.message.edit(payload).catch(() => null);
    return;
  }

  if (typeof interaction.editReply === 'function' && (interaction.replied || interaction.deferred)) {
    await interaction.editReply(payload).catch(() => null);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Show your level card.'),
  disableActionTimeout: true,

  async execute(interaction) {
    const { attachment } = await getRankCardPayload(interaction.guild, interaction.user);
    const summary = manager.getPunishmentSummary(interaction.guildId, interaction.user.id);
    const notice = punishmentNotice(summary);

    await interaction.reply({
      content: notice || undefined,
      files: [attachment],
      components: buildDecorationButtonRow(interaction.user.id),
    });
  },

  async handleMessageCreate(message) {
    if (!message.guild || message.author.bot) return;

    const trimmed = message.content.trim().toLowerCase();
    if (trimmed === '!level' || trimmed === '!rank') {
      const { attachment } = await getRankCardPayload(message.guild, message.author);
      const summary = manager.getPunishmentSummary(message.guild.id, message.author.id);
      const notice = punishmentNotice(summary);

      await message.reply({
        content: notice || undefined,
        files: [attachment],
        components: buildDecorationButtonRow(message.author.id),
      });
      return;
    }

    const fixedXp = isChannelInLowXpCategory(message.channel) ? LOW_XP_AMOUNT : undefined;
    const result = manager.awardMessageXp(message.guild.id, message.author.id, { fixedXp });
    await handleLevelUpRange(message.guild, message.author.id, result.oldLevel, result.newLevel);
  },

  async handleInteraction(interaction) {
    if (interaction.isButton?.()) {
      if (interaction.customId.startsWith(DECORATE_PREFIX)) {
        const ownerId = interaction.customId.slice(DECORATE_PREFIX.length);
        if (!assertOwner(interaction, ownerId)) return true;
        await editRankCardMessage(interaction, 'open');
        return true;
      }

      if (interaction.customId.startsWith(COLOR_PREFIX)) {
        const ownerId = interaction.customId.slice(COLOR_PREFIX.length);
        if (!assertOwner(interaction, ownerId)) return true;
        await interaction.showModal(getColorModal(ownerId));
        return true;
      }

      if (interaction.customId.startsWith(BACKGROUND_PREFIX)) {
        const ownerId = interaction.customId.slice(BACKGROUND_PREFIX.length);
        if (!assertOwner(interaction, ownerId)) return true;
        await interaction.showModal(getBackgroundModal(ownerId));
        return true;
      }
    }

    if (interaction.isModalSubmit?.()) {
      if (interaction.customId.startsWith(COLOR_MODAL_PREFIX)) {
        const ownerId = interaction.customId.slice(COLOR_MODAL_PREFIX.length);
        if (!assertOwner(interaction, ownerId)) return true;
        const changes = getNonEmptyColorChanges(interaction);
        if (Object.keys(changes).length > 0) manager.updateLevelCardCustomization(interaction.user.id, changes);
        await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(() => null);
        await editRankCardMessage(interaction, 'open');
        await interaction.editReply({ content: Object.keys(changes).length > 0 ? 'Rank card colors updated.' : 'No color changes were submitted.' }).catch(() => null);
        return true;
      }

      if (interaction.customId.startsWith(BACKGROUND_MODAL_PREFIX)) {
        const ownerId = interaction.customId.slice(BACKGROUND_MODAL_PREFIX.length);
        if (!assertOwner(interaction, ownerId)) return true;
        const upload = getBackgroundUpload(interaction);
        if (!upload) {
          await interaction.reply({ content: 'Please upload one image file for your rank card background.', flags: EPHEMERAL_FLAG });
          return true;
        }

        await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(() => null);
        try {
          const { filePath, optimized } = await saveUploadedBackground(interaction, upload);
          await logBackgroundUpload(interaction, filePath, optimized);
          await editRankCardMessage(interaction, 'open');
          await interaction.editReply({
            content: `Rank card background updated from **${getAttachmentFilename(upload)}**. The saved PNG is ${CARD_BACKGROUND_WIDTH}x${CARD_BACKGROUND_HEIGHT}${optimized ? ' and optimized with oxipng' : '; oxipng was unavailable, so PNG optimization was skipped'}.`,
          }).catch(() => null);
        } catch (error) {
          await interaction.editReply({ content: `Could not update your background: ${error?.message || 'unknown error'}` }).catch(() => null);
        }
        return true;
      }
    }

    return false;
  },

  async handleMessageReactionAdd(reaction, user) {
    if (user.bot) return;

    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message.guild) return;

    const fixedXp = isChannelInLowXpCategory(reaction.message.channel) ? LOW_XP_AMOUNT : undefined;
    const result = manager.awardReactionXp(reaction.message.guild.id, user.id, { fixedXp });
    await handleLevelUpRange(reaction.message.guild, user.id, result.oldLevel, result.newLevel);
  },
};
