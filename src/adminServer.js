const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { ensureGuildConfig, getEnabledGuildIds, getGuildConfig, getGuildConfigRaw, loadState, saveState } = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');
const { handleUserDataGet, handleUserDataPatch } = require('./adminUserDataRoutes');
const {
  handleBugReportCreate,
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerFeatures,
  handleOwnerOverview,
  handleOwnerReportStatus,
  handleOwnerReports,
  isOwnerSession,
} = require('./ownerPanelRoutes');
const { handleModerationEvidence } = require('./adminModerationEvidenceRoute');
const { handleUserModerationAction } = require('./adminModerationActionRoute');
const { handleAppealApi } = require('./appealWebRoutes');
const moderationCases = require('./moderationCaseStore');
const { canManageWarnings, createWarning, editWarning, pardonWarning } = require('./warningService');
const { getGag2StockSetupProgress, syncGag2StockGuildSetup } = require('./gag2Stock/manager');
const { syncGag2RoleAssignmentPanel } = require('./gag2Stock/roleAssignment');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const APPEAL_DIR = path.join(__dirname, '..', 'appeal');
const RUNTIME_IMAGE_DIR = path.join(__dirname, '..', 'images');
const RUNTIME_ICON_FILES = Object.freeze({
  'leveling.png': 'leveling.png',
  'ticket.png': 'ticket.png',
  'moderator.png': 'moderator.png',
  'moderator.svg': 'moderator.png',
  'data.png': 'data.png',
  'data.svg': 'data.png',
  'message.png': 'message.png',
  'messages.png': 'message.png',
  'message.svg': 'message.png',
});
const SESSION_STORE_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_BODY_BYTES = 1024 * 1024;
const COOKIE_NAME = 'coinsprite_admin';
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DIRECTORY_CACHE_TTL_MS = 60 * 1000;

const sessions = new Map();
const directoryCache = new Map();
let serverRef = null;

function getEnv() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    sessionSecret: process.env.SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex'),
    host: process.env.ADMIN_WEB_HOST || '127.0.0.1',
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

function loadSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSION_STORE_PATH, 'utf8') || '{}');
    const now = Date.now();
    for (const [sessionId, session] of Object.entries(parsed.sessions || {})) {
      const expiresAt = Number(session?.expiresAt);
      if (!session || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
      sessions.set(sessionId, session);
    }
  } catch {
    sessions.clear();
  }
}

function saveSessions() {
  fs.mkdirSync(path.dirname(SESSION_STORE_PATH), { recursive: true });
  const now = Date.now();
  const activeSessions = {};
  for (const [sessionId, session] of sessions.entries()) {
    const expiresAt = Number(session?.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      sessions.delete(sessionId);
      continue;
    }
    activeSessions[sessionId] = session;
  }
  fs.writeFileSync(SESSION_STORE_PATH, `${JSON.stringify({ sessions: activeSessions }, null, 2)}\n`, 'utf8');
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
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

function clearSessionCookie(res, env) {
  const secure = env.cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function getSession(req, res, env) {
  const sessionId = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (sessionId && verifySessionId(sessionId, env.sessionSecret) && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    const expiresAt = Number(session?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      session.touchedAt = Date.now();
      if (!session.csrfToken) {
        session.csrfToken = crypto.randomBytes(24).toString('base64url');
        saveSessions();
      }
      return { sessionId, session };
    }
    sessions.delete(sessionId);
    saveSessions();
    clearSessionCookie(res, env);
  }

  const newSessionId = createSessionId(env.sessionSecret);
  const now = Date.now();
  const session = {
    createdAt: now,
    touchedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    user: null,
    oauthState: null,
    authReturnTo: '/admin',
    csrfToken: crypto.randomBytes(24).toString('base64url'),
  };
  sessions.set(newSessionId, session);
  saveSessions();
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

function redirectBotAvatar(res, client) {
  const avatarUrl = client?.user?.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (!avatarUrl) {
    send(res, 404, 'Bot avatar not available');
    return;
  }
  send(res, 302, '', { Location: avatarUrl, 'Cache-Control': 'no-store' });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
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
    if (error) return send(res, 404, 'Not found');
    const isTextAsset = resolvedFile.endsWith('.html') || resolvedFile.endsWith('.js');
    send(res, 200, data, {
      'Content-Type': contentTypeFor(resolvedFile),
      'Cache-Control': isTextAsset ? 'no-store' : 'public, max-age=300',
    });
  });
}

function serveAppealAsset(res, assetPath) {
  const normalized = path.normalize(assetPath || 'index.html').replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(APPEAL_DIR, normalized);
  const root = path.resolve(APPEAL_DIR);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(resolved, (error, data) => {
    if (error) return send(res, 404, 'Not found');
    send(res, 200, data, {
      'Content-Type': contentTypeFor(resolved),
      'Cache-Control': resolved.endsWith('.html') || resolved.endsWith('.js') ? 'no-store' : 'public, max-age=300',
    });
  });
}

function serveRuntimeIcon(res, requestedPath) {
  let requestedName;
  try {
    requestedName = decodeURIComponent(String(requestedPath || '')).replace(/^\/+/, '');
  } catch {
    send(res, 400, 'Bad request');
    return;
  }
  if (!requestedName || requestedName !== path.posix.basename(requestedName)) {
    send(res, 404, 'Not found');
    return;
  }

  const runtimeName = RUNTIME_ICON_FILES[requestedName.toLowerCase()];
  if (!runtimeName) {
    send(res, 404, 'Not found');
    return;
  }

  const runtimePath = path.join(RUNTIME_IMAGE_DIR, runtimeName);
  const stream = fs.createReadStream(runtimePath);
  let opened = false;
  stream.once('open', () => {
    opened = true;
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    });
    stream.pipe(res);
  });
  stream.once('error', () => {
    if (!opened && !res.headersSent) send(res, 404, 'Icon not found');
    else res.destroy();
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
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.redirectUri });
  const auth = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64');
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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

function channelKind(channel) {
  switch (channel?.type) {
    case ChannelType.GuildCategory: return 'category';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice: return 'voice';
    case ChannelType.GuildAnnouncement: return 'announcement';
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia: return 'forum';
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread: return 'thread';
    default: return 'text';
  }
}

function serializeChannel(channel, parentNames = new Map()) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    kind: channelKind(channel),
    parentId: channel.parentId || null,
    parentName: channel.parentId ? parentNames.get(channel.parentId) || null : null,
    rawPosition: Number.isFinite(channel.rawPosition) ? channel.rawPosition : 0,
    archived: Boolean(channel.archived),
  };
}

function channelSort(a, b) {
  const parentA = a.parentId || '';
  const parentB = b.parentId || '';
  if (parentA !== parentB) return parentA.localeCompare(parentB);
  if (a.rawPosition !== b.rawPosition) return a.rawPosition - b.rawPosition;
  return a.name.localeCompare(b.name);
}

async function gag2StockPermissionState(guild) {
  const botUserId = guild.client?.user?.id || '';
  const botMember = botUserId
    ? await guild.members.fetch({ user: botUserId, force: true }).catch(() => guild.members.me || null)
    : guild.members.me || null;
  const botPermissions = botMember?.permissions || null;
  const requiredGag2Permissions = [
    ['ManageRoles', 'Manage Roles', PermissionFlagsBits.ManageRoles],
    ['ViewChannel', 'View Channels', PermissionFlagsBits.ViewChannel],
    ['SendMessages', 'Send Messages', PermissionFlagsBits.SendMessages],
  ];
  const missingGag2Permissions = requiredGag2Permissions
    .filter(([, , flag]) => !botPermissions?.has?.(flag))
    .map(([key, label]) => ({ key, label }));
  return {
    usable: missingGag2Permissions.length === 0,
    missing: missingGag2Permissions,
  };
}

async function fetchGuildDirectory(guild, options = {}) {
  const gag2StockPermissions = await gag2StockPermissionState(guild);
  const cached = directoryCache.get(guild.id);
  if (!options.force && cached && Date.now() - cached.createdAt < DIRECTORY_CACHE_TTL_MS) {
    return { ...cached.directory, gag2StockPermissions };
  }
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const baseChannels = Array.from(channels.values()).filter((channel) => channel && 'name' in channel);
  const parentNames = new Map(baseChannels.map((channel) => [channel.id, channel.name]));
  const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
  const threadItems = Array.from(activeThreads?.threads?.values?.() || []);
  const channelItems = [...baseChannels, ...threadItems].map((channel) => serializeChannel(channel, parentNames)).sort(channelSort);
  const directory = {
    channels: channelItems.filter((channel) => channel.kind !== 'category'),
    categories: channelItems.filter((channel) => channel.kind === 'category'),
    roles: Array.from(roles.values())
      .filter((role) => role && role.id !== guild.id)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#99aab5',
        position: Number.isFinite(role.position) ? role.position : 0,
        managed: Boolean(role.managed),
      }))
      .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name)),
    gag2StockPermissions,
  };
  directoryCache.set(guild.id, { createdAt: Date.now(), directory });
  return directory;
}

async function requireAdmin(req, res, env, client, guildId = null) {
  const { session } = getSession(req, res, env);
  if (!session.user?.id) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  if (!guildId) return session;

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (isOwnerSession(session, client)) {
    if (!guild) {
      sendJson(res, 404, { error: 'Guild is not available to the bot.' });
      return null;
    }
    ensureGuildConfig(guildId);
    return session;
  }

  if (!getGuildConfig(guildId)) {
    sendJson(res, 404, { error: 'Guild is not configured.' });
    return null;
  }
  const member = guild ? await guild.members.fetch(session.user.id).catch(() => null) : null;
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required for this guild.' });
    return null;
  }
  return session;
}

async function requireModerator(req, res, env, client, guildId) {
  const { session } = getSession(req, res, env);
  if (!session.user?.id) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild || !getGuildConfig(guildId)) {
    sendJson(res, 404, { error: 'Guild is not configured or unavailable.' });
    return null;
  }
  if (isOwnerSession(session, client)) return { session, guild, member: null };
  const member = await guild.members.fetch(session.user.id).catch(() => null);
  if (!canManageWarnings(member)) {
    sendJson(res, 403, { error: 'Administrator permission or the configured staff role is required.' });
    return null;
  }
  return { session, guild, member };
}

async function requireOwner(req, res, env, client) {
  const session = await requireAdmin(req, res, env, client);
  if (!session) return null;
  if (!isOwnerSession(session, client)) {
    sendJson(res, 403, { error: 'Owner access is required.' });
    return null;
  }
  return session;
}

function mergePlain(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergePlain(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function caseUserProfile(member, userId, fallbackUser = null) {
  const user = member?.user || fallbackUser || null;
  return {
    id: String(userId || ''),
    username: user?.username || 'Unknown user',
    displayName: member?.displayName || user?.globalName || user?.username || 'Unknown user',
    avatarUrl: typeof user?.displayAvatarURL === 'function' ? user.displayAvatarURL({ extension: 'png', size: 128 }) : '',
  };
}

function systemCaseProfile(label = 'System') {
  return { id: '', username: label, displayName: label, avatarUrl: '' };
}

function closingActorId(record) {
  const events = Array.isArray(record?.events) ? [...record.events].reverse() : [];
  const closeEvent = events.find((event) => /pardon|expire|close/i.test(String(event?.type || '')));
  return String(closeEvent?.actorId || record?.closedById || '');
}

async function hydrateCaseProfiles(guild, records) {
  const ids = [...new Set(records.flatMap((record) => [record.targetUserId, record.authorId, closingActorId(record)]).filter(Boolean))];
  const entries = await Promise.all(ids.map(async (id) => {
    const member = guild.members?.cache?.get(id) || await guild.members?.fetch?.(id).catch(() => null);
    const user = member?.user
      || guild.client?.users?.cache?.get(id)
      || await guild.client?.users?.fetch?.(id).catch(() => null);
    return [id, caseUserProfile(member, id, user)];
  }));
  const profiles = Object.fromEntries(entries);
  return records.map((record) => {
    const closedById = closingActorId(record);
    return {
      ...record,
      profiles: {
        target: profiles[record.targetUserId] || caseUserProfile(null, record.targetUserId),
        author: profiles[record.authorId] || caseUserProfile(null, record.authorId),
        closedBy: closedById ? profiles[closedById] || caseUserProfile(null, closedById) : systemCaseProfile(),
      },
    };
  });
}

function updateGuildConfig(guildId, patch) {
  const state = loadState();
  const current = state.guilds[guildId];
  if (!current) return null;
  state.guilds[guildId] = mergePlain(current, patch);
  saveState(state);
  return getGuildConfigRaw(guildId);
}

async function handleAuthStart(req, res, env, requestUrl) {
  const { session } = getSession(req, res, env);
  const state = crypto.randomBytes(24).toString('base64url');
  session.oauthState = state;
  session.authReturnTo = requestUrl?.searchParams?.get('returnTo') === '/appeal' ? '/appeal' : '/admin';
  saveSessions();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('scope', session.authReturnTo === '/appeal' ? 'identify' : 'identify guilds');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', state);
  redirect(res, url.toString());
}

async function handleAuthCallback(req, res, env, url) {
  const { sessionId, session } = getSession(req, res, env);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== session.oauthState) return send(res, 400, 'Invalid OAuth state.');
  try {
    const token = await exchangeCodeForToken(code, env);
    const user = await fetchDiscordUser(token.access_token);
    session.user = { id: user.id, username: user.username, globalName: user.global_name || user.username, avatar: user.avatar };
    session.oauthState = null;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    saveSessions();
    setSessionCookie(res, sessionId, env);
    const returnTo = session.authReturnTo === '/appeal' ? '/appeal' : '/admin';
    session.authReturnTo = '/admin';
    saveSessions();
    redirect(res, returnTo);
  } catch (error) {
    logCommandSystem(`Admin OAuth callback failed: ${error?.message ?? 'unknown error'}`);
    send(res, 502, 'Discord login failed.');
  }
}

async function routeRequest(req, res, env, client) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET') {
    for (const prefix of ['/images/', '/CoinSprite/images/', '/admin/images/']) {
      if (url.pathname.startsWith(prefix)) return serveRuntimeIcon(res, url.pathname.slice(prefix.length));
    }
  }
  if (req.method === 'GET' && url.pathname === '/bot-avatar.png') return redirectBotAvatar(res, client);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) return serveAdminAsset(res, 'index.html');
  if (req.method === 'GET' && url.pathname.startsWith('/admin/')) return serveAdminAsset(res, url.pathname.slice('/admin/'.length));
  if (req.method === 'GET' && (url.pathname === '/appeal' || url.pathname === '/appeal/')) return serveAppealAsset(res, 'index.html');
  if (req.method === 'GET' && url.pathname.startsWith('/appeal/')) return serveAppealAsset(res, url.pathname.slice('/appeal/'.length));
  if (req.method === 'GET' && url.pathname === '/auth/discord') return handleAuthStart(req, res, env, url);
  if (req.method === 'GET' && url.pathname === '/auth/discord/callback') return handleAuthCallback(req, res, env, url);
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const { sessionId } = getSession(req, res, env);
    sessions.delete(sessionId);
    saveSessions();
    clearSessionCookie(res, env);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname.startsWith('/api/appeal/')) {
    const handled = await handleAppealApi(req, res, url, env, client, {
      getSession,
      requireAdmin,
      requireModerator,
      send,
      sendJson,
    });
    if (handled) return;
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const session = await requireAdmin(req, res, env, client);
    if (!session) return;
    return sendJson(res, 200, {
      user: session.user,
      owner: isOwnerSession(session, client),
      guilds: await fetchAccessibleGuilds(client, session.user.id),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/bug-reports') {
    const session = await requireAdmin(req, res, env, client);
    if (!session) return;
    return handleBugReportCreate(req, res, client, session, { readJsonBody, sendJson });
  }

  if (req.method === 'GET' && url.pathname === '/api/owner/overview') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerOverview(req, res, client, { sendJson });
  }
  if (req.method === 'GET' && url.pathname === '/api/owner/reports') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerReports(req, res, client, session, { sendJson });
  }
  const ownerReportMatch = url.pathname.match(/^\/api\/owner\/reports\/([A-Za-z0-9_-]{6,80})$/);
  if (ownerReportMatch && (req.method === 'POST' || req.method === 'PATCH')) {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerReportStatus(req, res, client, ownerReportMatch[1], session, { readJsonBody, sendJson });
  }
  const ownerActionMatch = url.pathname.match(/^\/api\/owner\/guilds\/(\d{16,20})\/(disable|enable)$/);
  if (ownerActionMatch && req.method === 'POST') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    const deps = { readJsonBody, sendJson };
    return ownerActionMatch[2] === 'disable'
      ? handleOwnerDisable(req, res, client, ownerActionMatch[1], session, deps)
      : handleOwnerEnable(req, res, client, ownerActionMatch[1], session, deps);
  }
  const ownerFeaturesMatch = url.pathname.match(/^\/api\/owner\/guilds\/(\d{16,20})\/features$/);
  if (ownerFeaturesMatch && (req.method === 'POST' || req.method === 'PATCH')) {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerFeatures(req, res, client, ownerFeaturesMatch[1], session, { readJsonBody, sendJson });
  }

  const directoryMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/directory$/);
  if (directoryMatch && req.method === 'GET') {
    const guildId = directoryMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    const force = url.searchParams.get('refresh') === '1' || url.searchParams.get('cache') === 'no';
    return sendJson(res, 200, { guildId, directory: await fetchGuildDirectory(guild, { force }) });
  }

  const userDataMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/users\/(\d{16,20})\/data$/);
  if (userDataMatch && req.method === 'GET') {
    return handleUserDataGet(req, res, env, client, userDataMatch[1], userDataMatch[2], { requireAdmin, readJsonBody, sendJson });
  }
  if (userDataMatch && req.method === 'PATCH') {
    return handleUserDataPatch(req, res, env, client, userDataMatch[1], userDataMatch[2], { requireAdmin, readJsonBody, sendJson });
  }

  const userModerationMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/users\/(\d{16,20})\/moderation-actions$/);
  if (userModerationMatch && req.method === 'POST') {
    return handleUserModerationAction(
      req,
      res,
      env,
      client,
      userModerationMatch[1],
      userModerationMatch[2],
      { requireAdmin, sendJson },
    );
  }

  const moderationEvidenceMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/moderation\/evidence\/([A-Za-z0-9-]+)\/([^/]+)$/);
  if (moderationEvidenceMatch && req.method === 'GET') {
    const guildId = moderationEvidenceMatch[1];
    const auth = await requireModerator(req, res, env, client, guildId);
    if (!auth) return;
    return handleModerationEvidence(
      req,
      res,
      guildId,
      moderationEvidenceMatch[2],
      moderationEvidenceMatch[3],
      { send, sendJson },
    );
  }

  const moderationCasesMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/moderation\/cases$/);
  if (moderationCasesMatch) {
    const guildId = moderationCasesMatch[1];
    const auth = await requireModerator(req, res, env, client, guildId);
    if (!auth) return;
    if (req.method === 'GET') {
      const filters = {
        targetUserId: url.searchParams.get('targetUserId') || url.searchParams.get('memberId') || '',
        authorId: url.searchParams.get('authorId') || '',
        type: url.searchParams.get('type') || '',
        status: url.searchParams.get('status') || '',
        source: url.searchParams.get('source') || '',
        query: url.searchParams.get('query') || '',
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('pageSize') || 25,
      };
      const result = moderationCases.queryCases(guildId, filters);
      const cases = await hydrateCaseProfiles(auth.guild, result.cases);
      return sendJson(res, 200, { cases, pagination: result.pagination, total: result.pagination.total });
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const member = await auth.guild.members.fetch(String(body.memberId || '')).catch(() => null);
        const result = await createWarning({
          guild: auth.guild,
          member,
          moderatorId: auth.session.user.id,
          source: 'dashboard',
          reason: body.reason,
          points: body.points,
          expires: body.expires,
          evidence: body.evidence,
          appealable: body.appealable !== false,
          publicNote: body.publicNote,
          staffNotes: body.staffNotes,
        });
        return sendJson(res, 201, result);
      } catch (error) {
        return sendJson(res, 400, { error: error?.message || 'Could not create warning.' });
      }
    }
  }

  const moderationCaseMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/moderation\/cases\/([A-Za-z0-9-]+)(\/pardon)?$/);
  if (moderationCaseMatch) {
    const guildId = moderationCaseMatch[1];
    const caseId = moderationCaseMatch[2];
    const auth = await requireModerator(req, res, env, client, guildId);
    if (!auth) return;
    try {
      if (req.method === 'GET' && !moderationCaseMatch[3]) {
        const record = moderationCases.getCase(guildId, caseId);
        if (!record) return sendJson(res, 404, { error: 'Warning case was not found.' });
        const [hydrated] = await hydrateCaseProfiles(auth.guild, [record]);
        return sendJson(res, 200, { case: hydrated });
      }
      if (req.method === 'PATCH' && !moderationCaseMatch[3]) {
        const result = await editWarning({
          guild: auth.guild,
          caseId,
          moderatorId: auth.session.user.id,
          patch: await readJsonBody(req),
        });
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && moderationCaseMatch[3] === '/pardon') {
        const body = await readJsonBody(req);
        const result = await pardonWarning({ guild: auth.guild, caseId, moderatorId: auth.session.user.id, reason: body.reason });
        return sendJson(res, 200, result);
      }
    } catch (error) {
      return sendJson(res, 400, { error: error?.message || 'Could not manage warning case.' });
    }
  }

  const configMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/config$/);
  if (configMatch && req.method === 'GET') {
    const guildId = configMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    return sendJson(res, 200, { guildId, config: isOwnerSession(session, client) ? getGuildConfigRaw(guildId) : getGuildConfig(guildId) });
  }
  if (configMatch && req.method === 'PATCH') {
    const guildId = configMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    const currentConfig = getGuildConfigRaw(guildId);
    let patch = await readJsonBody(req);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) patch = {};
    delete patch.features;
    if (!isOwnerSession(session, client) && currentConfig?.features?.fullBot !== true) {
      patch = patch?.gag2Stock ? { gag2Stock: patch.gag2Stock } : {};
    }
    const config = updateGuildConfig(guildId, patch);
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    const ticketCommand = client.commands?.get('ticket-panel');
    if (guild && config?.enabled !== false && typeof ticketCommand?.refreshGuild === 'function') {
      await ticketCommand.refreshGuild(guild, client.user.id).catch((error) => logCommandSystem(`Ticket panel refresh failed for guild ${guildId}: ${error?.message ?? 'unknown error'}`));
    }
    if (guild && config?.enabled !== false) {
      syncGag2StockGuildSetup(client, guildId, { progressGuildId: guildId })
        .then(() => syncGag2RoleAssignmentPanel(client, guildId))
        .catch((error) => {
          logCommandSystem(`GAG2 stock setup sync failed for guild ${guildId}: ${error?.message ?? 'unknown error'}`);
        });
    }
    logCommandSystem(`Admin ${session.user.id} updated server config for guild ${guildId}.`);
    return sendJson(res, 200, { guildId, config, roleProgress: getGag2StockSetupProgress(guildId) });
  }

  const gag2ProgressMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/gag2-stock\/setup-progress$/);
  if (gag2ProgressMatch && req.method === 'GET') {
    const guildId = gag2ProgressMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    return sendJson(res, 200, { guildId, progress: getGag2StockSetupProgress(guildId) });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

function startAdminServer(client) {
  if (serverRef) return serverRef;
  const env = getEnv();
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    logCommandSystem('Admin web panel disabled: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or DISCORD_REDIRECT_URI is missing.');
    return null;
  }
  loadSessions();
  saveSessions();
  serverRef = http.createServer((req, res) => {
    routeRequest(req, res, env, client).catch((error) => {
      const status = error?.statusCode || 500;
      logCommandSystem(`Admin web request failed: ${error?.message ?? 'unknown error'}`);
      sendJson(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    });
  });
  serverRef.listen(env.port, env.host, () => logCommandSystem(`Admin web panel listening on http://${env.host}:${env.port}.`));
  return serverRef;
}

module.exports = { startAdminServer };

const consolidatedAdminCommands = [];

// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["005-channel-rules.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  CONTEXT_TYPES,
  classifyMessage,
  getGuildRules,
  isRuleViolation,
  ruleMatchesChannel,
  saveGuildRules,
} = require('../src/channelRules');
const { buildMessagePayload, findTemplate } = require('../src/messageTemplates');
const { addReportAttachments, buildReportEvidenceText, uploadedAttachmentUrls } = require('../src/channelReportEvidence');
const { deleteRecentUserMessages } = require('../src/channelMessageDeletion');
const { enforceOutstandingMuteForMessage, executeSanction } = require('../src/moderationActionService');

const previousCreateServer = http.createServer.bind(http);
const SESSION_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
const DEFAULT_REPORT_TEMPLATE_ID = 'default-moderation-action-log';
const DELETE_NOTICE_TEMPLATE_ID = 'default-auto-moderator-user-warning';
const API_PATTERN = /^\/api\/guilds\/(\d{16,20})\/channel-rules$/;
let clientRef = null;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sessionUser(req) {
  try {
    const sessionId = parseCookies(req.headers.cookie || '').coinsprite_admin;
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8') || '{}').sessions?.[sessionId];
    return session?.user?.id && Number(session.expiresAt) > Date.now() ? session.user : null;
  } catch {
    return null;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function requireAdmin(req, res, guildId) {
  const user = sessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  const guild = clientRef?.guilds?.cache?.get(guildId) || await clientRef?.guilds?.fetch(guildId).catch(() => null);
  if (!guild) {
    sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    return null;
  }
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required.' });
    return null;
  }
  return guild;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 });
  }
}

async function handleChannelRulesApi(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const match = url.pathname.match(API_PATTERN);
  if (!match) return false;
  if (!['GET', 'PUT'].includes(req.method)) {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return true;
  }
  const guild = await requireAdmin(req, res, match[1]);
  if (!guild) return true;

  if (req.method === 'GET') {
    sendJson(res, 200, { guildId: guild.id, rules: getGuildRules(guild.id), contextTypes: CONTEXT_TYPES });
    return true;
  }

  try {
    const body = await readBody(req);
    const rules = saveGuildRules(guild.id, body.rules);
    sendJson(res, 200, { guildId: guild.id, rules, contextTypes: CONTEXT_TYPES });
  } catch (error) {
    sendJson(res, Number(error.statusCode) || 400, { error: error.message || 'Could not save channel rules.' });
  }
  return true;
}

http.createServer = function channelRulesServer(listener) {
  return previousCreateServer(async (req, res) => {
    try {
      if (await handleChannelRulesApi(req, res)) return;
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Channel rules request failed.' });
      else res.destroy();
      return;
    }
    listener(req, res);
  });
};

function messageUrl(message) {
  return message.url || 'https://discord.com/channels/' + message.guildId + '/' + message.channelId + '/' + message.id;
}

function replacePlaceholders(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => (
    Object.prototype.hasOwnProperty.call(replacements, token.toLowerCase()) ? replacements[token.toLowerCase()] : match
  ));
}

function applyPlaceholders(template, replacements) {
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replacePlaceholders(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replacePlaceholders(container.text, replacements),
    thumbnailUrl: replacePlaceholders(container.thumbnailUrl, replacements),
    imageUrl: replacePlaceholders(container.imageUrl, replacements),
  }));
  return copy;
}

function templateValues(message, rule, reason, actionName, options = {}) {
  return {
    'moderation-action': actionName,
    'moderation-action-label': actionName,
    'moderation-reason': reason,
    'case-id': 'Channel rule',
    'case-type': 'channel_rule',
    'case-status': 'reported',
    duration: 'N/A',
    expires: 'N/A',
    appealable: 'Yes',
    'appealable-status': 'Yes',
    evidence: buildReportEvidenceText(message, options),
    'message-link': messageUrl(message),
    'message-content': String(message.content || '[attachment]').slice(0, 1200),
    'server-name': message.guild?.name || 'this server',
    'guild-name': message.guild?.name || 'this server',
    mention: '<@' + message.author.id + '>',
    username: message.author.username || message.author.id,
    user: message.author.username || message.author.id,
    'user-id': message.author.id,
    'moderator-id': message.client?.user?.id || '',
    moderator: '<@' + (message.client?.user?.id || '') + '>',
    channel: '<#' + message.channelId + '>',
    'channel-rule': rule.name,
    avatar_url: message.author.displayAvatarURL?.({ size: 256 }) || '',
  };
}

function createTemplatePayload(template, message, replacements) {
  const payload = buildMessagePayload(applyPlaceholders(template, replacements), {
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
  });
  payload.allowedMentions = { parse: [], users: [message.author.id], roles: [] };
  return payload;
}

async function sendTemplate(template, message, replacements, destination) {
  if (!template || !destination) return false;
  await destination.send(createTemplatePayload(template, message, replacements));
  return true;
}

async function reportMessage(message, rule, action) {
  const channelId = String(action.reportChannelId || '').trim();
  if (!channelId) return;
  const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const reason = action.reason || ('Channel rule violation: ' + rule.name);
  const template = findTemplate(message.guildId, DEFAULT_REPORT_TEMPLATE_ID);
  if (template) {
    const uploadPayload = createTemplatePayload(template, message, templateValues(message, rule, reason, 'report'));
    addReportAttachments(uploadPayload, message, { copyAttachments: true, includeGallery: false });
    const sent = await channel.send(uploadPayload).catch(() => null);
    if (sent) {
      const attachmentUrls = uploadedAttachmentUrls(sent);
      if (attachmentUrls.size && typeof sent.edit === 'function') {
        const finalPayload = createTemplatePayload(
          template,
          message,
          templateValues(message, rule, reason, 'report', { attachmentUrls }),
        );
        addReportAttachments(finalPayload, message, { copyAttachments: false, attachmentUrls });
        await sent.edit({
          components: finalPayload.components,
          allowedMentions: finalPayload.allowedMentions,
        }).catch(() => null);
      }
      return;
    }

    const fallbackPayload = createTemplatePayload(template, message, templateValues(message, rule, reason, 'report'));
    addReportAttachments(fallbackPayload, message, { copyAttachments: false });
    await channel.send(fallbackPayload).catch(() => null);
    return;
  }
  await channel.send({
    allowedMentions: { parse: [] },
    content: [
      '**Channel rule report**',
      '**Rule:** ' + rule.name,
      '**User:** <@' + message.author.id + '> (' + message.author.id + ')',
      '**Channel:** <#' + message.channelId + '>',
      '**Reason:** ' + reason,
      '**Evidence:** ' + messageUrl(message),
    ].join('\n'),
  }).catch(() => null);
}

async function sendConfiguredMessage(message, rule, action) {
  const template = findTemplate(message.guildId, action.templateId);
  if (!template || template.botDefault || template.defaultLocked || template.type === 'folder') return;
  const values = templateValues(message, rule, 'Channel rule violation: ' + rule.name, 'send_message');
  const destination = action.ephemeral ? message.author : message.channel;
  await sendTemplate(template, message, values, destination).catch(() => null);
}

async function sendDeleteNotice(message, rule, reason) {
  const template = findTemplate(message.guildId, DELETE_NOTICE_TEMPLATE_ID);
  if (!template) {
    await message.author.send('Your message in **' + message.guild.name + '** was removed.\n**Reason:** ' + reason).catch(() => null);
    return;
  }
  await sendTemplate(template, message, templateValues(message, rule, reason, 'delete'), message.author).catch(() => null);
}

async function runRuleActions(message, rule) {
  let deleted = false;
  let sanctioned = false;

  for (const action of rule.actions.filter((item) => item.type === 'report')) {
    await reportMessage(message, rule, action);
  }

  for (const action of rule.actions) {
    const reason = action.reason || ('Channel rule violation: ' + rule.name);
    if (action.type === 'delete') {
      const result = await deleteRecentUserMessages(message, action.amount);
      deleted = result.deleted > 0 || deleted;
    } else if (action.type === 'report') {
      continue;
    } else if (action.type === 'send_message') {
      await sendConfiguredMessage(message, rule, action);
    } else if (['mute', 'kick', 'ban'].includes(action.type)) {
      sanctioned = true;
      await executeSanction({
        guild: message.guild,
        member: message.member,
        user: message.author,
        moderatorId: message.client?.user?.id || '',
        action: action.type,
        reason,
        time: action.time,
        appealable: true,
        source: 'channel_rule',
        sourceChannelId: message.channelId,
      }).catch((error) => {
        console.error('Channel rule sanction failed:', error);
      });
    }
  }
  if (deleted && !sanctioned) {
    const action = rule.actions.find((item) => item.type === 'delete');
    await sendDeleteNotice(message, rule, action?.reason || ('Channel rule violation: ' + rule.name));
  }
}

module.exports = {
  allowTextlessMessages: true,
  data: new SlashCommandBuilder()
    .setName('channel-rules')
    .setDescription('Show channel content rule status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async init(client) {
    clientRef = client;
  },

  async execute(interaction) {
    const rules = getGuildRules(interaction.guildId);
    await interaction.reply({
      content: [
        'Channel content rules: **' + rules.filter((rule) => rule.enabled).length + ' enabled**',
        'Configured rules: **' + rules.length + '**',
        'Open the Moderator tab in the web dashboard to edit channel rules.',
      ].join('\n'),
      ephemeral: true,
    });
  },

  async handleMessageCreate(message) {
    if (!message?.guild || message.author?.bot || message.webhookId || message.__coinSpriteChannelRuleHandled) return;
    if (await enforceOutstandingMuteForMessage(message)) {
      message.__coinSpriteChannelRuleHandled = true;
      return;
    }
    const types = classifyMessage(message);
    const rule = getGuildRules(message.guildId).find((item) => (
      item.enabled && item.channelIds.length && item.actions.length && ruleMatchesChannel(item, message) && isRuleViolation(item, types)
    ));
    if (!rule) return;
    message.__coinSpriteChannelRuleHandled = true;
    await runRuleActions(message, rule);
  },
};
    }],
    ["01-message-template-http.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { PermissionFlagsBits } = require('discord.js');
const { fitMessageThumbnailSquares } = require('../src/thumbnailFit');
const {
  buildMessagePayload,
  deleteTemplate,
  findTemplate,
  listTemplates,
  parseDiscordMessageLink,
  saveTemplate,
} = require('../src/messageTemplates');

const originalCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const SESSION_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
const INDEX_PATH = path.join(__dirname, '..', 'admin', 'index.html');
const IMAGE_DIR = path.join(__dirname, '..', 'images');
const IMAGE_ALIASES = new Map([
  ['leveling.png', 'leveling.png'],
  ['messages.png', 'message.png'],
  ['message.png', 'message.png'],
  ['message.svg', 'message.png'],
  ['ticket.png', 'ticket.png'],
  ['moderator.png', 'moderator.png'],
  ['moderator.svg', 'moderator.png'],
  ['data.png', 'data.png'],
  ['data.svg', 'data.png'],
]);
const TAB_ICON_STYLE = [
  '  <style>',
  '    .tab[data-tab="leveling"], .tab[data-tab="data"], .tab[data-tab="tickets"], .tab[data-tab="moderator"], .tab[data-tab="messages"] { display: flex; align-items: center; gap: 12px; }',
  '    .tab .tab-icon { width: 30px; height: 30px; max-width: 30px; max-height: 30px; flex: 0 0 30px; display: block; object-fit: contain; object-position: center; border: 2px solid var(--tab-icon-border, rgba(120, 150, 190, 0.72)) !important; border-radius: 9px !important; background: var(--tab-icon-bg, rgba(80, 110, 150, 0.14)) !important; box-shadow: none !important; filter: none !important; outline: 0 !important; padding: 0 !important; transform: none !important; clip-path: none !important; }',
  '    .tab:hover .tab-icon, .tab.active .tab-icon { transform: none !important; box-shadow: none !important; filter: none !important; }',
  '    @media (max-width: 700px) { .tab .tab-icon { width: 26px; height: 26px; max-width: 26px; max-height: 26px; flex-basis: 26px; } }',
  '  </style>',
].join('\n');
let clientRef = null;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendAsset(res, status, body, contentType, cacheControl = 'public, max-age=300') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
  res.end(body);
}

function imageContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}

function serveImageAsset(res, imagePath) {
  const decoded = decodeURIComponent(String(imagePath || ''));
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  if (!/^[a-z0-9_.\-/\\]+$/i.test(normalized)) {
    sendAsset(res, 404, 'Not found', 'text/plain; charset=utf-8', 'no-store');
    return;
  }

  const publicImagePath = normalized.replace(/\\/g, '/');
  const localImagePath = IMAGE_ALIASES.get(publicImagePath) || normalized;
  const filePath = path.join(IMAGE_DIR, localImagePath);
  const resolvedImageDir = path.resolve(IMAGE_DIR);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedImageDir && !resolvedFile.startsWith(`${resolvedImageDir}${path.sep}`)) {
    sendAsset(res, 404, 'Not found', 'text/plain; charset=utf-8', 'no-store');
    return;
  }

  const stream = fs.createReadStream(resolvedFile);
  let opened = false;
  stream.once('open', () => {
    opened = true;
    res.writeHead(200, {
      'Content-Type': imageContentType(resolvedFile),
      'Cache-Control': 'public, max-age=300',
    });
    stream.pipe(res);
  });
  stream.once('error', () => {
    if (!opened && !res.headersSent) sendAsset(res, 404, 'Not found', 'text/plain; charset=utf-8', 'no-store');
    else res.destroy();
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sessionUser(req) {
  try {
    const sessionId = parseCookies(req.headers.cookie || '').coinsprite_admin;
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8') || '{}').sessions?.[sessionId];
    if (!session?.user?.id || Number(session.expiresAt) <= Date.now()) return null;
    return session.user;
  } catch { return null; }
}

async function requireGuildAdmin(req, res, guildId) {
  const user = sessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Not logged in.' });
    return null;
  }
  const guild = clientRef?.guilds?.cache?.get(guildId) || await clientRef?.guilds?.fetch(guildId).catch(() => null);
  if (!guild) {
    sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    return null;
  }
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    sendJson(res, 403, { error: 'Administrator permission is required.' });
    return null;
  }
  return { user, guild, member };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 }); }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function actionType(action = {}) {
  if (action.type || action.actionType) return action.type || action.actionType;
  if (action.roleId) return 'give_role';
  if (action.templateId) return 'send_message';
  if (action.response) return 'legacy_response';
  return 'send_message';
}

function actionConfigured(action = {}) {
  const type = actionType(action);
  if (type === 'send_message') return Boolean(String(action.templateId || '').trim());
  if (type === 'give_role') return /^\d{16,20}$/.test(String(action.roleId || '').trim());
  if (type === 'legacy_response') return Boolean(String(action.response || '').trim());
  return false;
}

function componentItems(template) {
  const items = new Map();
  for (const row of template?.componentRows || []) {
    const list = row.type === 'select' ? row.options || [] : row.buttons || [];
    for (const item of list) items.set(`${row.id}:${item.id}`, item);
  }
  return items;
}

function mergeItemActions(incomingItem, storedItem) {
  const storedActions = Array.isArray(storedItem?.actions) ? storedItem.actions.filter(Boolean) : [];
  if (!storedActions.some(actionConfigured)) return;
  if (incomingItem?.style === 'link') return;

  const incomingActions = Array.isArray(incomingItem.actions) ? incomingItem.actions.filter(Boolean) : [];
  if (!incomingActions.length || !incomingActions.some(actionConfigured)) {
    incomingItem.actions = clone(storedActions).slice(0, 2);
    return;
  }

  const storedByType = new Map(storedActions.map((action) => [actionType(action), action]));
  incomingItem.actions = incomingActions.slice(0, 2).map((action) => {
    if (actionConfigured(action)) return action;
    const stored = storedByType.get(actionType(action));
    return stored && actionConfigured(stored) ? clone(stored) : action;
  });
}

function preserveStoredComponentActions(incoming, stored) {
  if (!stored?.componentRows?.length || !incoming?.componentRows?.length) return incoming;
  const storedItems = componentItems(stored);
  for (const row of incoming.componentRows || []) {
    const list = row.type === 'select' ? row.options || [] : row.buttons || [];
    for (const item of list) {
      mergeItemActions(item, storedItems.get(`${row.id}:${item.id}`));
    }
  }
  return incoming;
}

function applyComponentActions(guildId, templateId, body = {}) {
  const template = findTemplate(guildId, templateId);
  if (!template) return null;
  const rowId = String(body.rowId || '').trim();
  const itemId = String(body.itemId || '').trim();
  const row = template.componentRows.find((entry) => entry.id === rowId);
  const items = row?.type === 'select' ? row.options : row?.buttons;
  const item = items?.find((entry) => entry.id === itemId);
  if (!item) return null;
  item.actions = Array.isArray(body.actions) ? body.actions.slice(0, 2) : [];
  return saveTemplate(guildId, template);
}

function injectedIndex() {
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  html = html.replace('</head>', [
    '  <link rel="stylesheet" href="/admin/messages.css">',
    '  <link rel="stylesheet" href="/admin/message-components.css">',
    '  <link rel="stylesheet" href="/admin/message-component-actions.css?v=action-save-3">',
    '  <link rel="stylesheet" href="/admin/moderator.css?v=moderator-7">',
    '  <link rel="stylesheet" href="/admin/channel-rules.css?v=channel-rules-1">',
    TAB_ICON_STYLE,
    '</head>',
  ].join('\n'));
  html = html.replace(
    '<button class="tab" type="button" data-tab="games"><span>Games</span></button>',
    '<button class="tab" type="button" data-tab="moderator"><img class="tab-icon" src="/images/moderator.png" alt="" aria-hidden="true"><span>Moderator</span></button>\n        <button class="tab" type="button" data-tab="messages"><img class="tab-icon" src="/images/message.png" alt="" aria-hidden="true"><span>Messages</span></button>\n        <button class="tab" type="button" data-tab="games"><span>Games</span></button>',
  );
  html = html.replace(
    '<section class="tab-panel" data-panel="games">',
    '<section class="tab-panel" data-panel="moderator"><div id="moderatorRoot"></div></section>\n\n        <section class="tab-panel" data-panel="messages"><div id="messageTemplatesRoot"></div></section>\n\n        <section class="tab-panel" data-panel="games">',
  );
  html = html.replace(
    '</body>',
    [
      '  <script src="/admin/moderator.js?v=moderator-7" defer></script>',
      '  <script src="/admin/channel-rules.js?v=channel-rules-1" defer></script>',
      '  <script src="/admin/messages.js?v=folders-3" defer></script>',
      '  <script src="/admin/message-components.js?v=action-save-3" defer></script>',
      '  <script src="/admin/message-component-actions.js?v=action-save-3" defer></script>',
      '  <script src="/admin/message-tab-inline-editor.js?v=inline-editor-1" defer></script>',
      '</body>',
    ].join('\n'),
  );
  return html;
}

async function handleTemplateRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname.startsWith('/CoinSprite/images/')) {
    serveImageAsset(res, url.pathname.slice('/CoinSprite/images/'.length));
    return true;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
    serveImageAsset(res, url.pathname.slice('/images/'.length));
    return true;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/CoinSprite/images/')) {
    serveImageAsset(res, url.pathname.slice('/CoinSprite/images/'.length));
    return true;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    const html = injectedIndex();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }
  const listMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates$/);
  const itemMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})$/);
  const componentActionsMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})\/component-actions$/);
  const actionMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})\/(send|edit)$/);
  const match = listMatch || itemMatch || componentActionsMatch || actionMatch;
  if (!match) return false;
  const auth = await requireGuildAdmin(req, res, match[1]);
  if (!auth) return true;
  const guildId = match[1];
  if (listMatch && req.method === 'GET') {
    sendJson(res, 200, { guildId, templates: listTemplates(guildId) });
    return true;
  }
  if (itemMatch && req.method === 'PUT') {
    const body = await readBody(req);
    const existing = findTemplate(guildId, itemMatch[2]);
    const template = saveTemplate(guildId, preserveStoredComponentActions({ ...body, id: itemMatch[2] }, existing));
    sendJson(res, 200, { guildId, template });
    return true;
  }
  if (componentActionsMatch && req.method === 'PUT') {
    const template = applyComponentActions(guildId, componentActionsMatch[2], await readBody(req));
    if (!template) sendJson(res, 404, { error: 'Message component not found.' });
    else sendJson(res, 200, { guildId, template });
    return true;
  }
  if (itemMatch && req.method === 'DELETE') {
    if (!deleteTemplate(guildId, itemMatch[2])) sendJson(res, 404, { error: 'Message template not found or cannot be deleted.' });
    else sendJson(res, 200, { ok: true });
    return true;
  }
  if (actionMatch && req.method === 'POST') {
    const template = findTemplate(guildId, actionMatch[2]);
    if (!template) {
      sendJson(res, 404, { error: 'Message template not found.' });
      return true;
    }
    const body = await readBody(req);
    let channelId = String(body.channelId || '');
    let messageId = '';
    if (actionMatch[3] === 'edit') {
      const target = parseDiscordMessageLink(body.messageLink, guildId);
      if (!target) {
        sendJson(res, 400, { error: 'Enter a valid Discord message link from this server.' });
        return true;
      }
      channelId = target.channelId;
      messageId = target.messageId;
    }
    const channel = await auth.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      sendJson(res, 400, { error: 'Select a text channel the bot can access.' });
      return true;
    }
    const payload = await fitMessageThumbnailSquares(buildMessagePayload(template, {
      guild: auth.guild,
      channel,
      user: auth.user,
      member: auth.member,
    }));
    if (!payload?.components?.length) {
      sendJson(res, 400, { error: 'This message template is empty, so the bot did not send it.' });
      return true;
    }
    if (actionMatch[3] === 'send') {
      const message = await channel.send(payload);
      sendJson(res, 200, { ok: true, messageLink: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}` });
      return true;
    }
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message || message.author?.id !== clientRef.user.id) {
      sendJson(res, 400, { error: 'That message was not sent by this bot or is no longer available.' });
      return true;
    }
    await message.edit(payload);
    sendJson(res, 200, { ok: true });
    return true;
  }
  sendJson(res, 405, { error: 'Method not allowed.' });
  return true;
}

http.createServer = function patchedCreateServer(listener) {
  return originalCreateServer((req, res) => {
    handleTemplateRequest(req, res).then((handled) => {
      if (!handled) listener(req, res);
    }).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || 'Internal server error.' }));
  });
};

Module._load = function captureTicketClient(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__messageClientCapture) return exported;
  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => {
    clientRef = client;
    if (nativeInit) await nativeInit(client);
  };
  exported.__messageClientCapture = true;
  return exported;
};

module.exports = {};
    }],
    ["02-admin-icon-assets.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const previousCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const IMAGE_DIR = path.join(__dirname, '..', 'images');
const ADMIN_BUNDLE_PATH = '/admin/admin.bundle.js';
const ICON_FILES = Object.freeze({
  'leveling.png': 'leveling.png',
  'messages.png': 'message.png',
  'message.png': 'message.png',
  'message.svg': 'message.png',
  'ticket.png': 'ticket.png',
  'moderator.png': 'moderator.png',
  'moderator.svg': 'moderator.png',
  'data.png': 'data.png',
  'data.svg': 'data.png',
});
const ICONS = new Map(
  ['/CoinSprite/images/', '/admin/images/', '/images/'].flatMap((prefix) => (
    Object.entries(ICON_FILES).map(([publicName, fileName]) => [
      `${prefix}${publicName}`,
      { file: path.join(IMAGE_DIR, fileName), type: 'image/png' },
    ])
  )),
);
let clientRef = null;

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function patchAdminIndex(source) {
  return source.replace(
    /\n\s*<script src="\/admin\/tickets\.js" defer><\/script>[\s\S]*?<script src="\/admin\/owner-panel\.js\?v=owner-tokens-1" defer><\/script>/,
    '\n  <script src="/admin/admin.bundle.js" defer></script>',
  );
}

function patchDefaultMessageList(source) {
  return source
    .replace(
      `  function withBuiltInDefaults(items) {
    const byId = new Map((Array.isArray(items) ? items : []).filter((item) => item && item.id).map((item) => [item.id, item]));
    for (const template of BUILT_IN_DEFAULT_TEMPLATES) {
      const saved = byId.get(template.id) || {};
      byId.set(template.id, {
        ...cloneTemplate(template),
        ...saved,
        id: template.id,
        type: 'template',
        folderId: '',
        name: template.name,
        botDefault: true,
        defaultLocked: true,
      });
    }
    return [...byId.values()];
  }`,
      `  function withBuiltInDefaults(items) {
    const byId = new Map((Array.isArray(items) ? items : []).filter((item) => item && item.id).map((item) => [item.id, item]));
    for (const template of BUILT_IN_DEFAULT_TEMPLATES) {
      const fallback = cloneTemplate(template); // FIXED: defaults always keep their built-in message body available.
      const saved = byId.get(template.id) || {};
      const containers = Array.isArray(saved.containers) && saved.containers.length ? saved.containers : fallback.containers; // FIXED: empty saved default records no longer render as blank defaults.
      const componentRows = Array.isArray(saved.componentRows) ? saved.componentRows : fallback.componentRows; // FIXED: default component rows stay stable when the API omits them.
      byId.set(template.id, {
        ...fallback,
        ...saved,
        id: template.id,
        type: 'template',
        folderId: '',
        name: template.name,
        containers,
        componentRows,
        botDefault: true,
        defaultLocked: true,
      });
    }
    return [...byId.values()];
  }`,
    )
    .replace(
      `    const allTemplates = withBuiltInDefaults(view.templates);
    if (allTemplates.length !== view.templates.length) view.templates = allTemplates;
    const defaults = allTemplates.filter((item) => isDefaultTemplate(item) && item.type !== 'folder');
    const folders = allTemplates.filter((item) => item.type === 'folder' && !isDefaultTemplate(item) && matchesQuery(item, query));
    const folder = folders.find((item) => item.id === view.folderId) || null;
    const userTemplates = allTemplates.filter((item) => item.type !== 'folder' && !isDefaultTemplate(item) && (view.folderId ? item.folderId === view.folderId : !item.folderId) && matchesQuery(item, query));
    const showingDefaults = view.section === 'defaults';
    const shown = showingDefaults ? defaults : userTemplates;`,
      `    const allTemplates = withBuiltInDefaults(view.templates);
    view.templates = allTemplates; // FIXED: default cards and click handlers use the same rebuilt template list.
    const defaultTemplates = allTemplates.filter((item) => isDefaultTemplate(item) && item.type !== 'folder');
    const folders = allTemplates.filter((item) => item.type === 'folder' && !isDefaultTemplate(item) && matchesQuery(item, query));
    const folder = folders.find((item) => item.id === view.folderId) || null;
    const userTemplates = allTemplates.filter((item) => item.type !== 'folder' && !isDefaultTemplate(item) && (view.folderId ? item.folderId === view.folderId : !item.folderId) && matchesQuery(item, query));
    const showingDefaults = view.section === 'defaults';
    const defaults = defaultTemplates.filter((item) => matchesQuery(item, query)); // FIXED: Defaults search uses the same filtering behavior as Templates search.
    const shown = showingDefaults ? defaults : userTemplates;`,
    );
}

function defaultMessageListGuard() {
  return `
(() => {
  if (window.__coinSpriteDefaultMessageListGuard) return;
  window.__coinSpriteDefaultMessageListGuard = true;
  const defaults = ${JSON.stringify([
    {
      id: 'default-ai-moderation-alert',
      type: 'template',
      folderId: '',
      name: 'Default: AI moderation alert',
      containers: [{ id: 'ai-moderation-alert', accentColor: '#9B59B6', text: '## AI moderation alert' }],
      botDefault: true,
      defaultLocked: true,
    },
    {
      id: 'default-ai-moderation-user-warning',
      type: 'template',
      folderId: '',
      name: 'Default: AI moderation user warning',
      containers: [{ id: 'ai-moderation-user-warning', accentColor: '#9B59B6', text: '## Message flagged' }],
      botDefault: true,
      defaultLocked: true,
    },
    {
      id: 'default-link-auto-moderation-alert',
      type: 'template',
      folderId: '',
      name: 'Default: Link Auto-Moderator alert',
      containers: [{ id: 'link-auto-moderation-alert', accentColor: '#ED4245', text: '## Link Auto-Moderator report' }],
      botDefault: true,
      defaultLocked: true,
    },
  ])};
  const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  const active = (root) => root?.querySelector('.message-list-head h3')?.textContent?.trim() === 'Default messages';
  const matches = (item, query) => !query || \`\${item.name || ''} \${item.id || ''}\`.toLowerCase().includes(query);
  const card = (item) => {
    const count = Array.isArray(item.containers) ? item.containers.length : 0;
    return \`<button class="message-template-card message-default-card" type="button" data-message-action="open" data-id="\${escapeHtml(item.id)}" style="display:grid!important;visibility:visible!important;opacity:1!important"><span class="message-template-symbol"><img src="/images/message.png" alt="" aria-hidden="true"></span><span><strong>\${escapeHtml(item.name)}</strong><small>\${count} container\${count === 1 ? '' : 's'}</small></span><span class="message-card-folder-button message-card-edit-button">Edit</span><span class="message-card-arrow">›</span></button>\`; // FIXED: fallback default cards cannot be hidden by stale card styling.
  };
  function repair() {
    const root = document.querySelector('#messageTemplatesRoot');
    if (!active(root)) return;
    const grid = root.querySelector('.message-template-grid');
    if (!grid) return;
    if (grid.querySelector('.message-template-card')) return; // FIXED: fallback repair is idempotent and cannot trigger its own mutation loop.
    const query = (root.querySelector('#messageTemplateSearch')?.value || '').trim().toLowerCase();
    const visible = defaults.filter((item) => matches(item, query));
    if (visible.length) grid.innerHTML = visible.map(card).join('');
    const emptyState = root.querySelector('.empty-state');
    if (visible.length) emptyState?.remove();
    if (!visible.length && !emptyState) grid.insertAdjacentHTML('afterend', '<div class="empty-state">No default messages found.</div>'); // FIXED: Defaults search shows the same no-results state as Templates search.
  }
  document.addEventListener('input', (event) => {
    if (event.target?.id === 'messageTemplateSearch') requestAnimationFrame(repair); // FIXED: default search blank state is repaired after each typed query.
  }, true);
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-message-action="section-defaults"]')) setTimeout(repair, 0); // FIXED: opening Defaults always rechecks the default card list.
  }, true);
  new MutationObserver(() => requestAnimationFrame(repair)).observe(document.documentElement, { childList: true, subtree: true });
  repair();
})();
`;
}

function patchMessagesScript(source) {
  return `${patchDefaultMessageList(source)
    .replace('if (selected().containers.length > 1) selected().containers.splice', 'selected().containers.splice')
    .replace(
      '<div class="message-bot-avatar">CS</div>',
      '<img class="message-bot-avatar" src="/admin/bot-avatar.png" alt="CoinSprite bot avatar">',
    )}\n${defaultMessageListGuard()}`;
}

function patchAppScript(source) {
  const currentExcludedKeys = "['levelUp', 'ticketPanel', 'ticketCategory', 'transcript']";
  const hiddenChannelKeys = "['levelUp', 'ticketPanel', 'ticketCategory', 'transcript', 'roleRequestReview', 'giveawayRequestReview', 'inviteRules', 'inviteClaim', 'inviteLog', 'inviteAnnounce', 'wordChain']";
  return source
    .split(currentExcludedKeys).join(hiddenChannelKeys)
    .replace(
      "elements.configForm.addEventListener('input', (event) => {\n  refreshDirtyState();",
      "elements.configForm.addEventListener('input', (event) => {\n  if (event.target !== elements.levelUpPreviewLevel) refreshDirtyState();",
    )
    .replace(
      "elements.configForm.addEventListener('change', (event) => {\n  refreshDirtyState();",
      "elements.configForm.addEventListener('change', (event) => {\n  if (event.target !== elements.levelUpPreviewLevel) refreshDirtyState();",
    );
}

function adminInteractionFixes() {
  return `
(() => {
  const workflowSelectSelector = [
    '[data-workflow-dm-template]',
    '[data-workflow-field]',
    '[data-condition-action-field]',
  ].join(',');

  // Workflow panels are rebuilt by a document click listener. Keep native select
  // clicks from reaching it so the browser dropdown remains open.
  window.addEventListener('click', (event) => {
    if (event.target.closest?.(workflowSelectSelector)) event.stopPropagation();
  }, true);

  let cleanupScheduled = false;
  function cleanupPunishmentRolePickers() {
    cleanupScheduled = false;
    const mount = document.querySelector('#wordChainRoleMount');
    if (!mount) return;
    const pickers = [...mount.children].filter((node) => node.classList?.contains('picker'));
    pickers.slice(0, -1).forEach((picker) => {
      const menuId = picker.querySelector('.picker-button')?.dataset.menuId;
      if (menuId) {
        [...document.querySelectorAll('.picker-portal-menu')]
          .find((menu) => menu.dataset.menuId === menuId)?.remove();
      }
      picker.remove();
    });
  }
  function schedulePunishmentRoleCleanup() {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    queueMicrotask(cleanupPunishmentRolePickers);
  }
  new MutationObserver(schedulePunishmentRoleCleanup).observe(document.body, { childList: true, subtree: true });
  schedulePunishmentRoleCleanup();
})();
 `;
}

function patchTicketUpgradeScript(source) {
  return `${source}\n${adminInteractionFixes()}`;
}

function patchTicketUpgradeCss(source) {
  return `${source}

.emoji-component-popover {
  width: min(430px, calc(100vw - 24px));
  max-height: none !important;
  grid-template-columns: 1fr;
  padding: 0;
}
.emoji-component-popover.open { display: block; }
.emoji-component-popover emoji-picker {
  width: min(430px, calc(100vw - 24px));
  height: min(420px, calc(100vh - 48px));
  color-scheme: dark;
  --background: #111318;
  --border-color: #303441;
  --input-border-color: #5865f2;
  --input-font-color: #ffffff;
  --input-placeholder-color: #888888;
  --category-font-color: #ffffff;
  --button-hover-background: #222633;
  --button-active-background: #2b3040;
  --indicator-color: #5865f2;
}
 `;
}

const BUNDLED_ADMIN_SCRIPTS = [
  ['tickets.js'],
  ['rich-message-editor.js'],
  ['message-inline-editor.js'],
  ['message-template-workflow.js'],
  ['messages.js', patchMessagesScript],
  ['message-components.js'],
  ['message-component-actions.js'],
  ['message-tab-inline-editor.js'],
  ['app.js', (source) => patchTicketUpgradeScript(patchAppScript(source))],
  ['user-data.js'],
  ['emoji-picker.js'],
  ['message-edit-shortcuts.js'],
  ['owner-panel.js'],
  ['dashboard-ui-enhancements.js'],
];

const TEXT_ASSETS = new Map([
  ['/admin/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', patch: patchAdminIndex }],
  ['/admin/messages.js', { file: 'messages.js', type: 'application/javascript; charset=utf-8', patch: patchMessagesScript }],
  ['/admin/app.js', { file: 'app.js', type: 'application/javascript; charset=utf-8', patch: (source) => patchTicketUpgradeScript(patchAppScript(source)) }],
  ['/admin/style.css', { file: 'style.css', type: 'text/css; charset=utf-8', patch: patchTicketUpgradeCss }],
]);

function serveAdminBundle(res) {
  try {
    const output = 'window.__coinSpriteAdminBundleIncludesMessages = true;\n' + BUNDLED_ADMIN_SCRIPTS.map(([fileName, patch]) => {
      const source = fs.readFileSync(path.join(ADMIN_DIR, fileName), 'utf8');
      const code = typeof patch === 'function' ? patch(source) : source;
      return `;\n/* admin/${fileName} */\n${code}\n//# sourceURL=/admin/${fileName}`;
    }).join('\n');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(output);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`console.error(${JSON.stringify(`Admin bundle failed: ${error.message}`)});`);
  }
}

function serveTextAsset(res, asset) {
  fs.readFile(path.join(ADMIN_DIR, asset.file), 'utf8', (error, source) => {
    if (error) {
      notFound(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' });
    res.end(asset.patch(source));
  });
}

function redirectBotAvatar(res) {
  const avatarUrl = clientRef?.user?.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (!avatarUrl) {
    notFound(res);
    return;
  }
  res.writeHead(302, { Location: avatarUrl, 'Cache-Control': 'no-store' });
  res.end();
}

http.createServer = function adminAssetServer(listener) {
  return previousCreateServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === ADMIN_BUNDLE_PATH) {
      serveAdminBundle(res);
      return;
    }
    const textAsset = TEXT_ASSETS.get(pathname === '/' || pathname === '/admin' ? '/admin/index.html' : pathname);
    if (textAsset) {
      serveTextAsset(res, textAsset);
      return;
    }
    if (pathname === '/admin/bot-avatar.png') {
      redirectBotAvatar(res);
      return;
    }
    const icon = ICONS.get(pathname);
    if (!icon) {
      listener(req, res);
      return;
    }
    const stream = fs.createReadStream(icon.file);
    let opened = false;
    stream.once('open', () => {
      opened = true;
      res.writeHead(200, { 'Content-Type': icon.type, 'Cache-Control': 'no-store' });
      stream.pipe(res);
    });
    stream.once('error', () => {
      if (!opened && !res.headersSent) notFound(res);
      else res.destroy();
    });
  });
};

Module._load = function captureAdminClient(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__adminAssetClientCapture) return exported;
  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => {
    clientRef = client;
    if (nativeInit) await nativeInit(client);
  };
  exported.__adminAssetClientCapture = true;
  return exported;
};

module.exports = {};
    }],
    ["04-admin-request-workflows.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { PermissionFlagsBits } = require('discord.js');
const { getGuildWorkflows, saveGuildWorkflows } = require('../src/requestControlWorkflows');

const previousCreateServer = http.createServer.bind(http);
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);
const previousLoad = Module._load;
const ADMIN_APP_PATH = path.resolve(__dirname, '..', 'admin', 'app.js');
const ADMIN_STYLE_PATH = path.resolve(__dirname, '..', 'admin', 'style.css');
const ADMIN_BROWSER_MARKER = '__coinSpriteRequestWorkflowEditor';
const ADMIN_STYLE_MARKER = '__coinSpriteRequestWorkflowEditorStyles';
const SESSION_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
let clientRef = null;

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function sessionUser(req) {
  try {
    const id = parseCookies(req.headers.cookie || '').coinsprite_admin;
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8') || '{}').sessions?.[id];
    return session?.user?.id && Number(session.expiresAt) > Date.now() ? session.user : null;
  } catch { return null; }
}
async function requireAdmin(req, res, guildId) {
  const user = sessionUser(req);
  const guild = clientRef?.guilds?.cache?.get(guildId) || await clientRef?.guilds?.fetch(guildId).catch(() => null);
  const member = user && guild ? await guild.members.fetch(user.id).catch(() => null) : null;
  if (!user) { sendJson(res, 401, { error: 'Not logged in.' }); return null; }
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) { sendJson(res, 403, { error: 'Administrator permission is required.' }); return null; }
  return guild;
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function browserScript() {
  return String.raw`
;(() => {
  if (window.__coinSpriteRequestWorkflowEditor) return;
  window.__coinSpriteRequestWorkflowEditor = true;
  let workflowGuildId = '';
  let workflows = {};
  let savedWorkflows = {};
  let templates = [];
  let activeTicketId = '';
  let rendering = false;
  let workflowObserver = null;
  const nativeActions = new Set(['close', 'transcript', 'delete', 'blacklist', 'move_to']);
  const copy = (value) => JSON.parse(JSON.stringify(value || {}));
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  const id = (prefix) => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const conditionStep = (conditionId) => 'condition_' + conditionId;
  const conditionIdFromStep = (value) => String(value || '').match(/^condition_([a-z0-9_-]{1,32})$/)?.[1] || '';
  const isRequest = (type) => Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
  const ticketValue = () => { try { return ensureTicketEditor().getValue().tickets; } catch { return { types: [] }; } };
  function responseWithJson(response, value) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
  }
  function activeType() {
    const types = ticketValue().types;
    let type = types.find((item) => item.id === activeTicketId) || null;
    if (!type) {
      const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim();
      type = types.find((item) => heading?.endsWith(item.name)) || null;
      if (type) activeTicketId = type.id;
    }
    return type;
  }
  const workflow = (ticketId, controlId) => {
    workflows[ticketId] ||= {};
    workflows[ticketId][controlId] ||= { dmTemplateId: '', sequence: [], conditions: [] };
    workflows[ticketId][controlId].sequence ||= [];
    workflows[ticketId][controlId].conditions ||= [];
    return workflows[ticketId][controlId];
  };
  function repairLegacyRequestType(config) {
    const canonicalId = 'request_role_crew_member_plus';
    const prefixedId = 'request-' + canonicalId;
    const legacyWorkflows = workflows[prefixedId];
    if (legacyWorkflows) {
      workflows[canonicalId] = { ...legacyWorkflows, ...(workflows[canonicalId] || {}) };
      delete workflows[prefixedId];
    }
    (config?.tickets?.types || []).forEach((type) => {
      if (type?.workflow === canonicalId && type.id === prefixedId) type.id = canonicalId;
    });
  }
  function overlayWorkflowSequences(config) {
    (config?.tickets?.types || []).filter(isRequest).forEach((type) => {
      (type.adminPanel?.controls || []).forEach((control) => {
        const data = workflow(type.id, control.id);
        const legacy = [
          ...(control.actions || []).filter((step) => nativeActions.has(step)),
          ...(data.conditions || []).map((condition) => conditionStep(condition.id)),
        ];
        data.sequence = Array.isArray(data.sequence) && data.sequence.length ? [...data.sequence] : legacy;
        control.actions = [...data.sequence];
      });
    });
  }
  const roleOptionsHtml = (selected = '') => '<option value=\"\">Select role</option>' + (state.directory.roles || []).map((role) => '<option value=\"' + esc(role.id) + '\" ' + (role.id === selected ? 'selected' : '') + '>' + esc(role.name) + '</option>').join('');
  const templateOptionsHtml = (selected = '') => '<option value=\"\">None</option>' + templates.map((template) => '<option value=\"' + esc(template.id) + '\" ' + (template.id === selected ? 'selected' : '') + '>' + esc(template.name) + '</option>').join('');
  const questionOptionsHtml = (type, selected = '') => '<option value=\"\">Select question</option>' + (type.forms?.create || []).filter((question) => question.type !== 'text_display').map((question, index) => '<option value=\"' + esc(question.id) + '\" ' + (question.id === selected ? 'selected' : '') + '>Question ' + (index + 1) + ': ' + esc(question.question) + '</option>').join('');
  function defaultExpected(question) {
    if (question?.type === 'file_upload') return 'has_files';
    if (question?.type === 'checkbox') return 'checked';
    return '';
  }
  function answerInput(condition, type, conditionIndex, controlIndex) {
    const question = (type.forms?.create || []).find((item) => item.id === condition.questionId);
    const attrs = ' data-workflow-field=\"expected\" data-control-index=\"' + controlIndex + '\" data-condition-index=\"' + conditionIndex + '\"';
    if (!question) return '<label>Expected answer<input type=\"text\" disabled placeholder=\"Select a question first\"></label>';
    if (question.type === 'file_upload') return '<label>File answer<select' + attrs + '><option value=\"has_files\" ' + (condition.expected === 'has_files' ? 'selected' : '') + '>Has files</option><option value=\"no_files\" ' + (condition.expected === 'no_files' ? 'selected' : '') + '>No files</option></select></label>';
    if (question.type === 'checkbox') return '<label>Expected answer<select' + attrs + '><option value=\"checked\" ' + (condition.expected === 'checked' ? 'selected' : '') + '>Checked</option><option value=\"not_checked\" ' + (condition.expected === 'not_checked' ? 'selected' : '') + '>Not checked</option></select></label>';
    if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) return '<label>Expected answer<select' + attrs + '><option value=\"\">Select answer</option>' + (question.options || []).map((option) => '<option value=\"' + esc(option.name) + '\" ' + (option.name === condition.expected ? 'selected' : '') + '>' + esc(option.name) + '</option>').join('') + '</select></label>';
    return '<label>Exact answer<input type=\"text\" value=\"' + esc(condition.expected) + '\"' + attrs + '></label>';
  }
  function actionHtml(action, controlIndex, conditionIndex, actionIndex) {
    const attrs = ' data-control-index=\"' + controlIndex + '\" data-condition-index=\"' + conditionIndex + '\" data-condition-action-index=\"' + actionIndex + '\"';
    let detail = '';
    if (action.type === 'dm_template') detail = '<label>Message template<select data-condition-action-field=\"templateId\"' + attrs + '>' + templateOptionsHtml(action.templateId) + '</select></label>';
    if (action.type === 'role_add') detail = '<label>Role<select data-condition-action-field=\"roleId\"' + attrs + '>' + roleOptionsHtml(action.roleId) + '</select></label>';
    return '<div class=\"condition-action\"><label>Action<select data-condition-action-field=\"type\"' + attrs + '><option value=\"dm_template\" ' + (action.type === 'dm_template' ? 'selected' : '') + '>DM message template</option><option value=\"role_add\" ' + (action.type === 'role_add' ? 'selected' : '') + '>Role add</option><option value=\"accept\" ' + (action.type === 'accept' ? 'selected' : '') + '>Accept request</option><option value=\"deny\" ' + (action.type === 'deny' ? 'selected' : '') + '>Deny request</option><option value=\"blacklist\" ' + (action.type === 'blacklist' ? 'selected' : '') + '>Blacklist author</option></select></label>' + detail + '<button class=\"icon-button danger-text\" type=\"button\" data-workflow-action=\"remove-condition-action\"' + attrs + '>&times;</button></div>';
  }
  function conditionHtml(condition, type, controlIndex, conditionIndex) {
    const attrs = ' data-control-index=\"' + controlIndex + '\" data-condition-index=\"' + conditionIndex + '\"';
    let criteria = '';
    if (condition.type === 'form_input') criteria = '<label>Question<select data-workflow-field=\"questionId\"' + attrs + '>' + questionOptionsHtml(type, condition.questionId) + '</select></label>' + answerInput(condition, type, conditionIndex, controlIndex);
    if (condition.type === 'has_role') criteria = '<label>Required role<select data-workflow-field=\"roleId\"' + attrs + '>' + roleOptionsHtml(condition.roleId) + '</select></label>';
    if (condition.type === 'level') criteria = '<label>Minimum level<input type=\"number\" min=\"0\" step=\"1\" value=\"' + Number(condition.level || 0) + '\" data-workflow-field=\"level\"' + attrs + '></label>';
    return '<div class=\"request-condition-inline\"><div class=\"request-condition-grid\"><label>Condition type<select data-workflow-field=\"type\"' + attrs + '><option value=\"form_input\" ' + (condition.type === 'form_input' ? 'selected' : '') + '>Form input</option><option value=\"level\" ' + (condition.type === 'level' ? 'selected' : '') + '>Level</option><option value=\"has_role\" ' + (condition.type === 'has_role' ? 'selected' : '') + '>Has role</option></select></label>' + criteria + '</div><div class=\"condition-actions\"><div class=\"sequence-head\"><span class=\"field-label\">Actions when true</span><button class=\"button small\" type=\"button\" data-workflow-action=\"add-condition-action\"' + attrs + '>+ Add action</button></div>' + (condition.actions || []).map((action, index) => actionHtml(action, controlIndex, conditionIndex, index)).join('') + '</div></div>';
  }
  function observeWorkflowPanels() {
    const root = document.querySelector('#ticketEditorRoot');
    if (workflowObserver && root) workflowObserver.observe(root, { childList: true, subtree: true });
  }
  function renderWorkflowPanels() {
    if (rendering) return;
    const type = activeType();
    const root = document.querySelector('#ticketEditorRoot');
    if (!root || !isRequest(type) || !root.dataset.requestEditor) return;
    rendering = true;
    workflowObserver?.disconnect();
    try {
      root.querySelectorAll('.ticket-control-card').forEach((card, controlIndex) => {
        const control = type.adminPanel?.controls?.[controlIndex];
        if (!control) return;
        const data = workflow(type.id, control.id);
        data.sequence = [...(control.actions || [])];
        card.querySelector('.request-template-field')?.remove();
        card.querySelector('.request-dm-field')?.remove();
        card.querySelectorAll('.request-condition-inline').forEach((node) => node.remove());
        const hasDm = data.sequence.includes('transcript');
        const nativeDescription = card.querySelector('[data-control-field=\"description\"]')?.closest('label');
        if (nativeDescription) nativeDescription.hidden = hasDm;
        if (hasDm) {
          const field = document.createElement('label');
          field.className = 'request-template-field';
          field.innerHTML = '<span class=\"field-label\">DM message template</span><select data-workflow-dm-template=\"' + controlIndex + '\">' + templateOptionsHtml(data.dmTemplateId) + '</select><span class=\"request-action-note\">Choose a saved Messages template. If None is saved, the DM action is removed when settings are saved.</span>';
          card.querySelector('.action-sequence')?.append(field);
        }
        card.querySelectorAll('.sequence-item').forEach((item, actionIndex) => {
          const conditionId = conditionIdFromStep(data.sequence[actionIndex]);
          item.classList.toggle('workflow-condition-step', Boolean(conditionId));
          if (!conditionId) return;
          const condition = data.conditions.find((value) => value.id === conditionId);
          const conditionIndex = data.conditions.indexOf(condition);
          const label = item.querySelector('strong');
          if (label) label.textContent = 'Condition';
          if (condition) item.insertAdjacentHTML('beforeend', conditionHtml(condition, type, controlIndex, conditionIndex));
        });
        const select = card.querySelector('select[data-action-select]');
        if (select && data.conditions.length < 10) {
          const conditionId = id('condition');
          select.append(new Option('Condition', conditionStep(conditionId)));
        }
      });
    } finally {
      rendering = false;
      observeWorkflowPanels();
    }
  }
  function markChanged() { refreshDirtyState(); queueMicrotask(renderWorkflowPanels); }
  document.addEventListener('click', (event) => {
    const ticketCard = event.target.closest('.ticket-type-card');
    if (ticketCard) activeTicketId = ticketCard.dataset.ticketId || '';
    const nativeButton = event.target.closest('#ticketEditorRoot [data-action]');
    if (nativeButton) {
      const type = activeType();
      const card = nativeButton.closest('.ticket-control-card');
      const controlIndex = card ? [...document.querySelectorAll('#ticketEditorRoot .ticket-control-card')].indexOf(card) : -1;
      const control = type?.adminPanel?.controls?.[controlIndex];
      if (control && nativeButton.dataset.action === 'add-action') {
        const selected = card.querySelector('select[data-action-select]')?.value || '';
        const conditionId = conditionIdFromStep(selected);
        if (conditionId) workflow(type.id, control.id).conditions.push({ id: conditionId, type: 'form_input', questionId: '', expected: '', roleId: '', level: 0, actions: [] });
        if (conditionId) queueMicrotask(markChanged);
      }
      if (control && nativeButton.dataset.action === 'remove-action') {
        const conditionId = conditionIdFromStep(control.actions?.[Number(nativeButton.dataset.actionIndex)]);
        if (conditionId) {
          const data = workflow(type.id, control.id);
          data.conditions = data.conditions.filter((condition) => condition.id !== conditionId);
          queueMicrotask(markChanged);
        }
      }
    }
    const button = event.target.closest('[data-workflow-action]');
    if (!button) return;
    const type = activeType();
    const control = type?.adminPanel?.controls?.[Number(button.dataset.controlIndex)];
    if (!type || !control) return;
    const data = workflow(type.id, control.id);
    const conditionIndex = Number(button.dataset.conditionIndex);
    const condition = data.conditions[conditionIndex];
    if (!condition) return;
    if (button.dataset.workflowAction === 'add-condition-action') condition.actions.push({ id: id('action'), type: 'dm_template', templateId: '', roleId: '' });
    if (button.dataset.workflowAction === 'remove-condition-action') condition.actions.splice(Number(button.dataset.conditionActionIndex), 1);
    markChanged();
  }, true);
  document.addEventListener('change', (event) => {
    const target = event.target;
    const type = activeType();
    if (!type) return;
    if (target.dataset.workflowDmTemplate !== undefined) {
      const control = type.adminPanel.controls[Number(target.dataset.workflowDmTemplate)];
      workflow(type.id, control.id).dmTemplateId = target.value;
      markChanged();
      return;
    }
    const controlIndex = Number(target.dataset.controlIndex);
    const conditionIndex = Number(target.dataset.conditionIndex);
    const control = type.adminPanel?.controls?.[controlIndex];
    const condition = control && workflow(type.id, control.id).conditions?.[conditionIndex];
    if (!condition) return;
    if (target.dataset.workflowField) {
      condition[target.dataset.workflowField] = target.dataset.workflowField === 'level' ? Number(target.value) : target.value;
      if (target.dataset.workflowField === 'type') Object.assign(condition, { questionId: '', expected: '', roleId: '', level: 0 });
      if (target.dataset.workflowField === 'questionId') {
        const question = (type.forms?.create || []).find((item) => item.id === target.value);
        condition.expected = defaultExpected(question);
      }
    }
    if (target.dataset.conditionActionField) {
      const action = condition.actions[Number(target.dataset.conditionActionIndex)];
      action[target.dataset.conditionActionField] = target.value;
      if (target.dataset.conditionActionField === 'type') Object.assign(action, { templateId: '', roleId: '' });
    }
    markChanged();
  }, true);
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const configMatch = url.match(/\/api\/guilds\/(\d{16,20})\/config$/);
    if (configMatch && method === 'GET') {
      const response = await previousFetch(input, init);
      if (!response.ok) return response;
      workflowGuildId = configMatch[1];
      const [payload, metaResponse, templateResponse] = await Promise.all([
        response.json(),
        previousFetch('/api/guilds/' + workflowGuildId + '/request-control-workflows'),
        previousFetch('/api/guilds/' + workflowGuildId + '/message-templates'),
      ]);
      workflows = metaResponse.ok ? (await metaResponse.json()).workflows || {} : {};
      templates = templateResponse.ok ? (await templateResponse.json()).templates || [] : [];
      repairLegacyRequestType(payload.config);
      overlayWorkflowSequences(payload.config);
      savedWorkflows = copy(workflows);
      return responseWithJson(response, payload);
    }
    if (configMatch && method === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      repairLegacyRequestType(body);
      (body.tickets?.types || []).filter(isRequest).forEach((type) => {
        const keptControlIds = new Set();
        const controls = (type.adminPanel?.controls || []).filter((control) => {
          const data = workflow(type.id, control.id);
          let sequence = [...(control.actions || [])];
          if (sequence.includes('transcript') && !data.dmTemplateId) sequence = sequence.filter((step) => step !== 'transcript');
          const referencedConditions = new Set(sequence.map(conditionIdFromStep).filter(Boolean));
          data.conditions = (data.conditions || []).filter((condition) => referencedConditions.has(condition.id));
          data.sequence = sequence;
          const keep = Boolean(control.url || sequence.length);
          if (keep) keptControlIds.add(control.id);
          const nativeSequence = sequence.filter((step) => nativeActions.has(step));
          control.actions = nativeSequence.length ? nativeSequence : (sequence.length ? ['transcript'] : []);
          return keep;
        });
        if (type.adminPanel) type.adminPanel.controls = controls;
        if (workflows[type.id]) {
          Object.keys(workflows[type.id]).forEach((controlId) => { if (!keptControlIds.has(controlId)) delete workflows[type.id][controlId]; });
        }
      });
      const response = await previousFetch(input, { ...init, body: JSON.stringify(body) });
      if (!response.ok) return response;
      const payload = await response.json();
      repairLegacyRequestType(payload.config);
      const metaResponse = await previousFetch('/api/guilds/' + configMatch[1] + '/request-control-workflows', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workflows) });
      if (!metaResponse.ok) return new Response(JSON.stringify({ error: 'Ticket settings saved, but request workflows failed to save.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      workflows = (await metaResponse.json()).workflows || {};
      savedWorkflows = copy(workflows);
      overlayWorkflowSequences(payload.config);
      return responseWithJson(response, payload);
    }
    return previousFetch(input, init);
  };
  const originalCollect = collectTabState;
  collectTabState = function workflowCollect(tabName) {
    const value = originalCollect(tabName);
    return tabName === 'tickets' ? { ...value, requestControlWorkflows: copy(workflows) } : value;
  };
  document.querySelector('#resetTabButton')?.addEventListener('click', () => {
    if (state.activeTab !== 'tickets') return;
    workflows = copy(savedWorkflows);
    queueMicrotask(renderWorkflowPanels);
  }, true);
  workflowObserver = new MutationObserver(() => queueMicrotask(renderWorkflowPanels));
  observeWorkflowPanels();
})();
`;
}
function browserCss() {
  return `
.request-template-field { display: grid; gap: 7px; margin-top: 12px; }
.workflow-condition-step { flex-wrap: wrap; align-items: flex-start; }
.workflow-condition-step .request-condition-inline { flex: 0 0 100%; width: 100%; }
.request-condition-inline { display: grid; gap: 12px; margin-top: 10px; padding: 14px; border: 1px solid #343943; border-radius: 8px; background: rgba(0,0,0,.12); }
.request-condition-grid, .condition-action { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; align-items: end; }
.condition-actions { display: grid; gap: 9px; }
.condition-actions .sequence-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.condition-action { padding: 10px; border: 1px solid #2d323b; border-radius: 7px; background: #171a20; }
.condition-action > .icon-button { align-self: end; }
@media(max-width:760px){.request-condition-grid,.condition-action{grid-template-columns:1fr}.condition-actions .sequence-head{align-items:flex-start;flex-direction:column}}
`;
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/request-control-workflows$/);
  if (!match) return false;
  if (!await requireAdmin(req, res, match[1])) return true;
  if (req.method === 'GET') { sendJson(res, 200, { guildId: match[1], workflows: getGuildWorkflows(match[1]) }); return true; }
  if (req.method === 'PUT') { sendJson(res, 200, { guildId: match[1], workflows: saveGuildWorkflows(match[1], await readBody(req)) }); return true; }
  sendJson(res, 405, { error: 'Method not allowed.' });
  return true;
}

function patchAdminAssetData(filePath, data) {
  const resolved = path.resolve(String(filePath));
  const isBuffer = Buffer.isBuffer(data);
  let source = isBuffer ? data.toString('utf8') : String(data);
  if (resolved === ADMIN_APP_PATH && !source.includes(ADMIN_BROWSER_MARKER)) {
    source += `\n${browserScript()}`;
  }
  if (resolved === ADMIN_STYLE_PATH && !source.includes(ADMIN_STYLE_MARKER)) {
    source += `\n/* ${ADMIN_STYLE_MARKER} */\n${browserCss()}`;
  }
  return isBuffer ? Buffer.from(source, 'utf8') : source;
}

fs.readFile = function requestWorkflowAdminRead(filePath, ...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== 'function') return previousReadFile(filePath, ...args);
  args[args.length - 1] = (error, data) => {
    if (error) {
      callback(error, data);
      return;
    }
    callback(null, patchAdminAssetData(filePath, data));
  };
  return previousReadFile(filePath, ...args);
};

fs.readFileSync = function requestWorkflowAdminReadSync(filePath, ...args) {
  return patchAdminAssetData(filePath, previousReadFileSync(filePath, ...args));
};

http.createServer = function requestWorkflowServer(listener) {
  return previousCreateServer((req, res) => {
    handle(req, res).then((handled) => { if (!handled) listener(req, res); })
      .catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || 'Internal server error.' }));
  });
};
Module._load = function captureClient(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestWorkflowAdminCapture) return exported;
  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => { clientRef = client; if (nativeInit) await nativeInit(client); };
  exported.__requestWorkflowAdminCapture = true;
  return exported;
};

module.exports = {};
    }],
    ["06-admin-scroll-stability.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const ADMIN_INDEX_PATH = path.join(__dirname, '..', 'admin', 'index.html');

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function stabilityScript() {
  return String.raw`
(() => {
  const ROOT_SELECTOR = '#ticketEditorRoot';
  const SCROLLER_SELECTOR = '#configForm';
  let saved = null;
  let scheduled = false;

  function scroller() {
    return document.querySelector(SCROLLER_SELECTOR) || document.scrollingElement || document.documentElement;
  }

  function scrollRect(element) {
    return element === document.scrollingElement || element === document.documentElement
      ? { top: 0 }
      : element.getBoundingClientRect();
  }

  function locate(root, info) {
    if (!info) return root;
    if (info.kind === 'control') return root.querySelectorAll('.ticket-control-card')[info.index] || root;
    if (info.kind === 'question') return root.querySelectorAll('.form-question-card')[info.index] || root;
    if (info.kind === 'panel') return root.querySelectorAll('.ticket-type-section > .panel, .ticket-main-content > .panel')[info.index] || root;
    return root;
  }

  function capture(target) {
    const root = target.closest(ROOT_SELECTOR);
    const scrollElement = scroller();
    if (!root || !scrollElement) return null;
    const control = target.closest('.ticket-control-card');
    const question = target.closest('.form-question-card');
    const panel = target.closest('.ticket-type-section > .panel, .ticket-main-content > .panel');
    let anchor = { kind: 'root', index: 0 };
    if (control) anchor = { kind: 'control', index: [...root.querySelectorAll('.ticket-control-card')].indexOf(control) };
    else if (question) anchor = { kind: 'question', index: [...root.querySelectorAll('.form-question-card')].indexOf(question) };
    else if (panel) anchor = { kind: 'panel', index: [...root.querySelectorAll('.ticket-type-section > .panel, .ticket-main-content > .panel')].indexOf(panel) };
    const node = locate(root, anchor);
    return {
      scrollTop: scrollElement.scrollTop,
      top: node.getBoundingClientRect().top - scrollRect(scrollElement).top,
      anchor,
    };
  }

  function restore() {
    scheduled = false;
    if (!saved) return;
    const root = document.querySelector(ROOT_SELECTOR);
    const scrollElement = scroller();
    if (!root || !scrollElement) return;
    const node = locate(root, saved.anchor);
    if (node) {
      const nextTop = node.getBoundingClientRect().top - scrollRect(scrollElement).top;
      scrollElement.scrollTop += nextTop - saved.top;
    } else {
      scrollElement.scrollTop = saved.scrollTop;
    }
  }

  function schedule(event) {
    const target = event.target;
    if (!target?.closest?.(ROOT_SELECTOR)) return;
    if (event.type === 'input' && !target.matches('input[type="checkbox"], input[type="number"], select')) return;
    saved = capture(target) || saved;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(restore);
    setTimeout(restore, 0);
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }

  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
})();
`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/admin/admin-stability.js') {
    send(res, 200, stabilityScript(), 'application/javascript; charset=utf-8');
    return true;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/index.html')) {
    fs.readFile(ADMIN_INDEX_PATH, 'utf8', (error, source) => {
      if (error) {
        send(res, 404, 'Not found');
        return;
      }
      const tag = '  <script src="/admin/admin-stability.js" defer></script>\n';
      send(res, 200, source.includes('/admin/admin-stability.js') ? source : source.replace('</body>', `${tag}</body>`), 'text/html; charset=utf-8');
    });
    return true;
  }
  return false;
}

http.createServer = function adminScrollStabilityServer(listener) {
  return previousCreateServer((req, res) => {
    handle(req, res)
      .then((handled) => { if (!handled) listener(req, res); })
      .catch((error) => send(res, error?.statusCode || 500, JSON.stringify({ error: error?.message || 'Internal server error.' }), 'application/json; charset=utf-8'));
  });
};

module.exports = {};
    }],
    ["07-admin-workflow-stability.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '..', 'images');
const ICON_FILES = Object.freeze({
  'leveling.png': 'leveling.png',
  'messages.png': 'message.png',
  'message.png': 'message.png',
  'message.svg': 'message.png',
  'ticket.png': 'ticket.png',
  'moderator.png': 'moderator.png',
  'moderator.svg': 'moderator.png',
  'data.png': 'data.png',
  'data.svg': 'data.png',
});
const ICON_ALIASES = new Map(
  ['/CoinSprite/images/', '/admin/images/', '/images/'].flatMap((prefix) => (
    Object.entries(ICON_FILES).map(([publicName, fileName]) => [
      `${prefix}${publicName}`,
      path.join(IMAGE_DIR, fileName),
    ])
  )),
);

function iconContentType(filePath) {
  return path.extname(filePath).toLowerCase() === '.svg'
    ? 'image/svg+xml; charset=utf-8'
    : 'image/png';
}

function browserScript() {
  return String.raw`
;(() => {
  if (window.__coinSpriteWorkflowStability) return;
  window.__coinSpriteWorkflowStability = true;
  const NativeObserver = window.MutationObserver;
  if (typeof NativeObserver !== 'function') return;

  window.MutationObserver = class CoinSpriteMutationObserver {
    constructor(callback) {
      if (!Function.prototype.toString.call(callback).includes('renderWorkflowPanels')) return new NativeObserver(callback);
      let rendering = false;
      let scheduled = false;
      let observer;
      const release = () => {
        rendering = false;
        scheduled = false;
        observer.takeRecords();
        window.refreshDirtyState?.();
      };
      observer = new NativeObserver((records, nativeObserver) => {
        if (rendering) return;
        rendering = true;
        callback(records, nativeObserver);
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 16)))(release);
      });
      return observer;
    }
  };

  const style = document.createElement('style');
  style.textContent =
    '.sequence-item.has-inline-action-field{' +
      'grid-template-columns:26px minmax(130px,max-content) minmax(220px,420px) auto;' +
      'align-items:center' +
    '}' +
    '.sequence-item .inline-action-field{' +
      'display:block;min-width:0;width:100%;max-width:420px;margin:0' +
    '}' +
    '.sequence-item .inline-action-field>.field-label,' +
    '.sequence-item .inline-action-field>.request-action-note{' +
      'display:none' +
    '}' +
    '.sequence-item .inline-action-field>select,' +
    '.sequence-item .inline-action-field .picker-button{' +
      'width:100%;min-height:38px' +
    '}' +
    '.sequence-item.has-inline-action-field>div:last-child{' +
      'justify-self:end;flex-wrap:nowrap' +
    '}' +
    '@media(max-width:900px){' +
      '.sequence-item.has-inline-action-field{' +
        'grid-template-columns:26px minmax(100px,1fr) minmax(180px,320px) auto' +
      '}' +
    '}' +
    '@media(max-width:650px){' +
      '.sequence-item.has-inline-action-field{' +
        'grid-template-columns:26px minmax(0,1fr) auto' +
      '}' +
      '.sequence-item .inline-action-field{' +
        'grid-column:2 / 4;grid-row:2;max-width:none' +
      '}' +
    '}';
  document.head.append(style);

  let layoutQueued = false;
  function actionRow(card, label) {
    return [...card.querySelectorAll('.sequence-item')].find((item) =>
      item.querySelector(':scope > strong')?.textContent?.trim().toLowerCase() === label
    );
  }
  function moveFieldIntoRow(field, row) {
    if (!field || !row) return;
    field.classList.add('inline-action-field');
    row.classList.add('has-inline-action-field');
    if (field.parentElement !== row) row.insertBefore(field, row.querySelector(':scope > div:last-child'));
  }
  function placeInlineActionFields() {
    layoutQueued = false;
    document.querySelectorAll('#ticketEditorRoot .ticket-control-card').forEach((card) => {
      moveFieldIntoRow(card.querySelector('.request-role-add-field'), actionRow(card, 'role add'));
      moveFieldIntoRow(card.querySelector('.request-template-field, .request-dm-field'), actionRow(card, 'dm message'));
    });
  }
  function queueActionLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(placeInlineActionFields);
  }
  const ticketRoot = document.querySelector('#ticketEditorRoot');
  if (ticketRoot) new NativeObserver(queueActionLayout).observe(ticketRoot, { childList: true, subtree: true });
  queueActionLayout();

  function captureView() {
    const view = { tab: window.state?.activeTab || '', levelingTab: window.state?.activeLevelingTab || '', scrollTop: document.querySelector('#configForm')?.scrollTop || 0, ticketId: '', ticketSection: '' };
    if (view.tab !== 'tickets') return view;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim() || '';
    const types = window.ensureTicketEditor?.().getValue()?.tickets?.types || [];
    view.ticketId = types.find((type) => heading.endsWith(type.name))?.id || '';
    view.ticketSection = document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || '';
    return view;
  }
  function restoreView(view) {
    if (!view) return;
    if (view.tab && window.state?.activeTab !== view.tab) document.querySelector('.tab[data-tab="' + CSS.escape(view.tab) + '"]')?.click();
    if (view.tab === 'leveling' && view.levelingTab) document.querySelector('[data-leveling-tab="' + CSS.escape(view.levelingTab) + '"]')?.click();
    if (view.tab === 'tickets' && view.ticketId) {
      document.querySelector('.ticket-type-card[data-ticket-id="' + CSS.escape(view.ticketId) + '"]')?.click();
      if (view.ticketSection) document.querySelector('#ticketEditorRoot .ticket-type-tabs [data-value="' + CSS.escape(view.ticketSection) + '"]')?.click();
    }
    window.requestAnimationFrame(() => {
      const form = document.querySelector('#configForm');
      if (form) form.scrollTop = view.scrollTop;
      queueActionLayout();
    });
  }
  function restoreAfterSave(view, attempts = 0) {
    if (window.state?.saving && attempts < 200) return window.setTimeout(() => restoreAfterSave(view, attempts + 1), 25);
    restoreView(view);
  }
  document.addEventListener('click', (event) => {
    const reset = event.target.closest('#resetTabButton');
    const save = event.target.closest('#saveButton');
    if (!reset && !save) return;
    const view = captureView();
    if (reset) queueMicrotask(() => restoreView(view));
    if (save) queueMicrotask(() => restoreAfterSave(view));
  }, true);

  queueMicrotask(() => {
    if (typeof window.setActiveTab !== 'function' || window.setActiveTab.__dirtyGuard) return;
    const nativeSetActiveTab = window.setActiveTab;
    const guarded = function guardedSetActiveTab(tabName) {
      const active = window.state?.activeTab;
      if (tabName !== active && window.state?.dirtyTabs?.has(active)) {
        window.setStatus?.('Save or reset ' + (window.TAB_NAMES?.[active] || active) + ' before opening another section.', 'error');
        return;
      }
      return nativeSetActiveTab(tabName);
    };
    guarded.__dirtyGuard = true;
    window.setActiveTab = guarded;
  });
})();
`;
}

const previousReadFile = fs.readFile.bind(fs);
const ADMIN_APP_JS = path.resolve(__dirname, '..', 'admin', 'app.js');
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_APP_JS) || typeof callback !== 'function') return previousReadFile(filePath, ...args);
  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    callback(null, (Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) + browserScript());
  };
  return previousReadFile(filePath, ...args);
};

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  return previousCreateServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url || '/', 'http://localhost').pathname; }
    catch { pathname = request.url || '/'; }
    const iconPath = ICON_ALIASES.get(pathname);
    if (!iconPath) return listener(request, response);
    fs.readFile(iconPath, (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Icon not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      response.end(data);
    });
  });
};

module.exports = {};
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
    if (fixModule.exports?.data && typeof fixModule.exports.execute === 'function') {
      consolidatedAdminCommands.push(fixModule.exports);
    }
  }
})();

function registerConsolidatedAdminCommands(client) {
  if (!client?.commands?.set) return;
  for (const command of consolidatedAdminCommands) {
    client.commands.set(command.data.name, command);
  }
}

module.exports.registerConsolidatedAdminCommands = registerConsolidatedAdminCommands;
