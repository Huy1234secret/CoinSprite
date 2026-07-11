const crypto = require('crypto');

const fallbackSecret = crypto.randomBytes(32).toString('hex');

function tokenSecret() {
  return String(
    process.env.CLICK_SIMULATOR_SECRET
    || process.env.SESSION_SECRET
    || process.env.DISCORD_CLIENT_SECRET
    || process.env.DISCORD_TOKEN
    || fallbackSecret,
  );
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function cleanDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function createClickSimulatorToken({ userId, guildId, issuedAt = Date.now() } = {}) {
  const cleanUserId = cleanDiscordId(userId);
  if (!cleanUserId) throw new Error('A valid Discord user ID is required.');
  const payload = base64UrlJson({
    version: 1,
    userId: cleanUserId,
    guildId: cleanDiscordId(guildId),
    issuedAt: Number.isFinite(Number(issuedAt)) ? Number(issuedAt) : Date.now(),
  });
  return `${payload}.${signPayload(payload)}`;
}

function verifyClickSimulatorToken(token) {
  const [payload, signature] = String(token || '').trim().split('.');
  if (!payload || !signature || !safeEqual(signature, signPayload(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const userId = cleanDiscordId(parsed?.userId);
    if (!userId) return null;
    return {
      version: Number(parsed.version) || 1,
      userId,
      guildId: cleanDiscordId(parsed.guildId),
      issuedAt: Number(parsed.issuedAt) || 0,
    };
  } catch {
    return null;
  }
}

function publicWebBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configured) return configured;
  try {
    const redirect = new URL(process.env.DISCORD_REDIRECT_URI || '');
    return redirect.origin;
  } catch {
    return '';
  }
}

function clickSimulatorUrl(payload) {
  const baseUrl = publicWebBaseUrl();
  if (!baseUrl) return '';
  return `${baseUrl}/click-simulator?token=${encodeURIComponent(createClickSimulatorToken(payload))}`;
}

module.exports = {
  clickSimulatorUrl,
  createClickSimulatorToken,
  publicWebBaseUrl,
  verifyClickSimulatorToken,
};
