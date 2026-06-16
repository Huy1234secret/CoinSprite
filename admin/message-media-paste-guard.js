(() => {
  if (window.__coinSpriteMessageMediaPasteGuard) return;
  window.__coinSpriteMessageMediaPasteGuard = true;

  const EVENTS = ['keydown', 'beforeinput', 'input', 'copy', 'cut'];

  function insertText(field, text) {
    const value = String(field.value || '');
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    field.value = next;
    const cursor = start + text.length;
    field.setSelectionRange?.(cursor, cursor);
    field.dispatchEvent(new Event('input', { bubbles: false }));
  }

  function guardField(field) {
    if (!field || field.dataset.mediaPasteGuard === 'true') return;
    field.dataset.mediaPasteGuard = 'true';
    EVENTS.forEach((name) => {
      field.addEventListener(name, (event) => {
        if (name === 'keydown') {
          const key = event.key.toLowerCase();
          if (!(event.ctrlKey || event.metaKey) || !['v', 'c', 'x', 'a', 'z', 'y'].includes(key)) return;
        }
        event.stopPropagation();
      });
    });
    field.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text == null) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      insertText(field, text);
      field.focus({ preventScroll: true });
    });
  }

  function scan(root = document) {
    root.querySelectorAll?.('.message-media-popover input, .message-media-popover textarea').forEach(guardField);
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });

  scan(document);
})();
