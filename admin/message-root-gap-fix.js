(() => {
  if (window.__coinSpriteMessageRootGapFix) return;
  window.__coinSpriteMessageRootGapFix = true;

  function loadGuard() {
    if (document.querySelector('script[src="/admin/message-media-paste-guard.js"]')) return;
    const script = document.createElement('script');
    script.src = '/admin/message-media-paste-guard.js';
    script.async = false;
    document.body.append(script);
  }

  function blankLine() {
    const line = document.createElement('div');
    line.className = 'message-preview-line message-preview-empty message-root-gap-line';
    line.setAttribute('aria-hidden', 'true');
    line.innerHTML = '&nbsp;';
    return line;
  }

  function decorate(root = document) {
    root.querySelectorAll?.('.message-root-content.message-root-empty').forEach((host) => {
      const addButton = host.querySelector(':scope > .message-add-root');
      if (addButton) addButton.replaceWith(blankLine());
      if (!host.textContent.trim() && !host.querySelector(':scope > .message-root-gap-line')) host.append(blankLine());
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) decorate(node);
      });
    }
    decorate(document);
  });

  if (document.body) {
    loadGuard();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  decorate(document);
})();
