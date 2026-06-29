'use strict';

const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { createWarning, warningConfig } = require('../src/warningService');
const { formatDuration } = require('../src/moderationActionService');

const messageWindows = new Map();
const cooldowns = new Map();

function clamp(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function spamSettings(guildId) {
  const config = getGuildConfig(guildId);
  const spam = config?.moderation?.auto?.spam || {};
  return {
    enabled: Boolean(spam.enabled),
    messages: {
      enabled: spam.messages?.enabled !== false,
      count: clamp(spam.messages?.count, 2, 50, 6),
      durationSeconds: clamp(spam.messages?.durationSeconds, 1, 120, 5),
    },
    lines: {
      enabled: spam.lines?.enabled !== false,
      maxLines: clamp(spam.lines?.maxLines, 2, 100, 12),
    },
    mentions: {
      enabled: spam.mentions?.enabled !== false,
      maxMentions: clamp(spam.mentions?.maxMentions, 2, 100, 6),
    },
    deleteMessage: spam.deleteMessage !== false,
    action: ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout',
    timeoutSeconds: clamp(spam.timeoutSeconds, 60, 2419200, 300),
    excludeChannelIds: [...new Set((spam.excludeChannelIds || []).map(String))],
    excludeRoleIds: [...new Set((spam.excludeRoleIds || []).map(String))],
    logChannelId: resolveLoggingChannelId(config, 'moderation', 'spam', spam.logChannelId || ''),
  };
}

function shouldScan(message, settings) {
  if (!message?.guild || message.author?.bot || message.webhookId) return false;
  if (message.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return false;
  if (settings.excludeChannelIds.includes(message.channelId) || settings.excludeChannelIds.includes(message.channel?.parentId)) return false;
  if (settings.excludeRoleIds.some((roleId) => message.member?.roles?.cache?.has?.(roleId))) return false;
  return true;
}

function burstViolation(message, settings, now) {
  if (!settings.messages.enabled) return null;
  const key = message.guildId + ':' + message.author.id;
  const durationMs = settings.messages.durationSeconds * 1000;
  const timestamps = (messageWindows.get(key) || []).filter((timestamp) => now - timestamp <= durationMs);
  timestamps.push(now);
  messageWindows.set(key, timestamps);
  if (timestamps.length < settings.messages.count) return null;
  messageWindows.set(key, []);
  return {
    kind: 'message_burst',
    reason: 'Sent ' + timestamps.length + ' messages within ' + settings.messages.durationSeconds + ' seconds.',
    measured: timestamps.length,
    limit: settings.messages.count,
  };
}

function lineViolation(message, settings) {
  if (!settings.lines.enabled || !message.content) return null;
  const count = String(message.content).split(/\r?\n/).length;
  if (count <= settings.lines.maxLines) return null;
  return {
    kind: 'excessive_lines',
    reason: 'Sent a message with ' + count + ' lines; the maximum is ' + settings.lines.maxLines + '.',
    measured: count,
    limit: settings.lines.maxLines,
  };
}

function mentionViolation(message, settings) {
  if (!settings.mentions.enabled) return null;
  const count = Number(message.mentions?.users?.size || 0)
    + Number(message.mentions?.roles?.size || 0)
    + (message.mentions?.everyone ? 1 : 0);
  if (count < settings.mentions.maxMentions) return null;
  return {
    kind: 'mass_mention',
    reason: 'Mentioned ' + count + ' users or roles; the trigger is ' + settings.mentions.maxMentions + '.',
    measured: count,
    limit: settings.mentions.maxMentions,
  };
}

function detectViolation(message, settings, now = Date.now()) {
  return lineViolation(message, settings)
    || mentionViolation(message, settings)
    || burstViolation(message, settings, now);
}

async function logViolation(message, settings, violation) {
  if (!settings.logChannelId) return;
  const channel = message.guild.channels.cache.get(settings.logChannelId)
    || await message.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    flags: 32768,
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: 0xed4245,
      components: [{
        type: 10,
        content: [
          '## Spam Auto-Moderator',
          '**User:** <@' + message.author.id + '> (`' + message.author.id + '`)',
          '**Channel:** <#' + message.channelId + '>',
          '**Type:** ' + violation.kind.replace(/_/g, ' '),
          '**Reason:** ' + violation.reason,
          '**Action:** ' + settings.action + (settings.deleteMessage ? ' + delete' : ''),
          '**Message:** ' + (message.url || 'not available'),
        ].join('\n'),
      }],
    }],
  }).catch(() => null);
}

async function applyViolation(message, settings, violation) {
  if (settings.deleteMessage && message.deletable) await message.delete().catch(() => null);
  if (settings.action === 'warn') {
    if (warningConfig(message.guildId).enabled) {
      await createWarning({
        guild: message.guild,
        member: message.member,
        memberId: message.author.id,
        moderatorId: message.client.user.id,
        source: 'automod_spam',
        reason: 'Spam Auto-Moderator: ' + violation.reason,
        evidence: message.url || '',
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
      }).catch((error) => console.error('Spam warning case failed:', error));
    } else {
      await message.author.send('Your message was flagged as spam in **' + message.guild.name + '**. ' + violation.reason).catch(() => null);
    }
  } else if (settings.action === 'timeout') {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member?.moderatable) {
      const durationMs = settings.timeoutSeconds * 1000;
      const reason = 'Spam Auto-Moderator: ' + violation.reason;
      const applied = await member.timeout(durationMs, reason).then(() => true).catch(() => false);
      if (applied) {
        await message.author.send([
          'You were muted in **' + message.guild.name + '**.',
          '**Duration:** ' + formatDuration(durationMs),
          '**Reason:** ' + reason,
        ].join('\n')).catch(() => null);
      }
    }
  }
  await logViolation(message, settings, violation);
}

module.exports = {
  allowTextlessMessages: true,
  data: new SlashCommandBuilder()
    .setName('spam-auto-moderator')
    .setDescription('Show Spam Auto-Moderator status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const settings = spamSettings(interaction.guildId);
    await interaction.reply({
      content: [
        'Spam Auto-Moderator: **' + (settings.enabled ? 'enabled' : 'disabled') + '**',
        'Message burst: **' + settings.messages.count + ' messages / ' + settings.messages.durationSeconds + ' seconds**',
        'Line limit: **' + settings.lines.maxLines + '**',
        'Mass mention trigger: **' + settings.mentions.maxMentions + '**',
        'Action: **' + settings.action + (settings.deleteMessage ? ' + delete' : '') + '**',
      ].join('\n'),
      ephemeral: true,
    });
  },

  async handleMessageCreate(message) {
    const settings = spamSettings(message.guildId);
    if (!settings.enabled || !shouldScan(message, settings) || message.__coinSpriteAutoModerated) return;
    const key = message.guildId + ':' + message.author.id;
    const now = Date.now();
    if ((cooldowns.get(key) || 0) > now) return;
    const violation = detectViolation(message, settings, now);
    if (!violation) return;
    cooldowns.set(key, now + Math.min(30000, settings.messages.durationSeconds * 1000));
    message.__coinSpriteAutoModerated = true;
    await applyViolation(message, settings, violation);
  },

  __test: { detectViolation, spamSettings },
};
