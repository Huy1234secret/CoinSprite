(() => {
  if (window.__coinSpriteMessageTemplateWorkflow) return;
  window.__coinSpriteMessageTemplateWorkflow = true;

  const nativeFetch = window.fetch.bind(window);
  const templates = new Map();
  const pending = new Map();
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

  function activeGuildId() {
    return guildId || document.querySelector('#guildSelect')?.value || window.state?.guildId || ''; // ADDED: create-menu fallback can resolve the active guild without waiting for a fetch.
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

  function setSaveState() {
    const status = root()?.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = ''; // FIXED: removes the old per-template saved/autosave text.
    status.className = 'message-save-state';
    status.hidden = true; // FIXED: only the existing global unsaved bar is shown.
  }

  function isCoreDirtyVisible() {
    return Boolean(document.querySelector('#savedState')?.classList.contains('dirty'));
  }

  function isMessagesTabActive() {
    return Boolean(document.querySelector('[data-panel="messages"]')?.classList.contains('active'));
  }

  function styleGlobalSaveBar() {
    const bar = document.querySelector('#unsavedBar');
    if (!bar) return;
    const textBlock = bar.firstElementChild;
    if (textBlock && !textBlock.classList.contains('unsaved-actions')) textBlock.hidden = true; // FIXED: removes the unsaved text block from the global bar.
    const detail = document.querySelector('#unsavedDetail');
    if (detail) detail.textContent = ''; // FIXED: clears the per-tab changed text.
    const saveButton = document.querySelector('#saveButton');
    if (saveButton) saveButton.classList.add('message-global-save-button'); // FIXED: uses one shared green save button style.
  }

  function syncGlobalSaveBar() {
    styleGlobalSaveBar();
    const bar = document.querySelector('#unsavedBar');
    if (!bar) return;
    if (pending.size > 0) {
      bar.hidden = false; // FIXED: message template edits use the existing global save bar.
      const resetButton = document.querySelector('#resetTabButton');
      if (resetButton && isMessagesTabActive()) resetButton.disabled = false; // FIXED: reset is enabled while editing unsaved message templates.
      return;
    }
    if (!isCoreDirtyVisible()) bar.hidden = true; // FIXED: do not hide the bar while the original dashboard system has changes.
  }

  function keepPendingState(templateId) {
    const restore = () => {
      if (pending.has(templateId)) {
        setSaveState(); // FIXED: old autosave labels stay hidden.
        syncGlobalSaveBar(); // FIXED: unsaved message edits stay on the global bar.
      }
    };
    setTimeout(restore, 0); // FIXED: beats the original autosave success microtask.
    setTimeout(restore, 75); // FIXED: keeps the manual-save state visible after delayed UI updates.
    setTimeout(restore, 300); // FIXED: prevents the old autosave label from coming back after component saves.
  }

  function hold(templateId, template) {
    if (!templateId || !template) return;
    pending.set(templateId, clone(template)); // ADDED: autosave attempts are held until Save changes is pressed.
    templates.set(templateId, clone(template));
    selectedId = templateId;
    setSaveState();
    syncGlobalSaveBar(); // FIXED: every message template change opens the one global unsaved bar.
    keepPendingState(templateId); // FIXED: saved/auto-saved status no longer replaces the pending manual-save status.
    decorateSoon();
  }

  function applyActions(templateId, body) {
    const template = clone(templates.get(templateId) || pending.get(templateId) || {});
    const row = (template.componentRows || []).find((entry) => entry.id === body?.rowId);
    const list = row?.type === 'select' ? row.options : row?.buttons;
    const item = list?.find((entry) => entry.id === body?.itemId);
    if (item) item.actions = Array.isArray(body.actions) ? body.actions.slice(0, 2) : []; // FIXED: component action changes join the pending save set.
    return template;
  }

  window.fetch = async (input, init = {}) => {
    const info = route(input, init.method || input?.method || 'GET');
    if (info?.method === 'PUT' && info.templateId && !bypass && info.action !== 'send' && info.action !== 'edit') {
      const body = JSON.parse(init.body || '{}');
      const template = info.action === 'component-actions' ? applyActions(info.templateId, body) : { ...body, id: info.templateId };
      guildId = info.guildId;
      hold(info.templateId, template);
      return jsonResponse({ guildId: info.guildId, template }); // FIXED: message templates no longer auto-save on field changes.
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

  async function saveSelected() {
    const id = currentTemplateId();
    const template = collectTemplate() || pending.get(id) || templates.get(id);
    if (!guildId || !id || !template) return;
    try {
      bypass = true;
      const response = await nativeFetch(`/api/guilds/${guildId}/message-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        cache: 'no-store',
        body: JSON.stringify(template),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      pending.delete(id);
      templates.set(id, payload.template || template);
      setSaveState(); // FIXED: old saved text stays removed after saving.
      syncGlobalSaveBar(); // FIXED: global bar closes after the pending template is saved.
    } catch (error) {
      window.alert(error.message || 'Save failed.'); // FIXED: save errors use the single global save flow instead of the old label.
    } finally {
      bypass = false;
      decorateSoon();
    }
  }
})();