const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { analyzeModerationBatch } = require('../src/aiModeration');
const { getGuildConfig } = require('../src/serverConfig');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');
const { saveMessageScreenshot } = require('../src/messageScreenshot');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
const DEFAULT_MAX_AI_CHARS = 4000;
const SEVERE_AI_THRESHOLD = 8;
const MODERATION_BATCH_SIZE = 10;
const MODERATION_CONTEXT_SIZE = 20;
const moderationBatchQueues = new Map();

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

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return [];
}

function messageModerationText(message) {
  return String(message?.content || '').trim();
}

function moderationAuthor(message) {
  return String(message?.member?.displayName || message?.author?.username || 'User')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberedModerationLine(kind, index, message) {
  const text = messageModerationText(message).replace(/\s+/g, ' ').trim();
  return `${kind} ${index}# ${moderationAuthor(message)}: ${text}`;
}

async function previousModerationContext(firstMessage) {
  const fetchMessages = firstMessage?.channel?.messages?.fetch;
  if (typeof fetchMessages !== 'function') return [];
  const fetched = await fetchMessages.call(firstMessage.channel.messages, {
    before: firstMessage.id,
    limit: 50,
  }).catch(() => null);
  return collectionValues(fetched)
    .filter((entry) => !entry?.author?.bot && messageModerationText(entry))
    .sort((left, right) => Number(left?.createdTimestamp || 0) - Number(right?.createdTimestamp || 0))
    .slice(-MODERATION_CONTEXT_SIZE);
}

function moderationBatchInput(contextMessages, targetMessages) {
  return [
    `Context (previous ${contextMessages.length}; reference only, do not judge):`,
    ...contextMessages.map((message, index) => numberedModerationLine('Context', index + 1, message)),
    '',
    'Messages to check (judge only these ten):',
    ...targetMessages.map((message, index) => numberedModerationLine('Message', index + 1, message)),
  ].join('\n');
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
  console.info(
    `[AI MODERATION] ${status} guild=${message.guildId || 'unknown'} channel=${message.channelId || 'unknown'} user=${message.author?.id || 'unknown'}${suffix}`,
  );
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

function isSevereModerationResult(result) {
  return Number(result?.severityScore) >= SEVERE_AI_THRESHOLD;
}

function moderationLogChannelId(result, settings) {
  return String(
    isSevereModerationResult(result)
      ? settings.severeLogChannelId
      : settings.lowSeverityLogChannelId,
  ).trim();
}

function moderationValues(message, result, screenshot = null) {
  const ruleIds = Array.isArray(result.brokenRules) ? result.brokenRules : [];
  const englishTranslation = String(result.englishTranslation || '').trim();
  const moderationCase = String(result.case || result.categories?.[0] || 'Rule violation').trim();
  return new Map([
    ['severity', formatSeverityScore(result.severityScore)],
    ['severity-tier', result.severity || 'medium'],
    ['broken-rules', listLines(ruleIds)],
    ['moderation-case', moderationCase],
    ['moderation-reason', result.reason || 'The message breaks a server rule.'],
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
    if (container.id === 'ai-moderation-alert' && translation && !text.includes(translation)) {
      text = `${text}\n${translation}`;
    }
    return {
      ...container,
      text,
      thumbnailUrl: replaceModerationPlaceholders(container.thumbnailUrl, replacements),
      imageUrl: replaceModerationPlaceholders(container.imageUrl, replacements),
    };
  });
  return copy;
}

function shouldSkipMessage(message, moderationText) {
  return !message?.guild || message.__coinSpriteAutoModerated || message.author?.bot || !String(moderationText || '').trim();
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

async function moderationScreenshot(message, result) {
  try {
    return await saveMessageScreenshot(message, result);
  } catch (error) {
    console.error('Moderation screenshot render failed:', error);
    return null;
  }
}

function screenshotFiles(screenshot) {
  return screenshot?.attachment && screenshot?.name
    ? [{ attachment: screenshot.attachment, name: screenshot.name }]
    : [];
}

function attachScreenshotToPayload(payload, screenshot) {
  if (!screenshot?.name || !Array.isArray(payload?.components)) return payload;
  const container = payload.components.find((component) => component?.type === 17 && Array.isArray(component.components));
  if (!container) return payload;
  container.components.push({ type: 12, items: [{ media: { url: `attachment://${screenshot.name}` } }] });
  return payload;
}

async function sendModerationAlertToChannel(message, result, templateId, channelId, screenshot) {
  const targetChannelId = String(channelId || '').trim();
  if (!targetChannelId) return false;
  const channel = message.guild.channels.cache.get(targetChannelId)
    || await message.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const files = screenshotFiles(screenshot);
  const template = findTemplate(message.guildId, templateId) || findTemplate(message.guildId, DEFAULT_ALERT_TEMPLATE_ID);
  if (!template) {
    await channel.send({
      content: [
        `AI moderation alert for ${message.author} in ${message.channel}`,
        `Severity: ${formatSeverityScore(result.severityScore)}/10`,
        `Case: ${result.case || result.categories?.[0] || 'Rule violation'}`,
        `Reason: ${result.reason || 'The message breaks a server rule.'}`,
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

async function processModerationBatch(targetMessages) {
  if (targetMessages.length !== MODERATION_BATCH_SIZE) return;
  const firstMessage = targetMessages[0];
  const settings = moderationConfig(firstMessage.guildId);
  if (!settings.enabled || !shouldScanChannel(firstMessage, settings)) return;

  const contextMessages = await previousModerationContext(firstMessage);
  const batchInput = moderationBatchInput(contextMessages, targetMessages);
  debugModeration(
    firstMessage,
    'batch-check',
    `targets=${targetMessages.length} context=${contextMessages.length} chars=${batchInput.length}`,
  );

  const results = await analyzeModerationBatch(
    targetMessages.map((message) => messageModerationText(message)),
    {
      guildId: firstMessage.guildId,
      channelId: firstMessage.channelId,
      batchInput,
    },
  );

  for (const result of results) {
    const message = targetMessages[result.batchIndex - 1];
    if (!message || !result.flagged || hasExcludedRole(message, settings)) continue;
    const logChannelId = moderationLogChannelId(result, settings);
    if (!logChannelId) {
      debugModeration(message, 'alert-skip', `reason=no-configured-log-channel severity=${formatSeverityScore(result.severityScore)}`);
      continue;
    }
    debugModeration(
      message,
      'batch-result',
      `index=${result.batchIndex} source=${result.source || 'unknown'} severity=${formatSeverityScore(result.severityScore)}`,
    );
    await sendModerationAlert(message, result, settings);
  }
}

async function drainModerationBatchQueue(key, state) {
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.pending.length >= MODERATION_BATCH_SIZE) {
      const batch = state.pending.splice(0, MODERATION_BATCH_SIZE);
      await processModerationBatch(batch);
    }
  } catch (error) {
    console.error('AI moderation batch failed:', error);
  } finally {
    state.processing = false;
    if (!state.pending.length) moderationBatchQueues.delete(key);
    else if (state.pending.length >= MODERATION_BATCH_SIZE) void drainModerationBatchQueue(key, state);
  }
}

function enqueueModerationMessage(message) {
  const key = `${message.guildId}:${message.channelId}`;
  const state = moderationBatchQueues.get(key) || { pending: [], processing: false };
  if (!moderationBatchQueues.has(key)) moderationBatchQueues.set(key, state);
  state.pending.push(message);
  if (state.pending.length >= MODERATION_BATCH_SIZE) return drainModerationBatchQueue(key, state);
  return Promise.resolve();
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
        'AI input: target message plus recent channel context, stickers, attachments, and embeds',
        'Minimum alert severity: 2/10',
        `Alert channels: ${settings.scanChannelIds.length ? settings.scanChannelIds.map((id) => `<#${id}>`).join(', ') : 'all text channels'}`,
        `Excluded roles: ${settings.excludeRoleIds.length ? settings.excludeRoleIds.map((id) => `<@&${id}>`).join(', ') : 'none'}`,
        `AI reports below 8/10: ${settings.lowSeverityLogChannelId ? `<#${settings.lowSeverityLogChannelId}>` : 'not set'}`,
        `AI severe reports 8-10/10: ${settings.severeLogChannelId ? `<#${settings.severeLogChannelId}>` : 'not set'}`,
        `AI input sent: up to ${settings.maxInputChars} characters, capped at ${DEFAULT_MAX_AI_CHARS}`,
        `AI provider: ${process.env.OPENAI_API_KEY ? 'OpenAI every message' : 'fallback scan only'}`,
        `Debug logs: ${moderationDebugEnabled() ? 'enabled' : 'off'}`,
      ].join('\n'),
      flags: EPHEMERAL_FLAG,
    });
  },

  async handleMessageCreate(message) {
    const moderationText = messageModerationText(message);
    if (shouldSkipMessage(message, moderationText)) return;

    const settings = moderationConfig(message.guildId);
    if (!settings.enabled) {
      debugModeration(message, 'skip', 'reason=disabled');
      return;
    }
    if (!shouldScanChannel(message, settings)) {
      debugModeration(message, 'skip', 'reason=outside-channel-scope');
      return;
    }

    debugModeration(message, 'queue', `batch-size=${MODERATION_BATCH_SIZE}`);
    await enqueueModerationMessage(message);
  },
};
