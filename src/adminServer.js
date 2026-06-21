const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { ensureGuildConfig, getEnabledGuildIds, getGuildConfig, getGuildConfigRaw, loadState, saveState } = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');
const { handleUserDataGet, handleUserDataPatch } = require('./adminUserDataRoutes');
const { handleOwnerDisable, handleOwnerEnable, handleOwnerOverview, isOwnerSession } = require('./ownerPanelRoutes');
const moderationCases = require('./moderationCaseStore');
const { canManageWarnings, createWarning, editWarning, pardonWarning } = require('./warningService');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
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
      return { sessionId, session };
    }
    sessions.delete(sessionId);
    saveSessions();
    clearSessionCookie(res, env);
  }

  const newSessionId = createSessionId(env.sessionSecret);
  const now = Date.now();
  const session = { createdAt: now, touchedAt: now, expiresAt: now + SESSION_TTL_MS, user: null, oauthState: null };
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

async function fetchGuildDirectory(guild) {
  const cached = directoryCache.get(guild.id);
  if (cached && Date.now() - cached.createdAt < DIRECTORY_CACHE_TTL_MS) return cached.directory;
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

function caseUserProfile(member, userId) {
  const user = member?.user || null;
  return {
    id: String(userId || ''),
    username: user?.username || 'Unknown user',
    displayName: member?.displayName || user?.globalName || user?.username || 'Unknown user',
    avatarUrl: typeof user?.displayAvatarURL === 'function' ? user.displayAvatarURL({ extension: 'png', size: 128 }) : '',
  };
}

async function hydrateCaseProfiles(guild, records) {
  const ids = [...new Set(records.flatMap((record) => [record.targetUserId, record.authorId]).filter(Boolean))];
  const entries = await Promise.all(ids.map(async (id) => {
    const member = guild.members?.cache?.get(id) || await guild.members?.fetch?.(id).catch(() => null);
    return [id, caseUserProfile(member, id)];
  }));
  const profiles = Object.fromEntries(entries);
  return records.map((record) => ({
    ...record,
    profiles: {
      target: profiles[record.targetUserId] || caseUserProfile(null, record.targetUserId),
      author: profiles[record.authorId] || caseUserProfile(null, record.authorId),
    },
  }));
}

function updateGuildConfig(guildId, patch) {
  const state = loadState();
  const current = state.guilds[guildId];
  if (!current) return null;
  state.guilds[guildId] = mergePlain(current, patch);
  saveState(state);
  return getGuildConfigRaw(guildId);
}

async function handleAuthStart(req, res, env) {
  const { session } = getSession(req, res, env);
  const state = crypto.randomBytes(24).toString('base64url');
  session.oauthState = state;
  saveSessions();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('scope', 'identify guilds');
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
    redirect(res, '/admin');
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
  if (req.method === 'GET' && url.pathname === '/auth/discord') return handleAuthStart(req, res, env);
  if (req.method === 'GET' && url.pathname === '/auth/discord/callback') return handleAuthCallback(req, res, env, url);
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const { sessionId } = getSession(req, res, env);
    sessions.delete(sessionId);
    saveSessions();
    clearSessionCookie(res, env);
    return sendJson(res, 200, { ok: true });
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

  if (req.method === 'GET' && url.pathname === '/api/owner/overview') {
    const session = await requireOwner(req, res, env, client);
    if (!session) return;
    return handleOwnerOverview(req, res, client, { sendJson });
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

  const directoryMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/directory$/);
  if (directoryMatch && req.method === 'GET') {
    const guildId = directoryMatch[1];
    const session = await requireAdmin(req, res, env, client, guildId);
    if (!session) return;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return sendJson(res, 404, { error: 'Guild is not available to the bot.' });
    return sendJson(res, 200, { guildId, directory: await fetchGuildDirectory(guild) });
  }

  const userDataMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/users\/(\d{16,20})\/data$/);
  if (userDataMatch && req.method === 'GET') {
    return handleUserDataGet(req, res, env, client, userDataMatch[1], userDataMatch[2], { requireAdmin, readJsonBody, sendJson });
  }
  if (userDataMatch && req.method === 'PATCH') {
    return handleUserDataPatch(req, res, env, client, userDataMatch[1], userDataMatch[2], { requireAdmin, readJsonBody, sendJson });
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
    const config = updateGuildConfig(guildId, await readJsonBody(req));
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    const ticketCommand = client.commands?.get('ticket-panel');
    if (guild && config?.enabled !== false && typeof ticketCommand?.refreshGuild === 'function') {
      await ticketCommand.refreshGuild(guild, client.user.id).catch((error) => logCommandSystem(`Ticket panel refresh failed for guild ${guildId}: ${error?.message ?? 'unknown error'}`));
    }
    logCommandSystem(`Admin ${session.user.id} updated server config for guild ${guildId}.`);
    return sendJson(res, 200, { guildId, config });
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
