(() => {
  const pickerMenus = new Set();
  const fallbackTabIcons = {
    leveling: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAC0klEQVR4nOWXXUhTYRjHf/typnPVSJuW2/KD1CRK01HSRRAEQhfRRRTSTVF3FZV1ERlmUEF213UXxi4qEuquICLQ/CTrQkM2c2q6qUxd82Otebo4eeY8+zDUGfjcPe/H8/+9//e857wHNnoo4g0w5xQJKxVx9nVH1YnasRrCywFRJko8Wl0ZwFqJR6uvjNWZCIiIW5DIkAAStfqlev+PAxsWQL04ScnbQrGtEmWSCoC+2k+MNtrDJpivlpJ5tgiAgGeOryffoLcayX9wWFZcCAoEPHP4vowx8qyHn12jsjFhDszYJxl80hUSu34AbZZOytNKMsisKpTyvrstBCbmoq5OoVKQlL4Jw1ETe54eI+NkfmwAgJGGHrydbgBUqRpy6w6BUoEqRU1eXQUoxbfp2GsHEx8GIwq3WW207Gvgc2WjVAsFWG6UodmaHBuAeQFHTTPB6QAA+tLtZFYVYq4uQ7tDdMPvmqb/YXvUlS+Ef9iH81FHSEyrQm81xgEA/D98OOtDE02X9pNxIk9MBHDcDgHGhRjyheUaQzwH/sboKzsTH4cAUKhDw0ZsPXjbXcsSB9Bmp4XlAU/4MxPzGLpf9MrBIrRFFc/SYb5WKuXz/iDetnB49dJJElmyGkt1max91y0r3RfeQYwXd3nrGXmjAM76juU7YLpSQrJJtC8wPsu8PwiAvsyI8XRBdPXFmkGBwPgsnvcDdJ9/i/u53L2IDmy2ZmI8tVvKHXeaSbboJUdMl0uYah5mtt8bUbjNapOA44XMAZVOQ27tQemy5n7Zy2TTMC7bN6Zaxf1TalXk3qtAoYx7pfx3AMvNcpKMqYB4hAYed4odguhE0CceP13xNrLOFa8ugOFINunHc8RkXsBe00Rw5rfU/8s1zff7bVK+8+JeUgsMKwII8zCRl5KFG/K6f47DAGL9QKxmLNaRObDWEEvrR9yCtYKIVHfd/w3XPf4AadT6ohNi+d4AAAAASUVORK5CYII=',
    tickets: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAtUlEQVR4nGNgGOmAkZACeSWt/5Ra8vDeNZz24JSghsXEOISJXpbjMhfDAbSyHJf5TPgk6eEIrFFATwB3AL18j27f4AmBEesAFmIV7mtmZxDmJVhwwkFY9y+Gm0//EVQ3dELAqfYnCr/Yn4UhzhGi/e6L/wxBHT+xaSMIBjwERh0w6oBRB4w6YMAdgFK70LNRAmshD3gIoDgAXweCmgDZHowQoLUj0M3HGgW0cgQ2cwe8bzjgAACoqTjHn+EJLQAAAABJRU5ErkJggg==',
  };

  function hydrateTabIcons() {
    for (const [tabName, fallback] of Object.entries(fallbackTabIcons)) {
      const image = document.querySelector(`.tab[data-tab="${tabName}"] .tab-icon`);
      if (!image) continue;
      image.addEventListener('error', () => {
        if (image.src !== fallback) image.src = fallback;
      }, { once: true });
    }
  }

  function closePickerMenus(except = null) {
    pickerMenus.forEach((menu) => {
      if (menu !== except) menu.classList.remove('open');
    });
    document.querySelectorAll('.picker-button.open').forEach((button) => {
      const menuId = button.dataset.menuId;
      if (!except || menuId !== except.dataset.menuId) button.classList.remove('open');
    });
  }

  function placeMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const gap = 6;
    const width = Math.max(rect.width, 260);
    const maxWidth = Math.max(260, window.innerWidth - 24);
    menu.style.width = `${Math.min(width, maxWidth)}px`;
    menu.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - Math.min(width, maxWidth) - 12)}px`;
    menu.style.top = `${Math.min(rect.bottom + gap, window.innerHeight - 36)}px`;
  }

  renderPicker = function renderPicker(mount, options, selectedValue, settings) {
    const { multiple = false, type = 'channel', placeholder = 'Select', onChange } = settings;
    const selected = multiple ? new Set(selectedValue || []) : new Set(selectedValue ? [selectedValue] : []);
    if (mount._pickerMenu) {
      pickerMenus.delete(mount._pickerMenu);
      mount._pickerMenu.remove();
      mount._pickerMenu = null;
    }
    mount.replaceChildren();

    const picker = document.createElement('div');
    picker.className = 'picker';
    const button = document.createElement('button');
    button.className = 'picker-button';
    button.type = 'button';
    const menuId = `picker-${Math.random().toString(36).slice(2)}`;
    button.dataset.menuId = menuId;

    const selectedWrap = document.createElement('span');
    selectedWrap.className = 'selected-wrap';
    const selectedOptions = [...selected].map((id) => optionById(options, id, type));
    if (selectedOptions.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'placeholder';
      empty.textContent = placeholder;
      selectedWrap.append(empty);
    } else {
      selectedOptions.slice(0, multiple ? 5 : 1).forEach((option) => selectedWrap.append(makeToken(option, type)));
      if (selectedOptions.length > 5) {
        const more = document.createElement('span');
        more.className = 'token';
        more.textContent = `+${selectedOptions.length - 5}`;
        selectedWrap.append(more);
      }
    }
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = 'v';
    button.append(selectedWrap, chevron);

    const menu = document.createElement('div');
    menu.className = 'picker-menu picker-portal-menu';
    menu.dataset.menuId = menuId;
    const search = document.createElement('input');
    search.className = 'picker-search';
    search.placeholder = 'Search by name or ID';
    search.autocomplete = 'off';
    const optionList = document.createElement('div');
    optionList.className = 'option-list';
    menu.append(search, optionList);

    function drawOptions() {
      const query = search.value.trim().toLowerCase();
      const filtered = options.filter((option) => {
        const haystack = option.searchText || `${option.label} ${option.id}`.toLowerCase();
        return !query || haystack.includes(query);
      });
      optionList.replaceChildren();
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-option';
        empty.textContent = 'No results';
        optionList.append(empty);
        return;
      }
      for (const option of filtered) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `option ${type === 'role' ? 'role-option' : ''}${selected.has(option.id) ? ' selected' : ''}`;
        if (type === 'role') row.style.setProperty('--role-color', option.color || '#99aab5');
        const main = document.createElement('span');
        main.className = 'option-main';
        main.append(makeToken(option, type));
        const check = document.createElement('span');
        check.className = 'check-mark';
        check.textContent = selected.has(option.id) ? 'Selected' : '';
        row.append(main, check);
        row.addEventListener('click', () => {
          if (multiple) {
            if (selected.has(option.id)) selected.delete(option.id);
            else selected.add(option.id);
            onChange([...selected]);
          } else {
            onChange(selected.has(option.id) ? '' : option.id);
          }
          closePickerMenus();
          refreshDirtyState();
        });
        optionList.append(row);
      }
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !menu.classList.contains('open');
      closePickerMenus(open ? menu : null);
      menu.classList.toggle('open', open);
      button.classList.toggle('open', open);
      if (open) {
        drawOptions();
        placeMenu(button, menu);
        search.focus();
      }
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    search.addEventListener('input', drawOptions);
    picker.append(button);
    mount.append(picker);
    document.body.append(menu);
    pickerMenus.add(menu);
    mount._pickerMenu = menu;
  };

  window.addEventListener('resize', () => {
    document.querySelectorAll('.picker-menu.open').forEach((menu) => {
      const button = document.querySelector(`.picker-button[data-menu-id="${menu.dataset.menuId}"]`);
      if (button) placeMenu(button, menu);
    });
  });
  elements.configForm.addEventListener('scroll', () => closePickerMenus(), { passive: true });

  function wordChainChannelOptions() {
    return channelOptions().filter((option) => !['category', 'voice', 'forum'].includes(option.optionType));
  }

  function ensureWordChainChannelPicker() {
    let mount = document.querySelector('#wordChainChannelMount');
    if (mount) return mount;
    const gamesPanel = document.querySelector('[data-panel="games"] .panel');
    const grid = gamesPanel?.querySelector('.grid.three');
    if (!gamesPanel || !grid) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'game-channel-setting';
    wrapper.innerHTML = `
      <div class="picker-field">
        <span class="field-label">Word chain game channel</span>
        <div id="wordChainChannelMount"></div>
      </div>
    `;
    gamesPanel.insertBefore(wrapper, grid);
    mount = wrapper.querySelector('#wordChainChannelMount');
    return mount;
  }

  function renderWordChainChannelPicker() {
    const mount = ensureWordChainChannelPicker();
    if (!mount) return;
    renderPicker(mount, wordChainChannelOptions(), state.channelValues.wordChain, {
      type: 'channel',
      placeholder: 'Select word chain channel',
      onChange: (value) => {
        state.channelValues.wordChain = value;
        renderWordChainChannelPicker();
      },
    });
  }

  const originalApplyTabFromConfig = applyTabFromConfig;
  applyTabFromConfig = function patchedApplyTabFromConfig(tabName, config) {
    originalApplyTabFromConfig(tabName, config);
    if (tabName === 'games') {
      state.channelValues.wordChain = config.channels?.wordChain || '';
      renderWordChainChannelPicker();
    }
  };

  const originalCollectTabState = collectTabState;
  collectTabState = function patchedCollectTabState(tabName) {
    const value = originalCollectTabState(tabName);
    if (tabName === 'games') {
      return {
        ...value,
        wordChainChannel: state.channelValues.wordChain || '',
      };
    }
    return value;
  };

  const originalCollectPatch = collectPatch;
  collectPatch = function patchedCollectPatch() {
    const patch = originalCollectPatch();
    patch.channels = {
      ...patch.channels,
      wordChain: state.channelValues.wordChain || '',
    };
    return patch;
  };

  const originalSetActiveTab = setActiveTab;
  setActiveTab = function patchedSetActiveTab(tabName) {
    originalSetActiveTab(tabName);
    if (tabName === 'games') renderWordChainChannelPicker();
  };

  hydrateTabIcons();
})();
