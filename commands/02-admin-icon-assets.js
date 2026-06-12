const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const previousCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const IMAGE_DIR = process.env.ADMIN_IMAGE_DIR || path.join(__dirname, '..', 'images');
const EMOJI_PICKER_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';
const ICONS = new Map([
  ['/admin/images/leveling.png', path.join(IMAGE_DIR, 'leveling.png')],
  ['/admin/images/ticket.png', path.join(IMAGE_DIR, 'ticket.png')],
  ['/admin/images/message.png', path.join(IMAGE_DIR, 'message.png')],
]);
let clientRef = null;

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function patchMessagesScript(source) {
  return source
    .replace('if (selected().containers.length > 1) selected().containers.splice', 'selected().containers.splice')
    .replace(
      '<div class="message-bot-avatar">CS</div>',
      '<img class="message-bot-avatar" src="/admin/bot-avatar.png" alt="CoinSprite bot avatar">',
    );
}

function patchAppScript(source) {
  const currentExcludedKeys = "['levelUp', 'ticketPanel', 'ticketCategory', 'transcript']";
  const hiddenChannelKeys = "['levelUp', 'ticketPanel', 'ticketCategory', 'transcript', 'roleRequestReview', 'giveawayRequestReview', 'inviteRules', 'inviteClaim', 'inviteLog', 'inviteAnnounce', 'wordChain']";
  return source.split(currentExcludedKeys).join(hiddenChannelKeys);
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
  return `${source}\n
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

const TEXT_ASSETS = new Map([
  ['/admin/messages.js', { file: 'messages.js', type: 'application/javascript; charset=utf-8', patch: patchMessagesScript }],
  ['/admin/app.js', { file: 'app.js', type: 'application/javascript; charset=utf-8', patch: patchAppScript }],
  ['/admin/ticket-ui-upgrade.js', { file: 'ticket-ui-upgrade.js', type: 'application/javascript; charset=utf-8', patch: patchTicketUpgradeScript }],
  ['/admin/ticket-ui-upgrade.css', { file: 'ticket-ui-upgrade.css', type: 'text/css; charset=utf-8', patch: patchTicketUpgradeCss }],
]);

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
    const textAsset = TEXT_ASSETS.get(pathname);
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
        notFound(res);
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
