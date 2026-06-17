(() => {
  if (window.__coinSpriteEmojiPicker) return;
  window.__coinSpriteEmojiPicker = true;

  const COMMON_EMOJIS = ['🎫', '✅', '❌', '⛔', '🚫', '💀', '⭐', '🎁', '🛡️', '📨', '👋', '📌', '📎', '🔒', '🔓', '📝', '⚠️', '🟢', '🟡', '🔴', '💬', '🤖', '🏆', '✨'];
  let popover = null;
  let activeInput = null;

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function style() {
    if (document.querySelector('#coinSpriteEmojiPickerStyle')) return;
    const tag = document.createElement('style');
    tag.id = 'coinSpriteEmojiPickerStyle';
    tag.textContent = `
      .emoji-picker-wrap {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 38px;
        gap: 7px;
        align-items: center;
        width: 100%;
      }

      .emoji-picker-wrap .emoji-picker-input {
        min-width: 0;
      }

      .emoji-picker-button {
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface-2);
        color: var(--text);
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }

      .emoji-picker-button:hover,
      .emoji-picker-button:focus-visible {
        border-color: var(--primary);
        background: var(--surface-3);
        outline: none;
      }

      .emoji-picker-popover {
        position: fixed;
        z-index: 260;
        width: min(318px, calc(100vw - 24px));
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #101218;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
      }

      .emoji-picker-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
      }

      .emoji-picker-close {
        width: 28px;
        height: 28px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface-2);
        color: var(--text);
        cursor: pointer;
      }

      .emoji-picker-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 5px;
      }

      .emoji-choice {
        height: 31px;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: var(--input);
        color: var(--text);
        cursor: pointer;
        font-size: 18px;
      }

      .emoji-choice:hover,
      .emoji-choice:focus-visible,
      .emoji-choice.selected {
        border-color: var(--primary);
        background: var(--surface-2);
        outline: none;
      }

      .emoji-custom-field {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 750;
      }

      .emoji-custom-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
      }

      .emoji-custom-row button {
        min-height: 36px;
        border: 1px solid var(--primary);
        border-radius: 7px;
        background: var(--primary);
        color: #fff;
        cursor: pointer;
        padding: 0 11px;
        font-weight: 800;
      }
    `;
    document.head.append(tag);
  }

  function isEmojiInput(input) {
    if (!input || input.dataset.emojiEnhanced === 'true') return false;
    if (input.classList.contains('emoji-input')) return true;
    if (input.dataset.ticketField === 'emoji') return true;
    if (input.dataset.controlField === 'emoji') return true;
    if (input.dataset.optionField === 'emoji') return true;
    if (input.name && /emoji/i.test(input.name)) return true;
    if (input.id && /emoji/i.test(input.id)) return true;
    return false;
  }

  function emit(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.refreshDirtyState === 'function') window.refreshDirtyState();
  }

  function buttonLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '🙂';
    const custom = text.match(/^<a?:([a-z0-9_]+):(\d{16,20})>$/i);
    return custom ? '🙂' : text.slice(0, 4);
  }

  function syncButton(input) {
    const button = input.closest('.emoji-picker-wrap')?.querySelector('.emoji-picker-button');
    if (button) button.textContent = buttonLabel(input.value);
  }

  function setEmoji(input, value) {
    input.value = value;
    syncButton(input);
    emit(input);
    closePopover();
    input.focus({ preventScroll: true });
  }

  function closePopover() {
    popover?.remove();
    popover = null;
    activeInput = null;
  }

  function place(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const pad = 12;
    document.body.append(node);
    const width = node.offsetWidth || 318;
    const height = node.offsetHeight || 260;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - pad) top = rect.top - height - 8;
    node.style.left = `${Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad))}px`;
    node.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - height - pad))}px`;
  }

  function openPopover(input, anchor) {
    closePopover();
    activeInput = input;
    const box = document.createElement('div');
    box.className = 'emoji-picker-popover';
    const current = String(input.value || '').trim();
    box.innerHTML = `
      <div class="emoji-picker-title"><span>Choose emoji</span><button class="emoji-picker-close" type="button" aria-label="Close emoji picker">×</button></div>
      <div class="emoji-picker-grid">
        ${COMMON_EMOJIS.map((emoji) => `<button class="emoji-choice${emoji === current ? ' selected' : ''}" type="button" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`).join('')}
      </div>
      <label class="emoji-custom-field">Custom emoji or text
        <span class="emoji-custom-row"><input type="text" maxlength="100" value="${escapeHtml(current)}" placeholder="😀 or <:name:123456789012345678>"><button type="button">Apply</button></span>
      </label>
    `;
    box.addEventListener('click', (event) => {
      const choice = event.target.closest('.emoji-choice');
      if (choice) setEmoji(input, choice.dataset.emoji || '');
      if (event.target.closest('.emoji-picker-close')) closePopover();
      if (event.target.closest('.emoji-custom-row button')) {
        setEmoji(input, box.querySelector('.emoji-custom-row input')?.value || '');
      }
      event.stopPropagation();
    });
    box.querySelector('.emoji-custom-row input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        setEmoji(input, event.currentTarget.value || '');
      }
      if (event.key === 'Escape') closePopover();
    });
    popover = box;
    place(box, anchor);
    box.querySelector('.emoji-custom-row input')?.focus({ preventScroll: true });
  }

  function enhance(input) {
    if (!isEmojiInput(input)) return;
    input.dataset.emojiEnhanced = 'true';
    input.classList.add('emoji-picker-input');
    const wrap = document.createElement('span');
    wrap.className = 'emoji-picker-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-picker-button';
    button.setAttribute('aria-label', 'Choose emoji');
    button.textContent = buttonLabel(input.value);
    input.before(wrap);
    wrap.append(input, button);
    input.addEventListener('input', () => syncButton(input));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPopover(input, button);
    });
  }

  function scan() {
    style();
    document.querySelectorAll('input[type="text"], input:not([type])').forEach(enhance);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.emoji-picker-popover,.emoji-picker-button')) return;
    closePopover();
  });
  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();

(() => {
  if (window.__coinSpriteEmojiPickerUpgrade) return;
  window.__coinSpriteEmojiPickerUpgrade = true;

  const PICKER_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';
  let pickerImport = null;

  function ensurePicker() {
    if (!pickerImport) pickerImport = import(PICKER_URL).catch(() => null);
    return pickerImport;
  }

  function emojiPreview(value) {
    const preview = document.createElement('span');
    preview.className = 'emoji-picker-preview';
    const custom = String(value || '').match(/^<(a?):([a-z0-9_]+):(\d{16,20})>$/i);
    if (custom) {
      const image = document.createElement('img');
      image.src = `https://cdn.discordapp.com/emojis/${custom[3]}.${custom[1] ? 'gif' : 'webp'}?size=32&quality=lossless`;
      image.alt = `:${custom[2]}:`;
      preview.append(image);
    } else {
      preview.textContent = value || '☺';
    }
    return preview;
  }

  function updateButton(input, button) {
    const value = String(input.value || '').trim();
    const title = value ? 'Change emoji' : 'Choose emoji';
    button.replaceChildren(emojiPreview(value));
    button.classList.toggle('has-emoji-value', Boolean(value));
    button.setAttribute('aria-label', title);
    button.title = title;
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
      'input[type="text"][name*="emoji" i]',
      'input[type="text"][id*="emoji" i]',
      'input[type="text"][placeholder*="emoji" i]',
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
