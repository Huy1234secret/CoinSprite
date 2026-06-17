(() => {
  if (window.__coinSpriteMessageActionPersistenceFix) return;
  window.__coinSpriteMessageActionPersistenceFix = true;

  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;
  let selectedId = '';
  const pending = new WeakMap();
  const dirty = new WeakSet();

  function guildId() { return document.querySelector('#guildSelect')?.value || ''; }
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
  function isTemplateSelect(node) {
    return node?.tagName === 'SELECT' && node.options?.[0]?.textContent?.trim() === 'Select a template';
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
  function targetFor(template, meta) {
    const row = template?.componentRows?.[meta.rowIndex];
    const item = row?.type === 'select' ? row.options?.[meta.itemIndex] : row?.buttons?.[meta.itemIndex];
    return row && item ? { row, item } : null;
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
    const choices = [['', 'Select a template'], ...templates.filter((template) => template.type !== 'folder').map((template) => [template.id, template.name || template.id])];
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
  async function templates() {
    const id = guildId();
    if (!id) return [];
    return (await json('GET', `/api/guilds/${id}/message-templates`)).templates || [];
  }
  async function sync() {
    const selects = [...root.querySelectorAll('select')].filter(isTemplateSelect);
    if (!selects.length) return;
    const all = await templates();
    const template = currentTemplate(all);
    if (!template) return;
    selectedId = template.id;
    for (const select of selects) {
      if (dirty.has(select)) continue;
      const meta = metaFor(select);
      const target = meta && targetFor(template, meta);
      const action = target ? actionsFor(target.item)[meta.actionIndex] : null;
      fill(select, all, action?.type === 'send_message' ? action.templateId : '');
    }
  }
  async function save(select) {
    const id = guildId();
    const meta = metaFor(select);
    if (!id || !meta) return;
    dirty.add(select);
    setState('Saving...', 'pending');
    try {
      const all = await templates();
      const template = currentTemplate(all);
      if (!template) throw new Error('Open a message template before saving this action.');
      selectedId = template.id;
      const target = targetFor(template, meta);
      if (!target) throw new Error('This component no longer exists.');
      const actions = actionsFor(target.item);
      while (actions.length <= meta.actionIndex) actions.push({ type: 'send_message', templateId: '' });
      actions[meta.actionIndex] = { ...actions[meta.actionIndex], type: 'send_message', templateId: select.value || '' };
      target.item.actions = actions.slice(0, 2);
      await json('PUT', `/api/guilds/${id}/message-templates/${template.id}/component-actions`, {
        rowId: target.row.id,
        itemId: target.item.id,
        actions: target.item.actions,
      });
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

(() => {
  if (window.__coinSpriteMessageFolderEnhancement) return;
  window.__coinSpriteMessageFolderEnhancement = true;

  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;
  const folderState = { mode: 'templates', folderId: '', lockedDefaultId: '', rendering: false, signature: '' };

  function guildId() { return document.querySelector('#guildSelect')?.value || ''; }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function stamp() { return Date.now().toString(36); }
  async function request(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }
  async function templates() {
    const id = guildId();
    if (!id) return [];
    return (await request('GET', `/api/guilds/${id}/message-templates`)).templates || [];
  }
  function refreshNative() {
    document.querySelector('#guildSelect')?.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function card(item, kind = 'template') {
    const icon = kind === 'folder' ? '📁' : item.botDefault ? '📄' : '<img src="/admin/images/message.png" alt="" aria-hidden="true">';
    const action = kind === 'folder' ? 'folder-open' : 'open';
    const meta = kind === 'folder' ? 'Folder' : `${(item.containers || []).length} container${(item.containers || []).length === 1 ? '' : 's'}`;
    return `<button class="message-template-card ${kind === 'folder' ? 'message-folder-card' : ''}${item.botDefault ? ' message-default-card' : ''}" type="button" data-message-action="${action}" data-id="${escapeHtml(item.id)}">
      <span class="message-template-symbol">${icon}</span>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(meta)}</small></span><span class="message-card-arrow">›</span>
    </button>`;
  }
  function header(folder) {
    if (!folder) return '';
    return `<div class="message-folder-head"><button class="button subtle" type="button" data-folder-action="folder-back">Back</button><input id="messageFolderName" type="text" maxlength="80" value="${escapeHtml(folder.name)}"><button class="button danger" type="button" data-folder-action="folder-delete">Delete folder</button></div>`;
  }
  function createMenu() {
    return '<div class="message-create-menu" id="messageCreateMenu" hidden><button type="button" data-folder-action="create-message">Message</button><button type="button" data-folder-action="create-folder">Folder</button></div>';
  }
  async function renderList(force = false) {
    if (folderState.rendering || root.querySelector('.message-editor-head') || root.querySelector('.message-loading')) return;
    const grid = root.querySelector('.message-template-grid');
    if (!grid || !guildId()) return;
    folderState.rendering = true;
    try {
      const all = await templates();
      const defaults = all.filter((item) => item.botDefault || item.defaultLocked);
      const folders = all.filter((item) => item.type === 'folder' && !item.botDefault);
      const folder = folders.find((item) => item.id === folderState.folderId) || null;
      const userTemplates = all.filter((item) => item.type !== 'folder' && !item.botDefault && !item.defaultLocked && (folderState.folderId ? item.folderId === folderState.folderId : !item.folderId));
      const shown = folderState.mode === 'defaults' ? defaults : userTemplates;
      const signature = JSON.stringify({ mode: folderState.mode, folderId: folderState.folderId, items: all.map((item) => [item.id, item.name, item.folderId, item.botDefault, item.defaultLocked, item.type]) });
      if (!force && root.dataset.folderEnhanced === 'true' && signature === folderState.signature) return;
      folderState.signature = signature;
      root.dataset.folderEnhanced = 'true';
      root.innerHTML = `<div class="message-list-head">
        <div><h3>${folderState.mode === 'defaults' ? 'Default messages' : folder ? escapeHtml(folder.name) : 'Message templates'}</h3><p>${folderState.mode === 'defaults' ? 'Bot defaults can be edited, but not renamed or deleted.' : 'Create reusable messages and organize them in folders.'}</p></div>
        ${folderState.mode === 'templates' ? '<div class="message-create-wrap"><button class="button primary" type="button" data-folder-action="create-open">Create template</button>' + createMenu() + '</div>' : ''}
      </div>
      <nav class="message-section-tabs"><button type="button" class="${folderState.mode === 'templates' ? 'active' : ''}" data-folder-action="mode-templates">Templates</button><button type="button" class="${folderState.mode === 'defaults' ? 'active' : ''}" data-folder-action="mode-defaults">Defaults</button></nav>
      ${folderState.mode === 'templates' ? header(folder) : ''}
      <div class="message-template-grid">
        ${folderState.mode === 'templates' && !folderState.folderId ? folders.map((item) => card(item, 'folder')).join('') : ''}
        ${shown.map((item) => card(item)).join('')}
      </div>
      ${folders.length || shown.length ? '' : '<div class="empty-state">No message templates found.</div>'}`;
    } catch {
    } finally {
      folderState.rendering = false;
    }
  }
  async function createTemplate(type) {
    const id = type === 'folder' ? `folder-${stamp()}` : `message-${stamp()}`;
    const body = type === 'folder'
      ? { id, type: 'folder', name: 'New folder' }
      : { id, type: 'template', folderId: folderState.folderId, name: 'New message template', content: '', containers: [{ id: `container-${stamp()}`, accentColor: '#5865F2', text: '## New message\nWrite your Discord message here.', thumbnailUrl: '', imageUrl: '' }], componentRows: [] };
    await request('PUT', `/api/guilds/${guildId()}/message-templates/${id}`, body);
    folderState.signature = '';
    refreshNative();
    setTimeout(() => renderList(true), 500);
  }
  function lockDefaultEditor() {
    const name = root.querySelector('[data-template-field="name"]');
    const del = root.querySelector('[data-message-action="delete"]');
    if (!name || !folderState.lockedDefaultId) return;
    name.disabled = true;
    name.title = 'Default templates cannot be renamed.';
    if (del) del.hidden = true;
  }

  root.addEventListener('click', async (event) => {
    const custom = event.target.closest('[data-folder-action]');
    if (!custom) {
      const cardNode = event.target.closest('.message-default-card[data-id]');
      if (cardNode) folderState.lockedDefaultId = cardNode.dataset.id;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = custom.dataset.folderAction;
    if (action === 'create-open') root.querySelector('#messageCreateMenu')?.toggleAttribute('hidden');
    if (action === 'mode-templates') { folderState.mode = 'templates'; folderState.folderId = ''; folderState.signature = ''; await renderList(true); }
    if (action === 'mode-defaults') { folderState.mode = 'defaults'; folderState.folderId = ''; folderState.signature = ''; await renderList(true); }
    if (action === 'folder-back') { folderState.folderId = ''; folderState.signature = ''; await renderList(true); }
    if (action === 'folder-delete' && folderState.folderId && window.confirm('Delete this folder and its templates?')) {
      await request('DELETE', `/api/guilds/${guildId()}/message-templates/${folderState.folderId}`);
      folderState.folderId = '';
      folderState.signature = '';
      refreshNative();
      setTimeout(() => renderList(true), 500);
    }
    if (action === 'create-message') await createTemplate('template');
    if (action === 'create-folder') await createTemplate('folder');
  }, true);
  root.addEventListener('click', (event) => {
    const folder = event.target.closest('[data-message-action="folder-open"]');
    if (!folder) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    folderState.folderId = folder.dataset.id;
    folderState.signature = '';
    renderList(true);
  }, true);
  root.addEventListener('change', async (event) => {
    if (event.target.id !== 'messageFolderName' || !folderState.folderId) return;
    const all = await templates();
    const folder = all.find((item) => item.id === folderState.folderId);
    if (!folder) return;
    folder.name = event.target.value || 'Folder';
    await request('PUT', `/api/guilds/${guildId()}/message-templates/${folder.id}`, folder);
    folderState.signature = '';
    refreshNative();
  }, true);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-message-action="back"]')) folderState.lockedDefaultId = '';
  }, true);
  new MutationObserver(() => requestAnimationFrame(() => { renderList(); lockDefaultEditor(); })).observe(root, { childList: true, subtree: true });
})();
