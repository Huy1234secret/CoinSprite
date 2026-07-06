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
  const suppliedBuffer = Buffer.isBuffer(attachment?.buffer) ? attachment.buffer : null;
  if (!record?.url && !suppliedBuffer) return null;
  if (record.size > MAX_EVIDENCE_BYTES) throw new Error('Evidence files must be 25 MB or smaller.');
  let data = suppliedBuffer;
  if (!data) {
    const response = await fetch(record.url);
    if (!response.ok) throw new Error('The evidence upload could not be downloaded.');
    data = Buffer.from(await response.arrayBuffer());
  }
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
  return {
    'moderation-action': action,
    'moderation-action-label': action === 'warning' ? 'warned' : action === 'mute' ? 'muted' : action === 'kick' ? 'kicked' : 'banned',
    'moderation-reason': record.reason,
    'case-id': record.id,
    duration: formatDuration(durationMs),
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
    const message = await user.send(withAppealButton(payload, record));
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

function moderationLogValues(guild, user, record, action, durationMs, moderatorId) {
  return {
    ...noticeValues(guild, user, record, action, durationMs),
    'moderator-id': moderatorId,
    moderator: '<@' + moderatorId + '>',
    'case-type': record.type,
    'case-status': record.status,
    evidence: record.attachments?.length
      ? record.attachments.map((item) => item.name).join(', ')
      : record.evidence || 'None',
  };
}

function addEvidenceGallery(payload, guildId, record) {
  const files = [];
  const images = [];
  const otherFiles = [];
  for (const [index, attachment] of (record.attachments || []).slice(0, 10).entries()) {
    const name = safeFilename(attachment.name || attachment.storedName || ('evidence-' + (index + 1)));
    let mediaUrl = String(attachment.url || '');
    if (attachment.storedName) {
      const storedPath = evidencePath(guildId, record.id, attachment.storedName);
      if (storedPath && fs.existsSync(storedPath)) {
        files.push({ attachment: storedPath, name });
        mediaUrl = 'attachment://' + name;
      }
    }
    if (!mediaUrl) continue;
    if (/^image\//i.test(String(attachment.contentType || ''))) {
      images.push({ media: { url: mediaUrl }, description: attachment.name || name });
    } else if (mediaUrl.startsWith('attachment://')) {
      otherFiles.push({ type: 13, file: { url: mediaUrl } });
    }
  }
  if (images.length) payload.components.push({ type: 12, items: images });
  payload.components.push(...otherFiles);
  if (files.length) payload.files = files;
  return payload;
}

async function logSanction(guild, record, action, moderatorId, user, durationMs = null) {
  const config = getGuildConfig(guild.id);
  const event = action === 'warning' ? 'warning' : 'action';
  const channelId = resolveLoggingChannelId(
    config,
    'moderation',
    event,
    config?.moderation?.warnings?.staffLogChannelId || '',
  );
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;

  let targetUser = user || null;
  if (!targetUser && guild.client?.users?.fetch) {
    targetUser = await guild.client.users.fetch(record.memberId).catch(() => null);
  }
  targetUser ||= { id: record.memberId, username: record.memberId };
  const template = messageTemplates.findTemplate(guild.id, 'default-moderation-action-log');
  const values = moderationLogValues(guild, targetUser, record, action, durationMs, moderatorId);
  let payload;
  if (template) {
    payload = messageTemplates.buildMessagePayload(applyNoticeValues(template, values), { guild, user: targetUser });
  } else {
    payload = {
      flags: COMPONENTS_V2_FLAG,
      allowedMentions: { parse: [] },
      components: [{
        type: 17,
        accent_color: action === 'warning' ? 0xfee75c : 0xed4245,
        components: [{
          type: 10,
          content: [
            '## Moderation action',
            '**Action:** ' + action,
            '**Case:** `' + record.id + '`',
            '**User:** <@' + record.memberId + '> (`' + record.memberId + '`)',
            '**Moderator:** <@' + moderatorId + '>',
            '**Reason:** ' + record.reason,
            '**Appealable:** ' + (record.appealable ? 'Yes' : 'No'),
          ].join('\n'),
        }],
      }],
    };
  }
  addEvidenceGallery(payload, guild.id, record);
  const message = await channel.send(payload).catch(() => null);
  if (!message) return null;
  store.updateStaffLog(guild.id, record.id, { channelId: message.channelId, messageId: message.id });
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
      maximumMs: 10 * 365 * 86400000,
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
  const enforcementDurationMs = action === 'mute'
    ? Math.min(durationMs == null ? DISCORD_MAX_TIMEOUT_MS : durationMs, DISCORD_MAX_TIMEOUT_MS)
    : durationMs;
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
  await logSanction(guild, record, action, moderatorId, user, durationMs);
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

function selectOutstandingMute(guildId, memberId, now = Date.now()) {
  const records = store.listCases(guildId, { type: 'mute', status: 'active', memberId })
    .filter((record) => !hasSuccessfulReversal(record, 'unmute'))
    .filter((record) => record.expiresAt == null || Number(record.expiresAt) > now);
  return records.reduce((selected, record) => {
    if (!selected || record.expiresAt == null) return record;
    if (selected.expiresAt == null) return selected;
    return Number(record.expiresAt) > Number(selected.expiresAt) ? record : selected;
  }, null);
}

function remainingMuteDuration(record, now = Date.now()) {
  if (!record) return 0;
  if (record.expiresAt == null) return DISCORD_MAX_TIMEOUT_MS;
  return Math.max(0, Math.min(DISCORD_MAX_TIMEOUT_MS, Number(record.expiresAt) - now));
}

async function applyMuteSegment(guild, member, record, now = Date.now(), source = 'maintenance') {
  const durationMs = remainingMuteDuration(record, now);
  if (!durationMs || !member?.moderatable || typeof member.timeout !== 'function') return false;
  try {
    await member.timeout(durationMs, 'Continuing mute (' + record.id + ')');
    store.appendEvent(guild.id, record.id, 'enforcement.refreshed', '', {
      action: 'mute',
      durationMs,
      source,
      remainingMs: record.expiresAt == null ? null : Math.max(0, Number(record.expiresAt) - now),
    });
    return true;
  } catch (error) {
    console.error('Mute refresh failed for ' + record.id + ':', error);
    return false;
  }
}

async function enforceOutstandingMuteForMessage(message) {
  if (!message?.guild || !message.author?.id || message.author.bot) return false;
  const now = Date.now();
  const record = selectOutstandingMute(message.guild.id, message.author.id, now);
  if (!record) return false;

  if (message.deletable) await message.delete().catch(() => null);
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return true;

  const disabledUntil = Number(member.communicationDisabledUntilTimestamp)
    || Number(member.communicationDisabledUntil?.getTime?.())
    || 0;
  if (disabledUntil <= now + 1000) {
    await applyMuteSegment(message.guild, member, record, now, 'message_guard');
  }
  return true;
}

async function refreshOutstandingMutes(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const records = store.listCases(guild.id, { type: 'mute', status: 'active' })
      .filter((record) => !hasSuccessfulReversal(record, 'unmute'));
    const strongestByMember = new Map();
    for (const record of records) {
      const selected = strongestByMember.get(record.memberId);
      if (!selected || record.expiresAt == null || (selected.expiresAt != null && Number(record.expiresAt) > Number(selected.expiresAt))) {
        strongestByMember.set(record.memberId, record);
      }
    }

    for (const record of strongestByMember.values()) {
      const member = await guild.members.fetch(record.memberId).catch(() => null);
      if (!member?.moderatable || typeof member.timeout !== 'function') continue;
      const disabledUntil = Number(member.communicationDisabledUntilTimestamp)
        || Number(member.communicationDisabledUntil?.getTime?.())
        || 0;
      if (disabledUntil > now + PERMANENT_MUTE_REFRESH_THRESHOLD_MS) continue;
      await applyMuteSegment(guild, member, record, now, 'maintenance');
    }
  }
}

async function maintainSanctions(client) {
  await cleanupTemporaryBans(client);
  await refreshOutstandingMutes(client);
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
  enforceOutstandingMuteForMessage,
  attachmentRecord,
  evidencePath,
  formatDuration,
  persistEvidence,
  initSanctionService,
  logSanction,
  maintainSanctions,
  parseActionDuration,
  remainingMuteDuration,
  selectOutstandingMute,
};


// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["004-channel-rule-explicit-reports.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const sanctions = require('../src/moderationActionService');

const PATCH_MARKER = Symbol.for('coinsprite.channelRuleExplicitReports');

function guildWithoutStaffLogChannels(guild) {
  if (!guild?.channels) return guild;
  const shadow = Object.create(guild);
  Object.defineProperty(shadow, 'channels', {
    configurable: true,
    enumerable: true,
    value: {
      cache: new Map(),
      fetch: async () => null,
    },
  });
  return shadow;
}

if (!sanctions.executeSanction?.[PATCH_MARKER]) {
  const nativeExecuteSanction = sanctions.executeSanction;
  const executeSanction = async (input) => {
    if (input?.source !== 'channel_rule') return nativeExecuteSanction(input);
    return nativeExecuteSanction({
      ...input,
      guild: guildWithoutStaffLogChannels(input.guild),
    });
  };
  Object.defineProperty(executeSanction, PATCH_MARKER, { value: true });
  sanctions.executeSanction = executeSanction;
}

module.exports = {
  guildWithoutStaffLogChannels,
};
    }],
  ];
  for (const [name, factory] of fixes) {
    const filename = require('path').join(__dirname, '..', 'commands', name);
    const fixModule = new ConsolidatedFixModule(filename, module);
    fixModule.filename = filename;
    fixModule.paths = ConsolidatedFixModule._nodeModulePaths(require('path').dirname(filename));
    require.cache[filename] = fixModule;
    factory.call(fixModule.exports, fixModule, fixModule.exports, fixModule.require.bind(fixModule), filename, require('path').dirname(filename));
    fixModule.loaded = true;
  }
})();
