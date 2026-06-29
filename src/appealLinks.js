'use strict';

const COMPONENTS_V2_FLAG = 32768;
const DISABLED_LINK_FALLBACK = 'https://discord.com';

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

function appealCaseUrl(record = {}) {
  const base = publicBaseUrl();
  if (!base) return '';
  const url = new URL('/appeal', base + '/');
  if (record.guildId) url.searchParams.set('guild', String(record.guildId));
  if (record.id) url.searchParams.set('case', String(record.id));
  return url.toString();
}

function appealButtonRow(record = {}) {
  const url = appealCaseUrl(record);
  const appealable = record.appealable !== false && Boolean(record.id) && Boolean(url);
  return {
    type: 1,
    components: [{
      type: 2,
      style: 5,
      label: record.appealable === false ? 'Appeal unavailable' : url ? 'Submit appeal' : 'Appeal form unavailable',
      url: url || DISABLED_LINK_FALLBACK,
      disabled: !appealable,
    }],
  };
}

function withAppealButton(payload, record = {}) {
  const next = payload && typeof payload === 'object' ? payload : {};
  next.flags = (Number(next.flags) || 0) | COMPONENTS_V2_FLAG;
  next.components = Array.isArray(next.components) ? next.components : [];
  next.components.push(appealButtonRow(record));
  return next;
}

module.exports = {
  appealButtonRow,
  appealCaseUrl,
  publicBaseUrl,
  withAppealButton,
};
