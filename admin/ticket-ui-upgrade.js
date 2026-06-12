(function ticketUiUpgrade() {
  const EMOJIS = [
    ['😀', 'grinning face happy'], ['😃', 'smile happy'], ['😄', 'smile eyes happy'], ['😁', 'grin happy'],
    ['😂', 'tears joy laugh'], ['🤣', 'rolling laugh'], ['😊', 'blush happy'], ['😍', 'heart eyes love'],
    ['🥰', 'hearts love'], ['😘', 'kiss'], ['😎', 'cool sunglasses'], ['🤔', 'thinking'],
    ['😢', 'cry sad'], ['😭', 'sob cry'], ['😡', 'angry'], ['🥳', 'party celebrate'],
    ['🤯', 'mind blown'], ['😴', 'sleep'], ['🤝', 'handshake'], ['🙏', 'pray thanks'],
    ['👍', 'thumbs up yes'], ['👎', 'thumbs down no'], ['👏', 'clap'], ['👋', 'wave hello'],
    ['💪', 'strong muscle'], ['👌', 'ok'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed'],
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
    ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'],
    ['💯', 'hundred perfect'], ['✨', 'sparkles'], ['⭐', 'star'], ['🌟', 'glowing star'],
    ['🔥', 'fire hot'], ['💥', 'boom impact'], ['💫', 'dizzy star'], ['⚡', 'lightning'],
    ['✅', 'check yes approved'], ['❌', 'cross no denied'], ['⚠️', 'warning'], ['🚫', 'prohibited blocked'],
    ['⛔', 'stop no entry'], ['❗', 'exclamation'], ['❓', 'question'], ['ℹ️', 'information'],
    ['🎫', 'ticket'], ['🎟️', 'admission ticket'], ['🎁', 'gift present'], ['🎉', 'party popper'],
    ['🎊', 'confetti'], ['🏆', 'trophy winner'], ['🥇', 'gold medal'], ['👑', 'crown'],
    ['💎', 'diamond'], ['🪙', 'coin'], ['💰', 'money bag'], ['💳', 'card payment'],
    ['🛒', 'cart shop'], ['🛍️', 'shopping bags'], ['📦', 'package box'], ['📌', 'pin'],
    ['📢', 'announcement loudspeaker'], ['🔔', 'bell notification'], ['📩', 'mail inbox'], ['✉️', 'mail envelope'],
    ['📝', 'memo note'], ['📄', 'document'], ['📎', 'paperclip attachment'], ['🔗', 'link'],
    ['🔒', 'lock private'], ['🔓', 'unlock'], ['🔑', 'key'], ['🛡️', 'shield security'],
    ['⚙️', 'settings gear'], ['🛠️', 'tools'], ['🔧', 'wrench'], ['🔨', 'hammer'],
    ['🧰', 'toolbox'], ['🧹', 'clean broom'], ['🗑️', 'trash delete'], ['🔍', 'search'],
    ['👤', 'user person'], ['👥', 'users group'], ['🧑‍💻', 'developer computer'], ['👮', 'staff police'],
    ['🆘', 'sos help'], ['💬', 'chat message'], ['🗨️', 'speech bubble'], ['📞', 'phone support'],
    ['🎮', 'game controller'], ['🕹️', 'joystick'], ['🏅', 'medal'], ['🚀', 'rocket'],
    ['🌐', 'globe web'], ['📈', 'chart growth'], ['📊', 'chart stats'], ['🧪', 'test lab'],
    ['🐛', 'bug issue'], ['💡', 'idea light'], ['🧠', 'brain'], ['📚', 'books'],
    ['🍀', 'luck clover'], ['🌈', 'rainbow'], ['☀️', 'sun'], ['🌙', 'moon'],
  ];

  function closePicker(menu) {
    menu.classList.remove('open');
    menu.closest('.picker')?.querySelector('.picker-button')?.classList.remove('open');
  }

  function positionPicker(menu) {
    const picker = menu.closest('.picker');
    const button = picker?.querySelector('.picker-button');
    if (!button || !menu.classList.contains('open')) return;

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - viewportPadding - gap;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const available = Math.max(150, openAbove ? availableAbove : availableBelow);
    const height = Math.min(340, available);
    const width = Math.min(rect.width, window.innerWidth - (viewportPadding * 2));
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);

    menu.style.setProperty('--picker-menu-width', `${width}px`);
    menu.style.setProperty('--picker-menu-height', `${height}px`);
    menu.style.setProperty('--picker-list-height', `${Math.max(108, height - 44)}px`);
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';

    if (openAbove) {
      menu.style.top = 'auto';
      menu.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      menu.style.top = `${rect.bottom + gap}px`;
      menu.style.bottom = 'auto';
    }
  }

  function positionOpenPickers() {
    document.querySelectorAll('.picker-menu.open').forEach(positionPicker);
  }

  function setPermissionState(input, state, controls) {
    input.checked = state === 'allow';
    controls.querySelector('.permission-neutral').classList.toggle('active', state === 'neutral');
    controls.querySelector('.permission-allow').classList.toggle('active', state === 'allow');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function upgradePermissionModal(scope = document) {
    scope.querySelectorAll('.ticket-modal').forEach((modal) => {
      modal.querySelector('.ticket-modal-head p')?.remove();
    });

    scope.querySelectorAll('.permission-item:not([data-upgraded])').forEach((item) => {
      const input = item.querySelector('input[data-permission]');
      const originalLabel = item.querySelector('span')?.textContent?.trim();
      if (!input || !originalLabel) return;

      item.dataset.upgraded = 'true';
      const name = document.createElement('span');
      name.className = 'permission-name';
      name.textContent = originalLabel;

      const controls = document.createElement('span');
      controls.className = 'permission-state';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', `${originalLabel} permission`);

      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'permission-deny';
      deny.textContent = 'X';
      deny.disabled = true;
      deny.title = 'Explicit deny is not available for this setting yet';
      deny.setAttribute('aria-label', `Deny ${originalLabel}`);

      const neutral = document.createElement('button');
      neutral.type = 'button';
      neutral.className = 'permission-neutral';
      neutral.textContent = '/';
      neutral.title = 'Use inherited permission';
      neutral.setAttribute('aria-label', `Inherit ${originalLabel}`);

      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'permission-allow';
      allow.textContent = '\u2713';
      allow.title = 'Allow permission';
      allow.setAttribute('aria-label', `Allow ${originalLabel}`);

      controls.append(deny, neutral, allow);
      item.replaceChildren(input, name, controls);
      const refresh = () => {
        neutral.classList.toggle('active', !input.checked);
        allow.classList.toggle('active', input.checked);
      };
      neutral.addEventListener('click', () => setPermissionState(input, 'neutral', controls));
      allow.addEventListener('click', () => setPermissionState(input, 'allow', controls));
      refresh();
    });
  }

  function closeEmojiPickers(except = null) {
    document.querySelectorAll('.emoji-popover.open').forEach((popover) => {
      if (popover !== except) popover.classList.remove('open');
    });
  }

  function positionEmojiPicker(popover, button) {
    if (!popover.classList.contains('open')) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const openAbove = availableBelow < 280 && rect.top > availableBelow;
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    if (openAbove) {
      popover.style.top = 'auto';
      popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      popover.style.top = `${rect.bottom + 6}px`;
      popover.style.bottom = 'auto';
    }
  }

  function upgradeEmojiInput(input) {
    if (!input || input.dataset.emojiPicker === 'true' || input.closest('.emoji-field')) return;
    input.dataset.emojiPicker = 'true';
    const wrapper = document.createElement('span');
    wrapper.className = 'emoji-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-picker-button';
    button.textContent = '☺';
    button.title = 'Choose emoji';
    button.setAttribute('aria-label', 'Choose emoji');

    const popover = document.createElement('span');
    popover.className = 'emoji-popover';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'emoji-search';
    search.placeholder = 'Search emoji';
    search.autocomplete = 'off';
    const grid = document.createElement('span');
    grid.className = 'emoji-grid';
    popover.append(search, grid);

    function draw() {
      const query = search.value.trim().toLowerCase();
      grid.replaceChildren();
      for (const [emoji, keywords] of EMOJIS) {
        if (query && !`${emoji} ${keywords}`.includes(query)) continue;
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'emoji-option';
        option.textContent = emoji;
        option.title = keywords;
        option.addEventListener('click', (event) => {
          event.stopPropagation();
          input.value = emoji;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          popover.classList.remove('open');
          input.focus();
        });
        grid.append(option);
      }
      if (!grid.childElementCount) {
        const empty = document.createElement('span');
        empty.className = 'emoji-empty';
        empty.textContent = 'No emoji found';
        grid.append(empty);
      }
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !popover.classList.contains('open');
      closeEmojiPickers(popover);
      popover.classList.toggle('open', shouldOpen);
      if (shouldOpen) {
        draw();
        positionEmojiPicker(popover, button);
        search.focus();
      }
    });
    search.addEventListener('input', draw);
    popover.addEventListener('click', (event) => event.stopPropagation());
    wrapper.append(button, popover);
  }

  function upgradeEmojiInputs(scope = document) {
    const selector = [
      'input[data-ticket-field="emoji"]',
      'input[data-control-field="emoji"]',
      'input[data-option-field="emoji"]',
    ].join(',');
    if (scope.matches?.(selector)) upgradeEmojiInput(scope);
    scope.querySelectorAll?.(selector).forEach(upgradeEmojiInput);
  }

  document.addEventListener('click', (event) => {
    const picker = event.target.closest('.picker');
    if (picker) {
      requestAnimationFrame(() => {
        const menu = picker.querySelector('.picker-menu.open');
        if (menu) positionPicker(menu);
      });
    }
    if (!event.target.closest('.emoji-field')) closeEmojiPickers();
  });

  document.addEventListener('scroll', () => {
    closeEmojiPickers();
    requestAnimationFrame(positionOpenPickers);
  }, true);

  window.addEventListener('resize', () => {
    closeEmojiPickers();
    document.querySelectorAll('.picker-menu.open').forEach((menu) => {
      if (window.innerWidth < 360) closePicker(menu);
      else positionPicker(menu);
    });
  });

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.ticket-modal, .permission-item') || node.querySelector('.ticket-modal, .permission-item')) {
          upgradePermissionModal(node.matches('.permission-item') ? node.parentElement : node);
        }
        upgradeEmojiInputs(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  upgradePermissionModal();
  upgradeEmojiInputs();
}());
