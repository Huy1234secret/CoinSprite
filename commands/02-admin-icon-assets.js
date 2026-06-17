const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const previousCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const IMAGE_DIR = process.env.ADMIN_IMAGE_DIR || path.join(__dirname, '..', 'images');
const EMOJI_PICKER_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';
const ADMIN_BUNDLE_PATH = '/admin/admin.bundle.js';
const ICONS = new Map([
  ['/admin/images/leveling.png', path.join(IMAGE_DIR, 'leveling.png')],
  ['/admin/images/ticket.png', path.join(IMAGE_DIR, 'ticket.png')],
  ['/admin/images/message.png', path.join(IMAGE_DIR, 'message.png')],
]);
const FALLBACK_ICON_SVGS = new Map([
  ['/admin/images/leveling.png', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#10141d"/><path d="M16 44h32M20 40V28m12 12V18m12 22V24" stroke="#57f287" stroke-width="5" stroke-linecap="round"/><path d="M18 26l9-8 9 7 10-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'], // FIXED: fallback prevents missing PNG assets from causing dashboard 404s.
  ['/admin/images/ticket.png', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#10141d"/><path d="M18 22a6 6 0 0 0 6-6h16a6 6 0 0 0 6 6v20a6 6 0 0 0-6 6H24a6 6 0 0 0-6-6z" fill="none" stroke="#ff5c5c" stroke-width="5" stroke-linejoin="round"/><path d="M28 24h10M26 32h14M28 40h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'], // FIXED: fallback prevents missing PNG assets from causing dashboard 404s.
  ['/admin/images/message.png', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#10141d"/><path d="M16 19h32a6 6 0 0 1 6 6v17a6 6 0 0 1-6 6H28l-10 8v-8h-2a6 6 0 0 1-6-6V25a6 6 0 0 1 6-6z" fill="none" stroke="#55acee" stroke-width="5" stroke-linejoin="round"/><path d="M22 30h20M22 38h13" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'], // FIXED: fallback prevents missing PNG assets from causing dashboard 404s.
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

function patchMessagesScript(source) {
  return source
    .split("const defaults = allTemplates.filter((item) => isDefaultTemplate(item) && item.type !== 'folder');")
    .join("const defaults = allTemplates.filter((item) => isDefaultTemplate(item) && item.type !== 'folder' && matchesQuery(item, query)); // FIXED: default search now uses the same result/empty-state behavior as templates.")
    .split("const icon = isFolder ? '📁' : item.botDefault || item.defaultLocked ? '📄' : '<img src=\"/admin/images/message.png\" alt=\"\" aria-hidden=\"true\">';")
    .join("const icon = isFolder ? '📁' : '📄'; // FIXED: message cards no longer request a missing PNG icon.")
    .replace('if (selected().containers.length > 1) selected().containers.splice', 'selected().containers.splice')
    .replace(
      '<div class="message-bot-avatar">CS</div>',
      '<img class="message-bot-avatar" src="/admin/bot-avatar.png" alt="CoinSprite bot avatar">',
    );
}

function patchInlineMessageEditorScript(source) {
  const safeMessageTabIcon = '<span class="tab-icon" aria-hidden="true">💬</span><span>Messages</span>'; // FIXED: the Messages sidebar tab no longer depends on a PNG file that can 404.
  return source.replace(
    '<img class="tab-icon" src="/admin/images/message.png" alt="" aria-hidden="true"><span>Messages</span>',
    safeMessageTabIcon,
  );
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

function emojiPickerFunction() {
  return `  function emoji(input) {
    if (input.dataset.emojiPicker) return;
    input.dataset.emojiPicker = 'true';
    void import('${EMOJI_PICKER_URL}').catch(() => {});
    const wrap = document.createElement('span');
    wrap.className = 'emoji-field';
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-picker-button';
    button.textContent = '\\u263a';
    button.title = 'Choose emoji';
    const pop = document.createElement('span');
    pop.className = 'emoji-popover emoji-component-popover';
    const picker = document.createElement('emoji-picker');
    picker.className = 'dark';
    picker.addEventListener('emoji-click', (event) => {
      const value = event.detail?.unicode;
      if (!value) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(value, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      pop.classList.remove('open');
      input.focus();
    });
    button.onclick = (event) => {
      event.stopPropagation();
      document.querySelectorAll('.emoji-popover.open').forEach((node) => {
        if (node !== pop) node.classList.remove('open');
      });
      pop.classList.toggle('open');
      if (pop.classList.contains('open')) positionEmoji(pop, button);
    };
    pop.append(picker);
    wrap.append(button, pop);
  }
 `;
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
  let patched = source;
  const categoriesStart = patched.indexOf('  const EMOJI_CATEGORIES = {');
  const categoriesEnd = patched.indexOf('\n  function splitXp', categoriesStart);
  if (categoriesStart >= 0 && categoriesEnd > categoriesStart) {
    patched = `${patched.slice(0, categoriesStart)}${patched.slice(categoriesEnd + 1)}`;
  }
  const emojiStart = patched.indexOf('  function emoji(input) {');
  const positionStart = patched.indexOf('  function positionEmoji', emojiStart);
  if (emojiStart >= 0 && positionStart > emojiStart) {
    patched = `${patched.slice(0, emojiStart)}${emojiPickerFunction()}${patched.slice(positionStart)}`;
  }
  return `${patched}\n${adminInteractionFixes()}`;
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
  ['message-inline-editor.js', patchInlineMessageEditorScript],
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

function serveFallbackIcon(res, pathname) {
  const svg = FALLBACK_ICON_SVGS.get(pathname);
  if (!svg) {
    notFound(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.end(svg); // FIXED: missing local PNG icons now return a valid icon instead of a 404.
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
    const filePath = ICONS.get(pathname);
    if (!filePath) {
      listener(req, res);
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        serveFallbackIcon(res, pathname); // FIXED: icon requests no longer log 404 when PNG files are absent.
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
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
