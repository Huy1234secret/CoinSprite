const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('./serverConfig');
const store = require('./moderationCaseStore');
const { moderationErrorContainer, moderationSuccessContainer, warningNoticeContainer } = require('./moderationComponents');

const DAY_MS = 24 * 60 * 60 * 1000;

function warningConfig(guildId) {
  const config = getGuildConfig(guildId);
  const warnings = config?.moderation?.warnings || {};
  return {
    enabled: Boolean(warnings.enabled),
    defaultExpiryDays: Math.max(0, Math.min(3650, Number(warnings.defaultExpiryDays) || 90)),
    fallbackChannelId: String(warnings.fallbackChannelId || ''),
    staffLogChannelId: String(warnings.staffLogChannelId || ''),
    escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : [])
      .map((rule) => ({
        threshold: Math.max(1, Math.round(Number(rule?.threshold) || 1)),
        action: ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule?.action) ? rule.action : 'staff_alert',
        durationSeconds: Math.max(1, Math.min(2419200, Number(rule?.durationSeconds) || 3600)),
        enabled: rule?.enabled !== false,
      }))
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
  if (!text) return defaultDays > 0 ? now + defaultDays * DAY_MS : null;
  if (['never', 'none', 'permanent'].includes(text)) return null;
  const match = text.match(/^(\d+)\s*(m|h|d|w)$/);
  if (!match) throw new Error('Expiry must use formats such as 30m, 12h, 7d, 4w, or never.');
  const amount = Number(match[1]);
  const units = { m: 60000, h: 3600000, d: DAY_MS, w: 7 * DAY_MS };
  const duration = amount * units[match[2]];
  if (!Number.isFinite(duration) || duration < 60000 || duration > 3650 * DAY_MS) throw new Error('Expiry must be between 1 minute and 10 years.');
  return now + duration;
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

async function notifyMember(guild, member, record, config) {
  const points = store.activePoints(guild.id, member.id);
  try {
    const message = await member.send(warningNoticeContainer({ record, points, guildName: guild.name }));
    store.updateDelivery(guild.id, record.id, { status: 'dm', channelId: message.channelId || '', messageId: message.id || '' });
    return 'dm';
  } catch (error) {
    const fallback = await textChannel(guild, config.fallbackChannelId);
    if (fallback?.isTextBased?.()) {
      try {
        const message = await fallback.send(warningNoticeContainer({
          record,
          points,
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

async function executeRule(guild, member, record, rule, points, config) {
  const event = { threshold: rule.threshold, action: rule.action, success: false, detail: '' };
  try {
    if (rule.action === 'timeout') {
      if (!member.moderatable || typeof member.timeout !== 'function') throw new Error('Member is not moderatable.');
      await member.timeout(rule.durationSeconds * 1000, 'Warning threshold ' + rule.threshold + ' reached (' + record.id + ')');
    } else if (rule.action === 'kick') {
      if (!member.kickable || typeof member.kick !== 'function') throw new Error('Member is not kickable.');
      await member.kick('Warning threshold ' + rule.threshold + ' reached (' + record.id + ')');
    } else if (rule.action === 'ban') {
      if (!member.bannable || typeof member.ban !== 'function') throw new Error('Member is not bannable.');
      await member.ban({ reason: 'Warning threshold ' + rule.threshold + ' reached (' + record.id + ')' });
    } else {
      await logToStaff(guild, config, 'Warning threshold alert: <@' + member.id + '> reached **' + points + ' points** at threshold ' + rule.threshold + ' (case ' + record.id + ').');
    }
    event.success = true;
    event.detail = rule.action === 'timeout' ? rule.durationSeconds + ' seconds' : 'completed';
  } catch (error) {
    event.detail = String(error?.message || error || 'Unknown enforcement error').slice(0, 500);
    await logToStaff(guild, config, 'Warning enforcement failed for <@' + member.id + '> at threshold ' + rule.threshold + ': ' + event.detail);
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
    if (rule) events.push(await executeRule(guild, member, record, rule, claim.points, config));
  }
  return { points: claim.points, events };
}

async function createWarning(input) {
  const guild = input.guild;
  if (!guild?.id) throw new Error('A guild is required.');
  const config = warningConfig(guild.id);
  if (!config.enabled && !input.allowWhenDisabled) throw new Error('The warning system is disabled for this server.');
  const member = input.member || await guild.members.fetch(String(input.memberId || '')).catch(() => null);
  if (!member) throw new Error('Member was not found in this server.');
  const points = Math.max(1, Math.min(10, Math.round(Number(input.points) || 1)));
  const expiresAt = input.expiresAt !== undefined
    ? input.expiresAt
    : parseDuration(input.expires, config.defaultExpiryDays);
  const record = store.createCase({
    guildId: guild.id,
    type: input.source === 'automod' ? 'automod_warning' : 'warning',
    targetUserId: member.id,
    authorId: String(input.moderatorId || ''),
    source: String(input.source || 'manual'),
    reason: safeReason(input.reason),
    staffNotes: String(input.staffNotes || ''),
    points,
    evidence: validateEvidence(input.evidence),
    sourceChannelId: String(input.sourceChannelId || ''),
    sourceMessageId: String(input.sourceMessageId || ''),
    expiresAt,
  });
  const delivery = await notifyMember(guild, member, record, config);
  const evaluation = await evaluateMember(guild, member, record, config);
  const staffLog = await logToStaff(guild, config, 'Warning ' + record.id + ': <@' + member.id + '> received ' + points + ' point(s) from ' + record.source + '. Active total: ' + evaluation.points + '.');
  if (staffLog) store.updateStaffLog(guild.id, record.id, { channelId: staffLog.channelId || config.staffLogChannelId, messageId: staffLog.id || '' });
  return { case: store.getCase(guild.id, record.id), points: evaluation.points, delivery, enforcementEvents: evaluation.events };
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
  const evaluation = member ? await evaluateMember(input.guild, member, record) : { points: store.activePoints(input.guild.id, record.memberId), events: [] };
  return { case: store.getCase(input.guild.id, record.id), points: evaluation.points, enforcementEvents: evaluation.events };
}

async function pardonWarning(input) {
  const record = store.pardonCase(input.guild.id, input.caseId, input.moderatorId, safeReason(input.reason));
  if (!record) throw new Error('Warning case was not found.');
  return { case: record, points: store.activePoints(input.guild.id, record.memberId) };
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
