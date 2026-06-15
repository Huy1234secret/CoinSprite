(() => {
  if (window.__coinSpriteMessageComponents) return;
  window.__coinSpriteMessageComponents = true;

  const templates = new Map();
  const root = document.querySelector('#messageTemplatesRoot');
  const nativeFetch = window.fetch.bind(window);
  const PLACEHOLDERS = [
    ['<guild-name>', 'Server name'],
    ['<guild-id>', 'Server ID'],
    ['<member-count>', 'Member count'],
    ['<channel>', 'Channel mention'],
    ['<channel-name>', 'Channel name'],
    ['<channel-id>', 'Channel ID'],
    ['<@mention>', 'User mention'],
    ['<username>', 'Username'],
    ['<display-name>', 'Display name'],
    ['<user-id>', 'User ID'],
  ];
  let selectedId = '';
  let queued = false;
  let saveTimer = null;
  let idCounter = 0;

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const makeId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`.slice(0, 40);
  const messageApi = (url) => String(url || '').match(/\/api\/guilds\/(\d{16,20})\/message-templates(?:\/([a-z0-9_-]{1,40}))?/);

  function normalize(template) {
    if (!template || typeof template !== 'object') return null;
    if (!Array.isArray(template.componentRows)) template.componentRows = [];
    return template;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const match = messageApi(url);
    const method = String(init.method || 'GET').toUpperCase();
    if (match?.[2] && method === 'PUT' && init.body) {
      const body = JSON.parse(init.body);
      const current = templates.get(match[2]);
      if (current) body.componentRows = current.componentRows || [];
      init = { ...init, body: JSON.stringify(body) };
    }
    const response = await nativeFetch(input, init);
    if (match && response.ok && (method === 'GET' || method === 'PUT')) {
      response.clone().json().then((payload) => {
        for (const item of payload.templates || (payload.template ? [payload.template] : [])) {
          const template = normalize(item);
          if (template) templates.set(template.id, template);
        }
        if (payload.template) selectedId = payload.template.id;
        schedule();
      }).catch(() => null);
    }
    return response;
  };

  function currentTemplate() {
    if (selectedId && templates.has(selectedId)) return templates.get(selectedId);
    const name = root?.querySelector('[data-template-field="name"]')?.value;
    if (!name) return null;
    const matches = [...templates.values()].filter((template) => template.name === name);
    if (matches.length === 1) {
      selectedId = matches[0].id;
      return matches[0];
    }
    return null;
  }

  function setSaveState(text, className) {
    const status = root?.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = text;
    status.className = `message-save-state ${className}`;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    setSaveState('Unsaved changes', 'pending');
    saveTimer = setTimeout(saveComponents, 500);
  }

  async function saveComponents() {
    const template = currentTemplate();
    const guildId = window.state?.guildId;
    if (!template || !guildId) return;
    setSaveState('Saving...', 'pending');
    try {
      const response = await nativeFetch(`/api/guilds/${guildId}/message-templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      templates.set(template.id, normalize(payload.template));
      setSaveState('Saved', 'success');
    } catch (error) {
      setSaveState(error.message, 'error');
    }
  }

  function tokenPalette() {
    return `<div class="message-placeholder-palette">
      <div><strong>Message formats</strong><span>Click a format to insert it into the active message or response field.</span></div>
      <div class="message-placeholder-list">${PLACEHOLDERS.map(([token, label]) => `<button type="button" data-placeholder-token="${escapeHtml(token)}" title="${escapeHtml(label)}">${escapeHtml(token)}</button>`).join('')}</div>
    </div>`;
  }

  function insertToken(token) {
    const active = document.activeElement;
    if (active?.matches?.('input[type="text"],input[type="url"],textarea')) {
      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? start;
      active.setRangeText(token, start, end, 'end');
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.focus({ preventScroll: true });
      return;
    }
    if (active?.isContentEditable) {
      document.execCommand('insertText', false, token);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.focus({ preventScroll: true });
      return;
    }
    const source = root?.querySelector('[data-template-field="content"]');
    if (!source) return;
    source.value = `${source.value || ''}${source.value ? ' ' : ''}${token}`;
    source.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function buttonEditor(button, rowIndex, buttonIndex) {
    const responseField = button.style === 'link'
      ? `<label>URL <input type="url" value="${escapeHtml(button.url || '')}" data-component-field="url" data-row-index="${rowIndex}" data-item-index="${buttonIndex}" placeholder="https://..."></label>`
      : `<label class="message-component-wide">Ephemeral response <textarea rows="2" maxlength="2000" data-component-field="response" data-row-index="${rowIndex}" data-item-index="${buttonIndex}" placeholder="Message shown after clicking">${escapeHtml(button.response || '')}</textarea></label>`;
    return `<div class="message-button-editor">
      <div class="message-component-item-head"><strong>Button ${buttonIndex + 1}</strong><button type="button" class="icon-button danger-text" data-component-action="remove-button" data-row-index="${rowIndex}" data-item-index="${buttonIndex}">×</button></div>
      <div class="message-component-grid">
        <label>Label <input type="text" maxlength="80" value="${escapeHtml(button.label || '')}" data-component-field="label" data-row-index="${rowIndex}" data-item-index="${buttonIndex}"></label>
        <label>Style <select data-component-field="style" data-row-index="${rowIndex}" data-item-index="${buttonIndex}">${['primary', 'secondary', 'success', 'danger', 'link'].map((style) => `<option value="${style}"${button.style === style ? ' selected' : ''}>${style[0].toUpperCase()}${style.slice(1)}</option>`).join('')}</select></label>
        <label>Emoji <input type="text" maxlength="100" value="${escapeHtml(button.emoji || '')}" data-component-field="emoji" data-row-index="${rowIndex}" data-item-index="${buttonIndex}" placeholder="✅ or custom emoji"></label>
        ${responseField}
      </div>
    </div>`;
  }

  function optionEditor(option, rowIndex, optionIndex) {
    return `<div class="message-select-option-editor">
      <div class="message-component-item-head"><strong>Option ${optionIndex + 1}</strong><button type="button" class="icon-button danger-text" data-component-action="remove-option" data-row-index="${rowIndex}" data-item-index="${optionIndex}">×</button></div>
      <div class="message-component-grid">
        <label>Label <input type="text" maxlength="100" value="${escapeHtml(option.label || '')}" data-component-field="label" data-row-index="${rowIndex}" data-item-index="${optionIndex}"></label>
        <label>Description <input type="text" maxlength="100" value="${escapeHtml(option.description || '')}" data-component-field="description" data-row-index="${rowIndex}" data-item-index="${optionIndex}"></label>
        <label>Emoji <input type="text" maxlength="100" value="${escapeHtml(option.emoji || '')}" data-component-field="emoji" data-row-index="${rowIndex}" data-item-index="${optionIndex}" placeholder="✅"></label>
        <label class="message-component-wide">Ephemeral response <textarea rows="2" maxlength="2000" data-component-field="response" data-row-index="${rowIndex}" data-item-index="${optionIndex}">${escapeHtml(option.response || '')}</textarea></label>
      </div>
    </div>`;
  }

  function rowEditor(row, rowIndex) {
    if (row.type === 'select') {
      return `<article class="message-component-row-editor">
        <div class="message-component-row-head"><div><strong>Selection panel</strong><span>Users choose one or more options and receive the configured response.</span></div><button type="button" class="button danger" data-component-action="remove-row" data-row-index="${rowIndex}">Remove</button></div>
        <div class="message-component-grid message-select-settings">
          <label>Placeholder <input type="text" maxlength="150" value="${escapeHtml(row.placeholder || '')}" data-row-field="placeholder" data-row-index="${rowIndex}"></label>
          <label>Minimum choices <input type="number" min="0" max="25" value="${row.minValues ?? 1}" data-row-field="minValues" data-row-index="${rowIndex}"></label>
          <label>Maximum choices <input type="number" min="1" max="25" value="${row.maxValues ?? 1}" data-row-field="maxValues" data-row-index="${rowIndex}"></label>
        </div>
        <div class="message-component-items">${(row.options || []).map((option, index) => optionEditor(option, rowIndex, index)).join('')}</div>
        <button type="button" class="button subtle" data-component-action="add-option" data-row-index="${rowIndex}" ${(row.options || []).length >= 25 ? 'disabled' : ''}>+ Add option</button>
      </article>`;
    }
    return `<article class="message-component-row-editor">
      <div class="message-component-row-head"><div><strong>Button panel</strong><span>Up to five buttons in one Discord action row.</span></div><button type="button" class="button danger" data-component-action="remove-row" data-row-index="${rowIndex}">Remove</button></div>
      <div class="message-component-items">${(row.buttons || []).map((button, index) => buttonEditor(button, rowIndex, index)).join('')}</div>
      <button type="button" class="button subtle" data-component-action="add-button" data-row-index="${rowIndex}" ${(row.buttons || []).length >= 5 ? 'disabled' : ''}>+ Add button</button>
    </article>`;
  }

  function editorHtml(template) {
    return `<section class="message-components-editor">
      <div class="message-components-heading"><div><h3>Buttons and selection panels</h3><p>Add Sapphire-style interactive components. Non-link actions send an ephemeral response to the user.</p></div><span>${template.componentRows.length}/5 rows</span></div>
      <div class="message-component-rows">${template.componentRows.map(rowEditor).join('')}</div>
      ${template.componentRows.length ? '' : '<div class="empty-state compact">No interactive components added.</div>'}
      <div class="message-component-add-actions">
        <button type="button" class="button subtle" data-component-action="add-button-row" ${template.componentRows.length >= 5 ? 'disabled' : ''}>+ Button panel</button>
        <button type="button" class="button subtle" data-component-action="add-select-row" ${template.componentRows.length >= 5 ? 'disabled' : ''}>+ Selection panel</button>
      </div>
    </section>`;
  }

  function componentPreview(template) {
    return `<div class="message-components-preview">${template.componentRows.map((row) => {
      if (row.type === 'select') return `<div class="message-select-preview"><span>${escapeHtml(row.placeholder || 'Choose an option')}</span><span>⌄</span></div>`;
      return `<div class="message-buttons-preview">${(row.buttons || []).map((button) => `<button type="button" class="message-button-preview ${escapeHtml(button.style || 'primary')}" disabled>${button.emoji ? `${escapeHtml(button.emoji)} ` : ''}${escapeHtml(button.label || 'Button')}</button>`).join('')}</div>`;
    }).join('')}</div>`;
  }

  function renderPreview(template) {
    const body = root?.querySelector('.message-discord-body');
    if (!body) return;
    body.querySelector('.message-components-preview')?.remove();
    body.insertAdjacentHTML('beforeend', componentPreview(template));
  }

  function renderEditor(template) {
    const preview = root?.querySelector('.message-sticky-preview');
    if (!preview) return;
    preview.querySelector('.message-components-editor')?.remove();
    preview.insertAdjacentHTML('beforeend', editorHtml(template));
    renderPreview(template);
  }

  function decorate() {
    if (!root) return;
    const tabs = root.querySelector('.message-editor-tabs');
    if (tabs && !root.querySelector('.message-placeholder-palette')) tabs.insertAdjacentHTML('beforebegin', tokenPalette());
    const template = currentTemplate();
    if (template && root.querySelector('.message-sticky-preview') && !root.querySelector('.message-components-editor')) renderEditor(template);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }

  function newButton() {
    return { id: makeId('button'), label: 'Button', style: 'primary', emoji: '', url: '', response: 'Thanks, <@mention>!' };
  }
  function newOption() {
    return { id: makeId('option'), label: 'Option', description: '', emoji: '', response: 'You selected this option, <@mention>.' };
  }

  root?.addEventListener('click', (event) => {
    const card = event.target.closest('.message-template-card[data-id]');
    if (card) selectedId = card.dataset.id;
    if (event.target.closest('[data-message-action="back"]')) selectedId = '';

    const token = event.target.closest('[data-placeholder-token]');
    if (token) {
      event.preventDefault();
      insertToken(token.dataset.placeholderToken);
      return;
    }

    const action = event.target.closest('[data-component-action]');
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const template = currentTemplate();
    if (!template) return;
    const rowIndex = Number(action.dataset.rowIndex);
    const itemIndex = Number(action.dataset.itemIndex);
    const row = template.componentRows[rowIndex];
    switch (action.dataset.componentAction) {
      case 'add-button-row':
        template.componentRows.push({ id: makeId('row'), type: 'buttons', buttons: [newButton()] });
        break;
      case 'add-select-row':
        template.componentRows.push({ id: makeId('row'), type: 'select', placeholder: 'Choose an option', minValues: 1, maxValues: 1, options: [newOption()] });
        break;
      case 'remove-row':
        template.componentRows.splice(rowIndex, 1);
        break;
      case 'add-button':
        if (row?.type === 'buttons' && row.buttons.length < 5) row.buttons.push(newButton());
        break;
      case 'remove-button':
        if (row?.type === 'buttons' && row.buttons.length > 1) row.buttons.splice(itemIndex, 1);
        break;
      case 'add-option':
        if (row?.type === 'select' && row.options.length < 25) row.options.push(newOption());
        break;
      case 'remove-option':
        if (row?.type === 'select' && row.options.length > 1) row.options.splice(itemIndex, 1);
        break;
      default:
        return;
    }
    renderEditor(template);
    queueSave();
  }, true);

  root?.addEventListener('input', (event) => {
    const field = event.target;
    const template = currentTemplate();
    if (!template) return;
    const rowIndex = Number(field.dataset.rowIndex);
    const row = template.componentRows[rowIndex];
    if (!row) return;
    if (field.dataset.rowField) {
      row[field.dataset.rowField] = field.type === 'number' ? Number(field.value) : field.value;
    } else if (field.dataset.componentField) {
      const itemIndex = Number(field.dataset.itemIndex);
      const item = row.type === 'select' ? row.options?.[itemIndex] : row.buttons?.[itemIndex];
      if (!item) return;
      item[field.dataset.componentField] = field.value;
      if (field.dataset.componentField === 'style') renderEditor(template);
    } else return;
    renderPreview(template);
    queueSave();
  }, true);

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
