'use strict';

const FALLBACK_URL = 'https://discord.com';

function publicBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  try {
    const redirect = new URL(process.env.DISCORD_REDIRECT_URI || '');
    return redirect.origin;
  } catch {
    return '';
  }
}

function caseAppealUrl(record) {
  const base = publicBaseUrl();
  if (!base) return '';
  const url = new URL(base + '/appeal');
  if (record?.guildId) url.searchParams.set('guild', String(record.guildId));
  if (record?.id) url.searchParams.set('case', String(record.id));
  return url.toString();
}

function appealButtonRow(record) {
  const url = caseAppealUrl(record);
  const disabled = record?.appealable === false || !url;
  return {
    type: 1,
    components: [{
      type: 2,
      style: 5,
      label: record?.appealable === false ? 'Appeal unavailable' : 'Submit an appeal',
      url: url || FALLBACK_URL,
      disabled,
    }],
  };
}

function withAppealButton(payload, record) {
  const copy = { ...(payload || {}) };
  copy.components = [...(Array.isArray(payload?.components) ? payload.components : []), appealButtonRow(record)];
  return copy;
}

module.exports = {
  appealButtonRow,
  caseAppealUrl,
  publicBaseUrl,
  withAppealButton,
};
