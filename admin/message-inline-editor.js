(() => {
  if (window.__coinSpriteDirectMessageEditorV3) return;
  window.__coinSpriteDirectMessageEditorV3 = true;

  const CSS = '/admin/message-inline-editor.css';
  let uid = 0;
  let queued = false;
  let popover = null;
  let colorInput = null;
  let activeEditor = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
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
      tab.innerHTML = '<img class="tab-icon" src="https://raw.githubusercontent.com/Huy1234secret/CoinSprite/main/images/message.png" alt="" aria-hidden="true"><span>Messages</span>';
      (qs('[data-tab="tickets"]', tabs) || tabs.lastElementChild)?.after(tab);
    }
    if (form && !qs('[data-panel="messages"]', form)) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'messages';
      panel.innerHTML = '<div id="messageTemplatesRoot"><div class="message-editor"><div class="message-editor-head"><label><div class="message-template-symbol">💬</div><div><h3>Messages</h3><p>Manage message-related bot settings and templates.</p></div></label></div><div class="empty-state">Loading message templates...</div></div></div>';
      (qs('[data-panel="tickets"]', form) || form.lastElementChild)?.after(panel);
    }
    const messagesScriptScheduled = window.__coinSpriteMessageScriptsScheduled
      || qs('script[src^="/admin/messages.js"]');
    if (qs('#messageTemplatesRoot') && !messagesScriptScheduled) {
      window.__coinSpriteMessageScriptsScheduled = true;
      const script = document.createElement('script');
      script.src = '/admin/messages.js';
      document.body.append(script);
    }
  }

  function assignId(field) {
    if (!field || !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) return;
    if (!field.id) field.id = `admin-field-${++uid}`;
    if (!field.name) field.name = field.id;
    if (field.tagName === 'INPUT' && !field.autocomplete) field.autocomplete = 'off';
  }

  function button(className, text = '') {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = className;
    item.textContent = text;
    return item;
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
    if (!root) return null;
    if (fieldName === 'content') return qs('[data-template-field="content"]', root);
    const index = Number(anchor?.dataset?.index ?? anchor?.closest?.('[data-preview-container-index]')?.dataset?.previewContainerIndex);
    if (!Number.isFinite(index)) return null;
    return qs(`[data-container-index="${index}"] [data-container-field="${fieldName}"]`, root);
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
    colorInput?.remove();
    colorInput = null;
  }

  function place(node, anchorRect) {
    const pad = 12;
    const width = Math.min(390, window.innerWidth - pad * 2);
    node.style.width = `${width}px`;
    document.body.append(node);
    const height = node.offsetHeight || 200;
    let top = anchorRect.bottom + 8;
    if (top + height > window.innerHeight - pad) top = anchorRect.top - height - 8;
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    node.style.left = `${Math.max(pad, Math.min(anchorRect.left, window.innerWidth - width - pad))}px`;
    node.style.top = `${top}px`;
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

  function appendToken(parent, value, tagName = 'span', className = '') {
    const token = document.createElement(tagName);
    if (className) token.className = className;
    token.textContent = value;
    parent.append(token);
    return token;
  }

  function appendInline(parent, value) {
    const text = String(value || '');
    const pattern = /(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      let markerSize = 1;
      let tagName = 'em';
      let className = '';
      if (token.startsWith('**')) { markerSize = 2; tagName = 'strong'; }
      else if (token.startsWith('__')) { markerSize = 2; tagName = 'u'; }
      else if (token.startsWith('~~')) { markerSize = 2; tagName = 's'; }
      else if (token.startsWith('||')) { markerSize = 2; className = 'message-inline-spoiler'; }
      else if (token.startsWith('\x60')) tagName = 'code';
      const node = document.createElement(tagName);
      if (className) node.className = className;
      appendToken(node, token.slice(0, markerSize), 'span', 'message-inline-marker');
      node.append(document.createTextNode(token.slice(markerSize, -markerSize)));
      appendToken(node, token.slice(-markerSize), 'span', 'message-inline-marker');
      parent.append(node);
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function renderSurface(editor, value) {
    const fragment = document.createDocumentFragment();
    let inCode = false;
    String(value || '').split('\n').forEach((rawLine) => {
      const line = document.createElement('div');
      line.className = 'message-inline-line';
      let body = rawLine;
      let prefix = '';
      if (rawLine.trimStart().startsWith('\x60\x60\x60')) {
        line.classList.add('is-code-fence');
        prefix = rawLine;
        body = '';
        inCode = !inCode;
      } else if (inCode) {
        line.classList.add('is-code');
      } else if (rawLine.trim().toLowerCase() === '<separator>') {
        line.classList.add('is-separator');
        prefix = rawLine;
        body = '';
      } else {
        const match = rawLine.match(/^(### |## |# |-# |> |[-*] )/);
        if (match) {
          prefix = match[0];
          body = rawLine.slice(prefix.length);
          if (prefix === '# ') line.classList.add('is-heading-1');
          else if (prefix === '## ') line.classList.add('is-heading-2');
          else if (prefix === '### ') line.classList.add('is-heading-3');
          else if (prefix === '-# ') line.classList.add('is-subtext');
          else if (prefix === '> ') line.classList.add('is-quote');
          else line.classList.add('is-list');
        }
      }
      if (prefix) appendToken(line, prefix, 'span', 'message-inline-marker message-inline-prefix');
      const content = document.createElement('span');
      content.className = 'message-inline-content';
      if (line.classList.contains('is-code')) content.textContent = body || '\u200b';
      else appendInline(content, body);
      if (!prefix && !body) content.append(document.createElement('br'));
      line.append(content);
      fragment.append(line);
    });
    editor.replaceChildren(fragment);
  }

  function directLine(editor, node) {
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (current && current.parentElement !== editor) current = current.parentElement;
    return current?.parentElement === editor ? current : null;
  }

  function captureCaret(editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return { line: Math.max(0, editor.children.length - 1), offset: Number.MAX_SAFE_INTEGER };
    }
    const line = directLine(editor, selection.anchorNode);
    if (!line) return { line: Math.max(0, editor.children.length - 1), offset: Number.MAX_SAFE_INTEGER };
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { line: [...editor.children].indexOf(line), offset: range.toString().length };
  }

  function restoreCaret(editor, caret) {
    const line = editor.children[Math.min(caret.line, editor.children.length - 1)];
    if (!line) return;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = caret.offset;
    let node;
    let last = line;
    const range = document.createRange();
    while ((node = walker.nextNode())) {
      last = node;
      if (remaining <= node.data.length) {
        range.setStart(node, Math.max(0, remaining));
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= node.data.length;
    }
    range.selectNodeContents(last.nodeType === Node.TEXT_NODE ? last.parentNode : last);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function surfaceValue(editor) {
    return normalize(editor.innerText || editor.textContent || '');
  }

  function finishEditor(commit = true) {
    const current = activeEditor;
    if (!current) return;
    activeEditor = null;
    const value = commit ? surfaceValue(current.editor) : current.original;
    current.source.value = value;
    current.host.classList.remove('message-inline-edit-host');
    current.preview?.classList.remove('is-inline-editing');
    current.editor.remove();
    emit(current.source);
  }

  function startEditor(host, source, preview = host) {
    if (!host || !source) return;
    if (activeEditor?.host === host) {
      activeEditor.editor.focus({ preventScroll: true });
      return;
    }
    finishEditor(true);
    closePopover();
    const editor = document.createElement('div');
    editor.className = 'message-inline-surface';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', 'Edit Discord message directly');
    renderSurface(editor, source.value || '');
    host.classList.add('message-inline-edit-host');
    preview?.classList.add('is-inline-editing');
    const imageControl = host === preview ? qs(':scope > .preview-media-edit.image', host) : null;
    if (imageControl) host.insertBefore(editor, imageControl);
    else host.append(editor);
    activeEditor = { host, source, preview, editor, original: source.value || '' };

    editor.addEventListener('input', () => {
      if (editor.dataset.syncing === 'true') return;
      const caret = captureCaret(editor);
      const value = surfaceValue(editor);
      renderSurface(editor, value);
      restoreCaret(editor, caret);
      source.value = value;
      if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
    });
    const insertLineBreak = () => {
      const caret = captureCaret(editor);
      const lines = surfaceValue(editor).split('\n');
      const lineIndex = Math.max(0, Math.min(caret.line, lines.length - 1));
      const line = lines[lineIndex] || '';
      const offset = Math.max(0, Math.min(caret.offset, line.length));
      lines.splice(lineIndex, 1, line.slice(0, offset), line.slice(offset));
      const value = lines.join('\n');
      renderSurface(editor, value);
      restoreCaret(editor, { line: lineIndex + 1, offset: 0 });
      source.value = value;
      if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
    };
    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return;
      event.preventDefault();
      insertLineBreak();
    });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        finishEditor(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        insertLineBreak();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishEditor(false);
      }
    });
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

  function openNativeColor(field, anchor) {
    if (!field) return;
    const rect = anchor.getBoundingClientRect();
    finishEditor(true);
    closePopover();
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'message-native-color-input';
    input.value = hex(field.value);
    assignId(input);
    input.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 48))}px`;
    input.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 48))}px`;
    document.body.append(input);
    colorInput = input;
    const commit = () => setField(field, hex(input.value));
    input.addEventListener('input', commit);
    input.addEventListener('change', () => { commit(); setTimeout(closePopover, 180); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePopover(); });
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
    const rect = anchor.getBoundingClientRect();
    closePopover();
    const box = document.createElement('div');
    box.className = 'message-media-popover open';
    const title = document.createElement('div');
    title.className = 'message-popover-title';
    title.innerHTML = `<strong>${kind === 'thumb' ? 'Thumbnail' : 'Image'} URL</strong><span>Paste an http(s) URL. Supported placeholders such as &lt;avatar_url&gt; continue to work.</span>`;
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
      finishEditor(true);
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
    box.addEventListener('pointerdown', (event) => event.stopPropagation());
    box.addEventListener('click', (event) => event.stopPropagation());
    popover = box;
    place(box, rect);
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
    item.dataset.sourceValue = value;
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

  function decoratePreview(preview) {
    const f = fields(preview);
    if (!f.content || preview.classList.contains('is-inline-editing')) return;
    preview.classList.add('message-direct-ready');
    preview.classList.toggle('has-preview-thumbnail', Boolean(f.thumb));
    let color = qs(':scope > .preview-accent-picker', preview);
    if (f.color && !color) {
      color = button('preview-accent-picker');
      color.dataset.inlineMessageAction = 'color';
      color.title = 'Change container color';
      color.ariaLabel = color.title;
      preview.prepend(color);
    }
    if (color) color.style.setProperty('--preview-accent', hex(f.color?.value));
    preview.style.setProperty('--preview-accent', hex(f.color?.value));
    preview.style.setProperty('--container-color', hex(f.color?.value));
    for (const [field, kind] of [[f.thumb, 'thumb'], [f.image, 'image']]) {
      if (!field) continue;
      const className = kind === 'thumb' ? 'thumbnail' : 'image';
      const current = qs(`:scope > .preview-media-edit.${className}`, preview);
      const value = String(field.value || '').trim();
      if (current?.dataset.sourceValue !== value) {
        current?.remove();
        preview.append(mediaButton(field, kind));
      }
    }
  }

  function decorateMessageTemplatePreview() {
    const root = qs('#messageTemplatesRoot');
    if (!root) return;
    qsa('.message-preview-container[data-preview-container-index]', root).forEach((preview) => {
      if (qs('.preview-container-remove', preview)) return;
      const remove = button('preview-container-remove', '×');
      remove.dataset.messageAction = 'remove-container';
      remove.dataset.index = preview.dataset.previewContainerIndex;
      remove.title = 'Remove container';
      remove.ariaLabel = remove.title;
      preview.append(remove);
    });
  }

  function decorate() {
    loadCss();
    ensureMessagesTab();
    qsa('input,select,textarea').forEach(assignId);
    qsa('.ticket-message-builder').forEach((builder) => {
      if (qs('textarea[data-message-scope]', builder) && qs('.preview-container.ticket-preview', builder)) builder.classList.add('inline-message-mode');
    });
    const levelBuilder = qs('#levelUpPreviewContainer')?.closest('.message-builder');
    if (levelBuilder && qs('#levelUpContent')) levelBuilder.classList.add('inline-message-mode');
    qsa('.ticket-message-builder textarea[data-message-scope],#levelUpContent,.ticket-message-builder [data-message-field="accentColor"],.ticket-message-builder [data-message-field="thumbnailUrl"],.ticket-message-builder [data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]').forEach((field) => field.closest('label')?.classList.add('message-source-hidden'));
    qsa('.message-editor .grid').forEach((grid) => {
      if (qs('[data-message-field="accentColor"],[data-message-field="thumbnailUrl"],[data-message-field="imageUrl"],input[name="xp.levelUpMessage.accentColor"],input[name="xp.levelUpMessage.thumbnailUrl"],input[name="xp.levelUpMessage.imageUrl"]', grid)) grid.classList.add('message-source-hidden');
    });
    qsa('.ticket-message-builder .message-preview-container.ticket-preview,#levelUpPreviewContainer').forEach(decoratePreview);
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

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function inlineAction(event) {
    const action = event.target.closest?.('[data-inline-message-action]');
    if (!action) return false;
    const preview = action.closest('.preview-container');
    const f = fields(preview);
    const name = action.dataset.inlineMessageAction;
    stop(event);
    if (name === 'color') openNativeColor(f.color, action);
    else if (name === 'thumb') openMedia(f.thumb, action, 'thumb');
    else if (name === 'image') openMedia(f.image, action, 'image');
    else if (name === 'thumb-clear') { finishEditor(true); setField(f.thumb, ''); }
    else if (name === 'image-clear') { finishEditor(true); setField(f.image, ''); }
    return true;
  }

  function templateAction(event) {
    const action = event.target.closest?.('[data-message-action="preview-color"],[data-message-action="preview-media"],[data-message-action="preview-media-clear"]');
    if (!action) return false;
    const name = action.dataset.messageAction;
    stop(event);
    const preview = action.closest('.message-preview-container');
    const externalFields = action.closest('#messageTemplatesRoot') ? null : fields(preview);
    const source = (field) => externalFields
      ? field === 'accentColor' ? externalFields.color : field === 'thumbnailUrl' ? externalFields.thumb : externalFields.image
      : messageTemplateField(action, field);
    if (name === 'preview-color') openNativeColor(source('accentColor'), action);
    else if (name === 'preview-media') openMedia(source(action.dataset.field), action, action.dataset.field === 'thumbnailUrl' ? 'thumb' : 'image');
    else if (name === 'preview-media-clear') { finishEditor(true); setField(source(action.dataset.field), ''); }
    return true;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!activeEditor) return;
    if (activeEditor.preview?.contains(event.target) || activeEditor.host.contains(event.target) || event.target.closest?.('.message-media-popover,.message-native-color-input')) return;
    finishEditor(true);
  }, true);

  document.addEventListener('click', (event) => {
    if (templateAction(event) || inlineAction(event)) return;
    const templateText = event.target.closest?.('.message-preview-text,.message-root-content');
    if (templateText && !event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) {
      const preview = templateText.closest('.message-preview-container') || templateText;
      const rootText = templateText.classList.contains('message-root-content');
      const source = templateText.closest('#messageTemplatesRoot')
        ? messageTemplateField(templateText, rootText ? 'content' : 'text')
        : fields(preview).content;
      if (source) {
        stop(event);
        startEditor(templateText, source, preview);
        return;
      }
    }
    const preview = event.target.closest?.('.preview-container.message-direct-ready,.preview-container.ticket-preview,#levelUpPreviewContainer');
    if (preview && !event.target.closest('button,input,select,textarea,a,[contenteditable="true"],.message-media-popover,.message-native-color-input')) {
      const host = preview.id === 'levelUpPreviewContainer' ? qs('#levelUpPreviewBody', preview) || preview : preview;
      stop(event);
      startEditor(host, fields(preview).content, preview);
      return;
    }
    if (!event.target.closest?.('.message-media-popover,.message-native-color-input,.preview-accent-picker,.preview-media-edit')) closePopover();
  }, true);

  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
  qs('#saveButton')?.addEventListener('mousedown', () => finishEditor(true), true);
  qs('#resetTabButton')?.addEventListener('mousedown', () => { finishEditor(false); closePopover(); }, true);
  window.__coinSpriteMessagesTabSyncInit = true;
  ensureMessagesTab();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
