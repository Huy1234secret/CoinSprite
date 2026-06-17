const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()]+/gi;
const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/i;
const ACTION_TYPES = ['delete', 'warn', 'timeout', 'report', 'log'];
const DEFAULT_ACTIONS = [{ type: 'delete' }, { type: 'log' }];
const DEFAULT_LINK_AUTO_MODERATION_TEMPLATE_ID = 'default-link-auto-moderation-alert';
const COMPONENTS_V2_FLAG = 32768; // ADDED: render Auto-Moderator logs inside Discord Components v2 containers.
const AUTO_MOD_REPORT_COLOR = 0xED4245; // ADDED: consistent danger accent for blocked-link reports.

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function cleanDomain(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return text.replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function clampSeconds(value, fallback = 300) {
  return Math.max(0, Math.min(2419200, Number(value) || fallback));
}

function normalizeDomainMode(value, whitelist = []) {
  if (value === 'whitelist' || value === 'blacklist') return value;
  return whitelist.length ? 'whitelist' : 'blacklist';
}

function normalizeAction(action) {
  const type = String(typeof action === 'string' ? action : action?.type || '').trim().toLowerCase();
  if (!ACTION_TYPES.includes(type)) return null;
  const normalized = { type };
  if (type === 'warn') {
    normalized.message = String(action?.message || 'Your message was blocked by Auto-Moderator.').slice(0, 500);
    normalized.durationSeconds = clampSeconds(action?.durationSeconds, 300);
  }
  if (type === 'timeout') {
    normalized.durationSeconds = clampSeconds(action?.durationSeconds, 300);
  }
  if (type === 'report' || type === 'log') {
    normalized.reportChannelId = String(action?.reportChannelId || action?.channelId || '').trim();
  }
  return normalized;
}

function linkSettings(guildId) {
  const config = getGuildConfig(guildId);
  const link = config?.moderation?.auto?.link || {};
  const domainWhitelist = uniqueStrings(link.domainWhitelist).map(cleanDomain).filter(Boolean);
  return {
    enabled: Boolean(link.enabled),
    blockDiscordInvites: link.blockDiscordInvites !== false,
    allowedInviteGuildIds: uniqueStrings(link.allowedInviteGuildIds),
    domainMode: normalizeDomainMode(link.domainMode, domainWhitelist),
    domainBlacklist: uniqueStrings(link.domainBlacklist).map(cleanDomain).filter(Boolean),
    domainWhitelist,
    scanChannelIds: uniqueStrings(link.scanChannelIds),
    excludeChannelIds: uniqueStrings(link.excludeChannelIds),
    excludeRoleIds: uniqueStrings(link.excludeRoleIds),
    actions: (Array.isArray(link.actions) && link.actions.length ? link.actions : DEFAULT_ACTIONS).map(normalizeAction).filter(Boolean),
    logChannelId: String(link.logChannelId || config?.moderation?.ai?.logChannelId || ''),
  };
}

function shouldScanMessage(message, settings) {
  if (!message?.guild || message.author?.bot || !message.content) return false;
  if (settings.scanChannelIds.length) {
    const allowed = new Set(settings.scanChannelIds);
    if (!allowed.has(message.channelId) && !allowed.has(message.channel?.parentId)) return false;
  }
  const excludedChannels = new Set(settings.excludeChannelIds);
  if (excludedChannels.has(message.channelId) || excludedChannels.has(message.channel?.parentId)) return false;
  if (settings.excludeRoleIds.length && message.member?.roles?.cache) {
    if (settings.excludeRoleIds.some((roleId) => message.member.roles.cache.has(roleId))) return false;
  }
  return true;
}

function extractUrls(content) {
  const matches = String(content || '').match(URL_PATTERN) || [];
  return matches.map((raw) => raw.replace(/[.,!?;:]+$/g, '')).slice(0, 20);
}

function urlDomain(rawUrl) {
  try {
    const url = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
    return cleanDomain(url.hostname);
  } catch {
    return '';
  }
}

function domainMatches(domain, rule) {
  return domain === rule || domain.endsWith(`.${rule}`);
}

function inviteCode(rawUrl) {
  return String(rawUrl || '').match(INVITE_PATTERN)?.[1]?.toLowerCase() || '';
}

async function inviteAllowed(message, code, settings, client) {
  if (!code) return false;
  try {
    const invite = await client.fetchInvite(code);
    const guildId = invite?.guild?.id || invite?.guildId || '';
    return Boolean(guildId && settings.allowedInviteGuildIds.includes(guildId));
  } catch {
    return false;
  }
}

async function blockedLinkReason(message, settings, client) {
  const urls = extractUrls(message.content);
  for (const rawUrl of urls) {
    const domain = urlDomain(rawUrl);
    if (!domain) continue;
    const code = inviteCode(rawUrl);
    if (code && settings.blockDiscordInvites && !(await inviteAllowed(message, code, settings, client))) {
      return { reason: 'Blocked Discord invite', url: rawUrl, domain, inviteCode: code };
    }
    if (settings.domainMode === 'blacklist' && settings.domainBlacklist.some((rule) => domainMatches(domain, rule))) {
      return { reason: 'Blocked blacklisted domain', url: rawUrl, domain, inviteCode: code };
    }
    if (settings.domainMode === 'whitelist' && !settings.domainWhitelist.some((rule) => domainMatches(domain, rule))) {
      return { reason: 'Blocked non-whitelisted domain', url: rawUrl, domain, inviteCode: code };
    }
  }
  return null;
}

function limitText(value, max = 900) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function safeInline(value, fallback = '-') {
  return limitText(value || fallback, 950).replace(/`/g, "'");
}

function safeCodeBlock(value, max = 1200) {
  const text = limitText(value || '[empty message]', max).replace(/```/g, '``\u200b`');
  return `\`\`\`\n${text}\n\`\`\``;
}

function messageJumpUrl(message) {
  return message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function textDisplay(content) {
  return { type: 10, content: String(content || '').slice(0, 4000) };
}

function authorAvatarUrl(author) {
  if (typeof author?.displayAvatarURL === 'function') return author.displayAvatarURL({ extension: 'png', size: 128 });
  if (typeof author?.avatarURL === 'function') return author.avatarURL({ extension: 'png', size: 128 });
  return '';
}

function reportIntroComponent(message, details, actionName) {
  const content = [
    '## Auto-Moderator report',
    `**Action:** ${safeInline(actionName || 'log')}`,
    `**Reason:** ${safeInline(details.reason)}`,
  ].join('\n');
  const avatarUrl = authorAvatarUrl(message.author);
  if (!avatarUrl) return textDisplay(content);
  return { type: 9, components: [textDisplay(content)], accessory: { type: 11, media: { url: avatarUrl } } }; // ADDED: user avatar stays inside the report container.
}

function buildAutoModerationReportPayload(message, details, actionName) {
  const targetDetails = [
    `**User:** ${message.author} (\`${message.author.id}\`)`,
    `**Channel:** ${message.channel}`,
    `**Domain:** \`${safeInline(details.domain)}\``,
    `**URL:** ${details.url ? `<${safeInline(details.url)}>` : '`-`'}`,
    `**Message:** <${messageJumpUrl(message)}>`,
  ].join('\n');
  const messageDetails = [
    '**Blocked message**',
    safeCodeBlock(message.content),
  ].join('\n');
  return {
    flags: COMPONENTS_V2_FLAG, // FIXED: report is sent as a Discord container instead of loose plain text.
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: AUTO_MOD_REPORT_COLOR,
      components: [
        reportIntroComponent(message, details, actionName),
        { type: 14, divider: true, spacing: 1 },
        textDisplay(targetDetails),
        { type: 14, divider: true, spacing: 1 },
        textDisplay(messageDetails),
      ],
    }],
  };
}

function autoModerationValues(message, details, actionName) {
  return new Map([
    ['moderation-action', actionName || 'log'],
    ['moderation-reason', details.reason || 'Blocked link'],
    ['blocked-domain', details.domain || '-'],
    ['blocked-url', details.url ? `<${details.url}>` : '`-`'],
    ['invite-code', details.inviteCode || '-'],
    ['message-link', messageJumpUrl(message)],
    ['message-content', limitText(message.content || '[empty message]', 1200).replace(/```/g, '``\u200b`')],
  ]);
}

function replaceAutoModerationPlaceholders(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => replacements.get(token.toLowerCase()) ?? match);
}

function applyAutoModerationPlaceholders(template, message, details, actionName) {
  const replacements = autoModerationValues(message, details, actionName);
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replaceAutoModerationPlaceholders(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replaceAutoModerationPlaceholders(container.text, replacements),
    thumbnailUrl: replaceAutoModerationPlaceholders(container.thumbnailUrl, replacements),
    imageUrl: replaceAutoModerationPlaceholders(container.imageUrl, replacements),
  }));
  return copy;
}

function autoModerationTemplatePayload(message, details, actionName) {
  const template = findTemplate(message.guildId, DEFAULT_LINK_AUTO_MODERATION_TEMPLATE_ID);
  if (!template) return null;
  return buildMessagePayload(applyAutoModerationPlaceholders(template, message, details, actionName), {
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
  });
}

async function logAutoModeration(message, settings, details, action) {
  const actionName = typeof action === 'string' ? action : action?.type;
  const channelId = String((typeof action === 'object' && action?.reportChannelId) || settings.logChannelId || '').trim();
  if (!channelId) return;
  const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const payload = autoModerationTemplatePayload(message, details, actionName)
    || buildAutoModerationReportPayload(message, details, actionName);
  await channel.send(payload).catch(() => null); // FIXED: send a polished container report without pinging mentioned users or roles.
}

async function warnUser(message, action) {
  const text = action.message || 'Your message was blocked by Auto-Moderator.';
  await message.reply({ content: text, allowedMentions: { users: [message.author.id], roles: [], parse: [] } }).catch(() => null);
}

async function timeoutMember(message, action) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.moderatable || typeof member.timeout !== 'function') return;
  const durationMs = Math.max(1000, Number(action.durationSeconds || 300) * 1000);
  await member.timeout(durationMs, 'Auto-Moderator blocked link').catch(() => null);
}

async function runActions(message, settings, details) {
  for (const action of settings.actions) {
    if (action.type === 'delete') {
      if (message.deletable) await message.delete().catch(() => null);
    } else if (action.type === 'warn') {
      await warnUser(message, action);
    } else if (action.type === 'timeout') {
      await timeoutMember(message, action);
    } else if (action.type === 'log' || action.type === 'report') {
      await logAutoModeration(message, settings, details, action);
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto-moderator')
    .setDescription('Show Auto-Moderator status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const settings = linkSettings(interaction.guildId);
    await interaction.reply({
      content: [
        `Link Auto-Moderator: **${settings.enabled ? 'enabled' : 'disabled'}**`,
        `Discord invites: **${settings.blockDiscordInvites ? 'blocked' : 'allowed'}**`,
        `Domain filter: **${settings.domainMode === 'whitelist' ? 'block except allowed domains' : 'allow except blocked domains'}**`,
        `Blocked domains: ${settings.domainBlacklist.length || 0}`,
        `Allowed domains: ${settings.domainWhitelist.length || 0}`,
        `Actions: ${settings.actions.map((action) => action.type).join(', ') || 'none'}`,
      ].join('\n'),
      ephemeral: true,
    });
  },

  async handleMessageCreate(message, client) {
    const settings = linkSettings(message.guildId);
    if (!settings.enabled || !shouldScanMessage(message, settings)) return;
    const details = await blockedLinkReason(message, settings, client || message.client);
    if (!details) return;
    message.__coinSpriteAutoModerated = true;
    await runActions(message, settings, details);
  },
};
