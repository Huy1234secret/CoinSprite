const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('./serverConfig');
const store = require('./moderationCaseStore');
const messageTemplates = require('./messageTemplates');
const { attachmentRecord, logSanction, persistEvidence } = require('./moderationActionService');
const { withAppealButton } = require('./appealLinks');
const {
  moderationActionNoticeContainer,
  moderationErrorContainer,
  moderationSuccessContainer,
  warningNoticeContainer,
} = require('./moderationComponents');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTION_NOTICE_TEMPLATE_IDS = Object.freeze({
  timeout: 'default-warning-timeout-notice',
  kick: 'default-warning-kick-notice',
  ban: 'default-warning-ban-notice',
});
const ACTION_LABELS = Object.freeze({
  timeout: 'muted',
  kick: 'kicked',
  ban: 'banned',
  staff_alert: 'staff alerted',
});

function cleanRuleReason(value, action, threshold) {
  const reason = String(value || '').trim();
  if (reason) return reason.slice(0, 500);
  const label = ACTION_LABELS[action] || 'action taken';
  return ('Reached ' + threshold + ' active warnings; ' + label + '.').slice(0, 500);
}

function warningConfig(guildId) {
  const config = getGuildConfig(guildId);
  const warnings = config?.moderation?.warnings || {};
  return {
    enabled: Boolean(warnings.enabled),
    defaultExpiryDays: Math.max(0, Math.min(3650, Number(warnings.defaultExpiryDays) || 90)),
    fallbackChannelId: String(warnings.fallbackChannelId || ''),
    staffLogChannelId: resolveLoggingChannelId(config, 'moderation', 'warning', warnings.staffLogChannelId),
    escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : [])
      .map((rule) => {
        const threshold = Math.max(1, Math.round(Number(rule?.threshold) || 1));
        const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule?.action) ? rule.action : 'staff_alert';
        return {
          threshold,
          action,
          durationSeconds: Math.max(1, Math.min(2419200, Number(rule?.durationSeconds) || 3600)),
          reason: cleanRuleReason(rule?.reason, action, threshold),
          enabled: rule?.enabled !== false,
        };
      })
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.threshold - b.threshold),
  };
}

function canManageWarnings(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const staffRoleId = getGuildConfig(member.guild?.id)?.roles?.staff;
  return Boolean(staffRoleId && member.roles?.cache?.has?.(staffRoleId));
}

function parseDuration(value, defaultDays = 90, now = Date.now()) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (['never', 'none', 'permanent'].includes(text)) return null;
  const match = text.match(/^(\d+)\s*(m|h|d|w)$/);
  if (!match) throw new Error('Expiry must use formats such as 30m, 12h, 7d, 4w, or never.');
  const amount = Number(match[1]);
  const units = { m: 60000, h: 3600000, d: DAY_MS, w: 7 * DAY_MS };
  const duration = amount * units[match[2]];
  if (!Number.isFinite(duration) || duration < 60000 || duration > 3650 * DAY_MS) throw new Error('Expiry must be between 1 minute and 10 years.');
  return now + duration;
}

function formatDuration(seconds) {
  const total = Math.max(1, Math.round(Number(seconds) || 1));
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    if (total >= size && total % size === 0) {
      const amount = total / size;
      return amount + ' ' + name + (amount === 1 ? '' : 's');
    }
  }
  return total + ' second' + (total === 1 ? '' : 's');
}

function validateEvidence(value) {
  const evidence = String(value || '').trim();
  if (!evidence) return '';
  let url;
  try { url = new URL(evidence); } catch { throw new Error('Evidence must be a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Evidence must be a valid http or https URL.');
  return evidence.slice(0, 1000);
}

function safeReason(value) {
  const reason = String(value || '').trim();
  if (!reason) throw new Error('A warning reason is required.');
  return reason.slice(0, 1000);
}

async function textChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels?.cache?.get(channelId) || await guild.channels?.fetch?.(channelId).catch(() => null);
}

function actionNoticeValues(guild, member, record, rule, warningCount) {
  const expiresAt = rule.action === 'timeout' ? Date.now() + rule.durationSeconds * 1000 : null;
  return {
    'moderation-action': rule.action,
    'moderation-action-label': ACTION_LABELS[rule.action] || rule.action,
    'moderation-reason': rule.reason,
    'case-id': record.id,
    'warning-count': String(warningCount),
    'active-warnings': String(warningCount),
    threshold: String(rule.threshold),
    duration: rule.action === 'timeout' ? formatDuration(rule.durationSeconds) : 'N/A',
    expires: expiresAt ? '<t:' + Math.floor(expiresAt / 1000) + ':R>' : 'N/A',
    'server-name': guild.name || 'this server',
    'guild-name': guild.name || 'this server',
    mention: '<@' + member.id + '>',
    username: member.user?.username || member.displayName || member.id,
    user: member.user?.username || member.displayName || member.id,
    'user-id': member.id,
    avatar_url: member.user?.displayAvatarURL?.({ size: 256 }) || '',
  };
}

function replaceActionPlaceholders(text, values) {
  return String(text || '').replace(/<([a-z0-9_-]+)>/gi, (match, key) => {
    const normalized = String(key || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, normalized) ? values[normalized] : match;
  });
}

function applyActionNoticePlaceholders(template, values) {
  const clone = JSON.parse(JSON.stringify(template));
  clone.content = replaceActionPlaceholders(clone.content, values);
  clone.containers = (Array.isArray(clone.containers) ? clone.containers : []).map((container) => ({
    ...container,
    text: replaceActionPlaceholders(container.text, values),
    accentColor: replaceActionPlaceholders(container.accentColor, values),
    thumbnailUrl: replaceActionPlaceholders(container.thumbnailUrl, values),
    imageUrl: replaceActionPlaceholders(container.imageUrl, values),
  }));
  return clone;
}

async function sendActionNotice(guild, member, record, rule, warningCount) {
  const templateId = ACTION_NOTICE_TEMPLATE_IDS[rule.action];
  if (!templateId) return false;
  const durationText = rule.action === 'timeout' ? formatDuration(rule.durationSeconds) : '';
  try {
    const template = messageTemplates.findTemplate(guild.id, templateId);
    if (template) {
      const payload = messageTemplates.buildMessagePayload(
        applyActionNoticePlaceholders(template, actionNoticeValues(guild, member, record, rule, warningCount)),
        { guild, user: member.user, member },
      );
      await member.send(withAppealButton(payload, record));
    } else {
      await member.send(moderationActionNoticeContainer({
        action: rule.action,
        guildName: guild.name,
        reason: rule.reason,
        caseId: record.id,
        warningCount,
        durationText,
        record,
      }));
    }
    return true;
  } catch {
    return false;
  }
}

async function notifyMember(guild, member, record, config) {
  const warningCount = store.activeWarningCount(guild.id, member.id);
  try {
    const message = await member.send(warningNoticeContainer({ record, warningCount, guildName: guild.name }));
    store.updateDelivery(guild.id, record.id, { status: 'dm', channelId: message.channelId || '', messageId: message.id || '' });
    return 'dm';
  } catch (error) {
    const fallback = await textChannel(guild, config.fallbackChannelId);
    if (fallback?.isTextBased?.()) {
      try {
        const message = await fallback.send(warningNoticeContainer({
          record,
          warningCount,
          guildName: guild.name,
          mentionUserId: member.id,
        }));
        store.updateDelivery(guild.id, record.id, {
          status: 'fallback',
          channelId: fallback.id,
          messageId: message.id || '',
          error: String(error?.message || ''),
        });
        return 'fallback';
      } catch (fallbackError) {
        store.updateDelivery(guild.id, record.id, {
          status: 'failed',
          channelId: fallback.id,
          messageId: '',
          error: String(fallbackError?.message || ''),
        });
        return 'failed';
      }
    }
    store.updateDelivery(guild.id, record.id, {
      status: 'failed',
      channelId: '',
      messageId: '',
      error: String(error?.message || ''),
    });
    return 'failed';
  }
}

async function logToStaff(guild, config, text, error = false) {
  const channel = await textChannel(guild, config.staffLogChannelId);
  if (!channel?.isTextBased?.()) return null;
  const payload = error
    ? moderationErrorContainer('Moderation log', String(text).slice(0, 3500))
    : moderationSuccessContainer('Moderation log', String(text).slice(0, 3500));
  return channel.send(payload).catch(() => null);
}

async function executeRule(guild, member, record, rule, warningCount, config) {
  const event = {
    threshold: rule.threshold,
    action: rule.action,
    reason: rule.reason,
    warningCount,
    success: false,
    detail: '',
  };
  const actionReason = rule.reason + ' (' + record.id + ')';
  try {
    if (rule.action === 'timeout') {
      if (!member.moderatable || typeof member.timeout !== 'function') throw new Error('Member is not moderatable.');
      await sendActionNotice(guild, member, record, rule, warningCount);
      await member.timeout(rule.durationSeconds * 1000, actionReason);
    } else if (rule.action === 'kick') {
      if (!member.kickable || typeof member.kick !== 'function') throw new Error('Member is not kickable.');
      await sendActionNotice(guild, member, record, rule, warningCount);
      await member.kick(actionReason);
    } else if (rule.action === 'ban') {
      if (!member.bannable || typeof member.ban !== 'function') throw new Error('Member is not bannable.');
      await sendActionNotice(guild, member, record, rule, warningCount);
      await member.ban({ reason: actionReason });
    } else {
      await logToStaff(guild, config, 'Warning threshold alert: <@' + member.id + '> reached **' + warningCount + ' active warnings** at threshold ' + rule.threshold + ' (case ' + record.id + '). Reason: ' + rule.reason);
    }
    event.success = true;
    event.detail = rule.action === 'timeout' ? rule.durationSeconds + ' seconds' : 'completed';
  } catch (error) {
    event.detail = String(error?.message || error || 'Unknown enforcement error').slice(0, 500);
    await logToStaff(guild, config, 'Warning enforcement failed for <@' + member.id + '> at threshold ' + rule.threshold + ': ' + event.detail, true);
  }
  store.appendEnforcement(guild.id, record.id, event);
  return event;
}

async function evaluateMember(guild, member, record, config = warningConfig(guild.id)) {
  const rules = config.escalationRules;
  const claim = store.claimCrossedThresholds(guild.id, member.id, rules.map((rule) => rule.threshold));
  const events = [];
  for (const threshold of claim.thresholds) {
    const rule = rules.find((item) => item.threshold === threshold);
    if (rule) events.push(await executeRule(guild, member, record, rule, claim.warnings, config));
  }
  return { warnings: claim.warnings, points: claim.warnings, events };
}

async function createWarning(input) {
  const guild = input.guild;
  if (!guild?.id) throw new Error('A guild is required.');
  const config = warningConfig(guild.id);
  if (!config.enabled && !input.allowWhenDisabled) throw new Error('The warning system is disabled for this server.');
  const member = input.member || await guild.members.fetch(String(input.memberId || '')).catch(() => null);
  if (!member) throw new Error('Member was not found in this server.');
  const points = 1;
  const expiresAt = input.expiresAt !== undefined
    ? input.expiresAt
    : parseDuration(input.expires, config.defaultExpiryDays);
  const initialAttachment = attachmentRecord(input.attachment);
  let record = store.createCase({
    guildId: guild.id,
    type: /^automod(?:_|$)/.test(String(input.source || '')) ? 'automod_warning' : 'warning',
    targetUserId: member.id,
    authorId: String(input.moderatorId || ''),
    source: String(input.source || 'manual'),
    reason: safeReason(input.reason),
    staffNotes: String(input.staffNotes || ''),
    publicNote: String(input.publicNote || ''),
    points,
    evidence: initialAttachment?.url || validateEvidence(input.evidence),
    attachments: initialAttachment ? [initialAttachment] : [],
    appealable: input.appealable !== false,
    sourceChannelId: String(input.sourceChannelId || ''),
    sourceMessageId: String(input.sourceMessageId || ''),
    expiresAt,
  });
  if (input.attachment) {
    try {
      const saved = await persistEvidence(guild.id, record.id, input.attachment);
      if (saved) record = store.updateCase(guild.id, record.id, { attachments: [saved] }, input.moderatorId);
      store.appendEvent(guild.id, record.id, 'evidence.saved', input.moderatorId, { name: saved?.name || initialAttachment?.name || '' });
    } catch (error) {
      store.appendEvent(guild.id, record.id, 'evidence.failed', input.moderatorId, { error: String(error?.message || error).slice(0, 500) });
      throw error;
    }
  }
  const delivery = await notifyMember(guild, member, record, config);
  const evaluation = await evaluateMember(guild, member, record, config);
  await logSanction(
    guild,
    store.getCase(guild.id, record.id),
    'warning',
    String(input.moderatorId || ''),
    member.user,
  );
  return { case: store.getCase(guild.id, record.id), warnings: evaluation.warnings, points: evaluation.warnings, delivery, enforcementEvents: evaluation.events };
}

async function editWarning(input) {
  const current = store.getCase(input.guild.id, input.caseId);
  if (!current) throw new Error('Warning case was not found.');
  const patch = { ...input.patch };
  if (patch.reason !== undefined) patch.reason = safeReason(patch.reason);
  if (patch.evidence !== undefined) patch.evidence = validateEvidence(patch.evidence);
  if (patch.expires !== undefined) {
    patch.expiresAt = parseDuration(patch.expires, warningConfig(input.guild.id).defaultExpiryDays);
    delete patch.expires;
  }
  const record = store.updateCase(input.guild.id, input.caseId, patch, input.moderatorId);
  const member = await input.guild.members.fetch(record.memberId).catch(() => null);
  const fallbackWarnings = store.activeWarningCount(input.guild.id, record.memberId);
  const evaluation = member ? await evaluateMember(input.guild, member, record) : { warnings: fallbackWarnings, points: fallbackWarnings, events: [] };
  return { case: store.getCase(input.guild.id, record.id), warnings: evaluation.warnings, points: evaluation.warnings, enforcementEvents: evaluation.events };
}

async function pardonWarning(input) {
  const current = store.getCase(input.guild.id, input.caseId);
  if (!current) throw new Error('Moderation case was not found.');
  if (current.status === store.ACTIVE && current.type === 'mute') {
    const member = await input.guild.members.fetch(current.memberId).catch(() => null);
    if (!member?.moderatable || typeof member.timeout !== 'function') {
      throw new Error('The mute could not be reversed because the member is not moderatable.');
    }
    await member.timeout(null, 'Case pardoned (' + current.id + ')');
    store.appendEvent(input.guild.id, current.id, 'enforcement.reversed', input.moderatorId, {
      action: 'unmute',
      success: true,
    });
  }
  if (current.status === store.ACTIVE && current.type === 'ban') {
    await input.guild.bans.remove(current.memberId, 'Case pardoned (' + current.id + ')');
    store.appendEvent(input.guild.id, current.id, 'enforcement.reversed', input.moderatorId, {
      action: 'unban',
      success: true,
    });
  }
  const record = store.pardonCase(input.guild.id, input.caseId, input.moderatorId, safeReason(input.reason));
  const warnings = store.activeWarningCount(input.guild.id, record.memberId);
  return { case: record, warnings, points: warnings };
}

module.exports = {
  canManageWarnings,
  createWarning,
  editWarning,
  evaluateMember,
  parseDuration,
  pardonWarning,
  validateEvidence,
  warningConfig,
};
