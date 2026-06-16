(() => {
  if (window.__coinSpriteMessageActionPersistenceFix) return;
  window.__coinSpriteMessageActionPersistenceFix = true;

  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;

  let selectedId = '';
  const pending = new WeakMap();
  const dirty = new WeakSet();

  function guildId() {
    return window.state?.guildId || '';
  }

  function setState(text, kind) {
    const status = root.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = text;
    status.className = `message-save-state ${kind}`;
  }

  async function json(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      cache: 'no-store',
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function rawPut(url, body) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', url);
      request.responseType = 'json';
      request.setRequestHeader('Content-Type', 'application/json');
      request.onload = () => {
        const payload = request.response || {};
        if (request.status >= 200 && request.status < 300) resolve(payload);
        else reject(new Error(payload.error || `Request failed (${request.status})`));
      };
      request.onerror = () => reject(new Error('Network request failed.'));
      request.send(JSON.stringify(body));
    });
  }

  function currentTemplate(templates) {
    if (selectedId) {
      const byId = templates.find((template) => template.id === selectedId);
      if (byId) return byId;
    }
    const name = root.querySelector('[data-template-field="name"]')?.value;
    const matches = templates.filter((template) => template.name === name);
    if (matches.length === 1) {
      selectedId = matches[0].id;
      return matches[0];
    }
    return null;
  }

  function isTemplateSelect(node) {
    return node?.tagName === 'SELECT' && node.options?.[0]?.textContent?.trim() === 'Select a template';
  }

  function metaFor(select) {
    const editor = select.closest('.message-button-editor, .message-select-option-editor');
    const field = editor?.querySelector('[data-row-index][data-item-index]');
    const card = select.closest('.message-component-action-card');
    const cards = [...(card?.closest('.message-component-action-list')?.querySelectorAll('.message-component-action-card') || [])];
    const rowIndex = Number(field?.dataset.rowIndex);
    const itemIndex = Number(field?.dataset.itemIndex);
    const actionIndex = cards.indexOf(card);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(itemIndex) || actionIndex < 0) return null;
    return { rowIndex, itemIndex, actionIndex };
  }

  function itemFor(template, meta) {
    const row = template?.componentRows?.[meta.rowIndex];
    if (!row) return null;
    return row.type === 'select' ? row.options?.[meta.itemIndex] : row.buttons?.[meta.itemIndex];
  }

  function actionsFor(item) {
    if (Array.isArray(item?.actions) && item.actions.length) return item.actions.map((action) => ({ ...action }));
    if (item?.actionType === 'send_message' || item?.templateId) return [{ type: 'send_message', templateId: item.templateId || '' }];
    if (item?.actionType === 'give_role' || item?.roleId) return [{ type: 'give_role', roleId: item.roleId || '', reverse: Boolean(item.reverse) }];
    if (item?.response) return [{ type: 'legacy_response', response: item.response }];
    return [{ type: 'send_message', templateId: '' }];
  }

  function fill(select, templates, value) {
    const selected = value || '';
    const choices = [['', 'Select a template'], ...templates.map((template) => [template.id, template.name || template.id])];
    if (selected && !choices.some(([id]) => id === selected)) choices.push([selected, `Unavailable (${selected})`]);
    const signature = JSON.stringify({ selected, choices });
    if (select.dataset.persistenceSignature === signature) return;
    select.replaceChildren(...choices.map(([id, label]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      option.selected = id === selected;
      return option;
    }));
    select.value = selected;
    select.dataset.persistenceSignature = signature;
  }

  async function sync() {
    const selects = [...root.querySelectorAll('select')].filter(isTemplateSelect);
    if (!selects.length || !guildId()) return;
    const templates = (await json('GET', `/api/guilds/${guildId()}/message-templates`)).templates || [];
    const template = currentTemplate(templates);
    if (!template) return;
    selectedId = template.id;
    for (const select of selects) {
      if (dirty.has(select)) continue;
      const meta = metaFor(select);
      const item = meta && itemFor(template, meta);
      const action = item ? actionsFor(item)[meta.actionIndex] : null;
      fill(select, templates, action?.type === 'send_message' ? action.templateId : '');
    }
  }

  async function save(select) {
    const id = guildId();
    const meta = metaFor(select);
    if (!id || !meta) return;
    dirty.add(select);
    setState('Saving...', 'pending');
    try {
      const templates = (await json('GET', `/api/guilds/${id}/message-templates`)).templates || [];
      const template = currentTemplate(templates);
      if (!template) throw new Error('Open a message template before saving this action.');
      selectedId = template.id;
      const item = itemFor(template, meta);
      if (!item) throw new Error('This component no longer exists.');
      const actions = actionsFor(item);
      while (actions.length <= meta.actionIndex) actions.push({ type: 'send_message', templateId: '' });
      actions[meta.actionIndex] = { ...actions[meta.actionIndex], type: 'send_message', templateId: select.value || '' };
      item.actions = actions.slice(0, 2);
      await rawPut(`/api/guilds/${id}/message-templates/${template.id}`, template);
      await json('GET', `/api/guilds/${id}/message-templates`);
      dirty.delete(select);
      setState('Saved', 'success');
      sync().catch(() => null);
    } catch (error) {
      dirty.delete(select);
      setState(error.message || 'Could not save action.', 'error');
    }
  }

  root.addEventListener('click', (event) => {
    const card = event.target.closest('.message-template-card[data-id]');
    if (card) selectedId = card.dataset.id;
    if (event.target.closest('[data-message-action="back"]')) selectedId = '';
  }, true);

  root.addEventListener('change', (event) => {
    if (!isTemplateSelect(event.target)) return;
    dirty.add(event.target);
    setState('Unsaved changes', 'pending');
    clearTimeout(pending.get(event.target));
    pending.set(event.target, setTimeout(() => save(event.target), 150));
  }, true);

  new MutationObserver(() => requestAnimationFrame(() => sync().catch(() => null))).observe(root, { childList: true, subtree: true });
  sync().catch(() => null);
})();
