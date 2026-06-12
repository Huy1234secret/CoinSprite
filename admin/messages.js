(() => {
  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;

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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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
    let safe = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
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

  function renderContainerPreview(container) {
    const sections = String(container.text || '').split(/<separator>/gi).map((section) => section.trim()).filter(Boolean);
    return `<div class="message-preview-container" style="--container-color:${escapeHtml(container.accentColor)}">
      <div class="message-preview-text">
        ${container.thumbnailUrl ? `<img class="message-preview-thumb" src="${escapeHtml(container.thumbnailUrl)}" alt="">` : ''}
        ${sections.map((section, index) => `${index ? '<div class="message-preview-separator"></div>' : ''}${renderMarkdown(section)}`).join('') || '<div class="message-preview-line message-preview-empty">Write your message here.</div>'}
      </div>
      ${container.imageUrl ? `<img class="message-preview-image" src="${escapeHtml(container.imageUrl)}" alt="">` : ''}
    </div>`;
  }

  function messagePreview(template) {
    return `<div class="message-discord-preview">
      <div class="message-discord-message">
        <div class="message-bot-avatar">CS</div>
        <div class="message-discord-body">
          <div class="message-author"><strong>CoinSprite</strong><span>APP</span></div>
          ${template.content ? `<div class="message-root-content">${renderMarkdown(template.content)}</div>` : ''}
          ${template.containers.map(renderContainerPreview).join('')}
        </div>
      </div>
    </div>`;
  }

  function renderList() {
    const query = view.query.trim().toLowerCase();
    const templates = view.templates.filter((item) => !query || `${item.name} ${item.id}`.toLowerCase().includes(query));
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
    return `<div class="message-edit-layout">
      <div class="message-edit-fields">
        <section class="message-compose-card">
          <div class="message-compose-head"><strong>Message content</strong><span>Optional text above containers</span></div>
          <textarea class="message-discord-input root-input" rows="5" maxlength="2000" spellcheck="true" data-template-field="content" placeholder="Optional Discord Markdown shown above the containers">${escapeHtml(template.content)}</textarea>
        </section>
        <div class="message-container-list">${template.containers.map(renderContainer).join('')}</div>
        <button class="button subtle message-add-container" type="button" data-message-action="add-container" ${template.containers.length >= 8 ? 'disabled' : ''}>+ Add container</button>
      </div>
      <aside class="message-sticky-preview">
        <div class="panel-heading"><h3>Live preview</h3><p>Preview updates as you type, using Discord-style Markdown.</p></div>
        ${messagePreview(template)}
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
    if (preview) preview.innerHTML = `<div class="panel-heading"><h3>Live preview</h3><p>Preview updates as you type, using Discord-style Markdown.</p></div>${messagePreview(template)}`;
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
    if (action === 'create') {
      const template = newTemplate();
      view.templates.push(template);
      view.selectedId = template.id;
      view.tab = 'edit';
      view.notice = 'Unsaved changes';
      view.noticeType = 'pending';
      render();
      scheduleSave();
    } else if (action === 'open') { view.selectedId = button.dataset.id; view.tab = 'edit'; view.notice = ''; render(); }
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
