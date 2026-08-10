const ALLOWED_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });

function formatInteger(value) {
  return BigInt(value ?? 0).toLocaleString('en-US');
}

function safeUsername(value) {
  return String(value || 'Member').replace(/[\r\n\0]/g, ' ').trim().slice(0, 80) || 'Member';
}

function clampPage(page, maximum) {
  const max = Math.max(1, Number(maximum) || 1);
  const parsed = Math.floor(Number(page) || 1);
  return Math.max(1, Math.min(max, parsed));
}

module.exports = {
  ALLOWED_MENTIONS,
  clampPage,
  formatInteger,
  safeUsername,
};
