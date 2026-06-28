(() => {
  if (window.CoinSpriteRichEditor?.version >= 2) return;

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
      '.rich-live-panel{border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:8px;padding:18px;min-width:0}',
      '.rich-live-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.rich-live-head h3{margin:0;font-size:16px}',
      '.rich-preview-stage{min-height:300px;border:1px solid var(--border,#30394a);border-radius:8px;background:#25272d;padding:22px;overflow:auto}',
      '.rich-preview-stage .message-discord-preview{min-height:250px}.rich-source-fields{display:none!important}',
      '.rich-container-tools{position:absolute;right:8px;top:8px;display:flex;gap:5px;z-index:5;opacity:0;transition:opacity .15s}.message-preview-container:hover>.rich-container-tools,.message-preview-container:focus-within>.rich-container-tools{opacity:1}',
      '.rich-container-tools button{width:30px;height:30px;min-height:30px;padding:0;border-radius:5px;background:#11151dcc}',
      '.rich-add-container{width:100%;min-height:42px;border-style:dashed;margin-top:12px}',
      '.rich-template-editor .message-preview-container{position:relative}.rich-template-editor .message-root-content,.rich-template-editor .message-preview-text{cursor:text}',
      '@media(max-width:700px){.rich-format-head,.rich-live-head{align-items:flex-start;flex-direction:column}.rich-preview-stage{padding:12px}.rich-container-tools{opacity:1;position:static;justify-content:flex-end;margin-bottom:6px}}',
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
        const controls = document.createElement('div');
        controls.className = 'rich-container-tools';
        controls.innerHTML = '<button type="button" data-rich-action="up" data-index="' + index + '" title="Move up">↑</button><button type="button" data-rich-action="down" data-index="' + index + '" title="Move down">↓</button><button type="button" data-rich-action="remove" data-index="' + index + '" title="Remove">×</button>';
        container.prepend(controls);
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

  window.CoinSpriteRichEditor = Object.freeze({ version: 2, mount, normalize });
  window.dispatchEvent(new Event('coinsprite:rich-editor-ready'));
})();
