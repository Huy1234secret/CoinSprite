'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  CONTEXT_TYPES,
  classifyMessage,
  getGuildRules,
  isRuleViolation,
  ruleMatchesChannel,
  saveGuildRules,
} = require('../src/channelRules');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');
const { deleteRecentUserMessages } = require('../src/channelMessageDeletion');
const { enforceOutstandingMuteForMessage, executeSanction } = require('../src/moderationActionService');

const previousCreateServer = http.createServer.bind(http);
const SESSION_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
const DEFAULT_REPORT_TEMPLATE_ID = 'default-moderation-action-log';
const DELETE_NOTICE_TEMPLATE_ID = 'default-auto-moderator-user-warning';
const API_PATTERN = /^\/api\/guilds\/(\d{16,20})\/channel-rules$/;
let clientRef = null;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sessionUser(req) {
  try {
    const sessionId = parseCookies(req.headers.cookie || '').coinsprite_admin;
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8') || '{}').sessions?.[sessionId];
    return session?.user?.id && Number(session.expiresAt) > Date.now() ? session.user : null;
  } catch {
    return null;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function requireAdmin(req, res, guildId) {
  const user = sessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  const guild = clientRef?.guilds?.cache?.get(guildId) || await clientRef?.guilds?.fetch(guildId).catch(() => null);
  if (!guild) {
    sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    return null;
  }
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required.' });
    return null;
  }
  return guild;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 });
  }
}

async function handleChannelRulesApi(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const match = url.pathname.match(API_PATTERN);
  if (!match) return false;
  if (!['GET', 'PUT'].includes(req.method)) {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return true;
  }
  const guild = await requireAdmin(req, res, match[1]);
  if (!guild) return true;

  if (req.method === 'GET') {
    sendJson(res, 200, { guildId: guild.id, rules: getGuildRules(guild.id), contextTypes: CONTEXT_TYPES });
    return true;
  }

  try {
    const body = await readBody(req);
    const rules = saveGuildRules(guild.id, body.rules);
    sendJson(res, 200, { guildId: guild.id, rules, contextTypes: CONTEXT_TYPES });
  } catch (error) {
    sendJson(res, Number(error.statusCode) || 400, { error: error.message || 'Could not save channel rules.' });
  }
  return true;
}

http.createServer = function channelRulesServer(listener) {
  return previousCreateServer(async (req, res) => {
    try {
      if (await handleChannelRulesApi(req, res)) return;
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Channel rules request failed.' });
      else res.destroy();
      return;
    }
    listener(req, res);
  });
};

function messageUrl(message) {
  return message.url || 'https://discord.com/channels/' + message.guildId + '/' + message.channelId + '/' + message.id;
}

function replacePlaceholders(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => (
    Object.prototype.hasOwnProperty.call(replacements, token.toLowerCase()) ? replacements[token.toLowerCase()] : match
  ));
}

function applyPlaceholders(template, replacements) {
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replacePlaceholders(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replacePlaceholders(container.text, replacements),
    thumbnailUrl: replacePlaceholders(container.thumbnailUrl, replacements),
    imageUrl: replacePlaceholders(container.imageUrl, replacements),
  }));
  return copy;
}

function templateValues(message, rule, reason, actionName) {
  return {
    'moderation-action': actionName,
    'moderation-action-label': actionName,
    'moderation-reason': reason,
    'case-id': 'Channel rule',
    'case-type': 'channel_rule',
    'case-status': 'reported',
    duration: 'N/A',
    expires: 'N/A',
    appealable: 'Yes',
    'appealable-status': 'Yes',
    evidence: messageUrl(message),
    'message-link': messageUrl(message),
    'message-content': String(message.content || '[attachment]').slice(0, 1200),
    'server-name': message.guild?.name || 'this server',
    'guild-name': message.guild?.name || 'this server',
    mention: '<@' + message.author.id + '>',
    username: message.author.username || message.author.id,
    user: message.author.username || message.author.id,
    'user-id': message.author.id,
    'moderator-id': message.client?.user?.id || '',
    moderator: '<@' + (message.client?.user?.id || '') + '>',
    channel: '<#' + message.channelId + '>',
    'channel-rule': rule.name,
    avatar_url: message.author.displayAvatarURL?.({ size: 256 }) || '',
  };
}

async function sendTemplate(template, message, replacements, destination) {
  if (!template || !destination) return false;
  const payload = buildMessagePayload(applyPlaceholders(template, replacements), {
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
  });
  payload.allowedMentions = { parse: [], users: [message.author.id], roles: [] };
  await destination.send(payload);
  return true;
}

async function reportMessage(message, rule, action) {
  const channelId = String(action.reportChannelId || '').trim();
  if (!channelId) return;
  const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const reason = action.reason || ('Channel rule violation: ' + rule.name);
  const template = findTemplate(message.guildId, DEFAULT_REPORT_TEMPLATE_ID);
  if (template) {
    await sendTemplate(template, message, templateValues(message, rule, reason, 'report'), channel).catch(() => null);
    return;
  }
  await channel.send({
    allowedMentions: { parse: [] },
    content: [
      '**Channel rule report**',
      '**Rule:** ' + rule.name,
      '**User:** <@' + message.author.id + '> (' + message.author.id + ')',
      '**Channel:** <#' + message.channelId + '>',
      '**Reason:** ' + reason,
      '**Evidence:** ' + messageUrl(message),
    ].join('\n'),
  }).catch(() => null);
}

async function sendConfiguredMessage(message, rule, action) {
  const template = findTemplate(message.guildId, action.templateId);
  if (!template || template.botDefault || template.defaultLocked || template.type === 'folder') return;
  const values = templateValues(message, rule, 'Channel rule violation: ' + rule.name, 'send_message');
  const destination = action.ephemeral ? message.author : message.channel;
  await sendTemplate(template, message, values, destination).catch(() => null);
}

async function sendDeleteNotice(message, rule, reason) {
  const template = findTemplate(message.guildId, DELETE_NOTICE_TEMPLATE_ID);
  if (!template) {
    await message.author.send('Your message in **' + message.guild.name + '** was removed.\n**Reason:** ' + reason).catch(() => null);
    return;
  }
  await sendTemplate(template, message, templateValues(message, rule, reason, 'delete'), message.author).catch(() => null);
}

async function runRuleActions(message, rule) {
  let deleted = false;
  let sanctioned = false;
  for (const action of rule.actions) {
    const reason = action.reason || ('Channel rule violation: ' + rule.name);
    if (action.type === 'delete') {
      const result = await deleteRecentUserMessages(message, action.amount);
      deleted = result.deleted > 0 || deleted;
    } else if (action.type === 'report') {
      await reportMessage(message, rule, action);
    } else if (action.type === 'send_message') {
      await sendConfiguredMessage(message, rule, action);
    } else if (['mute', 'kick', 'ban'].includes(action.type)) {
      sanctioned = true;
      await executeSanction({
        guild: message.guild,
        member: message.member,
        user: message.author,
        moderatorId: message.client?.user?.id || '',
        action: action.type,
        reason,
        time: action.time,
        appealable: true,
        source: 'channel_rule',
        sourceChannelId: message.channelId,
      }).catch((error) => {
        console.error('Channel rule sanction failed:', error);
      });
    }
  }
  if (deleted && !sanctioned) {
    const action = rule.actions.find((item) => item.type === 'delete');
    await sendDeleteNotice(message, rule, action?.reason || ('Channel rule violation: ' + rule.name));
  }
}

module.exports = {
  allowTextlessMessages: true,
  data: new SlashCommandBuilder()
    .setName('channel-rules')
    .setDescription('Show channel content rule status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async init(client) {
    clientRef = client;
  },

  async execute(interaction) {
    const rules = getGuildRules(interaction.guildId);
    await interaction.reply({
      content: [
        'Channel content rules: **' + rules.filter((rule) => rule.enabled).length + ' enabled**',
        'Configured rules: **' + rules.length + '**',
        'Open the Moderator tab in the web dashboard to edit channel rules.',
      ].join('\n'),
      ephemeral: true,
    });
  },

  async handleMessageCreate(message) {
    if (!message?.guild || message.author?.bot || message.webhookId || message.__coinSpriteChannelRuleHandled) return;
    if (await enforceOutstandingMuteForMessage(message)) {
      message.__coinSpriteChannelRuleHandled = true;
      return;
    }
    const types = classifyMessage(message);
    const rule = getGuildRules(message.guildId).find((item) => (
      item.enabled && item.channelIds.length && item.actions.length && ruleMatchesChannel(item, message) && isRuleViolation(item, types)
    ));
    if (!rule) return;
    message.__coinSpriteChannelRuleHandled = true;
    await runRuleActions(message, rule);
  },
};
