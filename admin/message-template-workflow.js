(() => {
  if (window.__coinSpriteMessageTemplateWorkflow) return;
  window.__coinSpriteMessageTemplateWorkflow = true;

  const nativeFetch = window.fetch.bind(window);
  const templates = new Map();
  const pending = new Map();
  const DEFAULT_TEMPLATE_FALLBACKS = [
    { id: 'default-ai-moderation-alert', type: 'template', folderId: '', name: 'Default: AI moderation alert', containers: [{ id: 'ai-moderation-alert', accentColor: '#9B59B6', text: '## AI moderation alert' }], componentRows: [], botDefault: true, defaultLocked: true }, // FIXED: default cards have a local fallback when the rendered grid is empty.
    { id: 'default-ai-moderation-user-warning', type: 'template', folderId: '', name: 'Default: AI moderation user warning', containers: [{ id: 'ai-moderation-user-warning', accentColor: '#9B59B6', text: '## Message flagged' }], componentRows: [], botDefault: true, defaultLocked: true }, // FIXED: default cards have a local fallback when the rendered grid is empty.
  ];
  let selectedId = '';
  let guildId = '';
  let bypass = false;
  let queued = false;

  function root() {
    return document.querySelector('#messageTemplatesRoot');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function activeGuildId() {
    return guildId || document.querySelector('#guildSelect')?.value || window.state?.guildId || ''; // ADDED: resolves the active guild for global saves.
  }

  function route(input, method = 'GET') {
    const urlText = typeof input === 'string' ? input : input?.url;
    if (!urlText) return null;
    const url = new URL(urlText, window.location.origin);
    const match = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates(?:\/([a-z0-9_-]{1,40}))?(?:\/(component-actions|send|edit))?$/i);
    return match ? { guildId: match[1], templateId: match[2] || '', action: match[3] || '', method: String(method || 'GET').toUpperCase() } : null;
  }

  function jsonResponse(payload) {
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  function remember(list) {
    (Array.isArray(list) ? list : []).forEach((template) => {
      if (template?.id) templates.set(template.id, pending.get(template.id) || template); // FIXED: pending edits stay visible during refreshes.
    });
  }

  function hideOldSaveState() {
    const status = root()?.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = ''; // FIXED: removes the old saved/autosave text.
    status.className = 'message-save-state';
    status.hidden = true; // FIXED: only the shared unsaved bar is shown.
  }

  function styleSaveBar() {
    const bar = document.querySelector('#unsavedBar');
    if (!bar) return;
    const textBlock = bar.firstElementChild;
    if (textBlock && !textBlock.classList.contains('unsaved-actions')) textBlock.hidden = true; // FIXED: removes the left-side unsaved text.
    const detail = document.querySelector('#unsavedDetail');
    if (detail) detail.textContent = ''; // FIXED: clears the old changed-list text.
    document.querySelector('#saveButton')?.classList.add('message-global-save-button'); // FIXED: shared save button gets the requested green style.
  }

  function coreHasChanges() {
    return Boolean(document.querySelector('#savedState')?.classList.contains('dirty'));
  }

  function messagesActive() {
    return Boolean(document.querySelector('[data-panel="messages"]')?.classList.contains('active'));
  }

  function syncSaveBar() {
    styleSaveBar();
    const bar = document.querySelector('#unsavedBar');
    if (!bar) return;
    if (pending.size > 0) {
      bar.hidden = false; // FIXED: message changes use the existing global save bar.
      if (messagesActive()) {
        const reset = document.querySelector('#resetTabButton');
        if (reset) reset.disabled = false; // FIXED: reset is enabled for unsaved message edits.
      }
      return;
    }
    if (!coreHasChanges()) bar.hidden = true; // FIXED: hides only when no dashboard system has changes.
  }

  function hold(templateId, template) {
    if (!templateId || !template) return;
    pending.set(templateId, clone(template)); // FIXED: autosaves are converted into pending changes.
    templates.set(templateId, clone(template));
    selectedId = templateId;
    hideOldSaveState();
    syncSaveBar(); // FIXED: every message edit opens the one global bar.
    decorateSoon();
  }

  function applyActions(templateId, body) {
    const template = clone(templates.get(templateId) || pending.get(templateId) || {});
    const row = (template.componentRows || []).find((entry) => entry.id === body?.rowId);
    const list = row?.type === 'select' ? row.options : row?.buttons;
    const item = list?.find((entry) => entry.id === body?.itemId);
    if (item) item.actions = Array.isArray(body.actions) ? body.actions.slice(0, 2) : []; // FIXED: component action edits join pending saves.
    return template;
  }

  window.fetch = async (input, init = {}) => {
    const info = route(input, init.method || input?.method || 'GET');
    if (info?.method === 'PUT' && info.templateId && !bypass && info.action !== 'send' && info.action !== 'edit') {
      const body = JSON.parse(init.body || '{}');
      const template = info.action === 'component-actions' ? applyActions(info.templateId, body) : { ...body, id: info.templateId };
      guildId = info.guildId;
      hold(info.templateId, template);
      return jsonResponse({ guildId: info.guildId, template }); // FIXED: field changes no longer save directly.
    }
    const response = await nativeFetch(input, init);
    if (info && response.ok) {
      response.clone().json().then((payload) => {
        guildId = info.guildId || guildId;
        if (payload.templates) remember(payload.templates);
        if (payload.template?.id) {
          templates.set(payload.template.id, payload.template);
          selectedId = payload.template.id;
        }
        hideOldSaveState();
        syncSaveBar();
        decorateSoon();
      }).catch(() => null);
    }
    return response;
  };

  function currentTemplateId() {
    if (selectedId) return selectedId;
    const name = root()?.querySelector('[data-template-field="name"]')?.value || '';
    const matches = [...templates.values()].filter((template) => template.name === name);
    if (matches.length === 1) selectedId = matches[0].id;
    return selectedId;
  }

  function collectTemplate() {
    const host = root();
    const id = currentTemplateId();
    if (!host || !id) return null;
    const template = clone(pending.get(id) || templates.get(id) || { id, type: 'template', containers: [] });
    const name = host.querySelector('[data-template-field="name"]');
    const content = host.querySelector('[data-template-field="content"]');
    if (name && !template.defaultLocked && !template.botDefault) template.name = name.value;
    if (content) template.content = content.value;
    const containers = [...host.querySelectorAll('[data-container-index]')].map((card) => {
      const base = template.containers?.[Number(card.dataset.containerIndex)] || {};
      return {
        ...base,
        accentColor: card.querySelector('[data-container-field="accentColor"]')?.value || base.accentColor || '#5865F2',
        text: card.querySelector('[data-container-field="text"]')?.value || '',
        thumbnailUrl: card.querySelector('[data-container-field="thumbnailUrl"]')?.value || '',
        imageUrl: card.querySelector('[data-container-field="imageUrl"]')?.value || '',
      };
    });
    if (containers.length) template.containers = containers;
    return template;
  }

  async function savePendingTemplates() {
    guildId = activeGuildId();
    const id = currentTemplateId();
    const template = collectTemplate();
    if (id && template) pending.set(id, clone(template)); // FIXED: includes the open editor values before saving.
    if (!guildId || pending.size === 0) return;
    bypass = true;
    try {
      for (const [templateId, pendingTemplate] of [...pending.entries()]) {
        const response = await nativeFetch(`/api/guilds/${guildId}/message-templates/${templateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          cache: 'no-store',
          body: JSON.stringify(pendingTemplate),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
        pending.delete(templateId);
        templates.set(templateId, payload.template || pendingTemplate);
      }
      hideOldSaveState();
    } finally {
      bypass = false;
      syncSaveBar();
      decorateSoon();
    }
  }

  function resetPendingTemplates() {
    if (pending.size === 0) return;
    pending.clear(); // FIXED: reset uses the shared bar instead of another save system.
    syncSaveBar();
    window.location.reload(); // FIXED: reloads the last saved message data after reset.
  }

  function createMenu() {
    const menu = document.createElement('div');
    menu.className = 'message-create-menu';
    menu.id = 'messageCreateMenu';
    menu.hidden = true;
    menu.innerHTML = '<button type="button" data-message-action="create-message">Message</button><button type="button" data-message-action="create-folder">Folder</button>'; // ADDED: create menu exposes Message and Folder choices.
    return menu;
  }

  function fixCreateButtons(scope = document) {
    scope.querySelectorAll?.('[data-message-action="create-message"].button.primary, [data-message-action="create"].button.primary').forEach((button) => {
      button.dataset.messageAction = 'create-open'; // FIXED: Create template opens the Message/Folder menu.
      button.setAttribute('data-message-action', 'create-open');
    });
    scope.querySelectorAll?.('[data-message-action="create-open"].button.primary').forEach((button) => {
      const wrap = button.closest('.message-create-wrap') || button.parentElement;
      if (wrap && !wrap.querySelector('#messageCreateMenu')) wrap.append(createMenu()); // FIXED: older markup gets the missing menu.
    });
  }

  function toggleCreateMenu(button) {
    const host = root();
    if (!host || !button) return;
    fixCreateButtons(host);
    const wrap = button.closest('.message-create-wrap') || button.parentElement;
    const menu = wrap?.querySelector('#messageCreateMenu') || host.querySelector('#messageCreateMenu');
    if (!menu) return;
    const willOpen = menu.hidden;
    host.querySelectorAll('#messageCreateMenu').forEach((item) => { if (item !== menu) item.hidden = true; });
    menu.hidden = !willOpen; // FIXED: Create template reliably toggles Message/Folder options.
  }

  function injectCss() {
    if (document.querySelector('#messageTemplateWorkflowStyle')) return;
    const style = document.createElement('style');
    style.id = 'messageTemplateWorkflowStyle';
    style.textContent = '.message-template-card{position:relative}.message-card-folder-button{position:absolute;right:42px;bottom:10px;display:none;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);color:var(--text);font-size:11px;font-weight:800}.message-template-card:hover .message-card-folder-button{display:inline-flex}.message-card-folder-button:hover{border-color:var(--primary);background:var(--surface-3)}.message-save-state,.message-manual-save{display:none!important}.message-create-wrap{position:relative}.message-create-menu{position:absolute;z-index:90;top:calc(100% + 8px);right:0;min-width:190px;display:grid;gap:6px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#0b0d11;box-shadow:0 18px 40px rgba(0,0,0,.45)}.message-create-menu[hidden]{display:none!important}.message-create-menu button{min-height:38px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);color:var(--text);cursor:pointer;font-weight:800;text-align:left;padding:0 12px}.message-template-grid .message-default-card{display:grid!important;min-height:92px!important;visibility:visible!important;opacity:1!important}.message-template-grid .message-default-card[hidden]{display:grid!important}.unsaved-bar{justify-content:center!important;width:auto!important;min-width:316px!important;padding:12px!important}.unsaved-bar>div:first-child{display:none!important}.unsaved-actions{gap:10px!important}.unsaved-bar .message-global-save-button{min-height:44px!important;border:0!important;border-radius:10px!important;background:#23c483!important;color:#fff!important;padding:0 24px!important;font-weight:850!important}.unsaved-bar .message-global-save-button:hover{background:#1fb176!important}';
    document.head.append(style); // FIXED: shared bar style also forces default message cards to stay visible.
  }

  function decorateFolderButtons(host) {
    host.querySelectorAll('.message-template-card[data-id]').forEach((card) => {
      const template = templates.get(card.dataset.id);
      if (!template || template.type === 'folder' || template.botDefault || template.defaultLocked || card.querySelector('[data-message-action="move-template"]')) return;
      const button = document.createElement('span');
      button.className = 'message-card-folder-button';
      button.dataset.messageAction = 'move-template';
      button.dataset.id = template.id;
      button.textContent = 'Folder';
      button.title = 'Move to folder';
      card.append(button); // ADDED: templates show a folder move button on hover.
    });
  }

  function isDefaultTemplate(template) {
    return Boolean(template?.botDefault || template?.defaultLocked || String(template?.id || '').startsWith('default-'));
  }

  function defaultTemplates() {
    const fromApi = [...templates.values()].filter((template) => isDefaultTemplate(template) && template.type !== 'folder');
    return fromApi.length ? fromApi : DEFAULT_TEMPLATE_FALLBACKS; // FIXED: defaults tab never depends on an already-rendered card list.
  }

  function defaultCard(template) {
    const count = Array.isArray(template.containers) ? template.containers.length : 0;
    return `<button class="message-template-card message-default-card" type="button" data-message-action="open" data-id="${escapeHtml(template.id)}"><span class="message-template-symbol">📄</span><span><strong>${escapeHtml(template.name || template.id)}</strong><small>${count} container${count === 1 ? '' : 's'}</small></span><span class="message-card-arrow">›</span></button>`;
  }

  function ensureDefaultMessages(host) {
    const title = host.querySelector?.('.message-list-head h3')?.textContent?.trim().toLowerCase();
    if (title !== 'default messages') return;
    const grid = host.querySelector('.message-template-grid');
    if (!grid) return;
    const defaults = defaultTemplates();
    for (const template of defaults) templates.set(template.id, templates.get(template.id) || clone(template)); // FIXED: fallback default cards still open through the main message editor.
    const missing = defaults.filter((template) => !grid.querySelector(`[data-id="${CSS.escape(template.id)}"]`));
    if (missing.length) grid.insertAdjacentHTML('beforeend', missing.map(defaultCard).join('')); // FIXED: repopulates the empty Defaults tab.
    host.querySelectorAll('.empty-state').forEach((node) => {
      if (/no default messages/i.test(node.textContent || '')) node.remove(); // FIXED: removes stale empty state after defaults are restored.
    });
  }

  function moveTemplate(templateId) {
    const template = clone(templates.get(templateId));
    if (!template || template.botDefault || template.defaultLocked) return;
    const folders = [...templates.values()].filter((item) => item.type === 'folder' && !item.botDefault && !item.defaultLocked);
    const choice = window.prompt(['Move template to folder:', '0: Root', ...folders.map((folder, index) => `${index + 1}: ${folder.name}`)].join('\n'), '0');
    if (choice == null) return;
    const index = Number(choice);
    if (!Number.isInteger(index) || index < 0 || index > folders.length) return;
    template.folderId = index === 0 ? '' : folders[index - 1].id; // ADDED: chosen folder is applied to pending changes.
    guildId = activeGuildId();
    if (!guildId) return;
    hold(template.id, template); // FIXED: moving templates now waits for the shared Save changes button.
    root()?.querySelector(`[data-id="${CSS.escape(template.id)}"]`)?.remove();
  }

  function bindSharedButtons() {
    const save = document.querySelector('#saveButton');
    if (save && !save.dataset.messageWorkflowBound) {
      save.dataset.messageWorkflowBound = 'true';
      save.addEventListener('click', async () => {
        if (pending.size === 0) return;
        const original = save.textContent;
        save.disabled = true;
        save.textContent = 'Saving...';
        try {
          await savePendingTemplates(); // FIXED: existing Save changes saves message templates too.
        } catch (error) {
          window.alert(error.message || 'Save failed.');
        } finally {
          save.disabled = false;
          save.textContent = original || 'Save changes';
          syncSaveBar();
        }
      });
    }

    const reset = document.querySelector('#resetTabButton');
    if (reset && !reset.dataset.messageWorkflowBound) {
      reset.dataset.messageWorkflowBound = 'true';
      reset.addEventListener('click', () => {
        if (pending.size === 0 || !messagesActive()) return;
        resetPendingTemplates(); // FIXED: existing reset button clears message-template pending edits.
      });
    }
  }

  function decorate() {
    const host = root() || document;
    guildId = activeGuildId(); // ADDED: keeps the active guild available for global saves.
    injectCss();
    styleSaveBar();
    bindSharedButtons();
    fixCreateButtons(host);
    host.querySelectorAll?.('[data-message-action="manual-save"], .message-manual-save').forEach((button) => button.remove()); // FIXED: removes the extra message save button.
    decorateFolderButtons(host);
    ensureDefaultMessages(host); // FIXED: restores bot default cards when the Defaults tab renders empty.
    hideOldSaveState();
    syncSaveBar();
  }

  function decorateSoon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }

  document.addEventListener('input', (event) => {
    if (!root()?.contains(event.target)) return;
    if (!event.target.dataset.templateField && !event.target.dataset.containerField) return;
    const id = currentTemplateId();
    const template = collectTemplate();
    if (id && template) hold(id, template); // FIXED: typing immediately shows the shared unsaved bar.
  }, true);

  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[data-tab]');
    if (tab && tab.dataset.tab !== 'messages' && pending.size > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.alert('You have changes to save. Please click Save changes before switching tabs.'); // FIXED: blocks tab switches until saved.
      return;
    }

    const card = event.target.closest?.('.message-template-card[data-id]');
    if (card) selectedId = card.dataset.id;
    const action = event.target.closest?.('[data-message-action]');
    if (!action) {
      root()?.querySelectorAll('#messageCreateMenu').forEach((menu) => { menu.hidden = true; }); // ADDED: clicking outside closes create options.
      return;
    }
    if (action.dataset.messageAction === 'create-open') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleCreateMenu(action); // FIXED: Create template opens Message and Folder.
      return;
    }
    if (action.dataset.messageAction === 'manual-save') {
      event.preventDefault();
      savePendingTemplates(); // FIXED: legacy manual-save markup uses the shared save path.
    }
    if (action.dataset.messageAction === 'move-template') {
      event.preventDefault();
      event.stopPropagation();
      moveTemplate(action.dataset.id);
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') root()?.querySelectorAll('#messageCreateMenu').forEach((menu) => { menu.hidden = true; }); // ADDED: Escape closes create options.
  }, true);

  window.addEventListener('beforeunload', (event) => {
    if (pending.size === 0) return;
    event.preventDefault();
    event.returnValue = ''; // FIXED: refresh/close warns while message-template changes are unsaved.
  });

  new MutationObserver(decorateSoon).observe(document.documentElement, { childList: true, subtree: true });
  decorateSoon();
})();