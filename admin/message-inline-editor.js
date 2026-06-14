(() => {
  const STYLE_ID = 'message-inline-editor-style';
  const PALETTE = [
    ['#ffffff', 'White'], ['#5865f2', 'Blurple'], ['#57f287', 'Green'], ['#fee75c', 'Yellow'],
    ['#ed4245', 'Red'], ['#eb459e', 'Pink'], ['#9b59b6', 'Purple'], ['#2b2d31', 'Dark'],
    ['#3498db', 'Blue'], ['#1abc9c', 'Aqua'], ['#e67e22', 'Orange'], ['#99aab5', 'Gray'],
  ];
  let colorMenu = null;
  let mediaMenu = null;
  let scheduled = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .message-builder.inline-message-mode { grid-template-columns: minmax(0, 1fr); }
      .message-builder.inline-message-mode .preview-panel { order: 1; position: relative; top: auto; }
      .message-builder.inline-message-mode .message-editor { order: 2; }
      .message-builder.inline-message-mode .message-editor > label.message-source-hidden,
      .message-builder.inline-message-mode .message-editor .grid.message-source-hidden,
      .message-builder.inline-message-mode .message-editor .grid label.message-source-hidden,
      .message-editor .message-source-hidden { display: none !important; }
      .message-builder.inline-message-mode .message-editor { padding: 12px 14px; }
      .message-builder.inline-message-mode .message-editor .panel-heading { margin-bottom: 10px; }
      .message-builder.inline-message-mode .message-editor .template-tokens { margin-bottom: 0; }
      .message-live-hint { margin-top: 8px; color: var(--muted-2); font-size: 12px; }
      .preview-container.message-direct-ready { cursor: default; outline-offset: 3px; transition: border-color 140ms ease, outline-color 140ms ease, background 140ms ease; }
      .preview-container.message-direct-ready:hover { border-color: rgba(255,255,255,.20); outline: 2px solid rgba(88,101,242,.16); }
      .preview-container.message-direct-ready .ticket-preview-media,
      .preview-container.message-direct-ready > .preview-image,
      .preview-container.message-direct-ready .preview-thumbnail { display: none !important; }
      .preview-container.message-direct-ready.has-preview-thumbnail { padding-right: 108px; min-height: 104px; }
      .preview-container.is-direct-editing { min-height: 210px; cursor: text; outline: 2px solid rgba(88,101,242,.42); background: #25272c; padding: 14px 16px; }
      .preview-live-editor { min-height: 160px; white-space: pre-wrap; overflow-wrap: anywhere; color: #dbdee1; line-height: 1.45; font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; caret-color: #fff; }
      .preview-live-editor:focus { outline: none; }
      .preview-live-editor::selection { background: rgba(88,101,242,.45); }
      .preview-edit-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; color: #949ba4; font-size: 12px; }
      .preview-edit-toolbar strong { color: #f2f3f5; }
      .preview-edit-toolbar span:last-child { white-space: nowrap; }
      .preview-accent-picker { position: absolute; z-index: 4; inset: 0 auto 0 0; width: 8px; border: 0; border-radius: 4px 0 0 4px; padding: 0; background: var(--preview-accent, #fff); cursor: pointer; opacity: .96; }
      .preview-accent-picker:hover,
      .preview-accent-picker:focus-visible { width: 12px; outline: 2px solid rgba(255,255,255,.28); outline-offset: 2px; }
      .preview-media-edit { position: relative; z-index: 3; display: grid; place-items: center; border: 1px dashed rgba(255,255,255,.22); background: rgba(255,255,255,.035); color: #b5bac1; cursor: pointer; overflow: hidden; font-size: 12px; font-weight: 750; text-align: center; transition: border-color 140ms ease, background 140ms ease, color 140ms ease; }
      .preview-media-edit:hover,
      .preview-media-edit:focus-visible { border-color: rgba(255,255,255,.46); background: rgba(255,255,255,.065); color: #f2f3f5; outline: none; }
      .preview-media-edit.thumbnail { position: absolute; top: 14px; right: 14px; width: 76px; height: 76px; border-radius: 8px; }
      .preview-media-edit.image { min-height: 82px; width: 100%; margin-top: 12px; border-radius: 8px; }
      .preview-media-edit.has-value { border-style: solid; background: #1e1f22; color: #f2f3f5; }
      .preview-media-edit img { width: 100%; height: 100%; object-fit: cover; }
      .preview-media-edit.image img { max-height: 240px; object-fit: cover; }
      .preview-media-empty { display: grid; gap: 3px; justify-items: center; padding: 8px; }
      .preview-media-empty strong { color: #f2f3f5; font-size: 12px; }
      .preview-media-empty span { color: #949ba4; font-size: 11px; font-weight: 650; }
      .preview-media-clear { position: absolute; top: 5px; right: 5px; z-index: 2; width: 22px; height: 22px; border: 1px solid rgba(0,0,0,.3); border-radius: 999px; background: rgba(0,0,0,.64); color: #fff; cursor: pointer; display: grid; place-items: center; line-height: 1; font-weight: 900; }
      .preview-media-clear:hover { background: rgba(237,66,69,.88); }
      .message-color-popover,
      .message-media-popover { position: fixed; z-index: 6000; width: min(300px, calc(100vw - 24px)); display: none; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #0e1015; box-shadow: 0 18px 42px rgba(0,0,0,.52); max-height: calc(100dvh - 24px); overflow: auto; }
      .message-color-popover.open,
      .message-media-popover.open { display: grid; }
      .message-color-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
      .message-color-swatch { width: 100%; aspect-ratio: 1; min-height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: var(--swatch); cursor: pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.22) inset; }
      .message-color-swatch.selected { outline: 2px solid #fff; outline-offset: 2px; }
      .message-color-custom,
      .message-media-actions { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; }
      .message-color-custom input,
      .message-media-popover input { height: 34px; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .message-color-apply,
      .message-media-apply,
      .message-media-clear-button { min-height: 34px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-2); color: var(--text); padding: 0 10px; cursor: pointer; font-weight: 800; }
      .message-color-apply:hover,
      .message-media-apply:hover,
      .message-media-clear-button:hover { background: var(--surface-3); }
      .message-media-clear-button { color: var(--danger); }
      .message-popover-label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 750; }
      .message-popover-help { color: var(--muted-2); font-size: 11px; line-height: 1.35; }
      @media (min-width: 980px) {
        .message-builder.inline-message-mode { grid-template-columns: minmax(0, 1fr); }
        .message-builder.inline-message-mode .preview-panel { max-width: 860px; }
      }
    `;
    document.head.append(style);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '');
  }

  function hex(value) {
    const cleaned = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : '#FFFFFF';
  }

  function normalizeHexInput(value) {
    const cleaned = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(cleaned) ? `#${cleaned.toUpperCase()}` : '';
  }

  function dispatchMessageInput(input) {
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isLevelPreview(container) {
    return container.id === 'levelUpPreviewContainer' || Boolean(container.closest('#levelUpPreview'));
  }

  function getFields(container) {
    if (!container) return {};
    if (isLevelPreview(container)) {
      const form = document.querySelector('#configForm');
      return {
        scope: 'level-up',
        content: document.querySelector('#levelUpContent'),
        accentColor: form?.elements?.['xp.levelUpMessage.accentColor'] || document.querySelector('input[name="xp.levelUpMessage.accentColor"]'),
        thumbnailUrl: form?.elements?.['xp.levelUpMessage.thumbnailUrl'] || document.querySelector('input[name="xp.levelUpMessage.thumbnailUrl"]'),
        imageUrl: form?.elements?.['xp.levelUpMessage.imageUrl'] || document.querySelector('input[name="xp.levelUpMessage.imageUrl"]'),
      };
    }
    const builder = container.closest('.ticket-message-builder');
    return {
      scope: builder?.querySelector('textarea[data-message-scope]')?.dataset.messageScope || 'ticket',
      content: builder?.querySelector('textarea[data-message-scope]') || null,
      accentColor: builder?.querySelector('[data-message-field="accentColor"]') || null,
      thumbnailUrl: builder?.querySelector('[data-message-field="thumbnailUrl"]') || null,
      imageUrl: builder?.querySelector('[data-message-field="imageUrl"]') || null,
    };
  }

  function sourceForPreview(container) {
    return getFields(container).content || null;
  }

  function labelForInput(input) {
    return input?.closest('label') || null;
  }

  function hideSourceFields() {
    document.querySelectorAll('.ticket-message-builder, .message-builder').forEach((builder) => {
      const hasMessageSource = builder.querySelector('textarea[data-message-scope], #levelUpContent');
      const hasPreview = builder.querySelector('.preview-container.ticket-preview, #levelUpPreviewContainer');
      if (hasMessageSource && hasPreview) builder.classList.add('inline-message-mode');
    });

    document.querySelectorAll('.ticket-message-builder textarea[data-message-scope], #levelUpContent').forEach((textarea) => {
      labelForInput(textarea)?.classList.add('message-source-hidden');
    });

    document.querySelectorAll([
      '.ticket-message-builder [data-message-field="accentColor"]',
      '.ticket-message-builder [data-message-field="thumbnailUrl"]',
      '.ticket-message-builder [data-message-field="imageUrl"]',
      'input[name="xp.levelUpMessage.accentColor"]',
      'input[name="xp.levelUpMessage.thumbnailUrl"]',
      'input[name="xp.levelUpMessage.imageUrl"]',
    ].join(',')).forEach((input) => {
      labelForInput(input)?.classList.add('message-source-hidden');
    });

    document.querySelectorAll('.message-editor .grid').forEach((grid) => {
      if (grid.querySelector('[data-message-field="accentColor"], [data-message-field="thumbnailUrl"], [data-message-field="imageUrl"], input[name="xp.levelUpMessage.accentColor"], input[name="xp.levelUpMessage.thumbnailUrl"], input[name="xp.levelUpMessage.imageUrl"]')) {
        grid.classList.add('message-source-hidden');
      }
    });
  }

  function closeColorMenu() {
    colorMenu?.remove();
    colorMenu = null;
  }

  function closeMediaMenu() {
    mediaMenu?.remove();
    mediaMenu = null;
  }

  function placeFloatingMenu(anchor, menu) {
    const rect = anchor.getBoundingClientRect();
    const padding = 12;
    const width = menu.offsetWidth || 300;
    const height = menu.offsetHeight || 260;
    const left = Math.min(Math.max(padding, rect.left), window.innerWidth - width - padding);
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - padding) top = rect.top - height - 8;
    top = Math.min(Math.max(padding, top), Math.max(padding, window.innerHeight - height - padding));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function setInputValue(input, value) {
    if (!input) return;
    input.value = value;
    dispatchMessageInput(input);
  }

  function openColorMenu(input, anchor) {
    if (!input) return;
    closeMediaMenu();
    closeColorMenu();

    const menu = document.createElement('div');
    menu.className = 'message-color-popover open';
    const swatches = document.createElement('div');
    swatches.className = 'message-color-swatches';
    const custom = document.createElement('label');
    custom.className = 'message-popover-label';
    custom.textContent = 'Custom color';
    const customRow = document.createElement('div');
    customRow.className = 'message-color-custom';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.inputMode = 'text';
    customInput.maxLength = 7;
    customInput.placeholder = '#FFFFFF';
    customInput.value = hex(input.value);
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'message-color-apply';
    apply.textContent = 'Apply';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'message-color-apply';
    close.textContent = 'Close';
    customRow.append(customInput, apply, close);
    const help = document.createElement('p');
    help.className = 'message-popover-help';
    help.textContent = 'Choose a preset or type a hex color. The native color picker is not used, so this menu will not get cut off.';
    custom.append(customRow);

    const updateSelected = () => {
      const selected = hex(input.value);
      swatches.querySelectorAll('.message-color-swatch').forEach((button) => {
        button.classList.toggle('selected', hex(button.dataset.color) === selected);
      });
    };

    PALETTE.forEach(([color, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-color-swatch';
      button.dataset.color = color;
      button.title = name;
      button.setAttribute('aria-label', name);
      button.style.setProperty('--swatch', color);
      button.addEventListener('click', () => {
        setInputValue(input, hex(color));
        closeColorMenu();
      });
      swatches.append(button);
    });

    const applyCustom = () => {
      const value = normalizeHexInput(customInput.value);
      if (!value) {
        customInput.focus();
        customInput.select();
        return;
      }
      setInputValue(input, value);
      closeColorMenu();
    };

    customInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyCustom();
      }
      if (event.key === 'Escape') closeColorMenu();
    });
    apply.addEventListener('click', applyCustom);
    close.addEventListener('click', closeColorMenu);
    menu.addEventListener('click', (event) => event.stopPropagation());
    menu.append(swatches, custom, help);
    document.body.append(menu);
    updateSelected();
    placeFloatingMenu(anchor, menu);
    colorMenu = menu;
    customInput.focus({ preventScroll: true });
    customInput.select();
  }

  function resolveMediaPreview(value) {
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

  function mediaLabel(kind, hasValue) {
    if (kind === 'thumbnail') return hasValue ? 'Edit thumbnail' : 'Add thumbnail';
    return hasValue ? 'Edit image' : 'Add image';
  }

  function openMediaMenu(input, anchor, kind) {
    if (!input) return;
    closeColorMenu();
    closeMediaMenu();

    const menu = document.createElement('div');
    menu.className = 'message-media-popover open';
    const label = document.createElement('label');
    label.className = 'message-popover-label';
    label.textContent = kind === 'thumbnail' ? 'Thumbnail URL' : 'Image URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = String(input.value || '');
    urlInput.placeholder = kind === 'thumbnail' ? '<avatar_url> or https://example.com/avatar.png' : 'https://example.com/banner.png';
    label.append(urlInput);
    const actions = document.createElement('div');
    actions.className = 'message-media-actions';
    const spacer = document.createElement('span');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'message-media-clear-button';
    clear.textContent = 'Clear';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'message-media-apply';
    apply.textContent = 'Save';
    actions.append(spacer, clear, apply);
    const help = document.createElement('p');
    help.className = 'message-popover-help';
    help.textContent = 'Leave empty to remove it. Placeholders like <avatar_url> can still be used.';

    const save = (value) => {
      setInputValue(input, String(value || '').trim());
      closeMediaMenu();
    };
    apply.addEventListener('click', () => save(urlInput.value));
    clear.addEventListener('click', () => save(''));
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save(urlInput.value);
      }
      if (event.key === 'Escape') closeMediaMenu();
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    menu.append(label, actions, help);
    document.body.append(menu);
    placeFloatingMenu(anchor, menu);
    mediaMenu = menu;
    urlInput.focus({ preventScroll: true });
    urlInput.select();
  }

  function mediaButton(input, kind) {
    const value = String(input?.value || '').trim();
    const previewUrl = resolveMediaPreview(value);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `preview-media-edit ${kind}${value ? ' has-value' : ''}`;
    button.title = `${mediaLabel(kind, Boolean(value))}`;
    button.setAttribute('aria-label', button.title);
    if (previewUrl) {
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        button.classList.remove('has-value');
        button.append(emptyMediaContent(kind, value));
      }, { once: true });
      button.append(img);
    } else {
      button.append(emptyMediaContent(kind, value));
    }
    if (value) {
      const clear = document.createElement('span');
      clear.className = 'preview-media-clear';
      clear.textContent = '×';
      clear.title = 'Remove';
      clear.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setInputValue(input, '');
      });
      button.append(clear);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMediaMenu(input, button, kind);
    });
    return button;
  }

  function emptyMediaContent(kind, value) {
    const wrap = document.createElement('span');
    wrap.className = 'preview-media-empty';
    const strong = document.createElement('strong');
    strong.textContent = mediaLabel(kind, Boolean(value));
    const small = document.createElement('span');
    small.textContent = value ? 'Preview unavailable' : 'Click to set URL';
    wrap.append(strong, small);
    return wrap;
  }

  function decoratePreviewTools(container) {
    const fields = getFields(container);
    container.querySelectorAll('.preview-accent-picker, .preview-media-edit').forEach((node) => node.remove());
    container.classList.remove('has-preview-thumbnail');
    if (fields.accentColor) {
      const accent = document.createElement('button');
      accent.type = 'button';
      accent.className = 'preview-accent-picker';
      accent.title = 'Change container color';
      accent.setAttribute('aria-label', 'Change container color');
      accent.style.setProperty('--preview-accent', hex(fields.accentColor.value));
      accent.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openColorMenu(fields.accentColor, accent);
      });
      container.prepend(accent);
    }
    if (fields.thumbnailUrl) {
      container.classList.add('has-preview-thumbnail');
      container.append(mediaButton(fields.thumbnailUrl, 'thumbnail'));
    }
    if (fields.imageUrl) {
      container.append(mediaButton(fields.imageUrl, 'image'));
    }
  }

  function openDirectEditor(container) {
    const source = sourceForPreview(container);
    if (!source || container.querySelector('.preview-live-editor')) return;
    closeColorMenu();
    closeMediaMenu();
    const startingValue = String(source.value || '');
    container.classList.add('is-direct-editing');
    container.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-edit-toolbar';
    toolbar.innerHTML = '<strong>Editing message</strong><span>Ctrl/⌘ + Enter to finish · Esc to cancel</span>';
    const editor = document.createElement('div');
    editor.className = 'preview-live-editor';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.dataset.directPreviewEditor = 'true';
    editor.textContent = startingValue;
    let finished = false;
    const sync = (commit = false) => {
      source.value = normalizeText(editor.innerText || editor.textContent || '');
      if (commit) dispatchMessageInput(source);
      else if (typeof refreshDirtyState === 'function') refreshDirtyState();
    };
    const finish = (commit = true) => {
      if (finished) return;
      finished = true;
      sync(commit);
      container.classList.remove('is-direct-editing');
      if (commit) return;
      source.value = startingValue;
      dispatchMessageInput(source);
    };
    editor.addEventListener('input', () => sync(false));
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('commit-preview', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        editor.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    container.append(toolbar, editor);
    requestAnimationFrame(() => {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  function commitOpenPreviewEditors() {
    document.querySelectorAll('.preview-live-editor').forEach((editor) => {
      editor.dispatchEvent(new Event('commit-preview', { bubbles: true }));
    });
  }

  function decoratePreview(container) {
    if (!container) return;
    const source = sourceForPreview(container);
    if (!source) return;
    if (container.querySelector('.preview-live-editor')) return;
    decoratePreviewTools(container);
    if (container.dataset.directEditReady !== 'true') {
      container.dataset.directEditReady = 'true';
      container.classList.add('message-direct-ready');
      container.tabIndex = 0;
      container.title = 'Click the message body to edit it directly';
      container.addEventListener('click', (event) => {
        if (event.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
        openDirectEditor(container);
      });
      container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        openDirectEditor(container);
      });
    }
    const panel = container.closest('.preview-panel');
    if (panel && !panel.querySelector('.message-live-hint')) {
      const hint = document.createElement('p');
      hint.className = 'message-live-hint';
      hint.textContent = 'Click the message text to edit it. Click the color bar, thumbnail box, or image box to edit those fields.';
      panel.querySelector('.panel-heading')?.append(hint);
    }
  }

  function decorate() {
    ensureStyles();
    hideSourceFields();
    document.querySelectorAll('.ticket-message-builder .preview-container.ticket-preview, #levelUpPreviewContainer').forEach(decoratePreview);
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.message-color-popover, .preview-accent-picker')) closeColorMenu();
    if (!event.target.closest('.message-media-popover, .preview-media-edit')) closeMediaMenu();
  });
  window.addEventListener('resize', () => {
    closeColorMenu();
    closeMediaMenu();
  });
  document.querySelector('#saveButton')?.addEventListener('mousedown', commitOpenPreviewEditors, true);
  document.querySelector('#resetTabButton')?.addEventListener('mousedown', commitOpenPreviewEditors, true);
  new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
  scheduleDecorate();
})();
