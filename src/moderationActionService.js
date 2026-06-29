'use strict';

const fs = require('fs');
const path = require('path');
const { getGuildConfig, resolveLoggingChannelId } = require('./serverConfig');
const store = require('./moderationCaseStore');
const messageTemplates = require('./messageTemplates');
const { withAppealButton } = require('./appealLinks');

const COMPONENTS_V2_FLAG = 32768;
const DISCORD_MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const PERMANENT_MUTE_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const EVIDENCE_ROOT = process.env.MODERATION_EVIDENCE_PATH
  || path.join(__dirname, '..', 'data', 'moderation-evidence');
const ACTION_LOG_TEMPLATE_ID = 'default-moderation-action-log';
const NOTICE_TEMPLATE_IDS = Object.freeze({
  mute: 'default-moderation-mute-notice',
  kick: 'default-moderation-kick-notice',
  ban: 'default-moderation-ban-notice',
});
let cleanupTimer = null;

function parseActionDuration(value, options = {}) {
  const text = String(value || '').trim().toLowerCase();
  if (options.allowPermanent && (!text || ['permanent', 'perm', 'never'].includes(text))) return null;
  const match = text.match(/^(\d+)\s*(m|h|d|w)$/);
  if (!match) {
    const suffix = options.allowPermanent ? ', or permanent' : '';
    throw new Error('Time must use formats such as 30m, 12h, 7d, or 4w' + suffix + '.');
  }
  const units = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const durationMs = Number(match[1]) * units[match[2]];
  const maximum = Number(options.maximumMs) || 10 * 365 * 86400000;
  if (!Number.isFinite(durationMs) || durationMs < 60000 || durationMs > maximum) {
    throw new Error('Time must be between 1 minute and ' + Math.floor(maximum / 86400000) + ' days.');
  }
  return durationMs;
}

function formatDuration(durationMs) {
  if (durationMs == null) return 'Permanent';
  const seconds = Math.max(60, Math.round(durationMs / 1000));
  for (const [label, size] of [['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (seconds >= size && seconds % size === 0) {
      const amount = seconds / size;
      return amount + ' ' + label + (amount === 1 ? '' : 's');
    }
  }
  return seconds + ' seconds';
}

function safeFilename(value) {
  const name = String(value || 'evidence.bin').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return name.slice(0, 180) || 'evidence.bin';
}

function attachmentRecord(attachment) {
  if (!attachment) return null;
  return {
    name: safeFilename(attachment.name || 'evidence.bin'),
    contentType: String(attachment.contentType || '').slice(0, 120),
    size: Math.max(0, Number(attachment.size) || 0),
    url: String(attachment.url || '').slice(0, 2000),
    storedName: '',
  };
}

async function persistEvidence(guildId, caseId, attachment) {
  const record = attachmentRecord(attachment);
  if (!record?.url) return null;
  if (record.size > MAX_EVIDENCE_BYTES) throw new Error('Evidence files must be 25 MB or smaller.');
  const response = await fetch(record.url);
  if (!response.ok) throw new Error('The evidence upload could not be downloaded.');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_EVIDENCE_BYTES) throw new Error('Evidence files must be 25 MB or smaller.');
  const storedName = safeFilename(record.name);
  const directory = path.join(EVIDENCE_ROOT, String(guildId), String(caseId));
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(path.join(directory, storedName), data);
  return { ...record, size: data.length, storedName };
}

function evidencePath(guildId, caseId, storedName) {
  const safe = safeFilename(storedName);
  if (!safe || safe !== String(storedName || '')) return null;
  const target = path.resolve(EVIDENCE_ROOT, String(guildId), String(caseId), safe);
  const root = path.resolve(EVIDENCE_ROOT, String(guildId), String(caseId));
  return target.startsWith(root + path.sep) ? target : null;
}

function validateTarget(guild, member, user, moderatorId, action) {
  if (!user?.id) throw new Error('A user is required.');
  if (user.bot) throw new Error('Bots cannot receive moderation actions.');
  if (user.id === moderatorId) throw new Error('You cannot moderate yourself.');
  if (user.id === guild.ownerId) throw new Error('The server owner cannot be moderated.');
  if (action !== 'ban' && !member) throw new Error('That user is not a member of this server.');
  if (member && action === 'mute' && !member.moderatable) throw new Error('That member cannot be muted due to role hierarchy or permissions.');
  if (member && action === 'kick' && !member.kickable) throw new Error('That member cannot be kicked due to role hierarchy or permissions.');
  if (member && action === 'ban' && !member.bannable) throw new Error('That member cannot be banned due to role hierarchy or permissions.');
}

function replacePlaceholders(value, values) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => (
    Object.prototype.hasOwnProperty.call(values, token.toLowerCase()) ? values[token.toLowerCase()] : match
  ));
}

function noticeValues(guild, user, record, action, durationMs) {
  const normalizedAction = action === 'timeout' ? 'mute' : action;
  const actionLabel = {
    warn: 'warned',
    mute: 'muted',
    kick: 'kicked',
    ban: 'banned',
  }[normalizedAction] || 'moderated';
  return {
    'moderation-action': normalizedAction,
    'moderation-action-label': actionLabel,
    'moderation-action-title': normalizedAction[0].toUpperCase() + normalizedAction.slice(1),
    'moderation-reason': record.reason,
    'case-id': record.id,
    duration: normalizedAction === 'kick' ? 'N/A' : formatDuration(durationMs),
    expires: record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':R>' : 'N/A',
    appealable: record.appealable ? 'Yes' : 'No',
    'appealable-status': record.appealable ? 'Yes' : 'No',
    'server-name': guild.name || 'this server',
    'guild-name': guild.name || 'this server',
    mention: '<@' + user.id + '>',
    username: user.username || user.id,
    user: user.username || user.id,
    'user-id': user.id,
    avatar_url: user.displayAvatarURL?.({ size: 256 }) || '',
  };
}

function applyNoticeValues(template, values) {
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replacePlaceholders(copy.content, values);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replacePlaceholders(container.text, values),
    thumbnailUrl: replacePlaceholders(container.thumbnailUrl, values),
    imageUrl: replacePlaceholders(container.imageUrl, values),
  }));
  return copy;
}

function fallbackNotice(guild, record, action, durationMs) {
  const title = action === 'mute' ? 'You were muted' : action === 'kick' ? 'You were kicked' : 'You were banned';
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: 0xed4245,
      components: [{
        type: 10,
        content: [
          '## ' + title,
          '**Server:** ' + (guild.name || 'Unknown server'),
          '**Reason:** ' + record.reason,
          '**Duration:** ' + formatDuration(durationMs),
          '**Case:** `' + record.id + '`',
          '**Appealable:** ' + (record.appealable ? 'Yes' : 'No'),
        ].join('\n'),
      }],
    }],
  };
}

async function sendNotice(guild, user, record, action, durationMs) {
  try {
    const template = messageTemplates.findTemplate(guild.id, NOTICE_TEMPLATE_IDS[action]);
    const payload = template
      ? messageTemplates.buildMessagePayload(applyNoticeValues(template, noticeValues(guild, user, record, action, durationMs)), { guild, user })
      : fallbackNotice(guild, record, action, durationMs);
    withAppealButton(payload, record);
    const message = await user.send(payload);
    store.updateDelivery(guild.id, record.id, {
      status: 'dm',
      channelId: message.channelId || '',
      messageId: message.id || '',
    });
    return 'dm';
  } catch (error) {
    store.updateDelivery(guild.id, record.id, {
      status: 'failed',
      error: String(error?.message || error).slice(0, 500),
    });
    return 'failed';
  }
}

function appendEvidenceGallery(payload, record) {
  const items = (Array.isArray(record.attachments) ? record.attachments : [])
    .filter((attachment) => /^(?:image|video)\//i.test(String(attachment.contentType || '')) && /^https?:\/\//i.test(String(attachment.url || '')))
    .slice(0, 10)
    .map((attachment) => ({
      media: { url: attachment.url },
      description: String(attachment.name || 'Moderation evidence').slice(0, 1024),
    }));
  if (!items.length) return payload;
  const gallery = { type: 12, items };
  const container = payload.components?.find((component) => component.type === 17);
  if (container?.components) container.components.push(gallery);
  else payload.components.push(gallery);
  return payload;
}

function fallbackLogPayload(guild, user, record, action, moderatorId, durationMs) {
  const values = noticeValues(guild, user, record, action, durationMs);
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: 0xed4245,
      components: [{
        type: 10,
        content: [
          '## ' + values['moderation-action-label'][0].toUpperCase() + values['moderation-action-label'].slice(1) + ' `' + record.id + '`',
          '**User:** <@' + record.memberId + '> (`' + record.memberId + '`)',
          '**Reason:** ' + record.reason,
          '**Duration:** ' + formatDuration(durationMs),
          '**Moderator:** <@' + moderatorId + '>',
          '**Appealable:** ' + (record.appealable ? 'Yes' : 'No'),
        ].join('\n'),
      }],
    }],
  };
}

async function logSanction(guild, record, action, moderatorId, durationMs = null, targetUser = null) {
  const config = getGuildConfig(guild.id);
  const channelId = resolveLoggingChannelId(config, 'moderation', 'action', config?.moderation?.warnings?.staffLogChannelId);
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const user = targetUser
    || await guild.client?.users?.fetch?.(record.memberId).catch(() => null)
    || { id: record.memberId, username: record.memberId, displayAvatarURL: () => '' };
  const values = {
    ...noticeValues(guild, user, record, action, durationMs),
    'moderator-id': moderatorId,
    moderator: '<@' + moderatorId + '>',
    'moderator-mention': '<@' + moderatorId + '>',
    evidence: record.attachments?.length
      ? record.attachments.map((attachment) => attachment.name).join(', ')
      : record.evidence || 'None',
    timestamp: '<t:' + Math.floor(Date.now() / 1000) + ':f>',
  };
  const template = messageTemplates.findTemplate(guild.id, ACTION_LOG_TEMPLATE_ID);
  const payload = template
    ? messageTemplates.buildMessagePayload(applyNoticeValues(template, values), { guild, user })
    : fallbackLogPayload(guild, user, record, action, moderatorId, durationMs);
  appendEvidenceGallery(payload, record);
  const message = await channel.send(payload).catch(() => null);
  if (message) store.updateStaffLog(guild.id, record.id, { channelId: message.channelId || channel.id, messageId: message.id || '' });
  return message;
}

async function executeSanction(input) {
  const { guild, user, moderatorId } = input;
  const action = String(input.action || '').toLowerCase();
  if (!['mute', 'kick', 'ban'].includes(action)) throw new Error('Unsupported moderation action.');
  const member = input.member || await guild.members.fetch(user.id).catch(() => null);
  validateTarget(guild, member, user, moderatorId, action);
  const reason = String(input.reason || '').trim().slice(0, 1000);
  if (!reason) throw new Error('A reason is required.');
  const durationMs = action === 'kick'
    ? null
    : parseActionDuration(input.time, {
      allowPermanent: action !== 'kick',
      maximumMs: action === 'mute' ? DISCORD_MAX_TIMEOUT_MS : 10 * 365 * 86400000,
    });
  const expiresAt = durationMs == null ? null : Date.now() + durationMs;
  const initialAttachment = attachmentRecord(input.attachment);
  let record = store.createCase({
    guildId: guild.id,
    type: action,
    targetUserId: user.id,
    authorId: moderatorId,
    source: String(input.source || 'manual'),
    reason,
    evidence: initialAttachment?.url || '',
    attachments: initialAttachment ? [initialAttachment] : [],
    appealable: input.appealable !== false,
    expiresAt,
    sourceChannelId: input.sourceChannelId || '',
  });

  if (input.attachment) {
    try {
      const saved = await persistEvidence(guild.id, record.id, input.attachment);
      if (saved) record = store.updateCase(guild.id, record.id, { attachments: [saved] }, moderatorId);
      store.appendEvent(guild.id, record.id, 'evidence.saved', moderatorId, { name: saved?.name || initialAttachment?.name || '' });
    } catch (error) {
      store.appendEvent(guild.id, record.id, 'evidence.failed', moderatorId, { error: String(error?.message || error).slice(0, 500) });
      throw error;
    }
  }

  const auditReason = reason + ' (' + record.id + ')';
  const enforcementDurationMs = action === 'mute' && durationMs == null ? DISCORD_MAX_TIMEOUT_MS : durationMs;
  record = store.getCase(guild.id, record.id);
  const delivery = await sendNotice(guild, user, record, action, durationMs);
  try {
    if (action === 'mute') await member.timeout(enforcementDurationMs, auditReason);
    else if (action === 'kick') await member.kick(auditReason);
    else await guild.members.ban(user.id, { reason: auditReason });
    store.appendEnforcement(guild.id, record.id, {
      action,
      success: true,
      detail: action === 'kick' ? 'completed' : formatDuration(durationMs),
      createdAt: Date.now(),
    });
  } catch (error) {
    store.appendEnforcement(guild.id, record.id, {
      action,
      success: false,
      detail: String(error?.message || error).slice(0, 500),
      createdAt: Date.now(),
    });
    throw new Error('Discord rejected the ' + action + ' action: ' + (error?.message || 'unknown error'));
  }

  record = store.getCase(guild.id, record.id);
  await logSanction(guild, record, action, moderatorId, durationMs, user);
  return { case: store.getCase(guild.id, record.id), delivery, durationMs };
}

function hasSuccessfulReversal(record, action) {
  return (record.events || []).some((event) => (
    event.type === 'enforcement.reversed' && event.data?.action === action && event.data?.success !== false
  ));
}

async function cleanupTemporaryBans(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const cases = store.listCases(guild.id, { type: 'ban' });
    for (const record of cases) {
      if (!record.expiresAt || record.expiresAt > now || hasSuccessfulReversal(record, 'unban')) continue;
      try {
        await guild.bans.remove(record.memberId, 'Temporary ban expired (' + record.id + ')');
        store.appendEvent(guild.id, record.id, 'enforcement.reversed', '', { action: 'unban', success: true });
      } catch (error) {
        const code = Number(error?.code);
        if (code === 10026) {
          store.appendEvent(guild.id, record.id, 'enforcement.reversed', '', { action: 'unban', success: true, detail: 'Already unbanned' });
        }
      }
    }
  }
}

async function refreshPermanentMutes(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const cases = store.listCases(guild.id, { type: 'mute', status: 'active' });
    for (const record of cases) {
      if (record.expiresAt != null || hasSuccessfulReversal(record, 'unmute')) continue;
      const member = await guild.members.fetch(record.memberId).catch(() => null);
      if (!member?.moderatable || typeof member.timeout !== 'function') continue;
      const disabledUntil = Number(member.communicationDisabledUntilTimestamp)
        || Number(member.communicationDisabledUntil?.getTime?.())
        || 0;
      if (disabledUntil > now + PERMANENT_MUTE_REFRESH_THRESHOLD_MS) continue;
      try {
        await member.timeout(DISCORD_MAX_TIMEOUT_MS, 'Refreshing permanent mute (' + record.id + ')');
        store.appendEvent(guild.id, record.id, 'enforcement.refreshed', '', {
          action: 'mute',
          durationMs: DISCORD_MAX_TIMEOUT_MS,
        });
      } catch (error) {
        console.error('Permanent mute refresh failed for ' + record.id + ':', error);
      }
    }
  }
}

async function maintainSanctions(client) {
  await cleanupTemporaryBans(client);
  await refreshPermanentMutes(client);
}

function initSanctionService(client) {
  if (cleanupTimer) return;
  maintainSanctions(client).catch((error) => console.error('Sanction maintenance failed:', error));
  cleanupTimer = setInterval(() => {
    maintainSanctions(client).catch((error) => console.error('Sanction maintenance failed:', error));
  }, 60000);
  cleanupTimer.unref?.();
}

module.exports = {
  DISCORD_MAX_TIMEOUT_MS,
  EVIDENCE_ROOT,
  executeSanction,
  attachmentRecord,
  evidencePath,
  formatDuration,
  persistEvidence,
  initSanctionService,
  logSanction,
  maintainSanctions,
  parseActionDuration,
};
