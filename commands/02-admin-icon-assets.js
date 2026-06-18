const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const previousCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const IMAGE_DIR = path.join(__dirname, '..', 'images');
const ADMIN_BUNDLE_PATH = '/admin/admin.bundle.js';
const ICONS = new Map([
  ['/admin/images/leveling.png', { file: path.join(IMAGE_DIR, 'leveling.png'), type: 'image/png' }],
  ['/admin/images/messages.png', { file: path.join(IMAGE_DIR, 'messages.png'), type: 'image/png' }],
  ['/admin/images/message.png', { file: path.join(IMAGE_DIR, 'messages.png'), type: 'image/png' }],
  ['/admin/images/message.svg', { file: path.join(IMAGE_DIR, 'messages.png'), type: 'image/png' }],
  ['/admin/images/ticket.png', { file: path.join(IMAGE_DIR, 'ticket.png'), type: 'image/png' }],
  ['/admin/images/moderator.png', { file: path.join(IMAGE_DIR, 'moderator.png'), type: 'image/png' }],
  ['/admin/images/moderator.svg', { file: path.join(IMAGE_DIR, 'moderator.png'), type: 'image/png' }],
  ['/admin/images/data.png', { file: path.join(IMAGE_DIR, 'data.png'), type: 'image/png' }],
  ['/admin/images/data.svg', { file: path.join(IMAGE_DIR, 'data.png'), type: 'image/png' }],
]);
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
    return \`<button class="message-template-card message-default-card" type="button" data-message-action="open" data-id="\${escapeHtml(item.id)}" style="display:grid!important;visibility:visible!important;opacity:1!important"><span class="message-template-symbol"><img src="/admin/images/message.svg" alt="" aria-hidden="true"></span><span><strong>\${escapeHtml(item.name)}</strong><small>\${count} container\${count === 1 ? '' : 's'}</small></span><span class="message-card-folder-button message-card-edit-button">Edit</span><span class="message-card-arrow">›</span></button>\`; // FIXED: fallback default cards cannot be hidden by stale card styling.
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
  ['app.js', (source) => patchTicketUpgradeScript(patchAppScript(source))],
  ['user-data.js'],
  ['emoji-picker.js'],
  ['message-inline-editor.js'],
  ['message-edit-shortcuts.js'],
  ['owner-panel.js'],
];

const TEXT_ASSETS = new Map([
  ['/admin/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', patch: patchAdminIndex }],
  ['/admin/messages.js', { file: 'messages.js', type: 'application/javascript; charset=utf-8', patch: patchMessagesScript }],
  ['/admin/app.js', { file: 'app.js', type: 'application/javascript; charset=utf-8', patch: (source) => patchTicketUpgradeScript(patchAppScript(source)) }],
  ['/admin/style.css', { file: 'style.css', type: 'text/css; charset=utf-8', patch: patchTicketUpgradeCss }],
]);

function serveAdminBundle(res) {
  try {
    const output = BUNDLED_ADMIN_SCRIPTS.map(([fileName, patch]) => {
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
    fs.readFile(icon.file, (error, data) => {
      if (error) {
        notFound(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': icon.type, 'Cache-Control': 'public, max-age=3600' });
      res.end(data);
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
