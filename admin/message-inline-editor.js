(() => {
  const STYLE_ID = 'message-inline-editor-style';
  const PALETTE = [
    ['#ffffff', 'White'], ['#5865f2', 'Blurple'], ['#57f287', 'Green'], ['#fee75c', 'Yellow'],
    ['#ed4245', 'Red'], ['#eb459e', 'Pink'], ['#9b59b6', 'Purple'], ['#2b2d31', 'Dark'],
    ['#3498db', 'Blue'], ['#1abc9c', 'Aqua'], ['#e67e22', 'Orange'], ['#99aab5', 'Gray'],
  ];
  let colorMenu = null;
  let scheduled = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .message-live-hint { margin-top: 8px; color: var(--muted-2); font-size: 12px; }
      .preview-container.message-direct-ready { cursor: text; outline-offset: 3px; transition: border-color 140ms ease, outline-color 140ms ease, background 140ms ease; }
      .preview-container.message-direct-ready:hover { border-color: rgba(255,255,255,.20); outline: 2px solid rgba(88,101,242,.20); }
      .preview-container.is-direct-editing { min-height: 180px; cursor: text; outline: 2px solid rgba(88,101,242,.42); background: #25272c; }
      .preview-live-editor { min-height: 150px; white-space: pre-wrap; overflow-wrap: anywhere; color: #dbdee1; line-height: 1.45; font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; caret-color: #fff; }
      .preview-live-editor:focus { outline: none; }
      .preview-live-editor::selection { background: rgba(88,101,242,.45); }
      .preview-edit-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; color: #949ba4; font-size: 12px; }
      .preview-edit-toolbar strong { color: #f2f3f5; }
      .preview-edit-toolbar span:last-child { white-space: nowrap; }
      .message-color-native { position: absolute !important; width: 1px !important; height: 1px !important; opacity: 0 !important; pointer-events: none !important; }
      .message-color-control { position: relative; display: grid; gap: 8px; }
      .message-color-trigger { min-height: 40px; width: 100%; border: 1px solid var(--line); border-radius: 7px; background: var(--input); color: var(--text); padding: 0 10px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; cursor: pointer; text-align: left; font-weight: 750; }
      .message-color-trigger:hover, .message-color-trigger.open { border-color: var(--primary); background: #151922; }
      .message-color-preview { height: 18px; width: 72px; border-radius: 999px; border: 1px solid rgba(255,255,255,.28); box-shadow: 0 0 0 1px rgba(0,0,0,.32) inset; background: var(--selected-color, #fff); }
      .message-color-popover { position: fixed; z-index: 5000; width: 260px; display: none; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #0e1015; box-shadow: 0 18px 42px rgba(0,0,0,.46); }
      .message-color-popover.open { display: grid; }
      .message-color-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
      .message-color-swatch { width: 100%; aspect-ratio: 1; min-height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: var(--swatch); cursor: pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.22) inset; }
      .message-color-swatch.selected { outline: 2px solid #fff; outline-offset: 2px; }
      .message-color-custom { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; }
      .message-color-value { color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .message-color-native-button { min-height: 32px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); color: var(--text); padding: 0 10px; cursor: pointer; font-weight: 750; }
    `;
    document.head.append(style);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '');
  }

  function dispatchMessageInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function sourceForPreview(container) {
    if (container.id === 'levelUpPreviewContainer' || container.closest('#levelUpPreview')) return document.querySelector('#levelUpContent');
    return container.closest('.ticket-message-builder')?.querySelector('textarea[data-message-scope]') || null;
  }

  function openDirectEditor(container) {
    const source = sourceForPreview(container);
    if (!source || container.querySelector('.preview-live-editor')) return;
    const startingValue = String(source.value || '');
    container.classList.add('is-direct-editing');
    container.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-edit-toolbar';
    toolbar.innerHTML = '<strong>Editing message</strong><span>Ctrl/⌘ + Enter to finish</span>';
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
    if (!container || container.dataset.directEditReady === 'true') return;
    const source = sourceForPreview(container);
    if (!source) return;
    container.dataset.directEditReady = 'true';
    container.classList.add('message-direct-ready');
    container.tabIndex = 0;
    container.title = 'Click to edit this message directly';
    container.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
      openDirectEditor(container);
    });
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      openDirectEditor(container);
    });
    const panel = container.closest('.preview-panel');
    if (panel && !panel.querySelector('.message-live-hint')) {
      const hint = document.createElement('p');
      hint.className = 'message-live-hint';
      hint.textContent = 'Click the message card to edit the raw message directly. Use Ctrl/⌘ + Enter to finish.';
      panel.querySelector('.panel-heading')?.append(hint);
    }
  }

  function hex(value) {
    const cleaned = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : '#FFFFFF';
  }

  function closeColorMenu() {
    colorMenu?.classList.remove('open');
    document.querySelectorAll('.message-color-trigger.open').forEach((button) => button.classList.remove('open'));
    colorMenu = null;
  }

  function placeColorMenu(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const width = 260;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 230);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(12, top)}px`;
  }

  function decorateColorInput(input) {
    if (!input || input.dataset.messageColorEnhanced === 'true') return;
    input.dataset.messageColorEnhanced = 'true';
    input.classList.add('message-color-native');
    const control = document.createElement('div');
    control.className = 'message-color-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'message-color-trigger';
    const label = document.createElement('span');
    const swatch = document.createElement('span');
    swatch.className = 'message-color-preview';
    trigger.append(label, swatch);
    const menu = document.createElement('div');
    menu.className = 'message-color-popover';
    const swatches = document.createElement('div');
    swatches.className = 'message-color-swatches';
    const custom = document.createElement('div');
    custom.className = 'message-color-custom';
    const valueText = document.createElement('span');
    valueText.className = 'message-color-value';
    const nativeButton = document.createElement('button');
    nativeButton.type = 'button';
    nativeButton.className = 'message-color-native-button';
    nativeButton.textContent = 'Custom';
    custom.append(valueText, nativeButton);
    menu.append(swatches, custom);
    document.body.append(menu);
    const update = () => {
      const value = hex(input.value);
      label.textContent = value;
      valueText.textContent = value;
      swatch.style.setProperty('--selected-color', value);
      swatches.querySelectorAll('.message-color-swatch').forEach((button) => button.classList.toggle('selected', hex(button.dataset.color) === value));
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
        input.value = color;
        update();
        dispatchMessageInput(input);
        closeColorMenu();
      });
      swatches.append(button);
    });
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = !menu.classList.contains('open');
      closeColorMenu();
      if (!opening) return;
      update();
      menu.classList.add('open');
      trigger.classList.add('open');
      colorMenu = menu;
      placeColorMenu(trigger, menu);
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    nativeButton.addEventListener('click', () => input.showPicker ? input.showPicker() : input.click());
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    input.after(control);
    control.append(trigger);
    update();
  }

  function decorate() {
    ensureStyles();
    document.querySelectorAll('.ticket-message-builder .preview-container.ticket-preview, #levelUpPreviewContainer').forEach(decoratePreview);
    document.querySelectorAll('input[type="color"][data-message-field="accentColor"], input[type="color"][name="xp.levelUpMessage.accentColor"]').forEach(decorateColorInput);
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
    if (!event.target.closest('.message-color-popover, .message-color-trigger')) closeColorMenu();
  });
  window.addEventListener('resize', closeColorMenu);
  document.querySelector('#saveButton')?.addEventListener('mousedown', commitOpenPreviewEditors, true);
  document.querySelector('#resetTabButton')?.addEventListener('mousedown', commitOpenPreviewEditors, true);
  new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
  scheduleDecorate();
})();