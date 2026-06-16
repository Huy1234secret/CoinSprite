(() => {
  if (window.__coinSpriteMessageMediaPasteGuard) return;
  window.__coinSpriteMessageMediaPasteGuard = true;

  const EVENTS = ['keydown', 'beforeinput', 'input', 'paste', 'copy', 'cut'];

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
