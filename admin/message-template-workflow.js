(() => {
  if (window.__coinSpriteMessageTemplateWorkflow) return;
  window.__coinSpriteMessageTemplateWorkflow = true;

  function root() {
    return document.querySelector('#messageTemplatesRoot');
  }

  function fixCreateButtons(scope = document) {
    scope.querySelectorAll?.('[data-message-action="create-message"].button.primary').forEach((button) => {
      button.dataset.messageAction = 'create-open'; // FIXED: main Create template button opens the Message/Folder menu.
      button.setAttribute('data-message-action', 'create-open');
    });
  }

  function decorate() {
    const host = root() || document;
    fixCreateButtons(host);
  }

  new MutationObserver(decorate).observe(document.documentElement, { childList: true, subtree: true });
  decorate();
})();
