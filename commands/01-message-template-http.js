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

  const filePath = path.join(IMAGE_DIR, normalized);
  const resolvedImageDir = path.resolve(IMAGE_DIR);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedImageDir && !resolvedFile.startsWith(`${resolvedImageDir}${path.sep}`)) {
    sendAsset(res, 404, 'Not found', 'text/plain; charset=utf-8', 'no-store');
    return;
  }

  fs.readFile(resolvedFile, (error, data) => {
    if (error) {
      sendAsset(res, 404, 'Not found', 'text/plain; charset=utf-8', 'no-store');
      return;
    }
    sendAsset(res, 200, data, imageContentType(resolvedFile));
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
  html = html.replace('</head>', '  <link rel="stylesheet" href="/admin/messages.css">\n  <link rel="stylesheet" href="/admin/message-components.css">\n  <link rel="stylesheet" href="/admin/message-component-actions.css?v=action-save-3">\n  <link rel="stylesheet" href="/admin/moderator.css?v=moderator-6">\n</head>');
  html = html.replace(
    '<button class="tab" type="button" data-tab="games"><span>Games</span></button>',
    '<button class="tab" type="button" data-tab="moderator"><span class="tab-icon-frame" aria-hidden="true"><img class="tab-icon" src="/admin/images/moderator.svg" alt=""></span><span>Moderator</span></button>\n        <button class="tab" type="button" data-tab="messages"><img class="tab-icon" src="/admin/images/message.svg" alt="" aria-hidden="true"><span>Messages</span></button>\n        <button class="tab" type="button" data-tab="games"><span>Games</span></button>',
  );
  html = html.replace(
    '<section class="tab-panel" data-panel="games">',
    '<section class="tab-panel" data-panel="moderator"><div id="moderatorRoot"></div></section>\n\n        <section class="tab-panel" data-panel="messages"><div id="messageTemplatesRoot"></div></section>\n\n        <section class="tab-panel" data-panel="games">',
  );
  html = html.replace(
    '</body>',
    [
      '  <script>window.__coinSpriteMessageScriptsScheduled = true;</script>',
      '  <script src="/admin/moderator.js?v=moderator-6" defer></script>',
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
  if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
    serveImageAsset(res, url.pathname.slice('/images/'.length));
    return true;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/admin/images/')) {
    serveImageAsset(res, url.pathname.slice('/admin/images/'.length));
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
