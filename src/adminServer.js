const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  ensureGuildConfig,
  getConfiguredGuildIds,
  getEnabledGuildIds,
  getGuildConfig,
  getGuildConfigRaw,
  loadState,
  saveState,
} = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');
const {
  handleOwnerConsole,
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerMetrics,
  handleOwnerOverview,
  isOwnerSession,
} = require('./ownerPanelRoutes');
const { getGag2StockSetupProgress, syncGag2StockGuildSetup } = require('./gag2Stock/manager');
const { syncGag2RoleAssignmentPanel } = require('./gag2Stock/roleAssignment');
const { FALL_ROLE_TYPES, roleSpecsForType } = require('./gag2Stock/catalog');
const { FALL_HARVEST_END_AT_MS } = require('./gag2Stock/config');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const SESSION_STORE_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const COOKIE_NAME = 'coinsprite_admin';
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DIRECTORY_CACHE_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const PUBLIC_ASSETS = new Map([
  ['/admin/app.js', ['app.js', 'application/javascript; charset=utf-8']],
  ['/admin/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

const sessions = new Map();
const directoryCache = new Map();
let serverRef = null;

function getEnv() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    sessionSecret: process.env.SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET,
    host: process.env.ADMIN_WEB_HOST || '127.0.0.1',
    port: Number(process.env.ADMIN_WEB_PORT) || 3000,
    cookieSecure: /^(1|true|yes)$/i.test(String(process.env.ADMIN_COOKIE_SECURE || '')),
  };
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function redirect(res, location) {
  send(res, 302, '', { Location: location, 'Cache-Control': 'no-store' });
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionId(secret) {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `${raw}.${sign(raw, secret)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function verifySignedValue(value, secret) {
  const [raw, signature] = String(value || '').split('.');
  if (!raw || !signature) return false;
  const expected = sign(raw, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function loadSessions() {
  sessions.clear();
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSION_STORE_PATH, 'utf8'));
    const now = Date.now();
    for (const [id, session] of Object.entries(parsed.sessions || {})) {
      if (Number(session?.expiresAt) > now) sessions.set(id, session);
    }
  } catch {}
}

function saveSessions() {
  fs.mkdirSync(path.dirname(SESSION_STORE_PATH), { recursive: true });
  const now = Date.now();
  const active = {};
  for (const [id, session] of sessions) {
    if (Number(session?.expiresAt) <= now) sessions.delete(id);
    else active[id] = session;
  }
  fs.writeFileSync(SESSION_STORE_PATH, `${JSON.stringify({ sessions: active }, null, 2)}\n`, 'utf8');
}

function setSessionCookie(res, id, env) {
  const secure = env.cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res, env) {
  const secure = env.cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function getSession(req, res, env) {
  const id = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (verifySignedValue(id, env.sessionSecret) && sessions.has(id)) {
    const session = sessions.get(id);
    if (Number(session.expiresAt) > Date.now()) return { id, session };
    sessions.delete(id);
  }

  const nextId = createSessionId(env.sessionSecret);
  const now = Date.now();
  const session = {
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    csrfToken: crypto.randomBytes(24).toString('base64url'),
    oauthState: null,
    user: null,
  };
  sessions.set(nextId, session);
  saveSessions();
  setSessionCookie(res, nextId, env);
  return { id: nextId, session };
}

function requireCsrf(req, res, session) {
  const supplied = String(req.headers['x-csrf-token'] || '');
  const expected = String(session.csrfToken || '');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (!supplied || left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    sendJson(res, 403, { error: 'Security token is missing or expired. Refresh the page and try again.' });
    return false;
  }
  return true;
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
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function serveAsset(res, pathname) {
  const asset = PUBLIC_ASSETS.get(pathname);
  const filename = asset?.[0] || 'index.html';
  const contentType = asset?.[1] || 'text/html; charset=utf-8';
  fs.readFile(path.join(ADMIN_DIR, filename), (error, data) => {
    if (error) return send(res, 404, 'Not found');
    send(res, 200, data, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
  });
}

function redirectBotAvatar(res, client) {
  const url = client.user?.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (!url) return send(res, 404, 'Bot avatar unavailable');
  return redirect(res, url);
}

async function exchangeCodeForToken(code, env) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.redirectUri });
  const authorization = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64');
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Discord token exchange failed with ${response.status}`);
  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Discord user fetch failed with ${response.status}`);
  return response.json();
}

async function requireSignedIn(req, res, env) {
  const { session } = getSession(req, res, env);
  if (!session.user?.id) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  return session;
}

async function requireOwner(req, res, env, client) {
  const session = await requireSignedIn(req, res, env);
  if (!session) return null;
  if (!isOwnerSession(session, client)) {
    sendJson(res, 403, { error: 'Owner access is required.' });
    return null;
  }
  return session;
}

async function requireGuildAdmin(req, res, env, client, guildId) {
  const session = await requireSignedIn(req, res, env);
  if (!session) return null;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    return null;
  }
  if (isOwnerSession(session, client)) {
    ensureGuildConfig(guildId);
    return { session, guild };
  }
  if (!getGuildConfig(guildId)) {
    sendJson(res, 404, { error: 'Guild is not configured.' });
    return null;
  }
  const member = await guild.members.fetch(session.user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required for this guild.' });
    return null;
  }
  return { session, guild };
}

async function accessibleGuilds(client, session) {
  const ids = isOwnerSession(session, client)
    ? getConfiguredGuildIds({ includeDisabled: true })
    : getEnabledGuildIds();
  const visible = new Map();
  for (const guild of client.guilds.cache.values()) visible.set(guild.id, guild);
  for (const id of ids) {
    if (!visible.has(id)) {
      const guild = await client.guilds.fetch(id).catch(() => null);
      if (guild) visible.set(id, guild);
    }
  }

  const result = [];
  for (const guild of visible.values()) {
    if (!isOwnerSession(session, client)) {
      const member = await guild.members.fetch(session.user.id).catch(() => null);
      if (!member?.permissions?.has(PermissionFlagsBits.Administrator) || !getGuildConfig(guild.id)) continue;
    }
    result.push({ id: guild.id, name: guild.name, iconURL: guild.iconURL?.() || null });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function channelKind(channel) {
  if (channel?.type === ChannelType.GuildCategory) return 'category';
  if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel?.type)) return 'forum';
  if ([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(channel?.type)) return 'thread';
  if (channel?.type === ChannelType.GuildAnnouncement) return 'announcement';
  return 'text';
}

async function fetchGuildDirectory(guild, force = false) {
  const cached = directoryCache.get(guild.id);
  if (!force && cached && Date.now() - cached.createdAt < DIRECTORY_CACHE_TTL_MS) return cached.directory;

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const baseChannels = [...channels.values()].filter((channel) => channel && 'name' in channel);
  const parentNames = new Map(baseChannels.map((channel) => [channel.id, channel.name]));
  const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
  const allChannels = [...baseChannels, ...Array.from(activeThreads?.threads?.values?.() || [])];
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const required = [
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['View Channels', PermissionFlagsBits.ViewChannel],
    ['Send Messages', PermissionFlagsBits.SendMessages],
    ['Read Message History', PermissionFlagsBits.ReadMessageHistory],
    ['Use External Emojis', PermissionFlagsBits.UseExternalEmojis],
  ];
  const missing = required.filter(([, flag]) => !botMember?.permissions?.has?.(flag)).map(([label]) => label);

  const directory = {
    channels: allChannels.filter((channel) => channelKind(channel) !== 'category').map((channel) => ({
      id: channel.id,
      name: channel.name,
      kind: channelKind(channel),
      parentId: channel.parentId || null,
      parentName: channel.parentId ? parentNames.get(channel.parentId) || null : null,
      archived: Boolean(channel.archived),
      rawPosition: Number(channel.rawPosition) || 0,
    })).sort((a, b) => (a.parentName || '').localeCompare(b.parentName || '') || a.rawPosition - b.rawPosition || a.name.localeCompare(b.name)),
    gag2StockPermissions: { usable: missing.length === 0, missing: missing.map((label) => ({ label })) },
  };
  directoryCache.set(guild.id, { createdAt: Date.now(), directory });
  return directory;
}

function mergePlain(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergePlain(result[key], value);
    } else result[key] = value;
  }
  return result;
}

function publicConfig(config) {
  return {
    enabled: config?.enabled !== false,
    features: { gag2Stock: true, fullBot: false },
    gag2Stock: config?.gag2Stock || {},
  };
}

async function handleAuthStart(req, res, env) {
  const { session } = getSession(req, res, env);
  session.oauthState = crypto.randomBytes(24).toString('base64url');
  saveSessions();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', session.oauthState);
  return redirect(res, url.toString());
}

async function handleAuthCallback(req, res, env, url) {
  const { id, session } = getSession(req, res, env);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== session.oauthState) return send(res, 400, 'Invalid OAuth state.');

  try {
    const token = await exchangeCodeForToken(code, env);
    const user = await fetchDiscordUser(token.access_token);
    session.user = { id: user.id, username: user.username, globalName: user.global_name || user.username, avatar: user.avatar };
    session.oauthState = null;
    session.csrfToken = crypto.randomBytes(24).toString('base64url');
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    saveSessions();
    setSessionCookie(res, id, env);
    return redirect(res, '/admin');
  } catch (error) {
    logCommandSystem(`Admin OAuth callback failed: ${error?.message || 'unknown error'}`);
    return send(res, 502, 'Discord login failed.');
  }
}

async function routeRequest(req, res, env, client) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/admin' || pathname === '/admin/')) return serveAsset(res, '/admin/index.html');
  if (req.method === 'GET' && PUBLIC_ASSETS.has(pathname)) return serveAsset(res, pathname);
  if (req.method === 'GET' && pathname === '/bot-avatar.png') return redirectBotAvatar(res, client);
  if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true, service: 'coinsprite-gag-stock' });
  if (req.method === 'GET' && pathname === '/auth/discord') return handleAuthStart(req, res, env);
  if (req.method === 'GET' && pathname === '/auth/discord/callback') return handleAuthCallback(req, res, env, url);

  if (req.method === 'POST' && pathname === '/auth/logout') {
    const { id, session } = getSession(req, res, env);
    if (!requireCsrf(req, res, session)) return;
    sessions.delete(id);
    saveSessions();
    clearSessionCookie(res, env);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const session = await requireSignedIn(req, res, env);
    if (!session) return;
    return sendJson(res, 200, {
      user: session.user,
      owner: isOwnerSession(session, client),
      csrfToken: session.csrfToken,
      guilds: await accessibleGuilds(client, session),
    });
  }

  if (req.method === 'GET' && pathname === '/api/owner/overview') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerOverview(req, res, client, { sendJson });
  }
  if (req.method === 'GET' && pathname === '/api/owner/metrics') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerMetrics(req, res, client, session, { sendJson });
  }
  if (req.method === 'GET' && pathname === '/api/owner/console') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerConsole(req, res, url, client, session, { sendJson });
  }

  const ownerAction = pathname.match(/^\/api\/owner\/guilds\/(\d{16,20})\/(disable|enable)$/);
  if (req.method === 'POST' && ownerAction) {
    const session = await requireOwner(req, res, env, client);
    if (!session || !requireCsrf(req, res, session)) return;
    const deps = { readJsonBody, sendJson };
    return ownerAction[2] === 'disable'
      ? handleOwnerDisable(req, res, client, ownerAction[1], session, deps)
      : handleOwnerEnable(req, res, client, ownerAction[1], session, deps);
  }

  const directoryMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/directory$/);
  if (req.method === 'GET' && directoryMatch) {
    const auth = await requireGuildAdmin(req, res, env, client, directoryMatch[1]);
    if (!auth) return;
    const force = url.searchParams.get('refresh') === '1';
    return sendJson(res, 200, { guildId: directoryMatch[1], directory: await fetchGuildDirectory(auth.guild, force) });
  }

  const configMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/config$/);
  if (configMatch && req.method === 'GET') {
    const auth = await requireGuildAdmin(req, res, env, client, configMatch[1]);
    if (!auth) return;
    return sendJson(res, 200, { guildId: configMatch[1], config: publicConfig(getGuildConfigRaw(configMatch[1])) });
  }
  if (configMatch && req.method === 'PATCH') {
    const guildId = configMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = await readJsonBody(req);
    if (!body?.gag2Stock || typeof body.gag2Stock !== 'object' || Array.isArray(body.gag2Stock)) {
      return sendJson(res, 400, { error: 'Only GAG stock configuration can be updated.' });
    }

    const state = loadState();
    state.guilds[guildId] ||= ensureGuildConfig(guildId);
    state.guilds[guildId].features = { gag2Stock: true, fullBot: false };
    state.guilds[guildId].gag2Stock = mergePlain(state.guilds[guildId].gag2Stock, body.gag2Stock);
    saveState(state);
    const config = getGuildConfigRaw(guildId);

    syncGag2StockGuildSetup(client, guildId, { progressGuildId: guildId })
      .then(() => syncGag2RoleAssignmentPanel(client, guildId))
      .catch((error) => logCommandSystem(`GAG stock setup sync failed for guild ${guildId}: ${error?.message || 'unknown error'}`));
    logCommandSystem(`Admin ${auth.session.user.id} updated GAG stock for guild ${guildId}.`);
    return sendJson(res, 200, { guildId, config: publicConfig(config), progress: getGag2StockSetupProgress(guildId) });
  }

  const progressMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/gag2-stock\/setup-progress$/);
  if (req.method === 'GET' && progressMatch) {
    const auth = await requireGuildAdmin(req, res, env, client, progressMatch[1]);
    if (!auth) return;
    return sendJson(res, 200, { guildId: progressMatch[1], progress: getGag2StockSetupProgress(progressMatch[1]) });
  }

  const catalogMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/gag2-stock\/catalog$/);
  if (req.method === 'GET' && catalogMatch) {
    const auth = await requireGuildAdmin(req, res, env, client, catalogMatch[1]);
    if (!auth) return;
    const types = ['seed', 'gear', 'crate', 'sell'];
    return sendJson(res, 200, {
      items: Object.fromEntries(types.map((type) => [type, roleSpecsForType(type)])),
      fallItems: Object.fromEntries(types.map((type) => [type, roleSpecsForType(FALL_ROLE_TYPES[type])])),
      fallHarvestEndsAt: new Date(FALL_HARVEST_END_AT_MS).toISOString(),
    });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

function startAdminServer(client) {
  if (serverRef) return serverRef;
  const env = getEnv();
  if (!env.clientId || !env.clientSecret || !env.redirectUri || !env.sessionSecret) {
    logCommandSystem('Admin panel disabled: Discord OAuth or session configuration is missing.');
    return null;
  }

  loadSessions();
  saveSessions();
  serverRef = http.createServer((req, res) => {
    routeRequest(req, res, env, client).catch((error) => {
      const status = error?.statusCode || 500;
      logCommandSystem(`Admin request failed: ${error?.message || 'unknown error'}`);
      sendJson(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    });
  });
  serverRef.requestTimeout = 15_000;
  serverRef.headersTimeout = 20_000;
  serverRef.listen(env.port, env.host, () => logCommandSystem(`GAG stock dashboard listening on http://${env.host}:${env.port}.`));
  return serverRef;
}

module.exports = { startAdminServer };
