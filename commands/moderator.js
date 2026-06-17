const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { analyzeModerationMessage } = require('../src/aiModeration');
const { getGuildConfig } = require('../src/serverConfig');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
const DEFAULT_MAX_AI_CHARS = 1500;
const cooldowns = new Map();

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
}

function moderationConfig(guildId) {
  const config = getGuildConfig(guildId);
  const ai = config?.moderation?.ai || {};
  return {
    enabled: Boolean(ai.enabled),
    logChannelId: String(ai.logChannelId || ''),
    scanChannelIds: uniqueIds(ai.scanChannelIds),
    excludeRoleIds: uniqueIds(ai.excludeRoleIds),
    alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
    maxInputChars: Number(ai.maxInputChars) || DEFAULT_MAX_AI_CHARS,
  };
}

function listText(value) {
  if (Array.isArray(value) && value.length) return value.join(', ');
  return '-';
}

function listLines(value) {
  if (!Array.isArray(value) || !value.length) return '-';
  return value.map((entry) => `- ${entry}`).join('\n');
}

function formatSeverityScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '0';
  return String(Math.max(0, Math.min(10, Math.round(score * 100) / 100)));
}

function moderationValues(message, result) {
  return new Map([
    ['severity', result.severity || 'medium'],
    ['severity-tier', formatSeverityScore(result.severityScore)],
    ['broken-rules', listLines(result.brokenRules)],
    ['moderation-reason', result.reason || 'Flagged by moderation policy.'],
    ['matched-terms', listText(result.matchedTerms)],
    ['moderation-categories', listText(result.categories)],
    ['original-language', result.originalLanguage || 'unknown'],
    ['english-translation', result.englishTranslation || message.content || '-'],
    ['message-link', message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`],
    ['moderation-source', result.source || 'ai'],
  ]);
}

function replaceModerationPlaceholders(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => replacements.get(token.toLowerCase()) ?? match);
}

function applyModerationPlaceholders(template, message, result) {
  const replacements = moderationValues(message, result);
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replaceModerationPlaceholders(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replaceModerationPlaceholders(container.text, replacements),
    thumbnailUrl: replaceModerationPlaceholders(container.thumbnailUrl, replacements),
    imageUrl: replaceModerationPlaceholders(container.imageUrl, replacements),
  }));
  return copy;
}

function shouldSkipMessage(message) {
  return !message?.guild || message.__coinSpriteAutoModerated || message.author?.bot || !message.content?.trim();
}

function shouldScanChannel(message, settings) {
  if (!settings.scanChannelIds.length) return true;
  const allowed = new Set(settings.scanChannelIds);
  return allowed.has(message.channelId) || allowed.has(message.channel?.parentId);
}

function hasExcludedRole(message, settings) {
  if (!settings.excludeRoleIds.length) return false;
  const roles = message.member?.roles?.cache;
  if (!roles) return false;
  return settings.excludeRoleIds.some((roleId) => roles.has(roleId));
}

function cooldownKey(message) {
  return `${message.guildId}:${message.author.id}`;
}

function inCooldown(message) {
  const key = cooldownKey(message);
  const now = Date.now();
  const until = cooldowns.get(key) || 0;
  if (until > now) return true;
  cooldowns.set(key, now + 2500);
  return false;
}

async function sendModerationAlert(message, result, settings) {
  const channel = message.guild.channels.cache.get(settings.logChannelId)
    || await message.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const template = findTemplate(message.guildId, settings.alertTemplateId) || findTemplate(message.guildId, DEFAULT_ALERT_TEMPLATE_ID);
  if (!template) {
    await channel.send({
      content: [
        `AI moderation alert for ${message.author} in ${message.channel}`,
        `Severity: ${result.severity} ${formatSeverityScore(result.severityScore)}/10`,
        `Broken rules:\n${listLines(result.brokenRules)}`,
        `Reason: ${result.reason || 'Flagged by moderation policy.'}`,
        `English: ${result.englishTranslation || message.content}`,
        message.url,
      ].join('\n').slice(0, 2000),
      allowedMentions: { parse: [], users: [message.author.id] },
    }).catch(() => null);
    return;
  }

  const payload = buildMessagePayload(applyModerationPlaceholders(template, message, result), {
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
  });
  await channel.send(payload).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderator')
    .setDescription('Show AI moderation status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const settings = moderationConfig(interaction.guildId);
    await interaction.reply({
      content: [
        `AI moderation: **${settings.enabled ? 'enabled' : 'disabled'}**`,
        `Scan channels: ${settings.scanChannelIds.length ? settings.scanChannelIds.map((id) => `<#${id}>`).join(', ') : 'all text channels'}`,
        `Excluded roles: ${settings.excludeRoleIds.length ? settings.excludeRoleIds.map((id) => `<@&${id}>`).join(', ') : 'none'}`,
        `Log channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set'}`,
        `AI max input: ${settings.maxInputChars} characters`,
        `AI provider: ${process.env.OPENAI_API_KEY ? 'OpenAI' : 'fallback scan only'}`,
      ].join('\n'),
      flags: EPHEMERAL_FLAG,
    });
  },

  async handleMessageCreate(message) {
    if (shouldSkipMessage(message) || inCooldown(message)) return;
    const settings = moderationConfig(message.guildId);
    if (!settings.enabled || !settings.logChannelId || !shouldScanChannel(message, settings) || hasExcludedRole(message, settings)) return;

    const result = await analyzeModerationMessage(message.content, {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      maxInputChars: settings.maxInputChars,
    });
    if (!result.flagged) return;
    await sendModerationAlert(message, result, settings);
  },
};