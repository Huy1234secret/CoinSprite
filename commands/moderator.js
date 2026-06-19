const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { analyzeModerationMessage } = require('../src/aiModeration');
const { moderationIgnoreReason } = require('../src/moderationMessageFilter');
const { getGuildConfig } = require('../src/serverConfig');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');
const { saveMessageScreenshot } = require('../src/messageScreenshot');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
const DEFAULT_MAX_AI_CHARS = 4000;
const SEVERE_AI_THRESHOLD = 8;

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
}

function moderationConfig(guildId) {
  const config = getGuildConfig(guildId);
  const ai = config?.moderation?.ai || {};
  const legacyLogChannelId = String(ai.logChannelId || '');
  return {
    enabled: Boolean(ai.enabled),
    lowSeverityLogChannelId: String(ai.lowSeverityLogChannelId || legacyLogChannelId),
    severeLogChannelId: String(ai.severeLogChannelId || legacyLogChannelId),
    scanChannelIds: uniqueIds(ai.scanChannelIds),
    excludeRoleIds: uniqueIds(ai.excludeRoleIds),
    alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
    maxInputChars: Number(ai.maxInputChars) || DEFAULT_MAX_AI_CHARS,
  };
}

function messageModerationText(message) {
  return String(message?.content || '').trim();
}

function moderationMessagePreview(message, max = 900) {
  const text = String(message?.content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '[no text content]';
  const safe = text.replace(/[`*_~|>]/g, '').replace(/"/g, "'");
  return safe.length > max ? `${safe.slice(0, Math.max(0, max - 3))}...` : safe;
}

function moderationDebugEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.AI_MODERATION_DEBUG || '').toLowerCase());
}

function debugModeration(message, status, detail = '') {
  if (!moderationDebugEnabled()) return;
  const suffix = detail ? ` ${detail}` : '';
  console.info(`[AI MODERATION] ${status} guild=${message.guildId || 'unknown'} channel=${message.channelId || 'unknown'} user=${message.author?.id || 'unknown'}${suffix}`);
}

function listText(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : '-';
}

function listLines(value) {
  return Array.isArray(value) && value.length ? value.map((entry) => `- ${entry}`).join('\n') : '-';
}

function formatSeverityScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '0';
  return String(Math.max(0, Math.min(10, Math.round(score * 100) / 100)));
}

function isSevereModerationResult(result) {
  return Number(result?.severityScore) >= SEVERE_AI_THRESHOLD;
}

function moderationLogChannelId(result, settings) {
  return String(isSevereModerationResult(result) ? settings.severeLogChannelId : settings.lowSeverityLogChannelId).trim();
}

function moderationValues(message, result, screenshot = null) {
  const englishTranslation = String(result.englishTranslation || '').trim();
  const moderationCase = String(result.case || result.categories?.[0] || 'Rule violation').trim();
  return new Map([
    ['severity', formatSeverityScore(result.severityScore)],
    ['severity-tier', result.severity || 'medium'],
    ['broken-rules', listLines(result.brokenRules)],
    ['moderation-case', moderationCase],
    ['moderation-reason', result.reason || 'The message was flagged by moderation.'],
    ['matched-terms', listText(result.matchedTerms)],
    ['moderation-categories', listText(result.categories)],
    ['original-language', result.originalLanguage || ''],
    ['english-translation', englishTranslation],
    ['translation-section', englishTranslation ? `-# Translated: "${englishTranslation.replace(/"/g, "'")}"` : ''],
    ['message-content', moderationMessagePreview(message)],
    ['message-link', message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`],
    ['message-screenshot', screenshot?.name ? `attachment://${screenshot.name}` : ''],
    ['message-screenshot-path', screenshot?.path || ''],
    ['moderation-source', result.source || 'ai'],
  ]);
}

function replaceModerationPlaceholders(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => replacements.get(token.toLowerCase()) ?? match);
}

function applyModerationPlaceholders(template, message, result, screenshot = null) {
  const replacements = moderationValues(message, result, screenshot);
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replaceModerationPlaceholders(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => {
    let text = replaceModerationPlaceholders(container.text, replacements);
    const translation = replacements.get('translation-section');
    if (container.id === 'ai-moderation-alert' && translation && !text.includes(translation)) text = `${text}\n${translation}`;
    return {
      ...container,
      text,
      thumbnailUrl: replaceModerationPlaceholders(container.thumbnailUrl, replacements),
      imageUrl: replaceModerationPlaceholders(container.imageUrl, replacements),
    };
  });
  return copy;
}

function shouldSkipMessage(message) {
  return !message?.guild || message.__coinSpriteAutoModerated || message.author?.bot;
}

function shouldScanChannel(message, settings) {
  if (!settings.scanChannelIds.length) return true;
  const allowed = new Set(settings.scanChannelIds);
  return allowed.has(message.channelId) || allowed.has(message.channel?.parentId);
}

function hasExcludedRole(message, settings) {
  const roles = message.member?.roles?.cache;
  return Boolean(settings.excludeRoleIds.length && roles && settings.excludeRoleIds.some((roleId) => roles.has(roleId)));
}

async function moderationScreenshot(message, result) {
  try { return await saveMessageScreenshot(message, result); }
  catch (error) {
    console.error('Moderation screenshot render failed:', error);
    return null;
  }
}

function screenshotFiles(screenshot) {
  return screenshot?.attachment && screenshot?.name ? [{ attachment: screenshot.attachment, name: screenshot.name }] : [];
}

function attachScreenshotToPayload(payload, screenshot) {
  if (!screenshot?.name || !Array.isArray(payload?.components)) return payload;
  const container = payload.components.find((component) => component?.type === 17 && Array.isArray(component.components));
  if (container) container.components.push({ type: 12, items: [{ media: { url: `attachment://${screenshot.name}` } }] });
  return payload;
}

async function sendModerationAlertToChannel(message, result, templateId, channelId, screenshot) {
  const targetChannelId = String(channelId || '').trim();
  if (!targetChannelId) return false;
  const channel = message.guild.channels.cache.get(targetChannelId) || await message.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const files = screenshotFiles(screenshot);
  const template = findTemplate(message.guildId, templateId) || findTemplate(message.guildId, DEFAULT_ALERT_TEMPLATE_ID);
  if (!template) {
    await channel.send({
      content: [
        `AI moderation alert for ${message.author} in ${message.channel}`,
        `Severity: ${formatSeverityScore(result.severityScore)}/10`,
        `Case: ${result.case || result.categories?.[0] || 'Rule violation'}`,
        `Reason: ${result.reason || 'The message was flagged by moderation.'}`,
        `Message: ${moderationMessagePreview(message)}`,
        screenshot?.path ? `Screenshot saved: ${screenshot.path}` : '',
        message.url,
      ].filter(Boolean).join('\n').slice(0, 2000),
      allowedMentions: { parse: [], users: [message.author.id] },
      files,
    }).catch(() => null);
    return true;
  }
  const payload = attachScreenshotToPayload(buildMessagePayload(applyModerationPlaceholders(template, message, result, screenshot), {
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
  }), screenshot);
  await channel.send({ ...payload, files }).catch(() => null);
  return true;
}

async function sendModerationAlert(message, result, settings) {
  const channelId = moderationLogChannelId(result, settings);
  if (!channelId) return false;
  const screenshot = await moderationScreenshot(message, result);
  return sendModerationAlertToChannel(message, result, settings.alertTemplateId, channelId, screenshot);
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
        'AI input: target message only; channel context, stickers, attachments, and embeds are not sent to OpenAI',
        'Minimum alert severity: 2/10',
        `Alert channels: ${settings.scanChannelIds.length ? settings.scanChannelIds.map((id) => `<#${id}>`).join(', ') : 'all text channels'}`,
        `Excluded roles: ${settings.excludeRoleIds.length ? settings.excludeRoleIds.map((id) => `<@&${id}>`).join(', ') : 'none'}`,
        `AI reports below 8/10: ${settings.lowSeverityLogChannelId ? `<#${settings.lowSeverityLogChannelId}>` : 'not set'}`,
        `AI severe reports 8-10/10: ${settings.severeLogChannelId ? `<#${settings.severeLogChannelId}>` : 'not set'}`,
        `AI input sent: one message, up to ${settings.maxInputChars} characters, capped at ${DEFAULT_MAX_AI_CHARS}`,
        `AI provider: ${process.env.OPENAI_API_KEY ? 'OpenAI every message' : 'fallback scan only'}`,
        `Debug logs: ${moderationDebugEnabled() ? 'enabled' : 'off'}`,
      ].join('\n'),
      flags: EPHEMERAL_FLAG,
    });
  },

  async handleMessageCreate(message) {
    const moderationText = messageModerationText(message);
    if (shouldSkipMessage(message)) {
      debugModeration(message, 'skip', `reason=basic-filter textChars=${moderationText.length}`);
      return;
    }
    const ignoreReason = moderationIgnoreReason(message, moderationText);
    if (ignoreReason) {
      debugModeration(message, 'skip', `reason=${ignoreReason} textChars=${moderationText.length}`);
      return;
    }
    const settings = moderationConfig(message.guildId);
    if (!settings.enabled) {
      debugModeration(message, 'skip', 'reason=disabled');
      return;
    }
    if (hasExcludedRole(message, settings)) {
      debugModeration(message, 'skip', 'reason=excluded-role-before-ai');
      return;
    }
    debugModeration(message, 'check', `chars=${moderationText.length}`);
    const result = await analyzeModerationMessage(moderationText, {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      maxInputChars: settings.maxInputChars,
    });
    debugModeration(message, 'result', `flagged=${Boolean(result.flagged)} source=${result.source || 'unknown'} severity=${formatSeverityScore(result.severityScore)}`);
    if (!result.flagged) return;
    const logChannelId = moderationLogChannelId(result, settings);
    if (!logChannelId) {
      debugModeration(message, 'alert-skip', `reason=no-configured-log-channel severity=${formatSeverityScore(result.severityScore)}`);
      return;
    }
    if (!shouldScanChannel(message, settings)) {
      debugModeration(message, 'alert-skip', 'reason=outside-alert-channel-scope');
      return;
    }
    await sendModerationAlert(message, result, settings);
  },
};
