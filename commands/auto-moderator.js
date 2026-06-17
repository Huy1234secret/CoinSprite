const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()]+/gi;
const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/i;
const ACTION_TYPES = ['delete', 'warn', 'timeout', 'report', 'log'];
const DEFAULT_ACTIONS = [{ type: 'delete' }, { type: 'log' }];

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
  return normalized;
}

function linkSettings(guildId) {
  const config = getGuildConfig(guildId);
  const link = config?.moderation?.auto?.link || {};
  return {
    enabled: Boolean(link.enabled),
    blockDiscordInvites: link.blockDiscordInvites !== false,
    allowedInviteGuildIds: uniqueStrings(link.allowedInviteGuildIds),
    allowedInviteCodes: uniqueStrings(link.allowedInviteCodes).map((item) => item.toLowerCase()),
    domainBlacklist: uniqueStrings(link.domainBlacklist).map(cleanDomain).filter(Boolean),
    domainWhitelist: uniqueStrings(link.domainWhitelist).map(cleanDomain).filter(Boolean),
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
  if (settings.allowedInviteCodes.includes(code)) return true;
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
    if (settings.domainBlacklist.some((rule) => domainMatches(domain, rule))) {
      return { reason: 'Blocked blacklisted domain', url: rawUrl, domain, inviteCode: code };
    }
    if (settings.domainWhitelist.length && !settings.domainWhitelist.some((rule) => domainMatches(domain, rule))) {
      return { reason: 'Blocked non-whitelisted domain', url: rawUrl, domain, inviteCode: code };
    }
  }
  return null;
}

async function logAutoModeration(message, settings, details, actionName) {
  const channelId = settings.logChannelId;
  if (!channelId) return;
  const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    content: [
      `Auto-Moderator ${actionName || 'log'}: ${details.reason}`,
      `User: ${message.author} (${message.author.id})`,
      `Channel: ${message.channel}`,
      `Domain: ${details.domain || '-'}`,
      `URL: ${details.url || '-'}`,
      `Message: ${message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`}`,
    ].join('\n').slice(0, 2000),
    allowedMentions: { parse: [] },
  }).catch(() => null);
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
      await logAutoModeration(message, settings, details, action.type);
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
        `Domain blacklist: ${settings.domainBlacklist.length || 0}`,
        `Domain whitelist: ${settings.domainWhitelist.length || 0}`,
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
