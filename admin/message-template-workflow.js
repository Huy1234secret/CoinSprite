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

  function setSaveState(text, kind) {
    const status = root()?.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = text;
    status.className = `message-save-state ${kind}`;
  }

  function hold(templateId, template) {
    if (!templateId || !template) return;
    pending.set(templateId, clone(template)); // ADDED: autosave attempts are held until Save changes is pressed.
    templates.set(templateId, clone(template));
    selectedId = templateId;
    setSaveState('Unsaved changes', 'pending');
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
    setSaveState('Saving...', 'pending');
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
      setSaveState('Saved', 'success');
    } catch (error) {
      setSaveState(error.message || 'Save failed.', 'error');
    } finally {
      bypass = false;
      decorateSoon();
    }
  }

  function fixCreateButtons(scope = document) {
    scope.querySelectorAll?.('[data-message-action="create-message"].button.primary').forEach((button) => {
      button.dataset.messageAction = 'create-open'; // FIXED: main Create template button opens the Message/Folder menu.
      button.setAttribute('data-message-action', 'create-open');
    });
  }

  function ensureSaveButton(host) {
    const head = host.querySelector('.message-editor-head');
    if (!head || head.querySelector('[data-message-action="manual-save"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button success message-manual-save';
    button.dataset.messageAction = 'manual-save';
    button.textContent = 'Save changes';
    head.append(button); // ADDED: users confirm message template changes manually.
  }

  function injectCss() {
    if (document.querySelector('#messageTemplateWorkflowStyle')) return;
    const style = document.createElement('style');
    style.id = 'messageTemplateWorkflowStyle';
    style.textContent = '.message-template-card{position:relative}.message-card-folder-button{position:absolute;right:42px;bottom:10px;display:none;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);color:var(--text);font-size:11px;font-weight:800}.message-template-card:hover .message-card-folder-button{display:inline-flex}.message-card-folder-button:hover{border-color:var(--primary);background:var(--surface-3)}.message-manual-save{white-space:nowrap}';
    document.head.append(style); // ADDED: folder move controls stay hidden until hover.
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
      card.append(button); // ADDED: user templates show a folder move button on hover.
    });
  }

  async function moveTemplate(templateId) {
    const template = clone(templates.get(templateId));
    if (!template || template.botDefault || template.defaultLocked) return;
    const folders = [...templates.values()].filter((item) => item.type === 'folder' && !item.botDefault && !item.defaultLocked);
    const choice = window.prompt(['Move template to folder:', '0: Root', ...folders.map((folder, index) => `${index + 1}: ${folder.name}`)].join('\n'), '0');
    if (choice == null) return;
    const index = Number(choice);
    if (!Number.isInteger(index) || index < 0 || index > folders.length) return;
    template.folderId = index === 0 ? '' : folders[index - 1].id; // ADDED: chosen folder is saved after confirmation.
    if (!guildId) guildId = document.querySelector('#guildSelect')?.value || window.state?.guildId || '';
    if (!guildId) return;
    bypass = true;
    const response = await nativeFetch(`/api/guilds/${guildId}/message-templates/${template.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template) }).catch(() => null);
    bypass = false;
    if (response?.ok) {
      templates.set(template.id, template);
      root()?.querySelector(`[data-id="${CSS.escape(template.id)}"]`)?.remove();
    }
  }

  function decorate() {
    const host = root() || document;
    injectCss();
    fixCreateButtons(host);
    ensureSaveButton(host);
    decorateFolderButtons(host);
  }

  function decorateSoon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest?.('.message-template-card[data-id]');
    if (card) selectedId = card.dataset.id;
    const action = event.target.closest?.('[data-message-action]');
    if (!action) return;
    if (action.dataset.messageAction === 'manual-save') {
      event.preventDefault();
      saveSelected();
    }
    if (action.dataset.messageAction === 'move-template') {
      event.preventDefault();
      event.stopPropagation();
      moveTemplate(action.dataset.id);
    }
  }, true);

  new MutationObserver(decorateSoon).observe(document.documentElement, { childList: true, subtree: true });
  decorateSoon();
})();
