(() => {
  const validHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const normalizeText = (value) => String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/g, '');

  function fieldsFor(preview) {
    if (!preview) return {};
    if (preview.id === 'levelUpPreviewContainer' || preview.closest('#levelUpPreview')) {
      const form = document.querySelector('#configForm');
      return {
        content: document.querySelector('#levelUpContent'),
        color: form?.elements?.['xp.levelUpMessage.accentColor'],
        thumb: form?.elements?.['xp.levelUpMessage.thumbnailUrl'],
        image: form?.elements?.['xp.levelUpMessage.imageUrl'],
      };
    }
    const box = preview.closest('.ticket-message-builder, .message-builder');
    return {
      content: box?.querySelector('textarea[data-message-scope]'),
      color: box?.querySelector('[data-message-field="accentColor"]'),
      thumb: box?.querySelector('[data-message-field="thumbnailUrl"]'),
      image: box?.querySelector('[data-message-field="imageUrl"]'),
    };
  }

  function emit(field) {
    if (!field) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function finish(editor, commit) {
    if (!editor || editor.dataset.done === 'true') return;
    const overlay = editor.closest('.preview-inline-overlay');
    const preview = editor.closest('.preview-container');
    const source = fieldsFor(preview).content;
    if (!preview || !source) return;
    editor.dataset.done = 'true';
    source.value = commit ? normalizeText(editor.innerText || editor.textContent || '') : (preview.dataset.fixOriginal || source.value || '');
    delete preview.dataset.fixOriginal;
    preview.classList.remove('is-direct-editing');
    overlay?.remove();
    emit(source);
  }

  function cancelEditors() {
    document.querySelectorAll('.preview-inline-overlay .preview-live-editor').forEach((editor) => finish(editor, false));
  }

  function commitEditors() {
    document.querySelectorAll('.preview-inline-overlay .preview-live-editor').forEach((editor) => finish(editor, true));
  }

  function openOverlayEditor(preview) {
    const fields = fieldsFor(preview);
    const source = fields.content;
    if (!source || preview.querySelector('.preview-inline-overlay')) return;
    preview.dataset.fixOriginal = source.value || '';
    preview.classList.add('is-direct-editing');

    const overlay = document.createElement('div');
    overlay.className = 'preview-inline-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '10px',
      zIndex: '60',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gap: '10px',
      padding: '12px',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '8px',
      background: '#25272c',
      boxShadow: '0 18px 44px rgba(0,0,0,.42)',
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'preview-edit-toolbar';
    toolbar.innerHTML = '<strong>Editing message</strong><span>Ctrl/⌘ + Enter to finish · Esc to cancel</span>';
    const editor = document.createElement('div');
    editor.className = 'preview-live-editor';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = source.value || '';
    Object.assign(editor.style, {
      minHeight: '150px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflow: 'auto',
    });
    editor.addEventListener('input', () => {
      source.value = normalizeText(editor.innerText || editor.textContent || '');
      if (typeof refreshDirtyState === 'function') refreshDirtyState();
    });
    editor.addEventListener('blur', () => finish(editor, true));
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(editor, false); }
    });
    overlay.append(toolbar, editor);
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

  function ensureColorBar(preview) {
    const fields = fieldsFor(preview);
    if (!fields.color) return;
    const color = validHex(fields.color.value) ? fields.color.value : '#FFFFFF';
    preview.style.setProperty('--preview-accent', color);
    const bar = preview.querySelector('.preview-accent-picker');
    if (bar) bar.style.setProperty('--preview-accent', color);
  }

  document.addEventListener('click', (event) => {
    const preview = event.target.closest?.('.preview-container.message-direct-ready, .preview-container.ticket-preview, #levelUpPreviewContainer');
    if (!preview) return;
    if (event.target.closest('button, input, select, textarea, a, [contenteditable="true"], [data-inline-message-action], .message-color-popover, .message-media-popover')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    openOverlayEditor(preview);
  }, true);

  document.querySelector('#saveButton')?.addEventListener('mousedown', commitEditors, true);
  document.querySelector('#resetTabButton')?.addEventListener('mousedown', cancelEditors, true);
  new MutationObserver(() => {
    document.querySelectorAll('.preview-container.message-direct-ready, .preview-container.ticket-preview, #levelUpPreviewContainer').forEach(ensureColorBar);
  }).observe(document.body, { childList: true, subtree: true });
})();