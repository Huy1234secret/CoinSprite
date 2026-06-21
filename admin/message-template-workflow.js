(() => {
  if (window.__coinSpriteMessageTemplateWorkflow) return;
  window.__coinSpriteMessageTemplateWorkflow = true;

  const nativeFetch = window.fetch.bind(window);
  const templates = new Map();
  const savedTemplates = new Map();
  const pending = new Map();
  const DEFAULT_TEMPLATE_FALLBACKS = [
    {
      id: 'default-ai-moderation-alert',
      type: 'template',
      folderId: '',
      name: 'Default: AI moderation alert',
      content: '',
      containers: [{
        id: 'ai-moderation-alert',
        accentColor: '#9B59B6',
        text: '## AI moderation report\n**User:** <@mention> (`<user-id>`)\n**Channel:** <channel>\n**Severity:** <severity>/10\n**Case:** <moderation-case>\n**Reason:** <moderation-reason>\n**Message:** <message-link> “<message-content>”',
        thumbnailUrl: '<avatar_url>',
        imageUrl: '',
      }],
      componentRows: [],
      botDefault: true,
      defaultLocked: true,
    }, // FIXED: full default card body is available for no-change comparisons.
    {
      id: 'default-ai-moderation-user-warning',
      type: 'template',
      folderId: '',
      name: 'Default: AI moderation user warning',
      content: '',
      containers: [{
        id: 'ai-moderation-user-warning',
        accentColor: '#9B59B6',
        text: '## Message flagged\n<@mention>, your message in <channel> was flagged by AI moderation.\n**Severity:** <severity>/10\n**Case:** <moderation-case>\n**Reason:** <moderation-reason>\n-# If this was a mistake, please contact staff.',
        thumbnailUrl: '',
        imageUrl: '',
      }],
      componentRows: [],
      botDefault: true,
      defaultLocked: true,
    },
    {
      id: 'default-link-auto-moderation-alert',
      type: 'template',
      folderId: '',
      name: 'Default: Link Auto-Moderator alert',
      content: '',
      containers: [{
        id: 'link-auto-moderation-alert',
        accentColor: '#ED4245',
        text: '## Link Auto-Moderator report\n**User:** <@mention> (`<user-id>`)\n**Channel:** <channel>\n**Action taken:** <moderation-action>\n**Reason:** <moderation-reason>\n<separator>\n**Blocked link**\n- Domain: `<blocked-domain>`\n- URL: <blocked-url>\n- Invite code: `<invite-code>`\n<separator>\n-# User message: “<message-content>”\n-# Report link: <message-link>',
        thumbnailUrl: '<avatar_url>',
        imageUrl: '',
      }],
      componentRows: [],
      botDefault: true,
      defaultLocked: true,
    }, // ADDED: canonical link auto-moderation fallback.
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

  function fallbackTemplate(templateId) {
    const fallback = DEFAULT_TEMPLATE_FALLBACKS.find((template) => template.id === templateId);
    return fallback ? clone(fallback) : null;
  }

  function hydrateTemplate(template) {
    if (!template?.id) return template ? clone(template) : null;
    const fallback = fallbackTemplate(template.id);
    if (!fallback) return clone(template);
    const saved = clone(template);
    const containers = Array.isArray(saved.containers) && saved.containers.length ? saved.containers : fallback.containers;
    const componentRows = Array.isArray(saved.componentRows) ? saved.componentRows : fallback.componentRows;
    return {
      ...fallback,
      ...saved,
      id: fallback.id,
      type: 'template',
      folderId: '',
      name: fallback.name,
      containers,
      componentRows,
      botDefault: true,
      defaultLocked: true,
    }; // FIXED: default templates compare against the rendered built-in body, not an empty API shell.
  }

  function comparableTemplate(template) {
    const value = hydrateTemplate(template) || {};
    return {
      id: String(value.id || ''),
      type: String(value.type || 'template'),
      folderId: String(value.folderId || ''),
      name: String(value.name || ''),
      content: String(value.content || ''),
      containers: (Array.isArray(value.containers) ? value.containers : []).map((container) => ({
        id: String(container?.id || ''),
        accentColor: String(container?.accentColor || '#5865F2').toUpperCase(),
        text: String(container?.text || ''),
        thumbnailUrl: String(container?.thumbnailUrl || ''),
        imageUrl: String(container?.imageUrl || ''),
      })),
      componentRows: Array.isArray(value.componentRows) ? value.componentRows : [],
      botDefault: Boolean(value.botDefault),
      defaultLocked: Boolean(value.defaultLocked),
    };
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function templatesMatch(left, right) {
    return stableJson(comparableTemplate(left)) === stableJson(comparableTemplate(right));
  }

  function savedTemplate(templateId) {
    return savedTemplates.get(templateId) || fallbackTemplate(templateId);
  }

  function hasTemplateChanges(templateId, template) {
    const saved = savedTemplate(templateId);
    return !saved || !templatesMatch(saved, template);
  }

  function remember(list) {
    (Array.isArray(list) ? list : []).forEach((template) => {
      if (!template?.id) return;
      const saved = hydrateTemplate(template);
      savedTemplates.set(template.id, saved); // FIXED: keeps a real saved baseline separate from pending editor values.
      templates.set(template.id, pending.get(template.id) || saved); // FIXED: pending edits stay visible during refreshes.
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

  function restoreSavedTemplate(templateId, fallback = null) {
    const saved = savedTemplate(templateId) || hydrateTemplate(fallback);
    if (saved) templates.set(templateId, clone(saved));
    pending.delete(templateId); // FIXED: no-op autosaves from Back/Use no longer leave fake pending changes.
    hideOldSaveState();
    syncSaveBar();
    decorateSoon();
    return saved || fallback;
  }

  function hold(templateId, template) {
    if (!templateId || !template) return;
    if (!hasTemplateChanges(templateId, template)) {
      restoreSavedTemplate(templateId, template); // FIXED: reverting to the saved value clears the shared save bar.
      return;
    }
    const staged = hydrateTemplate(template) || clone(template);
    pending.set(templateId, clone(staged)); // FIXED: autosaves are converted into pending changes.
    templates.set(templateId, clone(staged));
    selectedId = templateId;
    hideOldSaveState();
    syncSaveBar(); // FIXED: every real message edit opens the one global bar.
    decorateSoon();
  }

  function applyActions(templateId, body) {
    const template = clone(pending.get(templateId) || templates.get(templateId) || savedTemplate(templateId) || {});
    const row = (template.componentRows || []).find((entry) => entry.id === body?.rowId);
    const list = row?.type === 'select' ? row.options : row?.buttons;
    const item = list?.find((entry) => entry.id === body?.itemId);
    if (item) item.actions = Array.isArray(body.actions) ? body.actions.slice(0, 2) : []; // FIXED: component action edits join pending saves.
    return template;
  }

  window.fetch = async (input, init = {}) => {
    const info = route(input, init.method || input?.method || 'GET');
    if (info?.method === 'PUT' && info.templateId && !bypass && info.action !== 'send' && info.action !== 'edit') {
      let body = {};
      try {
        body = JSON.parse(init.body || '{}');
      } catch {
        body = {};
      }
      const template = info.action === 'component-actions' ? applyActions(info.templateId, body) : { ...body, id: info.templateId };
      guildId = info.guildId;
      if (!hasTemplateChanges(info.templateId, template)) {
        const saved = restoreSavedTemplate(info.templateId, template); // FIXED: opening/backing out of any template does not create a false unsaved save.
        return jsonResponse({ guildId: info.guildId, template: hydrateTemplate(saved) || saved || template });
      }
      hold(info.templateId, template);
      return jsonResponse({ guildId: info.guildId, template: hydrateTemplate(template) || template }); // FIXED: field changes no longer save directly.
    }
    const response = await nativeFetch(input, init);
    if (info && response.ok) {
      response.clone().json().then((payload) => {
        guildId = info.guildId || guildId;
        if (payload.templates) remember(payload.templates);
        if (payload.template?.id) {
          const saved = hydrateTemplate(payload.template);
          templates.set(payload.template.id, saved);
          savedTemplates.set(payload.template.id, saved); // FIXED: successful real saves update the no-change baseline.
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
    const template = clone(pending.get(id) || templates.get(id) || savedTemplate(id) || { id, type: 'template', containers: [] });
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
    if (id && template) {
      if (hasTemplateChanges(id, template)) pending.set(id, clone(hydrateTemplate(template) || template)); // FIXED: includes the open editor values only when they differ from saved.
      else restoreSavedTemplate(id, template); // FIXED: Save changes does not force-save a clean open template.
    }
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
        const saved = hydrateTemplate(payload.template || pendingTemplate);
        pending.delete(templateId);
        templates.set(templateId, saved);
        savedTemplates.set(templateId, saved); // FIXED: saved templates become the new baseline for tab/refresh warnings.
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
    for (const [templateId, template] of savedTemplates.entries()) templates.set(templateId, clone(template)); // FIXED: reset restores clean message-template baselines.
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
    return `<button class="message-template-card message-default-card" type="button" data-message-action="open" data-id="${escapeHtml(template.id)}"><span class="message-template-symbol"><img src="https://raw.githubusercontent.com/Huy1234secret/CoinSprite/main/images/message.png" alt="" aria-hidden="true"></span><span><strong>${escapeHtml(template.name || template.id)}</strong><small>${count} container${count === 1 ? '' : 's'}</small></span><span class="message-card-folder-button message-card-edit-button">Edit</span><span class="message-card-arrow">›</span></button>`;
  }

  function ensureDefaultMessages(host) {
    const title = host.querySelector?.('.message-list-head h3')?.textContent?.trim().toLowerCase();
    if (title !== 'default messages') return;
    const grid = host.querySelector('.message-template-grid');
    if (!grid) return;
    const defaults = defaultTemplates();
    for (const template of defaults) {
      const hydrated = hydrateTemplate(template);
      templates.set(template.id, templates.get(template.id) || hydrated); // FIXED: fallback default cards still open through the main message editor.
      if (!savedTemplates.has(template.id)) savedTemplates.set(template.id, clone(hydrated)); // FIXED: defaults have a clean baseline before Back/Use runs.
    }
    const missing = defaults.filter((template) => !grid.querySelector(`[data-id="${CSS.escape(template.id)}"]`));
    if (missing.length) grid.insertAdjacentHTML('beforeend', missing.map(defaultCard).join('')); // FIXED: repopulates the empty Defaults tab.
    host.querySelectorAll('.empty-state').forEach((node) => {
      if (/no default messages/i.test(node.textContent || '')) node.remove(); // FIXED: removes stale empty state after defaults are restored.
    });
  }

  async function moveTemplate(templateId) {
    const template = clone(templates.get(templateId));
    if (!template || template.botDefault || template.defaultLocked) return;
    const folders = [...templates.values()].filter((item) => item.type === 'folder' && !item.botDefault && !item.defaultLocked);
    const choice = await window.coinSpriteUi.prompt(['Move template to folder:', '0: Root', ...folders.map((folder, index) => `${index + 1}: ${folder.name}`)].join('\n'), '0');
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
          void window.coinSpriteUi.alert(error.message || 'Save failed.', 'Save failed');
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
    const host = root();
    if (!host?.contains(event.target)) return;
    if (event.target.closest?.('.preview-live-editor')) return; // FIXED: inline preview typing waits for the editor commit instead of creating ghost dirty state.
    if (!event.target.dataset.templateField && !event.target.dataset.containerField) return;
    const id = currentTemplateId();
    const template = collectTemplate();
    if (id && template) hold(id, template); // FIXED: typing immediately shows the shared unsaved bar only for real changes.
  }, true);

  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[data-tab]');
    if (tab && tab.dataset.tab !== 'messages' && pending.size > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void window.coinSpriteUi.alert('You have changes to save. Please click Save changes before switching tabs.', 'Unsaved changes'); // FIXED: blocks tab switches only while real message edits are pending.
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
