(() => {
  const CSS = '/admin/message-inline-editor.css';
  const PALETTE = ['#FFFFFF', '#5865F2', '#57F287', '#FEE75C', '#ED4245', '#EB459E', '#9B59B6', '#2B2D31', '#3498DB', '#1ABC9C', '#E67E22', '#99AAB5'];
  let uid = 0;
  let queued = false;
  let popover = null;

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const hex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '#FFFFFF';
  const cleanHex = (v) => {
    const x = String(v || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(x) ? `#${x.toUpperCase()}` : '';
  };

  function loadCss() {
    if (!qs(`link[href="${CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS;
      document.head.append(link);
    }
    if (!qs('link[href="/admin/messages.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/admin/messages.css';
      document.head.append(link);
    }
  }

  function ensureMessagesTab() {
    const tabs = qs('#tabList');
    const form = qs('#configForm');
    if (tabs && !qs('[data-tab="messages"]', tabs)) {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.type = 'button';
      tab.dataset.tab = 'messages';
      tab.innerHTML = '<img class="tab-icon" src="/admin/images/message.png" alt="" aria-hidden="true"><span>Messages</span>';
      (qs('[data-tab="tickets"]', tabs) || tabs.lastElementChild)?.after(tab);
    }
    if (form && !qs('[data-panel="messages"]', form)) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'messages';
      panel.innerHTML = '<div id="messageTemplatesRoot"></div>';
      (qs('[data-panel="tickets"]', form) || form.lastElementChild)?.after(panel);
    }
    if (qs('#messageTemplatesRoot') && !qs('script[src="/admin/messages.js"]')) {
      const script = document.createElement('script');
      script.src = '/admin/messages.js';
      script.defer = true;
      document.body.append(script);
    }
  }

  function id(field) {
    if (!field || !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) return;
    if (!field.id) field.id = `admin-field-${++uid}`;
    if (!field.name) field.name = field.id;
    if (field.tagName === 'INPUT' && !field.autocomplete) field.autocomplete = 'off';
  }

  function fields(preview) {
    if (!preview) return {};
    if (preview.id === 'levelUpPreviewContainer' || preview.closest('#levelUpPreview')) {
      const form = qs('#configForm');
      return {
        content: qs('#levelUpContent'),
        color: form?.elements?.['xp.levelUpMessage.accentColor'],
        thumb: form?.elements?.['xp.levelUpMessage.thumbnailUrl'],
        image: form?.elements?.['xp.levelUpMessage.imageUrl'],
      };
    }
    const box = preview.closest('.ticket-message-builder, .message-builder');
    return {
      content: qs('textarea[data-message-scope]', box),
      color: qs('[data-message-field="accentColor"]', box),
      thumb: qs('[data-message-field="thumbnailUrl"]', box),
      image: qs('[data-message-field="imageUrl"]', box),
    };
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

  function closePopover() {
    popover?.remove();
    popover = null;
  }

  function place(node, anchor) {
    const r = anchor.getBoundingClientRect();
    const pad = 12;
    const w = Math.min(360, window.innerWidth - pad * 2);
    node.style.width = `${w}px`;
    document.body.append(node);
    const h = node.offsetHeight || 260;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - pad) top = r.top - h - 8;
    if (top < pad) top = pad;
    node.style.left = `${Math.min(Math.max(pad, r.left), window.innerWidth - w - pad)}px`;
    node.style.top = `${Math.min(Math.max(pad, top), window.innerHeight - h - pad)}px`;
  }

  function btn(cls, text = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function placeNativeColorInput(input, anchor) {
    const r = anchor.getBoundingClientRect();
    const size = Math.max(34, Math.min(46, Math.max(r.width || 0, r.height || 0)));
    const left = Math.min(Math.max(8, r.left), window.innerWidth - size - 8);
    const top = Math.min(Math.max(8, r.top), window.innerHeight - size - 8);
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${size}px`;
    input.style.height = `${size}px`;
  }

  function updatePreviewAccent(anchor, value) {
    anchor?.style?.setProperty('--preview-accent', value);
    const preview = anchor?.closest?.('.preview-container,.message-preview-container');
    preview?.style?.setProperty('--preview-accent', value);
    preview?.style?.setProperty('--container-color', value);
  }

  function openNativeColor(field, anchor) {
    if (!field) return;
    closePopover();
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'message-native-color-input';
    input.value = hex(field.value);
    id(input);
    placeNativeColorInput(input, anchor);
    document.body.append(input);
    popover = input;
    const commit = () => {
      const value = hex(input.value);
      setField(field, value);
      updatePreviewAccent(anchor, value);
    };
    input.addEventListener('input', commit);
    input.addEventListener('change', () => { commit(); setTimeout(closePopover, 250); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
    input.addEventListener('blur', () => setTimeout(() => { if (popover === input) closePopover(); }, 60000), { once: true });
    input.focus({ preventScroll: true });
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  }

  function openColor(field, anchor) {
    openNativeColor(field, anchor);
  }

  function messageTemplateColorField(anchor) {
    const root = qs('#messageTemplatesRoot');
    const index = Number(anchor?.dataset?.index);
    if (!root || !Number.isFinite(index)) return null;
    return qs(`[data-container-index="${index}"] [data-container-field="accentColor"]`, root);
  }

  function previewUrl(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    if (raw.includes('<avatar_url>')) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; }
  }

  function openMedia(field, anchor, kind) {
    if (!field) return;
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-media-popover open';
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    label.append(document.createTextNode(kind === 'thumb' ? 'Thumbnail URL' : 'Image URL'));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value || '';
    input.placeholder = kind === 'thumb' ? '<avatar_url> or https://example.com/avatar.png' : 'https://example.com/banner.png';
    id(input);
    label.append(input);
    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    actions.append(document.createElement('span'));
    const clear = btn('message-media-clear-button', 'Clear');
    const save = btn('message-media-apply', 'Save');
    actions.append(clear, save);
    const set = (v) => { setField(field, String(v || '').trim()); closePopover(); };
    clear.addEventListener('click', () => set(''));
    save.addEventListener('click', () => set(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set(input.value); } if (e.key === 'Escape') closePopover(); });
    box.append(label, actions);
    box.addEventListener('click', (e) => e.stopPropagation());
    popover = box;
    place(box, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function mediaButton(field, kind) {
    const value = String(field?.value || '').trim();
    const b = btn(`preview-media-edit ${kind === 'thumb' ? 'thumbnail' : 'image'}${value ? ' has-value' : ''}`);
    b.dataset.inlineMessageAction = kind;
    b.title = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    b.ariaLabel = b.title;
    const url = previewUrl(value);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => { img.remove(); b.classList.remove('has-value'); b.append(empty(kind, value)); }, { once: true });
      b.append(img);
    } else b.append(empty(kind, value));
    if (value) {
      const x = document.createElement('span');
      x.className = 'preview-media-clear';
      x.dataset.inlineMessageAction = `${kind}-clear`;
      x.textContent = '×';
      b.append(x);
    }
    return b;
  }

  function empty(kind, value) {
    const wrap = document.createElement('span');
    wrap.className = 'preview-media-empty';
    const strong = document.createElement('strong');
    strong.textContent = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    const small = document.createElement('span');
    small.textContent = value ? 'Preview unavailable' : 'Click to set URL';
    wrap.append(strong, small);
    return wrap;
  }

  function finish(editor, commit) {
    if (!editor || editor.dataset.done === 'true') return;
    const overlay = editor.closest('.preview-inline-overlay');
    const preview = editor.closest('.preview-container');
    const source = fields(preview).content;
    if (!preview || !source) return;
    editor.dataset.done = 'true';
    const original = preview.dataset.editorOriginal || source.value || '';
    source.value = commit ? String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '') : original;
    delete preview.dataset.editorOriginal;
    preview.classList.remove('is-direct-editing');
    overlay?.remove();
    emit(source);
  }

  function closeEditors(commit) {
    qsa('.preview-inline-overlay .preview-live-editor').forEach((editor) => finish(editor, commit));
    closePopover();
  }

  function openEditor(preview) {
    const source = fields(preview).content;
    if (!source || preview.querySelector('.preview-inline-overlay')) return;
    closePopover();
    preview.dataset.editorOriginal = source.value || '';
    preview.classList.add('is-direct-editing');
    const overlay = document.createElement('div');
    overlay.className = 'preview-inline-overlay';
    const bar = document.createElement('div');
    bar.className = 'preview-edit-toolbar';
    bar.innerHTML = '<strong>Editing message</strong><span>Ctrl/⌘ + Enter to finish · Esc to cancel</span>';
    const editor = document.createElement('div');
    editor.className = 'preview-live-editor';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = source.value || '';
    editor.addEventListener('input', () => { source.value = String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n'); if (typeof refreshDirtyState === 'function') refreshDirtyState(); });
    editor.addEventListener('blur', () => finish(editor, true));
    editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); editor.blur(); } if (e.key === 'Escape') { e.preventDefault(); finish(editor, false); } });
    overlay.append(bar, editor);
    preview.append(overlay);
    requestAnimationFrame(() => { editor.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); });
  }

  function decoratePreview(preview) {
    const f = fields(preview);
    if (!f.content || preview.querySelector('.preview-inline-overlay')) return;
    qsa('.preview-accent-picker,.preview-media-edit', preview).forEach((n) => n.remove());
    preview.classList.add('message-direct-ready');
    preview.classList.toggle('has-preview-thumbnail', Boolean(f.thumb));
    preview.tabIndex = 0;
    if (f.color) {
      preview.style.setProperty('--preview-accent', hex(f.color.value));
      const bar = btn('preview-accent-picker');
      bar.dataset.inlineMessageAction = 'color';
      bar.style.setProperty('--preview-accent', hex(f.color.value));
      bar.title = 'Change container color';
      bar.ariaLabel = bar.title;
      preview.prepend(bar);
    }
    if (f.thumb) preview.append(mediaButton(f.thumb, 'thumb'));
    if (f.image) preview.append(mediaButton(f.image, 'image'));
    const panel = preview.closest('.preview-panel');
    if (panel && !qs('.message-live-hint', panel)) {
      const hint = document.createElement('p');
      hint.className = 'message-live-hint';
      hint.textContent = 'Click the preview text to edit. Click the color bar, thumbnail box, or image box to edit those fields.';
      qs('.panel-heading', panel)?.append(hint);
    }
  }

  function decorate() {
    loadCss();
    ensureMessagesTab();
    qsa('input,select,textarea').forEach(id);
    qsa('.ticket-message-builder,.message-builder').forEach((builder) => {
      if (qs('textarea[data-message-scope],#levelUpContent', builder) && qs('.preview-container.ticket-preview,#levelUpPreviewContainer', builder)) builder.classList.add('inline-message-mode');
    });
    qsa('.ticket-message-builder textarea[data-message-scope],#levelUpContent,.ticket-message-builder [data-message-field="accentColor"],.ticket-message-builder [data-message-field="thumbnailUrl"],.ticket-message-builder [data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]').forEach((field) => field.closest('label')?.classList.add('message-source-hidden'));
    qsa('.message-editor .grid').forEach((grid) => { if (qs('[data-message-field="accentColor"],[data-message-field="thumbnailUrl"],[data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]', grid)) grid.classList.add('message-source-hidden'); });
    qsa('.ticket-message-builder .preview-container.ticket-preview,#levelUpPreviewContainer').forEach(decoratePreview);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }

  function actionEvent(e) {
    const a = e.target.closest?.('[data-inline-message-action]');
    if (!a) return false;
    const preview = a.closest('.preview-container');
    const f = fields(preview);
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (a.dataset.inlineMessageAction === 'color') openColor(f.color, a);
    if (a.dataset.inlineMessageAction === 'thumb') openMedia(f.thumb, a, 'thumb');
    if (a.dataset.inlineMessageAction === 'image') openMedia(f.image, a, 'image');
    if (a.dataset.inlineMessageAction === 'thumb-clear') setField(f.thumb, '');
    if (a.dataset.inlineMessageAction === 'image-clear') setField(f.image, '');
    return true;
  }

  document.addEventListener('pointerdown', actionEvent, true);
  document.addEventListener('click', (e) => {
    const messageColor = e.target.closest?.('.preview-accent-picker[data-message-action="preview-color"]');
    if (messageColor) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openNativeColor(messageTemplateColorField(messageColor), messageColor);
      return;
    }
    if (actionEvent(e)) return;
    const preview = e.target.closest?.('.preview-container.message-direct-ready,.preview-container.ticket-preview,#levelUpPreviewContainer');
    if (preview && !e.target.closest('button,input,select,textarea,a,[contenteditable="true"],.message-color-popover,.message-media-popover')) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); openEditor(preview); return;
    }
    if (!e.target.closest?.('.message-color-popover,.message-media-popover,.preview-accent-picker,.preview-media-edit')) closePopover();
  }, true);
  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
  qs('#saveButton')?.addEventListener('mousedown', () => closeEditors(true), true);
  qs('#resetTabButton')?.addEventListener('mousedown', () => { closeEditors(false); setTimeout(schedule, 0); }, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
