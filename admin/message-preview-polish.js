(() => {
  if (window.__coinSpriteRichMessageEditorV1) return;
  window.__coinSpriteRichMessageEditorV1 = true;

  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const normalize = (value) => String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ');

  function marker(value) {
    const span = document.createElement('span');
    span.className = 'live-markdown-marker';
    span.contentEditable = 'false';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = value;
    return span;
  }

  function appendInline(parent, value) {
    const text = String(value || '');
    const pattern = /(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      let open = token[0];
      let close = token[token.length - 1];
      let tag = 'em';
      let className = '';
      if (token.startsWith('**')) { open = close = '**'; tag = 'strong'; }
      else if (token.startsWith('__')) { open = close = '__'; tag = 'u'; }
      else if (token.startsWith('~~')) { open = close = '~~'; tag = 's'; }
      else if (token.startsWith('||')) { open = close = '||'; tag = 'span'; className = 'live-markdown-spoiler'; }
      else if (token.startsWith('\x60')) { open = close = '\x60'; tag = 'code'; }
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.append(marker(open), document.createTextNode(token.slice(open.length, token.length - close.length)), marker(close));
      parent.append(node);
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function renderEditor(editor, value) {
    const fragment = document.createDocumentFragment();
    let inCode = false;
    String(value || '').split('\n').forEach((rawLine) => {
      const line = document.createElement('div');
      line.className = 'live-markdown-line';
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

      if (prefix) line.append(marker(prefix));
      const content = document.createElement('span');
      content.className = 'live-markdown-content';
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
      const length = node.data.length;
      if (remaining <= length) {
        const markerNode = node.parentElement?.closest('.live-markdown-marker');
        if (markerNode) range.setStartAfter(markerNode);
        else range.setStart(node, Math.max(0, remaining));
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= length;
    }
    range.selectNodeContents(last.nodeType === Node.TEXT_NODE ? last.parentNode : last);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function enhanceEditor(editor) {
    if (!editor || editor.dataset.richMarkdown === 'true') return;
    editor.dataset.richMarkdown = 'true';
    editor.setAttribute('aria-label', 'Discord Markdown message editor');

    const overlay = editor.closest('.preview-inline-overlay');
    const preview = overlay?.parentElement;
    const image = preview?.querySelector(':scope > .preview-media-edit.image');
    if (overlay && image) preview.insertBefore(overlay, image);

    renderEditor(editor, normalize(editor.innerText || editor.textContent || ''));
    editor.addEventListener('input', () => {
      if (editor.dataset.richSync === 'true') return;
      const caret = captureCaret(editor);
      const value = normalize(editor.innerText || editor.textContent || '');
      renderEditor(editor, value);
      restoreCaret(editor, caret);
      editor.dataset.richSync = 'true';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      delete editor.dataset.richSync;
    });
  }

  function stripPrefix(node, length) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let remaining = length;
    let text;
    while (remaining > 0 && (text = walker.nextNode())) {
      const count = Math.min(remaining, text.data.length);
      text.data = text.data.slice(count);
      remaining -= count;
    }
  }

  function upgradePreviewLine(line) {
    if (line.dataset.discordPolished === 'true') return;
    const value = line.textContent || '';
    if (line.classList.contains('preview-line')) {
      if (value.startsWith('### ')) {
        stripPrefix(line, 4);
        line.className = 'preview-heading small';
      } else if (value.startsWith('# ')) {
        stripPrefix(line, 2);
        line.className = 'preview-heading large';
      } else if (/^[-*] /.test(value)) {
        stripPrefix(line, 2);
        line.classList.add('preview-list-line');
      }
    }
    line.dataset.discordPolished = 'true';
  }

  function decorate() {
    qsa('.preview-live-editor').forEach(enhanceEditor);
    qsa('.preview-container .preview-line, .message-preview-container .message-preview-line').forEach(upgradePreviewLine);
  }

  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });
  decorate();
})();