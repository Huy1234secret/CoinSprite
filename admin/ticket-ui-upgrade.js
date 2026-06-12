(function ticketUiUpgrade() {
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
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

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

  document.addEventListener('click', (event) => {
    const picker = event.target.closest('.picker');
    if (picker) {
      requestAnimationFrame(() => {
        const menu = picker.querySelector('.picker-menu.open');
        if (menu) positionPicker(menu);
      });
    }
  });

  document.addEventListener('scroll', () => {
    requestAnimationFrame(positionOpenPickers);
  }, true);

  window.addEventListener('resize', () => {
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
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  upgradePermissionModal();
}());
