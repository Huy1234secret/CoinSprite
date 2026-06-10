const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { getEnabledGuildIds, getGuildConfig, loadState, saveState } = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_BODY_BYTES = 128 * 1024;
const COOKIE_NAME = 'coinsprite_admin';

const sessions = new Map();
let serverRef = null;

function getEnv() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    sessionSecret: process.env.SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex'),
    port: Number(process.env.ADMIN_WEB_PORT) || 3000,
    cookieSecure: String(process.env.ADMIN_COOKIE_SECURE || '').toLowerCase() === 'true',
  };
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionId(secret) {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `${raw}.${sign(raw, secret)}`;
}

function verifySessionId(value, secret) {
  const [raw, signature] = String(value || '').split('.');
  if (!raw || !signature) return false;
  const expected = sign(raw, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function setSessionCookie(res, sessionId, env) {
  const secure = env.cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function clearSessionCookie(res, env) {
  const secure = env.cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function getSession(req, res, env) {
  const sessionId = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (sessionId && verifySessionId(sessionId, env.sessionSecret) && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.touchedAt = Date.now();
    return { sessionId, session };
  }

  const newSessionId = createSessionId(env.sessionSecret);
  const session = { createdAt: Date.now(), touchedAt: Date.now(), user: null, oauthState: null };
  sessions.set(newSessionId, session);
  setSessionCookie(res, newSessionId, env);
  return { sessionId: newSessionId, session };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function redirect(res, location) {
  send(res, 302, '', { Location: location });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function serveAdminAsset(res, assetPath) {
  const normalized = path.normalize(assetPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ADMIN_DIR, normalized);
  const resolvedAdminDir = path.resolve(ADMIN_DIR);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedAdminDir && !resolvedFile.startsWith(`${resolvedAdminDir}${path.sep}`)) {
    send(res, 404, 'Not found');
    return;
  }

  fs.readFile(resolvedFile, (error, data) => {
    if (error) {
      send(res, 404, 'Not found');
      return;
    }
    send(res, 200, data, {
      'Content-Type': contentTypeFor(resolvedFile),
      'Cache-Control': resolvedFile.endsWith('.html') ? 'no-store' : 'public, max-age=300',
    });
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function exchangeCodeForToken(code, env) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.redirectUri,
  });

  const auth = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64');
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Discord token exchange failed with ${response.status}`);
  }
  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord user fetch failed with ${response.status}`);
  }
  return response.json();
}

async function fetchAccessibleGuilds(client, userId) {
  const result = [];
  for (const guildId of getEnabledGuildIds()) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) continue;
    result.push({ id: guild.id, name: guild.name, iconURL: guild.iconURL?.() || null });
  }
  return result;
}

async function requireAdmin(req, res, env, client, guildId = null) {
  const { session } = getSession(req, res, env);
  if (!session.user?.id) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }

  if (!guildId) return session;
  if (!getGuildConfig(guildId)) {
    sendJson(res, 404, { error: 'Guild is not configured.' });
    return null;
  }

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(session.user.id).catch(() => null) : null;
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required for this guild.' });
    return null;
  }
  return session;
}

function asSnowflake(value, fallback = '') {
  const clean = String(value ?? '').trim();
  return /^\d{16,20}$/.test(clean) ? clean : fallback;
}

function asSnowflakeList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.map((item) => asSnowflake(item)).filter(Boolean))];
}

function asNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function asInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.floor(asNumber(value, fallback, min, max));
}

function sanitizeBoosts(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => ({
      roleId: asSnowflake(item?.roleId),
      xpPercent: asNumber(item?.xpPercent, 0, 0, 10000),
    }))
    .filter((item) => item.roleId && item.xpPercent > 0);
}

function sanitizeLevelRewards(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => ({
      level: asInteger(item?.level, 0, 1, 100000),
      roleId: asSnowflake(item?.roleId),
    }))
    .filter((item) => item.level > 0 && item.roleId)
    .sort((a, b) => a.level - b.level);
}

function sanitizeGuildPatch(current, patch) {
  const clean = {};

  if (patch.channels && typeof patch.channels === 'object') {
    clean.channels = {};
    for (const key of Object.keys(current.channels || {})) {
      if (key in patch.channels) clean.channels[key] = asSnowflake(patch.channels[key], current.channels[key]);
    }
  }

  if (patch.roles && typeof patch.roles === 'object') {
    clean.roles = {};
    for (const key of Object.keys(current.roles || {})) {
      if (key in patch.roles) clean.roles[key] = asSnowflake(patch.roles[key], current.roles[key]);
    }
  }

  if (patch.xp && typeof patch.xp === 'object') {
    clean.xp = {};
    const currentMin = asInteger(current.xp.messageXpMin, 0, 0, 100000);
    const requestedMin = 'messageXpMin' in patch.xp ? asInteger(patch.xp.messageXpMin, currentMin, 0, 100000) : currentMin;
    const requestedMax = 'messageXpMax' in patch.xp ? asInteger(patch.xp.messageXpMax, current.xp.messageXpMax, 0, 100000) : asInteger(current.xp.messageXpMax, requestedMin, 0, 100000);
    if ('messageXpMin' in patch.xp) clean.xp.messageXpMin = requestedMin;
    if ('messageXpMax' in patch.xp) clean.xp.messageXpMax = Math.max(requestedMin, requestedMax);
    if ('lowXpAmount' in patch.xp) clean.xp.lowXpAmount = asNumber(patch.xp.lowXpAmount, current.xp.lowXpAmount, 0, 100000);
    if ('channels' in patch.xp) clean.xp.channels = asSnowflakeList(patch.xp.channels, current.xp.channels);
    if ('lowXpChannels' in patch.xp) clean.xp.lowXpChannels = asSnowflakeList(patch.xp.lowXpChannels, current.xp.lowXpChannels);
    if ('noXpChannels' in patch.xp) clean.xp.noXpChannels = asSnowflakeList(patch.xp.noXpChannels, current.xp.noXpChannels);
    if ('boosts' in patch.xp) clean.xp.boosts = sanitizeBoosts(patch.xp.boosts, current.xp.boosts);
    if ('levelRoleRewards' in patch.xp) clean.xp.levelRoleRewards = sanitizeLevelRewards(patch.xp.levelRoleRewards, current.xp.levelRoleRewards);
  }

  if (patch.inviteRewards && typeof patch.inviteRewards === 'object') {
    clean.inviteRewards = {};
    if ('enabled' in patch.inviteRewards) clean.inviteRewards.enabled = Boolean(patch.inviteRewards.enabled);
    if ('capMembers' in patch.inviteRewards) clean.inviteRewards.capMembers = asInteger(patch.inviteRewards.capMembers, current.inviteRewards.capMembers, 0, 1000000);
  }

  if (patch.wordChain && typeof patch.wordChain === 'object') {
    clean.wordChain = {};
    for (const key of ['minWordLength', 'maxWordLength', 'startingHearts']) {
      if (key in patch.wordChain) clean.wordChain[key] = asInteger(patch.wordChain[key], current.wordChain[key], 1, 1000);
    }
    for (const key of ['turnTimeoutMs', 'punishmentMs', 'gameCooldownMs']) {
      if (key in patch.wordChain) clean.wordChain[key] = asInteger(patch.wordChain[key], current.wordChain[key], 1000, 2_147_000_000);
    }
  }

  if (patch.giveaway && typeof patch.giveaway === 'object') {
    clean.giveaway = {};
    for (const key of ['minClaimMs', 'maxClaimMs', 'minDurationMs', 'maxDurationMs']) {
      if (key in patch.giveaway) clean.giveaway[key] = asInteger(patch.giveaway[key], current.giveaway[key], 1000, 2_592_000_000);
    }
  }

  return clean;
}

function mergePlain(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = mergePlain(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function updateGuildConfig(guildId, patch) {
  const state = loadState();
  const current = state.guilds[guildId];
  if (!current) return null;
  const cleanPatch = sanitizeGuildPatch(current, patch);
  state.guilds[guildId] = mergePlain(current, cleanPatch);
  saveState(state);
  return getGuildConfig(guildId);
}

async function handleAuthStart(req, res, env) {
  const { session } = getSession(req, res, env);
  const state = crypto.randomBytes(24).toString('base64url');
  session.oauthState = state;

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', state);
  redirect(res, url.toString());
}

async function handleAuthCallback(req, res, env, url) {
  const { session } = getSession(req, res, env);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== session.oauthState) {
    send(res, 400, 'Invalid OAuth state.');
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, env);
    const user = await fetchDiscordUser(token.access_token);
    session.user = {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar,
    };
    session.oauthState = null;
    redirect(res, '/admin');
  } catch (error) {
    logCommandSystem(`Admin OAuth callback failed: ${error?.message ?? 'unknown error'}`);
    send(res, 502, 'Discord login failed.');
  }
}

async function routeRequest(req, res, env, client) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    serveAdminAsset(res, 'index.html');
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/admin/')) {
    serveAdminAsset(res, url.pathname.slice('/admin/'.length));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/auth/discord') {
    await handleAuthStart(req, res, env);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
    await handleAuthCallback(req, res, env, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const { sessionId } = getSession(req, res, env);
    sessions.delete(sessionId);
    clearSessionCookie(res, env);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const session = await requireAdmin(req, res, env, client);
    if (!session) return;
    const guilds = await fetchAccessibleGuilds(client, session.user.id);
    sendJson(res, 200, { user: session.user, guilds });
    return;
  }

  const configMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/config$/);
  if (configMatch && req.method === 'GET') {
    const guildId = configMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    sendJson(res, 200, { guildId, config: getGuildConfig(guildId) });
    return;
  }

  if (configMatch && req.method === 'PATCH') {
    const guildId = configMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    const patch = await readJsonBody(req);
    const config = updateGuildConfig(guildId, patch);
    sendJson(res, 200, { guildId, config });
    logCommandSystem(`Admin ${session.user.id} updated server config for guild ${guildId}.`);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function startAdminServer(client) {
  if (serverRef) return serverRef;

  const env = getEnv();
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    logCommandSystem('Admin web panel disabled: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or DISCORD_REDIRECT_URI is missing.');
    return null;
  }

  serverRef = http.createServer((req, res) => {
    routeRequest(req, res, env, client).catch((error) => {
      const status = error?.statusCode || 500;
      logCommandSystem(`Admin web request failed: ${error?.message ?? 'unknown error'}`);
      sendJson(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    });
  });

  serverRef.listen(env.port, '127.0.0.1', () => {
    logCommandSystem(`Admin web panel listening on http://127.0.0.1:${env.port}.`);
  });

  return serverRef;
}

module.exports = {
  startAdminServer,
};
