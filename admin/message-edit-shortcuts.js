(() => {
  if (window.__coinSpriteMessageEditShortcuts) return;
  window.__coinSpriteMessageEditShortcuts = true;

  if (!document.querySelector('script[src="/admin/message-media-paste-guard.js"]')) {
    const guard = document.createElement('script');
    guard.src = '/admin/message-media-paste-guard.js';
    guard.async = false;
    document.body.append(guard);
  }

  const EDITOR_SELECTOR = '.message-inline-surface, .preview-live-editor';
  const LIMIT = 100;
  const histories = new WeakMap();
  const syncing = new WeakSet();

  function normalize(value) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
  }

  function eventTargetElement(event) {
    const target = event.target;
    return target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement || null;
  }

  function editorFromEvent(event) {
    return eventTargetElement(event)?.closest?.(EDITOR_SELECTOR) || null;
  }

  function lineText(line) {
    return normalize(line?.textContent || '').replace(/\n/g, '');
  }

  function editorValue(editor) {
    if (editor.classList.contains('message-inline-surface') && editor.children.length) {
      return [...editor.children].map(lineText).join('\n');
    }
    return normalize(editor.innerText || editor.textContent || '');
  }

  function directLine(editor, node) {
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (current && current.parentElement !== editor) current = current.parentElement;
    return current?.parentElement === editor ? current : null;
  }

  function offsetBeforeLine(editor, line) {
    const lines = [...editor.children];
    const index = Math.max(0, lines.indexOf(line));
    return lines.slice(0, index).reduce((total, item) => total + lineText(item).length + 1, 0);
  }

  function rangeTextLength(container, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(container);
    try {
      range.setEnd(node, offset);
      return normalize(range.toString()).length;
    } catch {
      return normalize(container.textContent || '').length;
    }
  }

  function pointOffset(editor, node, offset) {
    if (!editor.contains(node)) return 0;
    if (editor.classList.contains('message-inline-surface') && editor.children.length) {
      if (node === editor) {
        return [...editor.children].slice(0, offset).reduce((total, item) => total + lineText(item).length + 1, 0);
      }
      const line = directLine(editor, node);
      if (!line) return editorValue(editor).length;
      return offsetBeforeLine(editor, line) + rangeTextLength(line, node, offset);
    }
    return rangeTextLength(editor, node, offset);
  }

  function selectionOffsets(editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const start = pointOffset(editor, range.startContainer, range.startOffset);
    const end = pointOffset(editor, range.endContainer, range.endOffset);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function selectedText(editor) {
    const offsets = selectionOffsets(editor);
    if (!offsets || offsets.start === offsets.end) return '';
    return editorValue(editor).slice(offsets.start, offsets.end);
  }

  function pointForTextOffset(container, offset) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let node;
    while ((node = walker.nextNode())) {
      const length = normalize(node.data).length;
      if (remaining <= length) return { node, offset: Math.max(0, remaining) };
      remaining -= length;
    }
    return { node: container, offset: container.childNodes.length };
  }

  function setSelection(editor, start, end = start) {
    const range = document.createRange();
    const selection = window.getSelection();
    const value = editorValue(editor);
    let safeStart = Math.max(0, Math.min(start, value.length));
    let safeEnd = Math.max(0, Math.min(end, value.length));

    if (editor.classList.contains('message-inline-surface') && editor.children.length) {
      const lines = [...editor.children];
      const locate = (offset) => {
        let remaining = offset;
        for (const line of lines) {
          const length = lineText(line).length;
          if (remaining <= length) return { line, offset: remaining };
          remaining -= length + 1;
        }
        const line = lines[lines.length - 1] || editor;
        return { line, offset: lineText(line).length };
      };
      const startPoint = locate(safeStart);
      const endPoint = locate(safeEnd);
      const startDom = pointForTextOffset(startPoint.line, startPoint.offset);
      const endDom = pointForTextOffset(endPoint.line, endPoint.offset);
      range.setStart(startDom.node, startDom.offset);
      range.setEnd(endDom.node, endDom.offset);
    } else {
      const startDom = pointForTextOffset(editor, safeStart);
      const endDom = pointForTextOffset(editor, safeEnd);
      range.setStart(startDom.node, startDom.offset);
      range.setEnd(endDom.node, endDom.offset);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  function historyFor(editor) {
    let history = histories.get(editor);
    if (!history) {
      history = { undo: [editorValue(editor)], redo: [] };
      histories.set(editor, history);
    }
    return history;
  }

  function pushHistory(editor, next = editorValue(editor)) {
    if (syncing.has(editor)) return;
    const history = historyFor(editor);
    if (history.undo[history.undo.length - 1] === next) return;
    history.undo.push(next);
    if (history.undo.length > LIMIT) history.undo.shift();
    history.redo = [];
  }

  function setEditorValue(editor, value, selectionStart, selectionEnd = selectionStart) {
    syncing.add(editor);
    editor.textContent = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      setSelection(editor, selectionStart, selectionEnd);
      syncing.delete(editor);
    });
  }

  function replaceSelection(editor, text) {
    editor.focus({ preventScroll: true });
    const value = editorValue(editor);
    const offsets = selectionOffsets(editor) || { start: value.length, end: value.length };
    const insert = normalize(text);
    const next = `${value.slice(0, offsets.start)}${insert}${value.slice(offsets.end)}`;
    setEditorValue(editor, next, offsets.start + insert.length);
  }

  function insertTextAtSelection(editor, text) {
    replaceSelection(editor, text);
  }

  function wrapSelection(editor, marker, placeholder) {
    const hasSelection = Boolean(selectionOffsets(editor) && selectedText(editor));
    const selected = hasSelection ? selectedText(editor) : placeholder;
    pushHistory(editor);
    insertTextAtSelection(editor, `${marker}${selected}${marker}`);
    queueMicrotask(() => pushHistory(editor));
  }

  function applyHistory(editor, direction) {
    const history = historyFor(editor);
    const current = editorValue(editor);
    if (direction === 'undo') {
      if (history.undo.length <= 1) return;
      if (history.undo[history.undo.length - 1] !== current) history.undo.push(current);
      const latest = history.undo.pop();
      history.redo.push(latest);
      const next = history.undo[history.undo.length - 1] || '';
      setEditorValue(editor, next, next.length);
    } else {
      const next = history.redo.pop();
      if (next == null) return;
      history.undo.push(next);
      setEditorValue(editor, next, next.length);
    }
  }

  function writeClipboard(event, text) {
    if (!text) return false;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', text);
    return true;
  }

  document.addEventListener('copy', (event) => {
    const editor = editorFromEvent(event);
    if (!editor) return;
    writeClipboard(event, selectedText(editor));
  }, true);

  document.addEventListener('cut', (event) => {
    const editor = editorFromEvent(event);
    if (!editor) return;
    const text = selectedText(editor);
    if (!writeClipboard(event, text)) return;
    pushHistory(editor);
    replaceSelection(editor, '');
    queueMicrotask(() => pushHistory(editor));
  }, true);

  document.addEventListener('paste', (event) => {
    const editor = editorFromEvent(event);
    if (!editor) return;
    const text = event.clipboardData?.getData('text/plain');
    if (text == null) return;
    event.preventDefault();
    pushHistory(editor);
    replaceSelection(editor, text);
    queueMicrotask(() => pushHistory(editor));
  }, true);

  document.addEventListener('focusin', (event) => {
    const editor = editorFromEvent(event);
    if (editor) historyFor(editor);
  }, true);

  document.addEventListener('input', (event) => {
    const editor = editorFromEvent(event);
    if (!editor || syncing.has(editor)) return;
    queueMicrotask(() => pushHistory(editor));
  }, true);

  document.addEventListener('keydown', (event) => {
    const editor = editorFromEvent(event);
    if (!editor || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      applyHistory(editor, event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      applyHistory(editor, 'redo');
      return;
    }
    const shortcut = event.shiftKey && key === 'x'
      ? ['~~', 'strikethrough text']
      : {
          b: ['**', 'bold text'],
          i: ['*', 'italic text'],
          u: ['__', 'underlined text'],
          e: ['`', 'code'],
        }[key];
    if (!shortcut) return;
    event.preventDefault();
    wrapSelection(editor, shortcut[0], shortcut[1]);
  }, true);
})();
