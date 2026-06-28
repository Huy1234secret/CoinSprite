(() => {
  if (window.CoinSpriteRichEditor) return;

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
        accentColor: /^#[0-9a-f]{6}$/i.test(item.accentColor) ? item.accentColor : '#5865F2',
        thumbnailUrl: String(item.thumbnailUrl || '').slice(0, 2000),
        imageUrl: String(item.imageUrl || '').slice(0, 2000),
      })),
      componentRows: [],
    };
  }

  function applyPreviewTokens(value, replacements = {}) {
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

  function mount(root, options = {}) {
    let value = normalize(options.value);
    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    const changed = () => options.onChange?.(clone(value));
    root.classList.add('rich-template-editor');
    if (!document.querySelector('#richTemplateEditorStyles')) {
      const style = document.createElement('style');
      style.id = 'richTemplateEditorStyles';
      style.textContent = '.rich-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:14px;align-items:start}.rich-editor-fields,.rich-editor-preview{border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:8px;padding:16px}.rich-editor-preview{position:sticky;top:18px}.rich-editor-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:13px}.rich-editor-toolbar select{max-width:240px}.rich-container{border:1px solid var(--border,#30394a);border-radius:7px;padding:13px;margin:12px 0;background:rgba(255,255,255,.018)}.rich-container-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.rich-container-actions{display:flex;gap:6px}.rich-container-actions button{min-width:34px;padding:6px}.rich-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px}.rich-grid .wide{grid-column:1/-1}.rich-template-editor label{display:grid;gap:6px}.rich-template-editor textarea{min-height:115px;resize:vertical}.rich-empty{color:var(--muted,#aeb7c5);padding:18px 0}.rich-add{width:100%;border-style:dashed}.rich-preview-title{margin:0 0 12px;font-size:15px}@media(max-width:900px){.rich-editor-layout{grid-template-columns:1fr}.rich-editor-preview{position:static}.rich-grid{grid-template-columns:1fr}.rich-grid .wide{grid-column:auto}}';
      document.head.append(style);
    }

    function preview() {
      const target = root.querySelector('[data-rich-preview]');
      if (!target) return;
      const rendered = applyPreviewTokens(value, options.previewTokens || {});
      target.innerHTML = window.CoinSpriteMessageEditor?.renderPreview
        ? window.CoinSpriteMessageEditor.renderPreview(rendered, { hideEmptyRoot: false })
        : '<pre>' + escapeHtml(JSON.stringify(rendered, null, 2)) + '</pre>';
    }

    function render() {
      root.innerHTML = '<div class="rich-editor-layout"><section class="rich-editor-fields">'
        + '<div class="rich-editor-toolbar"><select data-token><option value="">Insert placeholder</option>'
        + tokens.map((token) => '<option value="' + escapeHtml(token) + '">' + escapeHtml(token) + '</option>').join('')
        + '<option value="<separator>">Separator</option></select></div>'
        + '<label>Root text<textarea data-root maxlength="2000">' + escapeHtml(value.content) + '</textarea></label>'
        + '<div data-containers>' + (value.containers.length ? value.containers.map((item, index) => '<article class="rich-container" data-index="' + index + '"><div class="rich-container-head"><strong>Container ' + (index + 1) + '</strong><div class="rich-container-actions"><button type="button" data-up title="Move up">↑</button><button type="button" data-down title="Move down">↓</button><button type="button" data-remove title="Remove">×</button></div></div><div class="rich-grid"><label class="wide">Text<textarea data-key="text" maxlength="4000">' + escapeHtml(item.text) + '</textarea></label><label>Color<input data-key="accentColor" type="color" value="' + escapeHtml(item.accentColor) + '"></label><label>Thumbnail URL<input data-key="thumbnailUrl" type="text" maxlength="2000" value="' + escapeHtml(item.thumbnailUrl) + '"></label><label class="wide">Image URL<input data-key="imageUrl" type="text" maxlength="2000" value="' + escapeHtml(item.imageUrl) + '"></label></div></article>').join('') : '<div class="rich-empty">No containers</div>') + '</div>'
        + '<button class="rich-add" type="button" data-add ' + (value.containers.length >= 8 ? 'disabled' : '') + '>+ Add container</button></section>'
        + '<aside class="rich-editor-preview"><h3 class="rich-preview-title">Live preview</h3><div data-rich-preview></div></aside></div>';
      preview();
    }

    function focusedTextarea() {
      const active = document.activeElement;
      return root.contains(active) && active.tagName === 'TEXTAREA' ? active : root.querySelector('[data-root]');
    }

    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-root]')) value.content = event.target.value;
      const card = event.target.closest('[data-index]');
      if (card && event.target.dataset.key) value.containers[Number(card.dataset.index)][event.target.dataset.key] = event.target.value;
      changed();
      preview();
    });
    root.addEventListener('change', (event) => {
      if (event.target.matches('[data-token]') && event.target.value) {
        const textarea = focusedTextarea();
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || start;
        textarea.value = textarea.value.slice(0, start) + event.target.value + textarea.value.slice(end);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + event.target.value.length;
        event.target.value = '';
      }
    });
    root.addEventListener('click', (event) => {
      const card = event.target.closest('[data-index]');
      const index = Number(card?.dataset.index);
      if (event.target.closest('[data-add]')) {
        if (value.containers.length < 8) value.containers.push({ id: 'container-' + Date.now(), text: '', accentColor: '#5865F2', thumbnailUrl: '', imageUrl: '' });
      } else if (card && event.target.closest('[data-remove]')) value.containers.splice(index, 1);
      else if (card && event.target.closest('[data-up]') && index > 0) [value.containers[index - 1], value.containers[index]] = [value.containers[index], value.containers[index - 1]];
      else if (card && event.target.closest('[data-down]') && index < value.containers.length - 1) [value.containers[index + 1], value.containers[index]] = [value.containers[index], value.containers[index + 1]];
      else return;
      changed();
      render();
    });
    render();
    return {
      getValue: () => clone(value),
      setValue: (next) => { value = normalize(next); render(); },
    };
  }

  window.CoinSpriteRichEditor = { mount, normalize };
  window.dispatchEvent(new Event('coinsprite:rich-editor-ready'));
})();
