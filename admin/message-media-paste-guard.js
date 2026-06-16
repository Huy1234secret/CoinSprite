(() => {
  if (window.__coinSpriteMessageMediaPasteGuard) return;
  window.__coinSpriteMessageMediaPasteGuard = true;

  function mediaField(event) {
    const target = event.target;
    return target?.closest?.('.message-media-popover input, .message-media-popover textarea') || null;
  }

  function keepLocal(event) {
    if (!mediaField(event)) return;
    event.stopPropagation();
  }

  function keepLocalImmediate(event) {
    if (!mediaField(event)) return;
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  document.addEventListener('keydown', (event) => {
    if (!mediaField(event)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['v', 'c', 'x', 'a', 'z', 'y'].includes(key)) keepLocalImmediate(event);
  }, true);

  document.addEventListener('beforeinput', keepLocal, true);
  document.addEventListener('input', keepLocal, true);
  document.addEventListener('paste', keepLocalImmediate, true);
  document.addEventListener('copy', keepLocalImmediate, true);
  document.addEventListener('cut', keepLocalImmediate, true);
})();
