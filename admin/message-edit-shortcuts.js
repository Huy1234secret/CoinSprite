(() => {
  if (window.__coinSpriteMessageEditShortcuts) return;
  window.__coinSpriteMessageEditShortcuts = true;

  const EDITOR_SELECTOR = '.message-inline-surface, .preview-live-editor';
  const LIMIT = 100;
  const histories = new WeakMap();
  const syncing = new WeakSet();

  function editorFromEvent(event) {
    const target = event.target;
    return target?.closest?.(EDITOR_SELECTOR) || null;
  }

  function editorValue(editor) {
    return String(editor.innerText || editor.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '');
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

  function setSelection(editor, start, end = start) {
    const range = document.createRange();
    const selection = window.getSelection();
    let remainingStart = Math.max(0, start);
    let remainingEnd = Math.max(0, end);
    let startNode = editor;
    let startOffset = 0;
    let endNode = editor;
    let endOffset = editor.childNodes.length;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const length = node.data.length;
      if (remainingStart <= length && startNode === editor) {
        startNode = node;
        startOffset = remainingStart;
      }
      if (remainingEnd <= length) {
        endNode = node;
        endOffset = remainingEnd;
        break;
      }
      remainingStart -= length;
      remainingEnd -= length;
    }
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setEditorValue(editor, value, selectionStart, selectionEnd = selectionStart) {
    syncing.add(editor);
    editor.textContent = value;
    setSelection(editor, selectionStart, selectionEnd);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => setSelection(editor, selectionStart, selectionEnd));
    syncing.delete(editor);
  }

  function insertTextAtSelection(editor, text) {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (!document.execCommand('insertText', false, text)) {
      const range = window.getSelection()?.getRangeAt(0);
      if (!range) return;
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrapSelection(editor, marker, placeholder) {
    const selection = window.getSelection();
    const hasSelection = Boolean(selection?.rangeCount && editor.contains(selection.anchorNode) && !selection.isCollapsed);
    const selected = hasSelection ? selection.toString() : placeholder;
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
