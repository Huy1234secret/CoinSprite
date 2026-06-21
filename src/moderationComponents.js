const { MessageFlags } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const COLORS = Object.freeze({
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xf1c40f,
  neutral: 0x5865f2,
});

function truncate(value, maximum = 3800) {
  const text = String(value || '');
  return text.length <= maximum ? text : text.slice(0, maximum - 1) + '…';
}

function textContainer(accentColor, title, body, options = {}) {
  const heading = title ? '## ' + truncate(title, 120) : '';
  const content = truncate([heading, body].filter(Boolean).join('\n'), 3900);
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: options.allowedMentions || { parse: [] },
    components: [{
      type: 17,
      accent_color: accentColor,
      components: [{ type: 10, content }],
    }],
  };
}

function moderationSuccessContainer(title, body) {
  return textContainer(COLORS.success, title, body);
}

function moderationErrorContainer(title, body) {
  return textContainer(COLORS.error, title, body);
}

function warningNoticeContainer({ record, points, guildName, mentionUserId = '' }) {
  const expiry = record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':R>' : 'never';
  const body = [
    mentionUserId ? '<@' + mentionUserId + '>' : '',
    'You received a warning in **' + (guildName || 'this server') + '**.',
    '**Case:** ' + record.id,
    '**Reason:** ' + record.reason,
    '**Points:** +' + record.points + ' (' + points + ' active total)',
    '**Expires:** ' + expiry,
    record.evidence ? '**Evidence:** ' + record.evidence : '',
  ].filter(Boolean).join('\n');
  return textContainer(COLORS.warning, 'Warning notice', body, {
    allowedMentions: mentionUserId ? { parse: [], users: [mentionUserId] } : { parse: [] },
  });
}

function caseHistoryContainer({ target, cases, activePoints }) {
  const entries = cases.slice(0, 10).map((record) => {
    const expiry = record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':R>' : 'never';
    return [
      '**' + record.id + '** · ' + record.points + ' point(s) · ' + record.status,
      record.reason,
      'Expires ' + expiry,
    ].join('\n');
  });
  const body = [
    '**Active points:** ' + activePoints,
    entries.length ? entries.join('\n\n') : 'No warning cases.',
    cases.length > 10 ? 'Showing 10 of ' + cases.length + ' cases.' : '',
  ].filter(Boolean).join('\n\n');
  return textContainer(COLORS.neutral, 'Warning history for ' + (target?.username || target?.displayName || 'member'), body);
}

function caseDetailContainer(record) {
  const expiry = record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':F>' : 'never';
  const latestEvents = record.events.slice(-8).reverse().map((event) => {
    return '- <t:' + Math.floor(event.createdAt / 1000) + ':f> · ' + event.type + (event.actorId ? ' · <@' + event.actorId + '>' : '');
  });
  const body = [
    '**Target:** <@' + record.targetUserId + '>',
    '**Type:** ' + record.type,
    '**Status:** ' + record.status,
    '**Points:** ' + record.points,
    '**Source:** ' + record.source,
    '**Reason:** ' + record.reason,
    '**Expires:** ' + expiry,
    record.evidence ? '**Evidence:** ' + record.evidence : '',
    '**Notice delivery:** ' + (record.references?.notification?.status || 'unknown'),
    '**Notification message:** ' + (record.references?.notification?.messageId || 'not recorded'),
    '**Staff log message:** ' + (record.references?.staffLog?.messageId || 'not recorded'),
    '',
    '**Recent audit events**',
    latestEvents.length ? latestEvents.join('\n') : 'No audit events.',
  ].filter((line) => line !== null && line !== undefined).join('\n');
  return textContainer(COLORS.neutral, 'Case ' + record.id, body);
}

module.exports = {
  COLORS,
  COMPONENTS_V2_FLAG,
  caseDetailContainer,
  caseHistoryContainer,
  moderationErrorContainer,
  moderationSuccessContainer,
  warningNoticeContainer,
};
