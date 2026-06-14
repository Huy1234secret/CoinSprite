(() => {
  const POLISH_CSS = '/admin/message-preview-polish.css';
  let popover = null;
  let colorInput = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const hex = (value) => isHex(value) ? String(value).trim().toUpperCase() : '#FFFFFF';

  function ensureCss() {
    let link = qs(`link[href="${POLISH_CSS}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = POLISH_CSS;
      document.head.append(link);
    } else if (document.head.lastElementChild !== link) {
      link.remove();
      document.head.append(link);
    }
  }

  function assignIdentity(input, prefix = 'preview-field') {
    if (!input) return;
    if (!input.id) input.id = `${prefix}-${Math.random().toString(36).slice(2)}`;
    if (!input.name) input.name = input.id;
    if (!input.autocomplete) input.autocomplete = 'off';
  }

  function emit(field) {
    if (!field) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
  }

  function setField(field, value) {
    if (!field) return;
    field.value = value;
    emit(field);
  }

  function closePopover() {
    popover?.remove();
    popover = null;
    colorInput?.remove();
    colorInput = null;
  }

  function fieldsForPreview(preview) {
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

  function buildMediaButton(field, kind) {
    const value = String(field?.value || '').trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `preview-media-edit ${kind === 'thumb' ? 'thumbnail' : 'image'}${value ? ' has-value' : ''}`;
    button.dataset.inlineMessageAction = kind;
    button.ariaLabel = `${value ? 'Edit' : 'Add'} ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
    button.title = button.ariaLabel;
    const url = previewUrl(value);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        button.classList.remove('has-value');
        button.append(emptyMedia(kind, value));
      }, { once: true });
      button.append(img);
    } else {
      button.append(emptyMedia(kind, value));
    }
    if (value) {
      const clear = document.createElement('span');
      clear.className = 'preview-media-clear';
      clear.dataset.inlineMessageAction = `${kind}-clear`;
      clear.title = `Clear ${kind === 'thumb' ? 'thumbnail' : 'image'}`;
      clear.textContent = '×';
      button.append(clear);
    }
    return button;
  }

  function decorateTicketAndLevelPreview(preview) {
    const fields = fieldsForPreview(preview);
    if (!fields.content) return;
    preview.classList.add('message-direct-ready');
    const color = hex(fields.color?.value);
    preview.style.setProperty('--preview-accent', color);
    preview.style.setProperty('--container-color', color);

    let bar = qs(':scope > .preview-accent-picker', preview);
    if (fields.color && !bar) {
      bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'preview-accent-picker';
      bar.dataset.inlineMessageAction = 'color';
      bar.ariaLabel = 'Change container color';
      bar.title = 'Change container color';
      preview.prepend(bar);
    }
    if (bar) bar.style.setProperty('--preview-accent', color);

    if (fields.thumb && !qs(':scope > .preview-media-edit.thumbnail', preview)) {
      preview.append(buildMediaButton(fields.thumb, 'thumb'));
    }
    if (fields.image && !qs(':scope > .preview-media-edit.image', preview)) {
      preview.append(buildMediaButton(fields.image, 'image'));
    }
  }

  function decorate() {
    ensureCss();
    qsa('input, textarea, select').forEach(assignIdentity);
    qsa('.ticket-message-builder .preview-container.ticket-preview, #levelUpPreviewContainer').forEach(decorateTicketAndLevelPreview);
    qsa('.preview-media-empty').forEach((node) => {
      if (!qs('.preview-media-plus', node)) {
        const plus = document.createElement('span');
        plus.className = 'preview-media-plus';
        plus.textContent = '+';
        node.prepend(plus);
      }
    });
  }

  function place(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const pad = 12;
    const width = Math.min(390, window.innerWidth - pad * 2);
    node.style.width = `${width}px`;
    document.body.append(node);
    const height = node.offsetHeight || 180;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - pad) top = rect.top - height - 8;
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  function openNativeColor(field, anchor) {
    if (!field) return;
    closePopover();
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'message-native-color-input';
    input.value = hex(field.value);
    assignIdentity(input, 'native-color');
    const rect = anchor.getBoundingClientRect();
    input.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 50))}px`;
    input.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 50))}px`;
    document.body.append(input);
    colorInput = input;
    const commit = () => {
      const value = hex(input.value);
      setField(field, value);
      const preview = anchor.closest('.preview-container, .message-preview-container');
      preview?.style.setProperty('--preview-accent', value);
      preview?.style.setProperty('--container-color', value);
      anchor.style.setProperty('--preview-accent', value);
    };
    input.addEventListener('input', commit);
    input.addEventListener('change', () => { commit(); setTimeout(closePopover, 250); });
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

  function openUrlEditor(field, anchor, kind) {
    if (!field) return;
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-media-popover message-preview-url-popover open';
    const title = document.createElement('div');
    title.className = 'message-popover-title';
    title.innerHTML = `<strong>${kind === 'thumb' ? 'Thumbnail' : 'Image'} URL</strong><span>Paste an http(s) URL. Ticket and level messages also support &lt;avatar_url&gt;.</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value || '';
    input.placeholder = kind === 'thumb' ? '<avatar_url> or https://example.com/avatar.png' : 'https://example.com/banner.png';
    assignIdentity(input, 'media-url');
    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'message-media-clear-button';
    clear.textContent = 'Clear';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'message-media-clear-button neutral';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'message-media-apply';
    save.textContent = 'Save';
    actions.append(clear, cancel, save);
    const set = (value) => {
      setField(field, String(value || '').trim());
      closePopover();
      setTimeout(decorate, 0);
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

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function inlineAction(event) {
    const action = event.target.closest?.('[data-inline-message-action]');
    if (!action || action.closest('.message-media-popover')) return false;
    const preview = action.closest('.preview-container');
    const fields = fieldsForPreview(preview);
    const name = action.dataset.inlineMessageAction;
    stop(event);
    if (name === 'color') openNativeColor(fields.color, action);
    if (name === 'thumb') openUrlEditor(fields.thumb, action, 'thumb');
    if (name === 'image') openUrlEditor(fields.image, action, 'image');
    if (name === 'thumb-clear') { setField(fields.thumb, ''); setTimeout(decorate, 0); }
    if (name === 'image-clear') { setField(fields.image, ''); setTimeout(decorate, 0); }
    return true;
  }

  function messageTemplateAction(event) {
    const action = event.target.closest?.('[data-message-action="preview-color"], [data-message-action="preview-media"], [data-message-action="preview-media-clear"]');
    if (!action || action.closest('.message-media-popover')) return false;
    stop(event);
    const name = action.dataset.messageAction;
    if (name === 'preview-color') openNativeColor(messageTemplateField(action, 'accentColor'), action);
    if (name === 'preview-media') openUrlEditor(messageTemplateField(action, action.dataset.field), action, action.dataset.field === 'thumbnailUrl' ? 'thumb' : 'image');
    if (name === 'preview-media-clear') setField(messageTemplateField(action, action.dataset.field), '');
    return true;
  }

  window.addEventListener('click', (event) => {
    if (inlineAction(event)) return;
    if (messageTemplateAction(event)) return;
    if (!event.target.closest?.('.message-media-popover, .message-native-color-input, .preview-accent-picker, .preview-media-edit')) closePopover();
  }, true);

  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });
  decorate();
  setTimeout(decorate, 250);
  setTimeout(decorate, 900);
})();
