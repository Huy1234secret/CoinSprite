(() => {
  const CSS = '/admin/message-inline-editor.css';
  let uid = 0;
  let queued = false;
  let popover = null;
  let colorInput = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const hex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : '#FFFFFF';

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

  function assignId(field) {
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
    const builder = preview.closest('.ticket-message-builder');
    return {
      content: qs('textarea[data-message-scope]', builder),
      color: qs('[data-message-field="accentColor"]', builder),
      thumb: qs('[data-message-field="thumbnailUrl"]', builder),
      image: qs('[data-message-field="imageUrl"]', builder),
    };
  }

  function messageTemplateField(anchor, fieldName) {
    const root = qs('#messageTemplatesRoot');
    const index = Number(anchor?.dataset?.index ?? anchor?.closest?.('[data-preview-container-index]')?.dataset?.previewContainerIndex);
    if (!root || !Number.isFinite(index)) return null;
    return qs(`[data-container-index="${index}"] [data-container-field="${fieldName}"]`, root);
  }

  function decorateMessageTemplatePreview() {
    const root = qs('#messageTemplatesRoot');
    if (!root) return;
    qsa('.message-preview-container[data-preview-container-index]', root).forEach((preview) => {
      if (qs('.preview-container-remove', preview)) return;
      const index = preview.dataset.previewContainerIndex;
      const remove = button('preview-container-remove', '×');
      remove.dataset.messageAction = 'remove-container';
      remove.dataset.index = index;
      remove.title = 'Remove container';
      remove.ariaLabel = 'Remove container';
      preview.append(remove);
    });
  }

  function emit(field) {
    if (!field) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
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
    if (colorInput) {
      colorInput.remove();
      colorInput = null;
    }
  }

  function place(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const pad = 12;
    const width = Math.min(380, window.innerWidth - pad * 2);
    node.style.width = `${width}px`;
    document.body.append(node);
    const height = node.offsetHeight || 220;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - pad) top = rect.top - height - 8;
    if (top < pad) top = pad;
    node.style.left = `${Math.min(Math.max(pad, rect.left), window.innerWidth - width - pad)}px`;
    node.style.top = `${Math.min(Math.max(pad, top), window.innerHeight - height - pad)}px`;
  }

  function button(className, text = '') {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = className;
    item.textContent = text;
    return item;
  }

  function previewUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('<avatar_url>')) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
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
    assignId(input);
    const rect = anchor.getBoundingClientRect();
    input.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 48))}px`;
    input.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 48))}px`;
    document.body.append(input);
    colorInput = input;
    const commit = () => {
      const value = hex(input.value);
      setField(field, value);
      updatePreviewAccent(anchor, value);
    };
    input.addEventListener('input', commit);
    input.addEventListener('change', () => { commit(); setTimeout(closePopover, 200); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePopover(); });
    input.addEventListener('blur', () => setTimeout(() => { if (colorInput === input) closePopover(); }, 60000), { once: true });
    input.focus({ preventScroll: true });
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  }

  function openMedia(field, anchor, kind) {
    if (!field) return;
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-media-popover open';
    const title = document.createElement('div');
    title.className = 'message-popover-title';
    title.innerHTML = `<strong>${kind === 'thumb' ? 'Thumbnail' : 'Image'} URL</strong><span>Use an http(s) URL. Placeholders like &lt;avatar_url&gt; are supported.</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value || '';
    input.placeholder = kind === 'thumb' ? '<avatar_url> or https://example.com/avatar.png' : 'https://example.com/banner.png';
    assignId(input);

    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    const clear = button('message-media-clear-button', 'Clear');
    const cancel = button('message-media-clear-button neutral', 'Cancel');
    const save = button('message-media-apply', 'Save');
    actions.append(clear, cancel, save);

    const set = (value) => {
      setField(field, String(value || '').trim());
      closePopover();
    };
    clear.addEventListener('click', () => set(''));
    cancel.addEventListener('click', closePopover);
    save.addEventListener('click', () => set(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); set(input.value); }
      if (event.key === 'Escape') closePopover();
    });
    box.append(title, input, actions);
    box.addEventListener('click', (event) => event.stopPropagation());
    popover = box;
    place(box, anchor);
    input.focus({ preventScroll: true });
    input.select();
  }

  function emptyMedia(kind, value) {
    const wrap = document.createElement('span');
    wrap.className = 'preview-media-empty';
    const plus = document.createElement('span');
    plus.className = 'preview-media-plus';
    plus.textContent = '+';
    const strong = document.createElement('strong');
    strong.textContent = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    const small = document.createElement('span');
    small.textContent = value ? 'Preview unavailable' : 'Click to set URL';
    wrap.append(plus, strong, small);
    return wrap;
  }

  function mediaButton(field, kind) {
    const value = String(field?.value || '').trim();
    const item = button(`preview-media-edit ${kind === 'thumb' ? 'thumbnail' : 'image'}${value ? ' has-value' : ''}`);
    item.dataset.inlineMessageAction = kind;
    item.title = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    item.ariaLabel = item.title;

    const url = previewUrl(value);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        item.classList.remove('has-value');
        item.append(emptyMedia(kind, value));
      }, { once: true });
      item.append(img);
    } else {
      item.append(emptyMedia(kind, value));
    }
    if (value) {
      const clear = document.createElement('span');
      clear.className = 'preview-media-clear';
      clear.dataset.inlineMessageAction = `${kind}-clear`;
      clear.title = `Clear ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
      clear.textContent = '×';
      item.append(clear);
    }
    return item;
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
    const title = document.createElement('strong');
    title.textContent = 'Editing message';
    const hint = document.createElement('span');
    hint.textContent = 'Ctrl/⌘ + Enter to finish · Esc to cancel';
    bar.append(title, hint);
    const editor = document.createElement('div');
    editor.className = 'preview-live-editor';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = source.value || '';
    editor.addEventListener('input', () => {
      source.value = String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n');
      if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
    });
    editor.addEventListener('blur', () => finish(editor, true));
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(editor, false); }
    });
    overlay.append(bar, editor);
    preview.append(overlay);
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
    const f = fields(preview);
    if (!f.content || preview.querySelector('.preview-inline-overlay')) return;
    qsa('.preview-accent-picker,.preview-media-edit', preview).forEach((node) => node.remove());

    preview.classList.add('message-direct-ready');
    preview.classList.toggle('has-preview-thumbnail', Boolean(f.thumb));
    preview.tabIndex = 0;

    if (f.color) {
      preview.style.setProperty('--preview-accent', hex(f.color.value));
      preview.style.setProperty('--container-color', hex(f.color.value));
      const bar = button('preview-accent-picker');
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
      hint.textContent = 'Click the preview text to edit. Click the color bar, thumbnail, or image area to edit those fields.';
      qs('.panel-heading', panel)?.append(hint);
    }
  }

  function decorate() {
    loadCss();
    ensureMessagesTab();
    qsa('input,select,textarea').forEach(assignId);

    qsa('.ticket-message-builder').forEach((builder) => {
      if (qs('textarea[data-message-scope]', builder) && qs('.preview-container.ticket-preview', builder)) {
        builder.classList.add('inline-message-mode');
      }
    });
    const levelBuilder = qs('#levelUpPreviewContainer')?.closest('.message-builder');
    if (levelBuilder && qs('#levelUpContent')) levelBuilder.classList.add('inline-message-mode');

    qsa('.ticket-message-builder textarea[data-message-scope],#levelUpContent,.ticket-message-builder [data-message-field="accentColor"],.ticket-message-builder [data-message-field="thumbnailUrl"],.ticket-message-builder [data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]').forEach((field) => {
      field.closest('label')?.classList.add('message-source-hidden');
    });
    qsa('.message-editor .grid').forEach((grid) => {
      if (qs('[data-message-field="accentColor"],[data-message-field="thumbnailUrl"],[data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]', grid)) {
        grid.classList.add('message-source-hidden');
      }
    });
    qsa('.ticket-message-builder .preview-container.ticket-preview,#levelUpPreviewContainer').forEach(decoratePreview);
    decorateMessageTemplatePreview();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }

  function actionEvent(event) {
    const action = event.target.closest?.('[data-inline-message-action]');
    if (!action) return false;
    const preview = action.closest('.preview-container');
    const f = fields(preview);
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const name = action.dataset.inlineMessageAction;
    if (name === 'color') openNativeColor(f.color, action);
    if (name === 'thumb') openMedia(f.thumb, action, 'thumb');
    if (name === 'image') openMedia(f.image, action, 'image');
    if (name === 'thumb-clear') setField(f.thumb, '');
    if (name === 'image-clear') setField(f.image, '');
    return true;
  }

  document.addEventListener('click', (event) => {
    const messageAction = event.target.closest?.('[data-message-action="preview-color"],[data-message-action="preview-media"],[data-message-action="preview-media-clear"]');
    if (messageAction) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      const action = messageAction.dataset.messageAction;
      if (action === 'preview-color') openNativeColor(messageTemplateField(messageAction, 'accentColor'), messageAction);
      if (action === 'preview-media') openMedia(messageTemplateField(messageAction, messageAction.dataset.field), messageAction, messageAction.dataset.field === 'thumbnailUrl' ? 'thumb' : 'image');
      if (action === 'preview-media-clear') setField(messageTemplateField(messageAction, messageAction.dataset.field), '');
      return;
    }
    if (actionEvent(event)) return;
    const preview = event.target.closest?.('.preview-container.message-direct-ready,.preview-container.ticket-preview,#levelUpPreviewContainer');
    if (preview && !event.target.closest('button,input,select,textarea,a,[contenteditable="true"],.message-media-popover,.message-native-color-input')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      openEditor(preview);
      return;
    }
    if (!event.target.closest?.('.message-media-popover,.message-native-color-input,.preview-accent-picker,.preview-media-edit')) closePopover();
  }, true);

  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
  qs('#saveButton')?.addEventListener('mousedown', () => closeEditors(true), true);
  qs('#resetTabButton')?.addEventListener('mousedown', () => { closeEditors(false); closePopover(); setTimeout(schedule, 0); }, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();