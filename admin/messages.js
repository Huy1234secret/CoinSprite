(() => {
  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;

  const PALETTE = ['#FFFFFF', '#5865F2', '#57F287', '#FEE75C', '#ED4245', '#EB459E', '#9B59B6', '#2B2D31', '#3498DB', '#1ABC9C', '#E67E22', '#99AAB5'];
  let popover = null;
  const view = {
    guildId: '',
    templates: [],
    selectedId: '',
    tab: 'edit',
    query: '',
    channelId: '',
    saving: false,
    saveTimer: null,
    notice: '',
    noticeType: '',
  };

  const selected = () => view.templates.find((item) => item.id === view.selectedId) || null;
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const validHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const toHex = (value) => validHex(value) ? String(value).trim().toUpperCase() : '#5865F2';
  const cleanHex = (value) => {
    const clean = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(clean) ? `#${clean.toUpperCase()}` : '';
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function newTemplate() {
    const stamp = Date.now().toString(36);
    return {
      id: `message-${stamp}`,
      name: `Message template ${view.templates.length + 1}`,
      content: '',
      containers: [{
        id: `container-${stamp}`,
        accentColor: '#5865F2',
        text: '## New message\nWrite your Discord message here.',
        thumbnailUrl: '',
        imageUrl: '',
      }],
    };
  }

  function newContainer() {
    return {
      id: `container-${Date.now().toString(36)}`,
      accentColor: '#5865F2',
      text: '## Container title\nWrite your message here.',
      thumbnailUrl: '',
      imageUrl: '',
    };
  }

  async function loadTemplates(force = false) {
    if (!state.guildId) return;
    if (!force && view.guildId === state.guildId) return;
    view.guildId = state.guildId;
    view.selectedId = '';
    view.notice = '';
    root.innerHTML = '<div class="message-loading">Loading message templates...</div>';
    try {
      const payload = await request(`/api/guilds/${view.guildId}/message-templates`);
      view.templates = payload.templates || [];
      render();
    } catch (error) {
      root.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  function scheduleSave() {
    clearTimeout(view.saveTimer);
    view.notice = 'Unsaved changes';
    view.noticeType = 'pending';
    updateSaveState();
    view.saveTimer = setTimeout(saveSelected, 650);
  }

  async function saveSelected() {
    const template = selected();
    if (!template || view.saving) return;
    view.saving = true;
    view.notice = 'Saving...';
    view.noticeType = 'pending';
    updateSaveState();
    try {
      const payload = await request(`/api/guilds/${view.guildId}/message-templates/${template.id}`, {
        method: 'PUT',
        body: JSON.stringify(template),
      });
      Object.assign(template, payload.template);
      view.notice = 'Saved';
      view.noticeType = 'success';
    } catch (error) {
      view.notice = error.message;
      view.noticeType = 'error';
    } finally {
      view.saving = false;
      updateSaveState();
    }
  }

  function updateSaveState() {
    const status = root.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = view.notice;
    status.className = `message-save-state ${view.noticeType}`;
  }

  function renderInlineMarkdown(value) {
    const codeSpans = [];
    let safe = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, code) => {
      codeSpans.push(`<code>${code}</code>`);
      return `\u0000CODE${codeSpans.length - 1}\u0000`;
    });
    safe = safe
      .replace(/\|\|(.+?)\|\|/g, '<span class="message-preview-spoiler">$1</span>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    return safe.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeSpans[Number(index)] || '');
  }

  function renderMarkdown(value) {
    let inCode = false;
    const lines = [];
    for (const rawLine of String(value || '').split('\n')) {
      const line = rawLine.replace(/\s+$/g, '');
      if (line.trim().startsWith('```')) {
        lines.push(inCode ? '</code></pre>' : '<pre class="message-preview-code"><code>');
        inCode = !inCode;
      } else if (inCode) {
        lines.push(`${escapeHtml(line)}\n`);
      } else if (line.startsWith('### ')) {
        lines.push(`<div class="message-preview-heading small">${renderInlineMarkdown(line.slice(4))}</div>`);
      } else if (line.startsWith('## ')) {
        lines.push(`<div class="message-preview-heading">${renderInlineMarkdown(line.slice(3))}</div>`);
      } else if (line.startsWith('# ')) {
        lines.push(`<div class="message-preview-heading large">${renderInlineMarkdown(line.slice(2))}</div>`);
      } else if (line.startsWith('-# ')) {
        lines.push(`<div class="message-preview-small">${renderInlineMarkdown(line.slice(3))}</div>`);
      } else if (line.startsWith('> ')) {
        lines.push(`<div class="message-preview-quote">${renderInlineMarkdown(line.slice(2)) || '&nbsp;'}</div>`);
      } else if (/^\s*[-*]\s+/.test(line)) {
        lines.push(`<div class="message-preview-line message-preview-list">${renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</div>`);
      } else {
        lines.push(`<div class="message-preview-line">${renderInlineMarkdown(line) || '&nbsp;'}</div>`);
      }
    }
    if (inCode) lines.push('</code></pre>');
    return lines.join('');
  }

  function rootMessageHtml(content) {
    const value = String(content || '').trim();
    if (value) return renderMarkdown(value);
    return '<button class="message-add-root" type="button" data-message-action="preview-root-text"><span class="message-add-root-plus">+</span><strong>Add message</strong><span>Outside container</span></button>';
  }

  function previewUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function mediaControl(container, index, field, label) {
    const value = String(container[field] || '').trim();
    const url = previewUrl(value);
    return `<button class="preview-media-edit ${field === 'thumbnailUrl' ? 'thumbnail' : 'image'}${value ? ' has-value' : ''}" type="button" data-message-action="preview-media" data-index="${index}" data-field="${field}" aria-label="${escapeHtml(label)}">
      ${url ? `<img src="${escapeHtml(url)}" alt="">` : `<span class="preview-media-empty"><strong>${value ? 'Edit' : 'Add'} ${escapeHtml(label)}</strong><span>${value ? 'Preview unavailable' : 'Click to set URL'}</span></span>`}
      ${value ? `<span class="preview-media-clear" data-message-action="preview-media-clear" data-index="${index}" data-field="${field}">×</span>` : ''}
    </button>`;
  }

  function renderContainerPreview(container, index) {
    const sections = String(container.text || '').split(/<separator>/gi).map((section) => section.trim()).filter(Boolean);
    return `<div class="message-preview-container message-direct-ready" data-preview-container-index="${index}" style="--container-color:${escapeHtml(container.accentColor)};--preview-accent:${escapeHtml(container.accentColor)}">
      <button class="preview-accent-picker" type="button" data-message-action="preview-color" data-index="${index}" aria-label="Change container color" style="--preview-accent:${escapeHtml(container.accentColor)}"></button>
      ${mediaControl(container, index, 'thumbnailUrl', 'thumbnail')}
      <div class="message-preview-text" data-message-action="preview-text" data-index="${index}">
        ${sections.map((section, sectionIndex) => `${sectionIndex ? '<div class="message-preview-separator"></div>' : ''}${renderMarkdown(section)}`).join('') || '<div class="message-preview-line message-preview-empty">Write your message here.</div>'}
      </div>
      ${mediaControl(container, index, 'imageUrl', 'image')}
    </div>`;
  }

  function messagePreview(template) {
    const rootEmpty = !String(template.content || '').trim();
    return `<div class="message-discord-preview">
      <div class="message-discord-message">
        <div class="message-bot-avatar">CS</div>
        <div class="message-discord-body">
          <div class="message-author"><strong>CoinSprite</strong><span>APP</span></div>
          <div class="message-root-content${rootEmpty ? ' message-root-empty' : ''}" data-message-action="preview-root-text">${rootMessageHtml(template.content)}</div>
          ${template.containers.map(renderContainerPreview).join('')}
        </div>
      </div>
    </div>`;
  }

  function closePopover() {
    popover?.remove();
    popover = null;
  }

  function placePopover(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const pad = 12;
    const width = Math.min(360, window.innerWidth - pad * 2);
    node.style.width = `${width}px`;
    document.body.append(node);
    const height = node.offsetHeight || 220;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - pad) top = rect.top - height - 8;
    if (top < pad) top = pad;
    node.style.left = `${Math.min(Math.max(pad, rect.left), window.innerWidth - width - pad)}px`;
    node.style.top = `${Math.min(Math.max(pad, top), window.innerHeight - height - pad)}px`;
  }

  function popButton(className, text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function openColorEditor(anchor, index) {
    const template = selected();
    const container = template?.containers?.[index];
    if (!container) return;
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-color-popover open';
    const swatches = document.createElement('div');
    swatches.className = 'message-color-swatches';
    for (const color of PALETTE) {
      const button = popButton(`message-color-swatch${toHex(container.accentColor) === color ? ' selected' : ''}`, '');
      button.style.setProperty('--swatch', color);
      button.addEventListener('click', () => {
        container.accentColor = color;
        closePopover();
        scheduleSave();
        refreshPreview(template);
      });
      swatches.append(button);
    }
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    label.append(document.createTextNode('Custom hex color'));
    const row = document.createElement('div');
    row.className = 'message-color-custom';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 7;
    input.value = toHex(container.accentColor);
    const apply = popButton('message-color-apply', 'Apply');
    const close = popButton('message-color-apply', 'Close');
    const save = () => {
      const value = cleanHex(input.value);
      if (!value) return input.focus({ preventScroll: true });
      container.accentColor = value;
      closePopover();
      scheduleSave();
      refreshPreview(template);
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') closePopover(); });
    apply.addEventListener('click', save);
    close.addEventListener('click', closePopover);
    row.append(input, apply, close);
    label.append(row);
    box.append(swatches, label);
    box.addEventListener('click', (event) => event.stopPropagation());
    popover = box;
    placePopover(box, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function openMediaEditor(anchor, index, field) {
    const template = selected();
    const container = template?.containers?.[index];
    if (!container) return;
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-media-popover open';
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    label.append(document.createTextNode(field === 'thumbnailUrl' ? 'Thumbnail URL' : 'Image URL'));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = container[field] || '';
    input.placeholder = 'https://example.com/image.png';
    label.append(input);
    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    actions.append(document.createElement('span'));
    const clear = popButton('message-media-clear-button', 'Clear');
    const save = popButton('message-media-apply', 'Save');
    actions.append(clear, save);
    const set = (value) => {
      container[field] = String(value || '').trim();
      closePopover();
      scheduleSave();
      refreshPreview(template);
    };
    clear.addEventListener('click', () => set(''));
    save.addEventListener('click', () => set(input.value));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); set(input.value); } if (event.key === 'Escape') closePopover(); });
    box.append(label, actions);
    box.addEventListener('click', (event) => event.stopPropagation());
    popover = box;
    placePopover(box, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function openTextEditor(preview, index, rootText = false) {
    const template = selected();
    const target = rootText ? template : template?.containers?.[index];
    if (!target || preview.querySelector('.preview-inline-overlay')) return;
    closePopover();
    const key = rootText ? 'content' : 'text';
    const original = target[key] || '';
    preview.classList.add('is-direct-editing');
    const overlay = document.createElement('div');
    overlay.className = 'preview-inline-overlay';
    const bar = document.createElement('div');
    bar.className = 'preview-edit-toolbar';
    const title = document.createElement('strong');
    title.textContent = 'Editing message';
    const hint = document.createElement('span');
    hint.textContent = 'Ctrl/⌘ + Enter to finish · Esc to cancel';
    bar.append(title, hint);
    const editor = document.createElement('div');
    editor.className = 'preview-live-editor';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = original;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      target[key] = commit ? String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '') : original;
      overlay.remove();
      preview.classList.remove('is-direct-editing');
      scheduleSave();
      refreshPreview(template);
    };
    editor.addEventListener('input', () => { target[key] = String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n'); updateSaveState(); });
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    overlay.append(bar, editor);
    preview.append(overlay);
    requestAnimationFrame(() => editor.focus({ preventScroll: true }));
  }

  function renderList() {
    const query = view.query.trim().toLowerCase();
    const templates = view.templates.filter((item) => item.type !== 'folder' && !item.botDefault && !item.defaultLocked && (!query || `${item.name} ${item.id}`.toLowerCase().includes(query)));
    root.innerHTML = `<div class="message-list-head">
        <div><h3>Message templates</h3><p>Create reusable Discord Components V2 messages for this server.</p></div>
        <button class="button primary" type="button" data-message-action="create">Create template</button>
      </div>
      <div class="message-search"><input id="messageTemplateSearch" type="search" placeholder="Search templates" value="${escapeHtml(view.query)}"></div>
      <div class="message-template-grid">${templates.map((item) => `<button class="message-template-card" type="button" data-message-action="open" data-id="${escapeHtml(item.id)}">
        <span class="message-template-symbol"><img src="/admin/images/message.png" alt="" aria-hidden="true"></span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${item.containers.length} container${item.containers.length === 1 ? '' : 's'}</small></span><span class="message-card-arrow">›</span>
      </button>`).join('')}</div>
      ${templates.length ? '' : '<div class="empty-state">No message templates found.</div>'}`;
  }

  function renderContainer(container, index) {
    return `<article class="message-container-editor" data-container-index="${index}">
      <div class="message-container-head">
        <div><strong>Container ${index + 1}</strong><small>Discord text container</small></div>
        <button class="icon-button danger-text" type="button" data-message-action="remove-container" data-index="${index}" title="Remove container">×</button>
      </div>
      <div class="message-container-toolbar">
        <label class="message-color-field">Color <input type="color" value="${escapeHtml(container.accentColor)}" data-container-field="accentColor"></label>
        <span>Use <code>## heading</code>, <code>**bold**</code>, <code>&gt; quote</code>, <code>-# small</code>, and <code>&lt;separator&gt;</code>.</span>
      </div>
      <label class="message-text-label">Container text
        <textarea class="message-discord-input" rows="12" maxlength="4000" spellcheck="true" data-container-field="text" placeholder="Write Discord Markdown here...">${escapeHtml(container.text)}</textarea>
      </label>
      <div class="grid message-media-grid">
        <label>Thumbnail URL <input type="url" maxlength="1000" value="${escapeHtml(container.thumbnailUrl)}" data-container-field="thumbnailUrl" placeholder="https://..."></label>
        <label>Image URL <input type="url" maxlength="1000" value="${escapeHtml(container.imageUrl)}" data-container-field="imageUrl" placeholder="https://..."></label>
      </div>
    </article>`;
  }

  function renderEdit(template) {
    return `<div class="message-edit-layout inline-message-mode">
      <div class="message-edit-fields">
        <section class="message-compose-card">
          <div class="message-compose-head"><strong>Message content</strong><span>Optional text above containers</span></div>
          <textarea class="message-discord-input root-input" rows="5" maxlength="2000" spellcheck="true" data-template-field="content" placeholder="Optional Discord Markdown shown above the containers">${escapeHtml(template.content)}</textarea>
        </section>
        <div class="message-container-list">${template.containers.map(renderContainer).join('')}</div>
        <button class="button subtle message-add-container" type="button" data-message-action="add-container" ${template.containers.length >= 8 ? 'disabled' : ''}>+ Add container</button>
      </div>
      <aside class="message-sticky-preview">
        <div class="panel-heading"><h3>Live preview</h3><p>Preview updates as you type. Click a message box, color bar, thumbnail, or image area to edit.</p></div>
        ${messagePreview(template)}
        <button class="button subtle message-add-container" type="button" data-message-action="add-container" ${template.containers.length >= 8 ? 'disabled' : ''}>+ Add container</button>
      </aside>
    </div>`;
  }

  function renderUse() {
    return `<div class="message-use-grid">
      <section class="panel"><div class="panel-heading"><h3>Send message</h3><p>Send this template to a channel in this server.</p></div><div class="picker-field"><span class="field-label">Channel</span><div id="messageChannelPicker"></div></div><button class="button primary" type="button" data-message-action="send" ${view.channelId ? '' : 'disabled'}>Send message</button></section>
      <section class="panel"><div class="panel-heading"><h3>Edit existing message</h3><p>Paste a Discord message link. The message must have been sent by this bot.</p></div><label>Message link <input id="messageEditLink" type="url" placeholder="https://discord.com/channels/server/channel/message"></label><button class="button primary" type="button" data-message-action="edit-message">Edit message</button></section>
      <div id="messageUseStatus" class="message-use-status"></div>
    </div>`;
  }

  function mountUsePicker() {
    if (view.tab !== 'use') return;
    const mount = root.querySelector('#messageChannelPicker');
    if (!mount) return;
    const options = channelOptions().filter((option) => !['category', 'voice', 'forum'].includes(option.optionType));
    renderPicker(mount, options, view.channelId, {
      type: 'channel',
      placeholder: 'Select a channel',
      onChange: (value) => { view.channelId = value; render(); },
    });
  }

  function renderEditor() {
    const template = selected();
    if (!template) return renderList();
    root.innerHTML = `<div class="message-editor-head">
        <button class="icon-button" type="button" data-message-action="back" title="Back">←</button>
        <label>Template name <input type="text" maxlength="80" value="${escapeHtml(template.name)}" data-template-field="name"></label>
        <span id="messageSaveState" class="message-save-state ${view.noticeType}">${escapeHtml(view.notice)}</span>
        <button class="button danger" type="button" data-message-action="delete">Delete</button>
      </div>
      <nav class="message-editor-tabs">${[['edit', 'Edit'], ['use', 'Use']].map(([value, label]) => `<button type="button" class="${view.tab === value ? 'active' : ''}" data-message-action="tab" data-value="${value}">${label}</button>`).join('')}</nav>
      <div class="message-editor-body">${view.tab === 'use' ? renderUse(template) : renderEdit(template)}</div>`;
    mountUsePicker();
  }

  function render() { selected() ? renderEditor() : renderList(); }

  async function useTemplate(action) {
    const template = selected();
    if (!template) return;
    await saveSelected();
    const status = root.querySelector('#messageUseStatus');
    if (status) { status.textContent = action === 'send' ? 'Sending...' : 'Editing message...'; status.className = 'message-use-status pending'; }
    try {
      const body = action === 'send' ? { channelId: view.channelId } : { messageLink: root.querySelector('#messageEditLink')?.value || '' };
      const payload = await request(`/api/guilds/${view.guildId}/message-templates/${template.id}/${action === 'send' ? 'send' : 'edit'}`, { method: 'POST', body: JSON.stringify(body) });
      if (status) { status.innerHTML = payload.messageLink ? `Message sent. <a href="${escapeHtml(payload.messageLink)}" target="_blank" rel="noreferrer">Open in Discord</a>` : 'Message updated.'; status.className = 'message-use-status success'; }
    } catch (error) {
      if (status) { status.textContent = error.message; status.className = 'message-use-status error'; }
    }
  }

  function refreshPreview(template) {
    const preview = root.querySelector('.message-sticky-preview');
    if (preview) preview.innerHTML = `<div class="panel-heading"><h3>Live preview</h3><p>Preview updates as you type. Click a message box, color bar, thumbnail, or image area to edit.</p></div>${messagePreview(template)}<button class="button subtle message-add-container" type="button" data-message-action="add-container" ${template.containers.length >= 8 ? 'disabled' : ''}>+ Add container</button>`;
  }

  root.addEventListener('input', (event) => {
    const template = selected();
    if (!template) {
      if (event.target.id === 'messageTemplateSearch') { view.query = event.target.value; renderList(); root.querySelector('#messageTemplateSearch')?.focus(); }
      return;
    }
    if (event.target.dataset.templateField) template[event.target.dataset.templateField] = event.target.value;
    if (event.target.dataset.containerField) {
      const index = Number(event.target.closest('[data-container-index]')?.dataset.containerIndex);
      if (template.containers[index]) template.containers[index][event.target.dataset.containerField] = event.target.value;
    }
    if (event.target.dataset.templateField || event.target.dataset.containerField) {
      scheduleSave();
      if (view.tab === 'edit') refreshPreview(template);
    }
  });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-message-action]');
    if (!button) return;
    const action = button.dataset.messageAction;
    if (action === 'preview-color') { event.preventDefault(); openColorEditor(button, Number(button.dataset.index)); return; }
    if (action === 'preview-media') { event.preventDefault(); openMediaEditor(button, Number(button.dataset.index), button.dataset.field); return; }
    if (action === 'preview-media-clear') {
      event.preventDefault();
      const template = selected();
      const container = template?.containers?.[Number(button.dataset.index)];
      if (container) { container[button.dataset.field] = ''; scheduleSave(); refreshPreview(template); }
      return;
    }
    if (action === 'preview-text') { event.preventDefault(); openTextEditor(button.closest('.message-preview-container'), Number(button.dataset.index)); return; }
    if (action === 'preview-root-text') { event.preventDefault(); openTextEditor(button.closest('.message-root-content'), 0, true); return; }
    if (action === 'create') {
      const template = newTemplate();
      view.templates.push(template);
      view.selectedId = template.id;
      view.tab = 'edit';
      view.notice = 'Unsaved changes';
      view.noticeType = 'pending';
      render();
      scheduleSave();
    } else if (action === 'open') { const item = view.templates.find((entry) => entry.id === button.dataset.id); if (item?.type === 'folder') return; view.selectedId = button.dataset.id; view.tab = 'edit'; view.notice = ''; render(); }
    else if (action === 'back') { await saveSelected(); view.selectedId = ''; render(); }
    else if (action === 'tab') { view.tab = button.dataset.value === 'use' ? 'use' : 'edit'; render(); }
    else if (action === 'add-container') { selected().containers.push(newContainer()); render(); scheduleSave(); }
    else if (action === 'remove-container') { if (selected().containers.length > 1) selected().containers.splice(Number(button.dataset.index), 1); render(); scheduleSave(); }
    else if (action === 'delete') {
      const template = selected();
      if (!window.confirm(`Delete "${template.name}"?`)) return;
      await request(`/api/guilds/${view.guildId}/message-templates/${template.id}`, { method: 'DELETE' });
      view.templates = view.templates.filter((item) => item.id !== template.id);
      view.selectedId = '';
      render();
    } else if (action === 'send') await useTemplate('send');
    else if (action === 'edit-message') await useTemplate('edit');
  });

  document.querySelector('#tabList')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-tab="messages"]')) loadTemplates();
  });
  document.querySelector('#guildSelect')?.addEventListener('change', () => setTimeout(() => loadTemplates(true), 0));
  setInterval(() => {
    if (document.querySelector('[data-panel="messages"]')?.classList.contains('active')) loadTemplates();
  }, 800);
})();

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
      const defaults = all.filter((item) => item.botDefault || item.defaultLocked || String(item.id || '').startsWith('default-'));
      const folders = all.filter((item) => item.type === 'folder' && !item.botDefault);
      const folder = folders.find((item) => item.id === folderState.folderId) || null;
      const userTemplates = all.filter((item) => item.type !== 'folder' && !item.botDefault && !item.defaultLocked && !String(item.id || '').startsWith('default-') && (folderState.folderId ? item.folderId === folderState.folderId : !item.folderId));
      const shown = folderState.mode === 'defaults' ? defaults : userTemplates;
      const signature = JSON.stringify({ mode: folderState.mode, folderId: folderState.folderId, items: all.map((item) => [item.id, item.name, item.folderId, item.botDefault, item.defaultLocked, item.type]) });
      const alreadyEnhanced = Boolean(root.querySelector('.message-section-tabs'));
      if (!force && alreadyEnhanced && signature === folderState.signature) return;
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
      ${shown.length || (folderState.mode === 'templates' && !folderState.folderId && folders.length) ? '' : `<div class="empty-state">${folderState.mode === 'defaults' ? 'No default messages found.' : 'No message templates found.'}</div>`}`;
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
  requestAnimationFrame(() => renderList(true));
})();

(() => {
  if (window.__coinSpriteMessageRootGapFix) return;
  window.__coinSpriteMessageRootGapFix = true;

  function loadGuard() {}

  function blankLine() {
    const line = document.createElement('div');
    line.className = 'message-preview-line message-preview-empty message-root-gap-line';
    line.setAttribute('aria-hidden', 'true');
    line.innerHTML = '&nbsp;';
    return line;
  }

  function decorate(root = document) {
    root.querySelectorAll?.('.message-root-content.message-root-empty').forEach((host) => {
      const addButton = host.querySelector(':scope > .message-add-root');
      if (addButton) addButton.replaceWith(blankLine());
      if (!host.textContent.trim() && !host.querySelector(':scope > .message-root-gap-line')) host.append(blankLine());
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) decorate(node);
      });
    }
    decorate(document);
  });

  if (document.body) {
    loadGuard();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  decorate(document);
})();
