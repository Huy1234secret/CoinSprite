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

  function selectionOffsets(editor) {
    const selection = window.getSelection();
    const value = editorValue(editor);
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return { start: value.length, end: value.length };
    }
    const range = selection.getRangeAt(0);
    const startRange = document.createRange();
    startRange.selectNodeContents(editor);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.setEnd(range.endContainer, range.endOffset);
    return {
      start: Math.max(0, Math.min(value.length, startRange.toString().length)),
      end: Math.max(0, Math.min(value.length, endRange.toString().length)),
    };
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

  function wrapSelection(editor, marker, placeholder) {
    const value = editorValue(editor);
    const { start, end } = selectionOffsets(editor);
    const selected = value.slice(start, end) || placeholder;
    const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
    pushHistory(editor, value);
    setEditorValue(editor, next, start + marker.length, start + marker.length + selected.length);
    pushHistory(editor, next);
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
