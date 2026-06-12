const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { PermissionFlagsBits } = require('discord.js');
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
const BOT_IMAGES_DIR = path.join(__dirname, '..', 'images');
let clientRef = null;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
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
  return { user, guild };
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

function serveBotImage(req, res, url) {
  if (req.method !== 'GET') return false;
  const match = url.pathname.match(/^\/(?:admin\/)?images\/(leveling|ticket|message)\.png$/);
  if (!match) return false;
  const filePath = path.join(BOT_IMAGES_DIR, `${match[1]}.png`);
  const resolvedDir = path.resolve(BOT_IMAGES_DIR);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }
  fs.readFile(resolvedFile, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
  return true;
}

function injectedIndex() {
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  html = html.replace('</head>', '  <link rel="stylesheet" href="/admin/messages.css">\n</head>');
  html = html.replace(/src="\/admin\/images\/(leveling|ticket)\.png"/g, 'src="/images/$1.png"');
  html = html.replace(
    '<button class="tab" type="button" data-tab="games"><span>Games</span></button>',
    '<button class="tab" type="button" data-tab="messages"><img class="tab-icon" src="/images/message.png" alt="" aria-hidden="true"><span>Messages</span></button>\n        <button class="tab" type="button" data-tab="games"><span>Games</span></button>',
  );
  html = html.replace(
    '<section class="tab-panel" data-panel="games">',
    '<section class="tab-panel" data-panel="messages"><div id="messageTemplatesRoot"></div></section>\n\n        <section class="tab-panel" data-panel="games">',
  );
  html = html.replace('</body>', '  <script src="/admin/messages.js" defer></script>\n</body>');
  return html;
}

async function handleTemplateRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (serveBotImage(req, res, url)) return true;
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    const html = injectedIndex();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }
  const listMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates$/);
  const itemMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})$/);
  const actionMatch = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})\/(send|edit)$/);
  const match = listMatch || itemMatch || actionMatch;
  if (!match) return false;
  const auth = await requireGuildAdmin(req, res, match[1]);
  if (!auth) return true;
  const guildId = match[1];
  if (listMatch && req.method === 'GET') {
    sendJson(res, 200, { guildId, templates: listTemplates(guildId) });
    return true;
  }
  if (itemMatch && req.method === 'PUT') {
    const template = saveTemplate(guildId, { ...(await readBody(req)), id: itemMatch[2] });
    sendJson(res, 200, { guildId, template });
    return true;
  }
  if (itemMatch && req.method === 'DELETE') {
    if (!deleteTemplate(guildId, itemMatch[2])) sendJson(res, 404, { error: 'Message template not found.' });
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
    const payload = buildMessagePayload(template);
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
