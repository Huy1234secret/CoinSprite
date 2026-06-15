(() => {
  const root = document.querySelector('#messageTemplatesRoot');
  if (!root || root.__coinSpriteMessageTabEditorGuard) return;
  root.__coinSpriteMessageTabEditorGuard = true;

  root.addEventListener('click', (event) => {
    if (!event.target.closest?.('.message-inline-surface')) return;
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);
})();
