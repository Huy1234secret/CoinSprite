const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  ensureGuildConfig,
  getConfiguredGuildIds,
  getEnabledGuildIds,
  getGuildConfig,
  getGuildConfigRaw,
  loadState,
  normalizeLevelingConfig,
  normalizeCountingConfig,
  normalizeMessageTemplatesConfig,
  normalizeReactionRolesConfig,
  saveState,
} = require('./serverConfig');
const { logCommandSystem } = require('./commandLogger');
const { syncGuildApplicationCommands } = require('./applicationCommands');
const { loadAdminAsset, loadAdminFont } = require('./adminAssets');
const { levelCardRendererIdentity, logLevelCardRendererIdentity } = require('./canvasFonts');
const {
  handleOwnerConsole,
  handleOwnerDisable,
  handleOwnerEnable,
  handleOwnerFeatures,
  handleOwnerMetrics,
  handleOwnerOverview,
  isOwnerSession,
} = require('./ownerPanelRoutes');
const {
  LEVEL_CARD_MEDIA_DIR,
  bestMemberStats,
  canonicalLevelCardUsername,
  getLevelCardProfile,
  levelCardDesignHash,
  levelCardRenderKey,
  normalizeLevelCardDesign,
  renderLevelCard,
  saveLevelCardDesign,
  findXpDropCrate,
  sendXpDrop,
} = require('./leveling');
const {
  createFolder,
  createTemplate,
  deleteFolder,
  deleteTemplate,
  duplicateTemplate,
  renameFolder,
  sendTemplate,
  templateById,
  updateTemplate,
} = require('./messageTemplates');
const {
  configuredRoleIds,
  createReactionRoleTemplate,
  deleteReactionRoleTemplate,
  duplicateReactionRoleTemplate,
  publishReactionRoleTemplate,
  reactionRoleById,
  updateReactionRoleTemplate,
  validateReactionRoleRoles,
} = require('./reactionRoles');

const SESSION_STORE_PATH = process.env.ADMIN_SESSION_STORE_PATH || path.join(__dirname, '..', 'data', 'admin-sessions.json');
const LEVELING_MEDIA_DIR = path.join(__dirname, '..', 'data', 'leveling-media');
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const COOKIE_NAME = 'coinsprite_admin';
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DIRECTORY_CACHE_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_LEVELING_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_LEVELING_MEDIA_BODY_BYTES = 14 * 1024 * 1024;
const LEVELING_MEDIA_TYPES = Object.freeze({
  gif: { extension: 'gif', contentType: 'image/gif' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' },
  webp: { extension: 'webp', contentType: 'image/webp' },
});
const PUBLIC_ASSETS = new Map([
  ['/admin/brand-icon.png', ['brand-icon.png', 'image/png']],
  ['/admin/emojiData.js', ['emojiData.js', 'application/javascript; charset=utf-8']],
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
    renderSecret: process.env.LEVEL_CARD_RENDER_SECRET,
    host: process.env.ADMIN_WEB_HOST || '127.0.0.1',
    port: Number(process.env.ADMIN_WEB_PORT) || 3000,
    cookieSecure: /^(1|true|yes)$/i.test(String(process.env.ADMIN_COOKIE_SECURE || '')),
    publicOrigin: String(process.env.ADMIN_PUBLIC_URL || '').replace(/\/$/, ''),
    botToken: process.env.DISCORD_TOKEN,
  };
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com",
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

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function levelCardRendererHeaders(profile, source = 'authoritative') {
  const identity = levelCardRendererIdentity();
  const headers = {
    'X-CoinSprite-Renderer-Version': identity.version,
    'X-CoinSprite-Build-Version': identity.buildVersion,
    'X-CoinSprite-Font-Manifest': identity.fontManifestHash,
  };
  if (profile) {
    headers['X-CoinSprite-Design-Hash'] = profile.designHash;
    headers['X-CoinSprite-Saved-At'] = String(profile.updatedAt);
    headers['X-CoinSprite-Render-Source'] = source;
  }
  return headers;
}

function logLevelCardDiagnostics(profile, source) {
  const identity = levelCardRendererIdentity();
  const username = profile.design.username;
  logCommandSystem(`Level card render diagnostics: source=${source} renderer=${identity.version} build=${identity.buildVersion} font-manifest=${identity.fontManifestHash} design=${profile.designHash} saved-at=${profile.updatedAt} username-x=${username.x} username-y=${username.y} username-size=${username.size} username-font=${username.fontFamily} username-bold=${username.bold} username-italic=${username.italic}.`);
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

function hasInternalRenderKey(req, secret) {
  const provided = Buffer.from(String(req.headers['x-coinsprite-render-key'] || ''));
  const expected = Buffer.from(levelCardRenderKey(secret));
  return provided.length > 0 && provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
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

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
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

async function decodeLevelingMedia(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    const error = new Error('Upload a valid image file.');
    error.statusCode = 400;
    throw error;
  }
  const mimeType = match[1].toLowerCase();
  const type = ({
    'image/gif': 'gif',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
  })[mimeType];
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > MAX_LEVELING_MEDIA_BYTES) {
    const error = new Error('Images must be 10 MB or smaller.');
    error.statusCode = data.length ? 413 : 400;
    throw error;
  }
  const valid = type === 'png'
    ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : type === 'jpeg'
      ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : type === 'gif'
        ? ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))
        : type === 'webp' && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (type && !valid) {
    const error = new Error('The uploaded file does not match its image type.');
    error.statusCode = 400;
    throw error;
  }
  if (type) return { data, ...LEVELING_MEDIA_TYPES[type] };

  try {
    const image = await loadImage(data);
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('unsupported dimensions');
    const scale = Math.min(1, 4096 / image.width, 4096 / image.height);
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const normalized = canvas.toBuffer('image/png');
    if (normalized.length > MAX_LEVELING_MEDIA_BYTES) throw new Error('normalized image too large');
    return { data: normalized, extension: 'png', contentType: 'image/png' };
  } catch {
    const error = new Error('That image type could not be decoded. Try PNG, JPG, WEBP, GIF, or another standard image format.');
    error.statusCode = 400;
    throw error;
  }
}

function serveLevelingMedia(res, pathname) {
  const match = pathname.match(/^\/(?:leveling|message)-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp|gif)$/);
  if (!match) return send(res, 404, 'Not found');
  const filePath = path.join(LEVELING_MEDIA_DIR, match[1], `${match[2]}.${match[3]}`);
  const contentType = match[3] === 'jpg' ? 'image/jpeg' : `image/${match[3]}`;
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not found');
    return send(res, 200, data, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });
}

function serveLevelCardMedia(res, pathname) {
  const match = pathname.match(/^\/level-card-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  if (!match) return send(res, 404, 'Not found');
  const filePath = path.join(LEVEL_CARD_MEDIA_DIR, match[1], `${match[2]}.${match[3]}`);
  const contentType = match[3] === 'jpg' ? 'image/jpeg' : `image/${match[3]}`;
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not found');
    return send(res, 200, data, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });
}

function profilePreview(session, client) {
  const user = session.user;
  const stats = bestMemberStats(user.id);
  const guild = stats.guildId ? client.guilds.cache.get(stats.guildId) : null;
  const avatarUrl = profileAvatarUrl(user);
  return {
    username: user.globalName || user.username,
    avatarUrl,
    serverName: guild?.name || '',
    level: stats.level,
    rank: stats.rank,
    xp: stats.xp,
    progressXp: stats.progressXp,
    neededXp: stats.neededXp,
    progressRatio: stats.progressRatio,
  };
}

function profileAvatarUrl(user) {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function profileRenderIdentity(session) {
  const user = session.user;
  const avatarUrl = profileAvatarUrl(user);
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    displayName: canonicalLevelCardUsername(user),
    displayAvatarURL: () => avatarUrl,
    avatarURL: () => avatarUrl,
  };
}

function internalCardIdentity(userId, value = {}) {
  let avatarUrl = '';
  try {
    const candidate = new URL(String(value.avatarUrl || ''));
    const hostname = candidate.hostname.toLowerCase();
    if (candidate.protocol === 'https:' && (hostname === 'cdn.discordapp.com' || hostname === 'media.discordapp.net')) avatarUrl = candidate.toString();
  } catch {}
  const username = String(value.username || 'Member').slice(0, 100);
  const globalName = String(value.globalName || '').slice(0, 100);
  const displayName = canonicalLevelCardUsername({ globalName, username });
  return {
    id: userId,
    username,
    globalName,
    displayName,
    displayAvatarURL: () => avatarUrl,
    avatarURL: () => avatarUrl,
  };
}

function internalCardStats(value = {}) {
  const positive = (input, fallback = 0) => Math.max(0, Math.min(1_000_000_000, Number(input) || fallback));
  const neededXp = Math.max(1, positive(value.neededXp, 1));
  const progressXp = Math.min(neededXp, positive(value.progressXp));
  const suppliedRatio = Number(value.progressRatio);
  return {
    xp: positive(value.xp),
    level: Math.floor(positive(value.level)),
    rank: Math.max(1, Math.floor(positive(value.rank, 1))),
    progressXp,
    neededXp,
    progressRatio: Math.max(0, Math.min(1, Number.isFinite(suppliedRatio) ? suppliedRatio : progressXp / neededXp)),
  };
}

function versionedCacheControl(requestedVersion, currentVersion) {
  return requestedVersion === currentVersion
    ? 'public, max-age=31536000, immutable'
    : 'no-store, max-age=0';
}

function serveAsset(res, pathname, requestedVersion = '') {
  const asset = PUBLIC_ASSETS.get(pathname);
  const filename = asset?.[0] || 'index.html';
  const contentType = asset?.[1] || 'text/html; charset=utf-8';
  const loaded = loadAdminAsset(filename);
  if (!loaded) return send(res, 404, 'Not found');
  const index = filename === 'index.html';
  return send(res, 200, loaded.data, {
    'Content-Type': contentType,
    'Cache-Control': index ? 'no-store, max-age=0' : versionedCacheControl(requestedVersion, loaded.version),
    ...(index ? { Pragma: 'no-cache', Expires: '0' } : {}),
  });
}

function serveAdminFont(res, pathname, requestedVersion = '') {
  const loaded = loadAdminFont(pathname);
  if (!loaded) return send(res, 404, 'Not found');
  return send(res, 200, loaded.data, {
    'Content-Type': loaded.contentType,
    'Cache-Control': versionedCacheControl(requestedVersion, loaded.version),
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

function channelSendable(channel, botMember) {
  if (!botMember || !channel?.isTextBased?.()) return false;
  try {
    const permissions = channel.permissionsFor?.(botMember);
    return Boolean(permissions?.has?.(PermissionFlagsBits.ViewChannel)
      && permissions.has(PermissionFlagsBits.SendMessages)
      && (!channel.isThread?.() || permissions.has(PermissionFlagsBits.SendMessagesInThreads)));
  } catch {
    return false;
  }
}

function sanitizedEmoji(emoji, source) {
  const id = String(emoji?.id || '');
  const name = String(emoji?.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  if (!/^\d{16,20}$/.test(id) || !name) return null;
  const animated = emoji?.animated === true;
  let url = '';
  try { url = String(emoji.imageURL?.({ extension: animated ? 'gif' : 'png', size: 64 }) || emoji.url || ''); } catch {}
  if (!/^https:\/\//i.test(url)) url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=64&quality=lossless`;
  return { id, name, animated, url, source };
}

async function fetchDirectoryEmojis(guild) {
  const applicationManager = guild?.client?.application?.emojis;
  const [applicationResult, guildResult] = await Promise.all([
    applicationManager?.fetch ? applicationManager.fetch().then((items) => ({ items, error: false })).catch(() => ({ items: new Map(), error: true })) : Promise.resolve({ items: new Map(), error: true }),
    guild?.emojis?.fetch ? guild.emojis.fetch().then((items) => ({ items, error: false })).catch(() => ({ items: new Map(), error: true })) : Promise.resolve({ items: guild?.emojis?.cache || new Map(), error: !guild?.emojis?.cache }),
  ]);
  const seen = new Set();
  const normalize = (values, source, availableOnly = false) => [...values.values()]
    .filter((emoji) => !availableOnly || emoji?.available !== false)
    .map((emoji) => sanitizedEmoji(emoji, source))
    .filter((emoji) => emoji && !seen.has(emoji.id) && seen.add(emoji.id))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  return {
    bot: normalize(applicationResult.items, 'bot'),
    group: normalize(guildResult.items, 'group', true),
    errors: { bot: applicationResult.error, group: guildResult.error },
  };
}

async function fetchGuildDirectory(guild, force = false) {
  const cached = directoryCache.get(guild.id);
  if (!force && cached && Date.now() - cached.createdAt < DIRECTORY_CACHE_TTL_MS) return cached.directory;

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const baseChannels = [...channels.values()].filter((channel) => channel && 'name' in channel);
  const parentNames = new Map(baseChannels.map((channel) => [channel.id, channel.name]));
  const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
  const allChannels = [...baseChannels, ...Array.from(activeThreads?.threads?.values?.() || [])];
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const emojis = await fetchDirectoryEmojis(guild);
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const required = [
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['View Channels', PermissionFlagsBits.ViewChannel],
    ['Send Messages', PermissionFlagsBits.SendMessages],
    ['Read Message History', PermissionFlagsBits.ReadMessageHistory],
    ['Add Reactions', PermissionFlagsBits.AddReactions],
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
      sendable: channelSendable(channel, botMember),
      rawPosition: Number(channel.rawPosition) || 0,
    })).sort((a, b) => (a.parentName || '').localeCompare(b.parentName || '') || a.rawPosition - b.rawPosition || a.name.localeCompare(b.name)),
    roles: [...roles.values()]
      .filter((role) => role.id !== guild.id && !role.managed)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor || '#99a1a6',
        position: Number(role.rawPosition) || 0,
        editable: role.editable !== false,
        managed: role.managed === true,
        administrator: Boolean(role.permissions?.has?.(PermissionFlagsBits.Administrator)),
        belowBot: role.editable !== false,
      }))
      .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name)),
    emojis,
    botPermissions: { usable: missing.length === 0, missing: missing.map((label) => ({ label })) },
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
    features: {
      leveling: config?.features?.leveling === true,
    },
    leveling: config?.leveling || {},
    memberMessages: config?.memberMessages || {},
    messageTemplates: normalizeMessageTemplatesConfig(config?.messageTemplates),
    reactionRoles: normalizeReactionRolesConfig(config?.reactionRoles),
    counting: normalizeCountingConfig(config?.counting),
  };
}

async function validateCountingChannel(guild, channelId) {
  const id = normalizeCountingConfig({ channelId }).channelId;
  if (!id) return '';
  let channel = null;
  try { channel = await guild?.channels?.fetch?.(id); } catch {}
  channel ||= guild?.channels?.cache?.get?.(id) || null;
  const messageCapableTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ]);
  const channelGuildId = channel?.guildId || channel?.guild?.id;
  if (!channel || channelGuildId !== guild.id || !messageCapableTypes.has(channel.type) || !channel.isTextBased?.()) {
    throw Object.assign(new Error('Counting channel must be a message-capable text channel in this server.'), { statusCode: 400 });
  }
  return id;
}

function safeOAuthReturnTo(value) {
  const route = String(value || '');
  if (['/admin', '/profile'].includes(route)) return route;
  let parsed;
  try { parsed = new URL(route, 'http://coinsprite.local'); } catch { return '/admin'; }
  if (parsed.origin !== 'http://coinsprite.local' || parsed.pathname !== '/admin') return '/admin';
  const safe = new URLSearchParams();
  const guildId = String(parsed.searchParams.get('guild') || '');
  const view = String(parsed.searchParams.get('view') || '');
  const templateId = String(parsed.searchParams.get('template') || '');
  const folderId = String(parsed.searchParams.get('folder') || '');
  if (/^\d{16,20}$/.test(guildId)) safe.set('guild', guildId);
  if (['message-templates', 'reaction-roles', 'games'].includes(view)) safe.set('view', view);
  if (/^[a-zA-Z0-9_-]{8,64}$/.test(templateId)) safe.set('template', templateId);
  if (/^[a-zA-Z0-9_-]{8,64}$/.test(folderId)) safe.set('folder', folderId);
  const query = safe.toString();
  return query ? `/admin?${query}` : '/admin';
}

function mutateGuildMessageTemplates(guildId, mutation) {
  const state = loadState();
  if (!state.guilds[guildId]) throw Object.assign(new Error('Guild is not configured.'), { statusCode: 404 });
  const collection = normalizeMessageTemplatesConfig(state.guilds[guildId].messageTemplates);
  const result = mutation(collection);
  state.guilds[guildId].messageTemplates = collection;
  saveState(state);
  return { result, collection: normalizeMessageTemplatesConfig(getGuildConfigRaw(guildId)?.messageTemplates) };
}

async function mutateGuildReactionRoles(guildId, guild, mutation, options = {}) {
  const state = loadState();
  if (!state.guilds[guildId]) throw Object.assign(new Error('Guild is not configured.'), { statusCode: 404 });
  const collection = normalizeReactionRolesConfig(state.guilds[guildId].reactionRoles);
  const result = mutation(collection);
  if (options.validateRoles !== false && result && configuredRoleIds(result).length) await validateReactionRoleRoles(result, guild);
  state.guilds[guildId].reactionRoles = collection;
  saveState(state);
  return { result, collection: normalizeReactionRolesConfig(getGuildConfigRaw(guildId)?.reactionRoles) };
}

async function handleAuthStart(req, res, env, requestUrl) {
  const { session } = getSession(req, res, env);
  session.oauthState = crypto.randomBytes(24).toString('base64url');
  session.oauthReturnTo = safeOAuthReturnTo(requestUrl?.searchParams?.get('returnTo'));
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
    const returnTo = safeOAuthReturnTo(session.oauthReturnTo);
    session.oauthReturnTo = null;
    saveSessions();
    setSessionCookie(res, id, env);
    return redirect(res, returnTo);
  } catch (error) {
    logCommandSystem(`Admin OAuth callback failed: ${error?.message || 'unknown error'}`);
    return send(res, 502, 'Discord login failed.');
  }
}

async function routeRequest(req, res, env, client, services = {}) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/admin' || pathname === '/admin/' || pathname === '/profile' || pathname === '/profile/')) return serveAsset(res, '/admin/index.html');
  if (req.method === 'GET' && PUBLIC_ASSETS.has(pathname)) return serveAsset(res, pathname, url.searchParams.get('v') || '');
  if (req.method === 'GET' && pathname.startsWith('/admin/fonts/')) return serveAdminFont(res, pathname, url.searchParams.get('v') || '');
  if (req.method === 'GET' && pathname.startsWith('/leveling-media/')) return serveLevelingMedia(res, pathname);
  if (req.method === 'GET' && pathname.startsWith('/message-media/')) return serveLevelingMedia(res, pathname);
  if (req.method === 'GET' && pathname.startsWith('/level-card-media/')) return serveLevelCardMedia(res, pathname);
  if (req.method === 'GET' && pathname === '/bot-avatar.png') return redirectBotAvatar(res, client);
  if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true, service: 'coinsprite' });
  if (req.method === 'GET' && pathname === '/auth/discord') return handleAuthStart(req, res, env, url);
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

  const ownerFeatures = pathname.match(/^\/api\/owner\/guilds\/(\d{16,20})\/features$/);
  if (req.method === 'PATCH' && ownerFeatures) {
    const session = await requireOwner(req, res, env, client);
    if (!session || !requireCsrf(req, res, session)) return;
    return handleOwnerFeatures(req, res, client, ownerFeatures[1], session, { readJsonBody, sendJson });
  }

  const directoryMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/directory$/);
  if (req.method === 'GET' && directoryMatch) {
    const auth = await requireGuildAdmin(req, res, env, client, directoryMatch[1]);
    if (!auth) return;
    const force = url.searchParams.get('refresh') === '1';
    return sendJson(res, 200, { guildId: directoryMatch[1], directory: await fetchGuildDirectory(auth.guild, force) });
  }

  const templateCollectionMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates$/);
  if (req.method === 'GET' && templateCollectionMatch) {
    const guildId = templateCollectionMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth) return;
    return sendJson(res, 200, {
      guildId,
      messageTemplates: normalizeMessageTemplatesConfig(getGuildConfigRaw(guildId)?.messageTemplates),
    });
  }
  if (req.method === 'POST' && templateCollectionMatch) {
    const guildId = templateCollectionMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = await readJsonBody(req);
    const saved = mutateGuildMessageTemplates(guildId, (collection) => createTemplate(collection, body));
    logCommandSystem(`Admin ${auth.session.user.id} created message template ${saved.result.id} in guild ${guildId}.`);
    return sendJson(res, 201, { guildId, item: saved.result, messageTemplates: saved.collection });
  }

  const templateFolderCollectionMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-template-folders$/);
  if (req.method === 'POST' && templateFolderCollectionMatch) {
    const guildId = templateFolderCollectionMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = await readJsonBody(req);
    const saved = mutateGuildMessageTemplates(guildId, (collection) => createFolder(collection, body));
    logCommandSystem(`Admin ${auth.session.user.id} created message template folder ${saved.result.id} in guild ${guildId}.`);
    return sendJson(res, 201, { guildId, folder: saved.result, messageTemplates: saved.collection });
  }

  const templateFolderMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-template-folders\/([a-zA-Z0-9_-]{8,64})$/);
  if (templateFolderMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const guildId = templateFolderMatch[1];
    const folderId = templateFolderMatch[2];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = req.method === 'PATCH' ? await readJsonBody(req) : null;
    const saved = req.method === 'PATCH'
      ? mutateGuildMessageTemplates(guildId, (collection) => renameFolder(collection, folderId, body))
      : mutateGuildMessageTemplates(guildId, (collection) => deleteFolder(collection, folderId));
    logCommandSystem(`Admin ${auth.session.user.id} ${req.method === 'PATCH' ? 'renamed' : 'deleted'} message template folder ${folderId} in guild ${guildId}${req.method === 'DELETE' ? `; ${saved.result.moved} template(s) moved to Unfiled` : ''}.`);
    return sendJson(res, 200, { guildId, folder: saved.result.folder || saved.result, moved: saved.result.moved || 0, messageTemplates: saved.collection });
  }

  const templateActionMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-zA-Z0-9_-]{8,64})\/(duplicate|send)$/);
  if (req.method === 'POST' && templateActionMatch) {
    const guildId = templateActionMatch[1];
    const templateId = templateActionMatch[2];
    const action = templateActionMatch[3];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    if (action === 'duplicate') {
      const saved = mutateGuildMessageTemplates(guildId, (collection) => duplicateTemplate(collection, templateId));
      logCommandSystem(`Admin ${auth.session.user.id} duplicated message template ${templateId} as ${saved.result.id} in guild ${guildId}.`);
      return sendJson(res, 201, { guildId, item: saved.result, messageTemplates: saved.collection });
    }
    const body = await readJsonBody(req);
    if (!['test', 'send'].includes(body?.mode)) return sendJson(res, 400, { error: 'Send mode must be test or send.' });
    if (body.mode === 'send' && body.confirm !== true) return sendJson(res, 400, { error: 'Confirm this send before continuing.' });
    const item = templateById(normalizeMessageTemplatesConfig(getGuildConfigRaw(guildId)?.messageTemplates), templateId);
    const sent = await sendTemplate(item, auth.guild, {
      channelId: body.channelId,
      test: body.mode === 'test',
    });
    logCommandSystem(`Admin ${auth.session.user.id} ${body.mode === 'test' ? 'test-sent' : 'sent'} message template ${templateId} to channel ${sent.channel.id} in guild ${guildId}.`);
    return sendJson(res, 201, {
      ok: true,
      mode: body.mode,
      channelId: sent.channel.id,
      channelName: String(sent.channel.name || sent.channel.id),
      messageId: String(sent.message?.id || ''),
      messageUrl: String(sent.message?.url || ''),
    });
  }

  const templateItemMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-zA-Z0-9_-]{8,64})$/);
  if (templateItemMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const guildId = templateItemMatch[1];
    const templateId = templateItemMatch[2];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    let saved;
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      saved = mutateGuildMessageTemplates(guildId, (collection) => updateTemplate(collection, templateId, body));
    } else saved = mutateGuildMessageTemplates(guildId, (collection) => deleteTemplate(collection, templateId));
    logCommandSystem(`Admin ${auth.session.user.id} ${req.method === 'PATCH' ? 'updated' : 'deleted'} message template ${templateId} in guild ${guildId}.`);
    return sendJson(res, 200, { guildId, item: saved.result, messageTemplates: saved.collection });
  }

  const reactionRoleCollectionMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/reaction-roles$/);
  if (req.method === 'GET' && reactionRoleCollectionMatch) {
    const guildId = reactionRoleCollectionMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth) return;
    return sendJson(res, 200, {
      guildId,
      reactionRoles: normalizeReactionRolesConfig(getGuildConfigRaw(guildId)?.reactionRoles),
    });
  }
  if (req.method === 'POST' && reactionRoleCollectionMatch) {
    const guildId = reactionRoleCollectionMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = await readJsonBody(req);
    const saved = await mutateGuildReactionRoles(guildId, auth.guild, (collection) => createReactionRoleTemplate(collection, body));
    logCommandSystem(`Admin ${auth.session.user.id} created Reaction Role template ${saved.result.id} in guild ${guildId}.`);
    return sendJson(res, 201, { guildId, item: saved.result, reactionRoles: saved.collection });
  }

  const reactionRoleActionMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/reaction-roles\/([a-zA-Z0-9_-]{8,64})\/(duplicate|publish)$/);
  if (req.method === 'POST' && reactionRoleActionMatch) {
    const guildId = reactionRoleActionMatch[1];
    const templateId = reactionRoleActionMatch[2];
    const action = reactionRoleActionMatch[3];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    if (action === 'duplicate') {
      const saved = await mutateGuildReactionRoles(guildId, auth.guild, (collection) => duplicateReactionRoleTemplate(collection, templateId));
      logCommandSystem(`Admin ${auth.session.user.id} duplicated Reaction Role template ${templateId} as ${saved.result.id} in guild ${guildId}.`);
      return sendJson(res, 201, { guildId, item: saved.result, reactionRoles: saved.collection });
    }
    const item = reactionRoleById(normalizeReactionRolesConfig(getGuildConfigRaw(guildId)?.reactionRoles), templateId);
    const published = await publishReactionRoleTemplate(item, auth.guild);
    const saved = await mutateGuildReactionRoles(guildId, auth.guild, (collection) => updateReactionRoleTemplate(collection, templateId, {
      publishedMessageId: String(published.message?.id || ''),
      channelId: String(published.channel?.id || ''),
    }), { validateRoles: false });
    logCommandSystem(`Admin ${auth.session.user.id} ${published.updated ? 'updated' : 'published'} Reaction Role template ${templateId} in channel ${published.channel.id} for guild ${guildId}.`);
    return sendJson(res, 201, {
      ok: true,
      updated: published.updated,
      guildId,
      item: saved.result,
      reactionRoles: saved.collection,
      channelId: published.channel.id,
      messageId: String(published.message?.id || ''),
      messageUrl: String(published.message?.url || ''),
    });
  }

  const reactionRoleItemMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/reaction-roles\/([a-zA-Z0-9_-]{8,64})$/);
  if (reactionRoleItemMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const guildId = reactionRoleItemMatch[1];
    const templateId = reactionRoleItemMatch[2];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    const body = req.method === 'PATCH' ? await readJsonBody(req) : null;
    const saved = req.method === 'PATCH'
      ? await mutateGuildReactionRoles(guildId, auth.guild, (collection) => updateReactionRoleTemplate(collection, templateId, body))
      : await mutateGuildReactionRoles(guildId, auth.guild, (collection) => deleteReactionRoleTemplate(collection, templateId), { validateRoles: false });
    logCommandSystem(`Admin ${auth.session.user.id} ${req.method === 'PATCH' ? 'updated' : 'deleted'} Reaction Role template ${templateId} in guild ${guildId}.`);
    return sendJson(res, 200, { guildId, item: saved.result, reactionRoles: saved.collection });
  }

  const internalCardMatch = pathname.match(/^\/api\/internal\/level-card\/(\d{16,20})$/);
  if (req.method === 'POST' && internalCardMatch) {
    if (!hasInternalRenderKey(req, env.renderSecret)) return sendJson(res, 403, { error: 'Forbidden.' });
    const identity = levelCardRendererIdentity();
    const requestedVersion = String(req.headers['x-coinsprite-renderer-version'] || '');
    const requestedBuild = String(req.headers['x-coinsprite-build-version'] || '');
    const requestedManifest = String(req.headers['x-coinsprite-font-manifest'] || '');
    if (requestedVersion !== identity.version
      || requestedBuild !== identity.buildVersion
      || requestedManifest !== identity.fontManifestHash) {
      logCommandSystem(`Authoritative level card identity mismatch: bot-renderer=${requestedVersion || 'missing'} panel-renderer=${identity.version} bot-build=${requestedBuild || 'missing'} panel-build=${identity.buildVersion} bot-font-manifest=${requestedManifest || 'missing'} panel-font-manifest=${identity.fontManifestHash}.`);
      return sendJson(res, 409, { error: 'Level card renderer deployment versions do not match.' }, levelCardRendererHeaders());
    }
    const body = await readJsonBody(req);
    const userId = internalCardMatch[1];
    const profile = getLevelCardProfile(userId);
    const image = await renderLevelCard(
      internalCardIdentity(userId, body?.user),
      internalCardStats(body?.stats),
      profile.design,
    );
    logLevelCardDiagnostics(profile, 'authoritative');
    return send(res, 200, image, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="level-card.png"',
      ...levelCardRendererHeaders(profile),
    });
  }

  if (req.method === 'GET' && pathname === '/api/profile/card') {
    const session = await requireSignedIn(req, res, env);
    if (!session) return;
    return sendJson(res, 200, {
      ...getLevelCardProfile(session.user.id),
      preview: profilePreview(session, client),
    });
  }

  if (req.method === 'POST' && pathname === '/api/profile/card/preview') {
    const session = await requireSignedIn(req, res, env);
    if (!session || !requireCsrf(req, res, session)) return;
    const body = await readJsonBody(req);
    const profile = getLevelCardProfile(session.user.id);
    const expectedHash = String(body?.designHash || '');
    if (expectedHash && expectedHash !== profile.designHash) {
      return sendJson(res, 409, { error: 'Saved level card changed before this preview rendered.', designHash: profile.designHash }, levelCardRendererHeaders(profile));
    }
    const draft = body?.draft === true;
    const design = draft ? normalizeLevelCardDesign(body?.design, session.user.id) : profile.design;
    const renderProfile = draft ? {
      ...profile,
      design,
      designHash: levelCardDesignHash(design, session.user.id),
    } : profile;
    const user = profileRenderIdentity(session);
    const stats = bestMemberStats(session.user.id);
    const image = await renderLevelCard(user, stats, renderProfile.design);
    const source = draft ? 'authoritative-draft' : 'authoritative';
    logLevelCardDiagnostics(renderProfile, source);
    return send(res, 200, image, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="level-card-preview.png"',
      ...levelCardRendererHeaders(renderProfile, source),
    });
  }

  if (req.method === 'PATCH' && pathname === '/api/profile/card') {
    const session = await requireSignedIn(req, res, env);
    if (!session || !requireCsrf(req, res, session)) return;
    const body = await readJsonBody(req);
    return sendJson(res, 200, saveLevelCardDesign(session.user.id, body?.design));
  }

  if (req.method === 'POST' && pathname === '/api/profile/card/media') {
    const session = await requireSignedIn(req, res, env);
    if (!session || !requireCsrf(req, res, session)) return;
    const body = await readJsonBody(req, MAX_LEVELING_MEDIA_BODY_BYTES);
    const media = await decodeLevelingMedia(body?.dataUrl);
    if (media.extension === 'gif') return sendJson(res, 400, { error: 'Card artwork must be PNG, JPG, or WEBP.' });
    let imageData;
    try {
      const img = await loadImage(media.data);
      const w = Math.min(img.width, 4000);
      const h = Math.min(img.height, 4000);
      const c = createCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      imageData = c.toBuffer('image/png');
    } catch (err) {
      return sendJson(res, 400, { error: 'This image could not be processed. Try saving it as a standard PNG or use a JPG/WEBP instead.' });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const directory = path.join(LEVEL_CARD_MEDIA_DIR, session.user.id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${id}.png`), imageData);
    return sendJson(res, 201, { url: `/level-card-media/${session.user.id}/${id}.png` });
  }

  const levelingMediaMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/(leveling|message)-media$/);
  if (req.method === 'POST' && levelingMediaMatch) {
    const guildId = levelingMediaMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    if (levelingMediaMatch[2] === 'leveling' && getGuildConfigRaw(guildId)?.features?.leveling !== true) {
      return sendJson(res, 403, { error: 'Leveling is locked for this server. Ask the bot owner to unlock it.' });
    }
    const body = await readJsonBody(req, MAX_LEVELING_MEDIA_BODY_BYTES);
    const media = await decodeLevelingMedia(body?.dataUrl);
    const id = crypto.randomBytes(16).toString('hex');
    const directory = path.join(LEVELING_MEDIA_DIR, guildId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${id}.${media.extension}`), media.data);
    let origin = env.publicOrigin;
    if (!/^https?:\/\//i.test(origin)) {
      try { origin = new URL(env.redirectUri).origin; } catch { origin = `http://${req.headers.host || `${env.host}:${env.port}`}`; }
    }
    return sendJson(res, 201, { url: `${origin}/${levelingMediaMatch[2]}-media/${guildId}/${id}.${media.extension}` });
  }

  const xpDropTestMatch = pathname.match(/^\/api\/guilds\/(\d{16,20})\/xp-drops\/test$/);
  if (req.method === 'POST' && xpDropTestMatch) {
    const guildId = xpDropTestMatch[1];
    const auth = await requireGuildAdmin(req, res, env, client, guildId);
    if (!auth || !requireCsrf(req, res, auth.session)) return;
    if (getGuildConfigRaw(guildId)?.features?.leveling !== true) {
      return sendJson(res, 403, { error: 'Leveling is locked for this server. Ask the bot owner to unlock it.' });
    }
    const body = await readJsonBody(req);
    const savedLeveling = getGuildConfigRaw(guildId)?.leveling || {};
    const leveling = normalizeLevelingConfig({
      ...savedLeveling,
      xpDrops: body?.xpDrops && typeof body.xpDrops === 'object' ? body.xpDrops : savedLeveling.xpDrops,
    });
    const crate = findXpDropCrate(leveling, body?.crateId);
    if (!crate) return sendJson(res, 400, { error: 'Choose an existing crate.' });
    const sent = await sendXpDrop({
      guild: auth.guild,
      crate,
      channelId: String(body?.channelId || ''),
      test: true,
      templates: leveling.xpDrops,
    });
    return sendJson(res, 201, {
      ok: true,
      crateId: crate.id,
      channelId: sent.channel.id,
      messageId: sent.message.id,
      messageUrl: sent.message.url || '',
    });
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
    const hasLeveling = body?.leveling && typeof body.leveling === 'object' && !Array.isArray(body.leveling);
    const hasMemberMessages = body?.memberMessages && typeof body.memberMessages === 'object' && !Array.isArray(body.memberMessages);
    const hasCounting = body?.counting && typeof body.counting === 'object' && !Array.isArray(body.counting);
    if (!hasLeveling && !hasMemberMessages && !hasCounting) {
      return sendJson(res, 400, { error: 'Leveling, Welcome Messages, or Counting configuration is required.' });
    }

    const state = loadState();
    state.guilds[guildId] ||= ensureGuildConfig(guildId);
    if (hasLeveling && state.guilds[guildId].features?.leveling !== true) {
      return sendJson(res, 403, { error: 'Leveling is locked for this server. Ask the bot owner to unlock it.' });
    }
    state.guilds[guildId].features = {
      leveling: state.guilds[guildId].features?.leveling === true,
    };
    if (hasLeveling) state.guilds[guildId].leveling = mergePlain(state.guilds[guildId].leveling, body.leveling);
    if (hasMemberMessages) state.guilds[guildId].memberMessages = mergePlain(state.guilds[guildId].memberMessages, body.memberMessages);
    if (hasCounting) {
      state.guilds[guildId].counting = {
        channelId: await validateCountingChannel(auth.guild, body.counting.channelId),
      };
    }
    saveState(state);
    const config = getGuildConfigRaw(guildId);

    if (hasLeveling) {
      await syncGuildApplicationCommands(auth.guild)
        .catch((error) => logCommandSystem(`Feature command sync failed for guild ${guildId}: ${error?.message || 'unknown error'}`));
    }

    logCommandSystem(`Admin ${auth.session.user.id} updated ${[hasLeveling && 'leveling', hasMemberMessages && 'Welcome Messages', hasCounting && 'Counting'].filter(Boolean).join(' and ')} for guild ${guildId}.`);
    return sendJson(res, 200, { guildId, config: publicConfig(config) });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

function createAdminRequestHandler(env, client, services = {}) {
  loadSessions();
  return (req, res) => {
    routeRequest(req, res, env, client, services).catch((error) => {
      const status = error?.statusCode || 500;
      logCommandSystem(`Admin request failed: ${error?.message || 'unknown error'}`);
      sendJson(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    });
  };
}

function startAdminServer(client, services = {}) {
  if (serverRef) return serverRef;
  const env = getEnv();
  if (!env.clientId || !env.clientSecret || !env.redirectUri || !env.sessionSecret) {
    logCommandSystem('Admin panel disabled: Discord OAuth or session configuration is missing.');
    return null;
  }

  loadSessions();
  saveSessions();
  serverRef = http.createServer(createAdminRequestHandler(env, client, services));
  serverRef.requestTimeout = 15_000;
  serverRef.headersTimeout = 20_000;
  serverRef.listen(env.port, env.host, () => {
    logLevelCardRendererIdentity(logCommandSystem, 'Panel');
    logCommandSystem(`CoinSprite dashboard listening on http://${env.host}:${env.port}.`);
  });
  return serverRef;
}

module.exports = {
  createAdminRequestHandler,
  decodeLevelingMedia,
  fetchDirectoryEmojis,
  fetchGuildDirectory,
  levelCardRendererHeaders,
  routeRequest,
  safeOAuthReturnTo,
  validateCountingChannel,
  startAdminServer,
};
