(() => {
  if (window.CoinSpriteRichEditor?.version >= 3) return;

  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);

  function normalize(value = {}) {
    return {
      ...clone(value),
      content: String(value.content || '').slice(0, 2000),
      containers: (Array.isArray(value.containers) ? value.containers : []).slice(0, 8).map((item, index) => ({
        id: String(item.id || 'container-' + (index + 1)),
        text: String(item.text || '').slice(0, 4000),
        accentColor: /^#[0-9a-f]{6}$/i.test(item.accentColor) ? item.accentColor.toUpperCase() : '#5865F2',
        thumbnailUrl: String(item.thumbnailUrl || '').slice(0, 2000),
        imageUrl: String(item.imageUrl || '').slice(0, 2000),
      })),
      componentRows: [],
    };
  }

  function previewValue(value, replacements = {}) {
    const copy = clone(value);
    const replace = (text) => String(text || '').replace(/<([@a-z0-9_-]+)>/gi, (match, key) => replacements[key.toLowerCase()] ?? match);
    copy.content = replace(copy.content);
    copy.containers = (copy.containers || []).map((item) => ({
      ...item,
      text: replace(item.text),
      thumbnailUrl: replace(item.thumbnailUrl),
      imageUrl: replace(item.imageUrl),
    }));
    return copy;
  }

  function styles() {
    if (document.querySelector('#richTemplateEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'richTemplateEditorStyles';
    style.textContent = [
      '.rich-template-editor{display:grid;gap:14px}',
      '.rich-format-bar{border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:8px;padding:14px 16px}',
      '.rich-format-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.rich-format-head h3{margin:0;font-size:16px}',
      '.rich-format-tokens{display:flex;flex-wrap:wrap;gap:7px}.rich-format-tokens button{min-height:32px;padding:5px 9px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}',
      '.rich-live-panel{border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:10px;padding:16px;min-width:0}',
      '.rich-live-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.rich-live-head h3{margin:0;font-size:16px}.rich-live-head span{color:var(--muted,#93a4bc);font-size:12px}',
      '.rich-preview-stage{border:1px solid var(--border,#30394a);border-radius:10px;background:#25272d;padding:20px;overflow:auto}',
      '.rich-preview-stage .message-discord-preview{min-height:220px;padding:20px}.rich-preview-stage .message-discord-body{width:100%;max-width:920px}.rich-source-fields{display:none!important}',
      '.rich-container-frame{width:min(100%,840px);margin:12px 0 0}.rich-container-frame>.message-preview-container{width:100%;max-width:none;margin:0}',
      '.rich-container-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;margin-bottom:7px;padding:0 2px;color:var(--muted,#93a4bc);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}',
      '.rich-container-tools{display:flex;gap:6px}.rich-container-tools button{display:grid;width:32px;height:32px;min-height:32px;place-items:center;padding:0;border:1px solid var(--border,#30394a);border-radius:7px;background:#11151d;color:#f2f3f5;line-height:1}.rich-container-tools button:hover:not(:disabled){border-color:var(--primary,#7c83ff);background:#1b2434}.rich-container-tools button:disabled{opacity:.35;cursor:not-allowed}',
      '.rich-template-editor .preview-media-edit.image:not(.has-value){width:auto;min-width:150px;min-height:42px;padding:0 12px}.rich-template-editor .preview-media-edit.image:not(.has-value) .preview-media-empty{flex-direction:row;gap:7px;padding:0}.rich-template-editor .preview-media-edit.image:not(.has-value) .preview-media-empty span:last-child{display:none}',
      '.rich-add-container{width:100%;min-height:42px;border-style:dashed;margin-top:12px}',
      '.rich-template-editor .message-preview-container{position:relative}.rich-template-editor .message-root-content,.rich-template-editor .message-preview-text{cursor:text}',
      '@media(max-width:700px){.rich-format-head,.rich-live-head{align-items:flex-start;flex-direction:column}.rich-preview-stage{padding:10px}.rich-preview-stage .message-discord-preview{min-height:0;padding:14px}.rich-container-frame{width:100%}.rich-container-toolbar{align-items:flex-start}}',
    ].join('\n');
    document.head.append(style);
  }

  function mount(root, options = {}) {
    styles();
    let value = normalize(options.value);
    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    const notify = () => options.onChange?.(clone(value));

    root.classList.add('rich-template-editor');
    root.innerHTML = '<section class="rich-format-bar"><div class="rich-format-head"><h3>Message formats</h3></div><div class="rich-format-tokens">'
      + tokens.map((token) => '<button type="button" data-rich-token="' + escapeHtml(token) + '">' + escapeHtml(token) + '</button>').join('')
      + '<button type="button" data-rich-token="<separator>">&lt;separator&gt;</button></div></section>'
      + '<section class="rich-live-panel"><div class="rich-live-head"><h3>Live preview</h3><span>Click the message, color, thumbnail, or image to edit.</span></div><div class="rich-preview-stage" data-rich-preview></div>'
      + '<button class="rich-add-container" type="button" data-rich-action="add">+ Add container</button></section><div class="rich-source-fields" data-rich-sources></div>';

    function sourceMarkup() {
      return '<textarea data-template-field="content" maxlength="2000">' + escapeHtml(value.content) + '</textarea>'
        + value.containers.map((item, index) => '<div data-container-index="' + index + '"><textarea data-container-field="text" maxlength="4000">' + escapeHtml(item.text) + '</textarea><input data-container-field="accentColor" type="color" value="' + escapeHtml(item.accentColor) + '"><input data-container-field="thumbnailUrl" value="' + escapeHtml(item.thumbnailUrl) + '"><input data-container-field="imageUrl" value="' + escapeHtml(item.imageUrl) + '"></div>').join('');
    }

    function syncSources() {
      const sources = root.querySelector('[data-rich-sources]');
      sources.innerHTML = sourceMarkup();
    }

    function syncValue() {
      value.content = root.querySelector('[data-template-field="content"]')?.value || '';
      root.querySelectorAll('[data-container-index]').forEach((group) => {
        const item = value.containers[Number(group.dataset.containerIndex)];
        if (!item) return;
        for (const key of ['text', 'accentColor', 'thumbnailUrl', 'imageUrl']) {
          const field = group.querySelector('[data-container-field="' + key + '"]');
          if (field) item[key] = field.value;
        }
      });
    }

    function decorateContainers() {
      root.querySelectorAll('[data-rich-preview] .message-preview-container').forEach((container, index) => {
        const frame = document.createElement('div');
        frame.className = 'rich-container-frame';
        const toolbar = document.createElement('div');
        toolbar.className = 'rich-container-toolbar';
        const label = document.createElement('span');
        label.textContent = 'Container ' + (index + 1);
        const controls = document.createElement('div');
        controls.className = 'rich-container-tools';
        controls.innerHTML = '<button type="button" data-rich-action="up" data-index="' + index + '" title="Move container up" aria-label="Move container up" ' + (index === 0 ? 'disabled' : '') + '>↑</button><button type="button" data-rich-action="down" data-index="' + index + '" title="Move container down" aria-label="Move container down" ' + (index === value.containers.length - 1 ? 'disabled' : '') + '>↓</button><button type="button" data-rich-action="remove" data-index="' + index + '" title="Remove container" aria-label="Remove container">×</button>';
        toolbar.append(label, controls);
        container.before(frame);
        frame.append(toolbar, container);
      });
    }

    function refreshPreview() {
      const preview = root.querySelector('[data-rich-preview]');
      const rendered = previewValue(value, options.previewTokens || {});
      preview.innerHTML = window.CoinSpriteMessageEditor?.renderPreview
        ? window.CoinSpriteMessageEditor.renderPreview(rendered, { hideEmptyRoot: false })
        : '<pre>' + escapeHtml(JSON.stringify(rendered, null, 2)) + '</pre>';
      decorateContainers();
      root.querySelector('[data-rich-action="add"]').disabled = value.containers.length >= 8;
    }

    root.addEventListener('input', (event) => {
      if (!event.target.closest('[data-rich-sources]')) return;
      syncValue();
      notify();
      refreshPreview();
    });
    root.addEventListener('change', (event) => {
      if (!event.target.closest('[data-rich-sources]')) return;
      syncValue();
      notify();
      refreshPreview();
    });
    root.addEventListener('click', (event) => {
      const token = event.target.closest('[data-rich-token]')?.dataset.richToken;
      if (token) {
        if (!window.CoinSpriteInlineMessageEditor?.insertToken(token, root)) {
          const field = root.querySelector('[data-template-field="content"]');
          field.value += token;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
      const action = event.target.closest('[data-rich-action]')?.dataset.richAction;
      if (!action) return;
      const index = Number(event.target.closest('[data-index]')?.dataset.index);
      if (action === 'add' && value.containers.length < 8) value.containers.push({ id: 'container-' + Date.now(), text: '', accentColor: '#5865F2', thumbnailUrl: '', imageUrl: '' });
      else if (action === 'remove' && Number.isInteger(index)) value.containers.splice(index, 1);
      else if (action === 'up' && index > 0) [value.containers[index - 1], value.containers[index]] = [value.containers[index], value.containers[index - 1]];
      else if (action === 'down' && index < value.containers.length - 1) [value.containers[index + 1], value.containers[index]] = [value.containers[index], value.containers[index + 1]];
      else return;
      syncSources();
      notify();
      refreshPreview();
    });

    syncSources();
    refreshPreview();
    return {
      getValue: () => clone(value),
      setValue(next) {
        value = normalize(next);
        syncSources();
        refreshPreview();
      },
    };
  }

  window.CoinSpriteRichEditor = Object.freeze({ version: 3, mount, normalize });
  window.dispatchEvent(new Event('coinsprite:rich-editor-ready'));
})();
