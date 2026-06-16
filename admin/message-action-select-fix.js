(() => {
  if (window.__coinSpriteActionSelectFix) return;
  window.__coinSpriteActionSelectFix = true;

  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;

  const ACTIONS = [
    ['send_message', 'Send message'],
    ['give_role', 'Give role'],
  ];

  function actionTypes(section) {
    return [...section.querySelectorAll('.message-component-action-card select')]
      .map((select) => select.value)
      .filter((value) => value === 'send_message' || value === 'give_role');
  }

  function option(value, label, disabled = false) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    item.disabled = disabled;
    return item;
  }

  function replaceAddButton(section) {
    const button = section.querySelector('.message-component-add-action');
    if (!button || button.dataset.selectFixInstalled === 'true') return;

    const used = new Set(actionTypes(section));
    const count = section.querySelectorAll('.message-component-action-card').length;
    const select = document.createElement('select');
    select.className = 'message-component-add-action-select';
    select.append(option('', 'Add action', true));
    select.value = '';

    ACTIONS.forEach(([value, label]) => {
      select.append(option(value, label, count >= 2 || used.has(value)));
    });

    select.disabled = button.disabled || count >= 2 || ACTIONS.every(([value]) => used.has(value));
    select.addEventListener('change', () => {
      const value = select.value;
      if (!value) return;
      const currentUsed = new Set(actionTypes(section));
      if (currentUsed.has(value)) {
        select.value = '';
        return;
      }
      button.click();
      select.value = '';
    });

    button.dataset.selectFixInstalled = 'true';
    button.hidden = true;
    button.after(select);
  }

  function decorate() {
    root.querySelectorAll('.message-component-action-editor').forEach(replaceAddButton);
  }

  new MutationObserver(decorate).observe(root, { childList: true, subtree: true });
  decorate();
})();
