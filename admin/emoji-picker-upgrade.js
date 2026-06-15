(() => {
  if (window.__coinSpriteEmojiPickerUpgrade) return;
  window.__coinSpriteEmojiPickerUpgrade = true;

  const PICKER_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';
  let pickerImport = null;

  function ensurePicker() {
    if (!pickerImport) pickerImport = import(PICKER_URL).catch(() => null);
    return pickerImport;
  }

  function updateButton(input, button) {
    const value = String(input.value || '').trim();
    const preview = document.createElement('span');
    preview.className = 'emoji-picker-preview';
    preview.textContent = value && !/^<a?:/.test(value) ? value : '☺';
    const label = document.createElement('span');
    label.className = 'emoji-picker-label';
    label.textContent = value ? 'Change emoji' : 'Choose emoji';
    button.replaceChildren(preview, label);
    button.setAttribute('aria-label', label.textContent);
    button.title = label.textContent;
  }

  function enhanceExisting(input) {
    const field = input.closest('.emoji-field');
    const button = field?.querySelector('.emoji-picker-button');
    if (!button || button.dataset.emojiButtonUpgraded) return;
    button.dataset.emojiButtonUpgraded = 'true';
    updateButton(input, button);
    input.addEventListener('input', () => updateButton(input, button));
    input.addEventListener('change', () => updateButton(input, button));
  }

  function position(popover, button) {
    const rect = button.getBoundingClientRect();
    const width = Math.min(430, window.innerWidth - 24);
    const height = Math.min(440, window.innerHeight - 24);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)}px`;
    if (window.innerHeight - rect.bottom < height && rect.top > window.innerHeight - rect.bottom) {
      popover.style.top = 'auto';
      popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      popover.style.top = `${rect.bottom + 6}px`;
      popover.style.bottom = 'auto';
    }
  }

  function attach(input) {
    if (input.dataset.emojiPicker) return enhanceExisting(input);
    input.dataset.emojiPicker = 'true';
    ensurePicker();

    const field = document.createElement('span');
    field.className = 'emoji-field';
    input.parentNode.insertBefore(field, input);
    field.append(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-picker-button';

    const popover = document.createElement('span');
    popover.className = 'emoji-popover emoji-component-popover';
    const picker = document.createElement('emoji-picker');
    picker.className = 'dark';
    picker.addEventListener('emoji-click', (event) => {
      const value = event.detail?.unicode;
      if (!value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      popover.classList.remove('open');
      input.focus({ preventScroll: true });
    });
    popover.append(picker);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('.emoji-popover.open').forEach((node) => {
        if (node !== popover) node.classList.remove('open');
      });
      popover.classList.toggle('open');
      if (popover.classList.contains('open')) position(popover, button);
    });

    field.append(button, popover);
    enhanceExisting(input);
  }

  function upgrade() {
    document.querySelectorAll([
      'input[data-ticket-field="emoji"]',
      'input[data-control-field="emoji"]',
      'input[data-option-field="emoji"]',
      'input[data-component-field="emoji"]',
    ].join(',')).forEach(attach);
    document.querySelectorAll('.emoji-field > input').forEach(enhanceExisting);
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.emoji-field')) {
      document.querySelectorAll('.emoji-popover.open').forEach((popover) => popover.classList.remove('open'));
    }
  });
  document.addEventListener('scroll', () => {
    document.querySelectorAll('.emoji-popover.open').forEach((popover) => {
      const button = popover.closest('.emoji-field')?.querySelector('.emoji-picker-button');
      if (button) position(popover, button);
    });
  }, true);
  window.addEventListener('resize', upgrade);
  new MutationObserver(upgrade).observe(document.body, { childList: true, subtree: true });
  upgrade();
})();
