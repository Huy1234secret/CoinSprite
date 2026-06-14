(() => {
  const CSS = '/admin/message-inline-editor.css';
  const PALETTE = ['#FFFFFF', '#5865F2', '#57F287', '#FEE75C', '#ED4245', '#EB459E', '#9B59B6', '#2B2D31', '#3498DB', '#1ABC9C', '#E67E22', '#99AAB5'];
  let scheduled = false;
  let uid = 0;
  let colorMenu = null;
  let mediaMenu = null;

  const nextId = (prefix) => `${prefix}-${++uid}`;
  const validHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const toHex = (value) => (validHex(value) ? String(value).trim().toUpperCase() : '#FFFFFF');
  const cleanHex = (value) => {
    const cleaned = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(cleaned) ? `#${cleaned.toUpperCase()}` : '';
  };

  function loadCss() {
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS;
      document.head.append(link);
    }
  }

  function identify(field, prefix = 'admin-field') {
    if (!field || !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) return;
    if (!field.id) field.id = nextId(prefix);
    if (!field.name) field.name = field.id;
    if (field.tagName === 'INPUT' && !field.autocomplete) field.autocomplete = 'off';
  }

  function identifyAll() {
    document.querySelectorAll('input, select, textarea').forEach(identify);
  }

  function fieldsFor(preview) {
    if (preview.id === 'levelUpPreviewContainer' || preview.closest('#levelUpPreview')) {
      const form = document.querySelector('#configForm');
      return {
        content: document.querySelector('#levelUpContent'),
        color: form?.elements?.['xp.levelUpMessage.accentColor'],
        thumb: form?.elements?.['xp.levelUpMessage.thumbnailUrl'],
        image: form?.elements?.['xp.levelUpMessage.imageUrl'],
      };
    }
    const box = preview.closest('.ticket-message-builder');
    return {
      content: box?.querySelector('textarea[data-message-scope]'),
      color: box?.querySelector('[data-message-field="accentColor"]'),
      thumb: box?.querySelector('[data-message-field="thumbnailUrl"]'),
      image: box?.querySelector('[data-message-field="imageUrl"]'),
    };
  }

  function hideSourceField(field) {
    identify(field, 'message-source');
    const label = field?.closest('label');
    if (label) {
      label.hidden = true;
      label.classList.add('message-source-hidden');
    }
  }

  function hideSources() {
    document.querySelectorAll('.ticket-message-builder, .message-builder').forEach((builder) => {
      if (builder.querySelector('textarea[data-message-scope], #levelUpContent') && builder.querySelector('.preview-container.ticket-preview, #levelUpPreviewContainer')) {
        builder.classList.add('inline-message-mode');
      }
    });
    document.querySelectorAll('.ticket-message-builder textarea[data-message-scope], #levelUpContent').forEach(hideSourceField);
    document.querySelectorAll('.ticket-message-builder [data-message-field="accentColor"], .ticket-message-builder [data-message-field="thumbnailUrl"], .ticket-message-builder [data-message-field="imageUrl"], input[name="xp.levelUpMessage.accentColor"], input[name="xp.levelUpMessage.thumbnailUrl"], input[name="xp.levelUpMessage.imageUrl"]').forEach(hideSourceField);
    document.querySelectorAll('.message-editor .grid').forEach((grid) => {
      if (grid.querySelector('[data-message-field="accentColor"], [data-message-field="thumbnailUrl"], [data-message-field="imageUrl"], input[name="xp.levelUpMessage.accentColor"], input[name="xp.levelUpMessage.thumbnailUrl"], input[name="xp.levelUpMessage.imageUrl"]')) {
        grid.hidden = true;
        grid.classList.add('message-source-hidden');
      }
    });
  }

  function emit(field) {
    if (!field) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    schedule();
  }

  function setField(field, value) {
    if (!field) return;
    field.value = value;
    emit(field);
  }

  function closeMenus() {
    colorMenu?.remove();
    mediaMenu?.remove();
    colorMenu = null;
    mediaMenu = null;
  }

  function place(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    const pad = 12;
    const w = Math.min(320, window.innerWidth - pad * 2);
    menu.style.width = `${w}px`;
    document.body.append(menu);
    const h = menu.offsetHeight || 260;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - pad) top = r.top - h - 8;
    menu.style.left = `${Math.min(Math.max(pad, r.left), window.innerWidth - w - pad)}px`;
    menu.style.top = `${Math.min(Math.max(pad, top), window.innerHeight - h - pad)}px`;
  }

  function button(className, text) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    return node;
  }

  function openColor(field, anchor) {
    if (!field) return;
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'message-color-popover open';
    const swatches = document.createElement('div');
    swatches.className = 'message-color-swatches';
    PALETTE.forEach((color) => {
      const item = button(`message-color-swatch${toHex(field.value) === color ? ' selected' : ''}`, '');
      item.style.setProperty('--swatch', color);
      item.setAttribute('aria-label', color);
      item.addEventListener('click', () => {
        setField(field, color);
        closeMenus();
      });
      swatches.append(item);
    });
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    const labelText = document.createElement('span');
    labelText.textContent = 'Custom hex color';
    const row = document.createElement('div');
    row.className = 'message-color-custom';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 7;
    input.placeholder = '#FFFFFF';
    input.value = toHex(field.value);
    identify(input, 'message-color');
    const apply = button('message-color-apply', 'Apply');
    const close = button('message-color-apply', 'Close');
    const save = () => {
      const value = cleanHex(input.value);
      if (!value) return input.focus({ preventScroll: true });
      setField(field, value);
      closeMenus();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') closeMenus();
    });
    apply.addEventListener('click', save);
    close.addEventListener('click', closeMenus);
    row.append(input, apply, close);
    label.append(labelText, row);
    const help = document.createElement('p');
    help.className = 'message-popover-help';
    help.textContent = 'Preset or custom hex color. This menu is fixed to the page so it will not be cut off.';
    menu.append(swatches, label, help);
    menu.addEventListener('click', (event) => event.stopPropagation());
    colorMenu = menu;
    place(menu, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function mediaPreview(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('<avatar_url>')) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  function openMedia(field, anchor, kind) {
    if (!field) return;
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'message-media-popover open';
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    const text = document.createElement('span');
    text.textContent = kind === 'thumb' ? 'Thumbnail URL' : 'Image URL';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value || '';
    input.placeholder = kind === 'thumb' ? '<avatar_url> or https://example.com/avatar.png' : 'https://example.com/banner.png';
    identify(input, `message-${kind}`);
    label.append(text, input);
    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    actions.append(document.createElement('span'));
    const clear = button('message-media-clear-button', 'Clear');
    const save = button('message-media-apply', 'Save');
    actions.append(clear, save);
    const set = (value) => { setField(field, String(value || '').trim()); closeMenus(); };
    save.addEventListener('click', () => set(input.value));
    clear.addEventListener('click', () => set(''));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); set(input.value); }
      if (event.key === 'Escape') closeMenus();
    });
    const help = document.createElement('p');
    help.className = 'message-popover-help';
    help.textContent = 'Leave empty to remove it. Placeholders like <avatar_url> are supported.';
    menu.append(label, actions, help);
    menu.addEventListener('click', (event) => event.stopPropagation());
    mediaMenu = menu;
    place(menu, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function mediaButton(field, kind) {
    const value = String(field?.value || '').trim();
    const node = button(`preview-media-edit ${kind === 'thumb' ? 'thumbnail' : 'image'}${value ? ' has-value' : ''}`, '');
    const title = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    node.title = title;
    node.setAttribute('aria-label', title);
    const url = mediaPreview(value);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        node.classList.remove('has-value');
        node.append(emptyMedia(kind, value));
      }, { once: true });
      node.append(img);
    } else {
      node.append(emptyMedia(kind, value));
    }
    if (value) {
      const x = document.createElement('span');
      x.className = 'preview-media-clear';
      x.textContent = '×';
      x.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation(); setField(field, '');
      });
      node.append(x);
    }
    node.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); openMedia(field, node, kind);
    });
    return node;
  }

  function emptyMedia(kind, hasValue) {
    const wrap = document.createElement('span');
    wrap.className = 'preview-media-empty';
    const strong = document.createElement('strong');
    strong.textContent = `${hasValue ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    const small = document.createElement('span');
    small.textContent = hasValue ? 'Preview unavailable' : 'Click to set URL';
    wrap.append(strong, small);
    return wrap;
  }

  function normalizeEditorText(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '');
  }

  function openEditor(preview) {
    const source = fieldsFor(preview).content;
    if (!source || preview.querySelector('.preview-live-editor')) return;
    closeMenus();
    const original = source.value || '';
    preview.classList.add('is-direct-editing');
    preview.replaceChildren();
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
      source.value = commit ? normalizeEditorText(editor.innerText || editor.textContent || '') : original;
      preview.classList.remove('is-direct-editing');
      emit(source);
    };
    editor.addEventListener('input', () => {
      source.value = normalizeEditorText(editor.innerText || editor.textContent || '');
      if (typeof refreshDirtyState === 'function') refreshDirtyState();
    });
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('commit-preview', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    preview.append(bar, editor);
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  function decoratePreview(preview) {
    const fields = fieldsFor(preview);
    if (!fields.content || preview.querySelector('.preview-live-editor')) return;
    preview.querySelectorAll('.preview-accent-picker, .preview-media-edit').forEach((node) => node.remove());
    preview.classList.add('message-direct-ready');
    preview.classList.toggle('has-preview-thumbnail', Boolean(fields.thumb));
    preview.tabIndex = 0;
    if (fields.color) {
      const accent = button('preview-accent-picker', '');
      accent.style.setProperty('--preview-accent', toHex(fields.color.value));
      accent.title = 'Change container color';
      accent.setAttribute('aria-label', 'Change container color');
      accent.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openColor(fields.color, accent); });
      preview.prepend(accent);
    }
    if (fields.thumb) preview.append(mediaButton(fields.thumb, 'thumb'));
    if (fields.image) preview.append(mediaButton(fields.image, 'image'));
    if (preview.dataset.inlineEditBound !== 'true') {
      preview.dataset.inlineEditBound = 'true';
      preview.addEventListener('click', (event) => {
        if (event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
        openEditor(preview);
      });
      preview.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); openEditor(preview); }
      });
    }
    const panel = preview.closest('.preview-panel');
    if (panel && !panel.querySelector('.message-live-hint')) {
      const hint = document.createElement('p');
      hint.className = 'message-live-hint';
      hint.textContent = 'Click the preview text to edit. Click the color bar, thumbnail box, or image box to edit those fields.';
      panel.querySelector('.panel-heading')?.append(hint);
    }
  }

  function decorate() {
    loadCss();
    identifyAll();
    hideSources();
    document.querySelectorAll('.ticket-message-builder .preview-container.ticket-preview, #levelUpPreviewContainer').forEach(decoratePreview);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; decorate(); });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.message-color-popover, .message-media-popover, .preview-accent-picker, .preview-media-edit')) closeMenus();
  });
  window.addEventListener('resize', closeMenus);
  window.addEventListener('scroll', closeMenus, true);
  document.querySelector('#saveButton')?.addEventListener('mousedown', () => {
    document.querySelectorAll('.preview-live-editor').forEach((editor) => editor.dispatchEvent(new Event('commit-preview', { bubbles: true })));
  }, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();