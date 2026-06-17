(() => {
  if (window.__coinSpriteMessageTabLineEditor) return;
  window.__coinSpriteMessageTabLineEditor = true;

  let activeEditor = null;

  function normalize(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
  }

  function sourceField(anchor) {
    const root = document.querySelector('#messageTemplatesRoot');
    if (!root) return null;
    if (anchor.classList.contains('message-root-content')) {
      return root.querySelector('[data-template-field="content"]');
    }
    const index = Number(anchor.closest('[data-preview-container-index]')?.dataset.previewContainerIndex);
    if (!Number.isFinite(index)) return null;
    return root.querySelector(`[data-container-index="${index}"] [data-container-field="text"]`);
  }

  function appendInline(parent, value) {
    const pattern = /(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(value))) {
      if (match.index > cursor) parent.append(document.createTextNode(value.slice(cursor, match.index)));
      const token = match[0];
      let markerSize = 1;
      let tagName = 'em';
      let className = '';
      if (token.startsWith('**')) { markerSize = 2; tagName = 'strong'; }
      else if (token.startsWith('__')) { markerSize = 2; tagName = 'u'; }
      else if (token.startsWith('~~')) { markerSize = 2; tagName = 's'; }
      else if (token.startsWith('||')) { markerSize = 2; tagName = 'span'; className = 'message-inline-spoiler'; }
      else if (token.startsWith('\x60')) tagName = 'code';
      const node = document.createElement(tagName);
      if (className) node.className = className;
      const before = document.createElement('span');
      before.className = 'message-inline-marker';
      before.textContent = token.slice(0, markerSize);
      const after = before.cloneNode();
      after.textContent = token.slice(-markerSize);
      node.append(before, document.createTextNode(token.slice(markerSize, -markerSize)), after);
      parent.append(node);
      cursor = pattern.lastIndex;
    }
    if (cursor < value.length) parent.append(document.createTextNode(value.slice(cursor)));
  }

  function renderSurface(editor, value) {
    const fragment = document.createDocumentFragment();
    let inCode = false;
    normalize(value).split('\n').forEach((rawLine) => {
      const line = document.createElement('div');
      line.className = 'message-inline-line';
      let body = rawLine;
      let prefix = '';
      if (rawLine.trimStart().startsWith('```')) {
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
      if (prefix) {
        const marker = document.createElement('span');
        marker.className = 'message-inline-marker message-inline-prefix';
        marker.textContent = prefix;
        line.append(marker);
      }
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
    return [...editor.children].map((line) => normalize(line.textContent || '').replace(/\u200b/g, '')).join('\n');
  }

  function emit(source) {
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function finish(commit = true) {
    const current = activeEditor;
    if (!current) return;
    activeEditor = null;
    current.source.value = commit ? surfaceValue(current.editor) : current.original;
    current.host.classList.remove('message-inline-edit-host');
    current.preview.classList.remove('is-inline-editing');
    current.editor.remove();
    emit(current.source);
  }

  function start(host, source, preview) {
    if (!host || !source || activeEditor?.host === host) return;
    finish(true);
    const editor = document.createElement('div');
    editor.className = 'message-inline-surface';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', 'Edit Discord message directly');
    renderSurface(editor, source.value || '');
    host.classList.add('message-inline-edit-host');
    preview.classList.add('is-inline-editing');
    host.append(editor);
    activeEditor = { host, source, preview, editor, original: source.value || '' };

    const insertLineBreak = () => {
      const caret = captureCaret(editor);
      const lines = surfaceValue(editor).split('\n');
      const lineIndex = Math.max(0, Math.min(caret.line, lines.length - 1));
      const line = lines[lineIndex] || '';
      const offset = Math.max(0, Math.min(caret.offset, line.length));
      lines.splice(lineIndex, 1, line.slice(0, offset), line.slice(offset));
      renderSurface(editor, lines.join('\n'));
      restoreCaret(editor, { line: lineIndex + 1, offset: 0 });
      source.value = surfaceValue(editor);
    };

    editor.addEventListener('input', () => {
      const caret = captureCaret(editor);
      const value = surfaceValue(editor);
      renderSurface(editor, value);
      restoreCaret(editor, caret);
      source.value = value;
    });
    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return;
      event.preventDefault();
      insertLineBreak();
    });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        insertLineBreak();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      restoreCaret(editor, { line: Math.max(0, editor.children.length - 1), offset: Number.MAX_SAFE_INTEGER });
    });
  }

  function installGuard(root) {
    if (!root || root.__coinSpriteMessageTabEditorGuard) return;
    root.__coinSpriteMessageTabEditorGuard = true;
    root.addEventListener('click', (event) => {
      if (!event.target.closest?.('.message-inline-surface')) return;
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }, true);
  }

  document.addEventListener('pointerdown', (event) => {
    if (!activeEditor || activeEditor.preview.contains(event.target)) return;
    finish(true);
  }, true);

  document.addEventListener('click', (event) => {
    const host = event.target.closest?.('#messageTemplatesRoot .message-preview-text, #messageTemplatesRoot .message-root-content');
    if (!host || event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
    const source = sourceField(host);
    const preview = host.closest('.message-preview-container') || host;
    if (!source || !preview) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    start(host, source, preview);
  }, true);

  installGuard(document.querySelector('#messageTemplatesRoot'));
  new MutationObserver(() => installGuard(document.querySelector('#messageTemplatesRoot'))).observe(document.body, { childList: true, subtree: true });
})();
