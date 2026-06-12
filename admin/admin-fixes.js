(() => {
  const pickerMenus = new Set();
  const requestIds = new Set();
  const requestActionLabels = {
    close: 'Accept request',
    delete: 'Deny request',
    transcript: 'DM message',
    move_to: 'Role-add',
    blacklist: 'Blacklist author',
  };
  const requestActionOrder = ['close', 'delete', 'transcript', 'move_to', 'blacklist'];
  let allowNativeAdd = false;
  let pendingRequest = false;
  let uiFixScheduled = false;
  let templateGuildId = '';
  let requestTemplates = [];
  let templatesLoading = false;

  function cleanTabIcons() {
    document.querySelectorAll('.tab-image-icon, .message-tab-icon').forEach((image) => image.remove());
    const sources = {
      leveling: '/images/leveling.png',
      tickets: '/images/ticket.png',
      messages: '/images/message.png',
    };
    Object.entries(sources).forEach(([tab, source]) => {
      const button = document.querySelector(`.tab[data-tab="${tab}"]`);
      if (!button) return;
      let image = button.querySelector('.tab-icon');
      if (!image) {
        image = document.createElement('img');
        image.className = 'tab-icon';
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        button.prepend(image);
      }
      if (image.getAttribute('src') !== source) image.src = source;
    });
  }

  function closePickerMenus(except = null) {
    pickerMenus.forEach((menu) => menu.classList.toggle('open', menu === except));
    document.querySelectorAll('.picker-button.open').forEach((button) => {
      button.classList.toggle('open', Boolean(except && button.dataset.menuId === except.dataset.menuId));
    });
  }

  function placeMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const top = roomBelow >= 220 ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(420, window.innerHeight - 24) - 6);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)}px`;
    menu.style.top = `${top}px`;
  }

  renderPicker = function fixedPicker(mount, options, selectedValue, settings) {
    const { multiple = false, type = 'channel', placeholder = 'Select', onChange } = settings;
    const selected = new Set(multiple ? selectedValue || [] : selectedValue ? [selectedValue] : []);
    if (mount._pickerMenu) {
      pickerMenus.delete(mount._pickerMenu);
      mount._pickerMenu.remove();
    }
    mount.replaceChildren();
    const picker = document.createElement('div');
    picker.className = 'picker';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-button';
    button.dataset.menuId = `picker-${Math.random().toString(36).slice(2)}`;
    const selectedWrap = document.createElement('span');
    selectedWrap.className = 'selected-wrap';
    const selectedOptions = [...selected].map((id) => optionById(options, id, type));
    if (!selectedOptions.length) {
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
    menu.dataset.menuId = button.dataset.menuId;
    const search = document.createElement('input');
    search.className = 'picker-search';
    search.placeholder = 'Search by name or ID';
    search.autocomplete = 'off';
    const list = document.createElement('div');
    list.className = 'option-list';
    menu.append(search, list);

    function draw() {
      const query = search.value.trim().toLowerCase();
      const filtered = options.filter((option) => !query || (option.searchText || `${option.label} ${option.id}`.toLowerCase()).includes(query));
      list.replaceChildren();
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-option';
        empty.textContent = 'No results';
        list.append(empty);
        return;
      }
      filtered.forEach((option) => {
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
            if (selected.has(option.id)) selected.delete(option.id); else selected.add(option.id);
            onChange([...selected]);
          } else onChange(selected.has(option.id) ? '' : option.id);
          closePickerMenus();
          refreshDirtyState();
        });
        list.append(row);
      });
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = !menu.classList.contains('open');
      closePickerMenus(opening ? menu : null);
      if (opening) {
        draw();
        placeMenu(button, menu);
        search.focus();
      }
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    search.addEventListener('input', draw);
    picker.append(button);
    mount.append(picker);
    document.body.append(menu);
    pickerMenus.add(menu);
    mount._pickerMenu = menu;
  };

  function wordChainOptions() {
    return channelOptions().filter((option) => !['category', 'voice', 'forum'].includes(option.optionType));
  }

  function ensureWordChainTools() {
    const gamesPanel = document.querySelector('[data-panel="games"] .panel');
    const grid = gamesPanel?.querySelector('.grid.three');
    if (!gamesPanel || !grid) return;
    let tools = gamesPanel.querySelector('.word-chain-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'word-chain-tools settings-grid';
      tools.innerHTML = '<div class="picker-field"><span class="field-label">Word chain game channel</span><div id="wordChainChannelMount"></div></div><div class="picker-field" id="wordChainRoleMount"><span class="field-label">Punishment role</span></div>';
      gamesPanel.insertBefore(tools, grid);
    }
    const channelMount = tools.querySelector('#wordChainChannelMount');
    if (channelMount && !channelMount.querySelector('.picker')) {
      renderPicker(channelMount, wordChainOptions(), state.channelValues.wordChain, {
        type: 'channel', placeholder: 'Select word chain channel',
        onChange: (value) => { state.channelValues.wordChain = value; ensureWordChainTools(); },
      });
    }
    const roleMount = tools.querySelector('#wordChainRoleMount');
    const roleField = [...document.querySelectorAll('#rolesGrid .picker-field')]
      .find((field) => field.querySelector('.field-label')?.textContent.trim() === 'Word Chain Punishment');
    if (roleMount && roleField) {
      const picker = roleField.querySelector('.picker');
      if (picker) roleMount.append(picker);
      roleField.remove();
    }
  }

  function isRequestType(type) {
    return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
  }

  function requestDefaultControls() {
    return [
      { id: 'accept', name: 'Accept', emoji: '✅', description: 'Accept the request.', buttonStyle: 'success', url: '', actions: ['close'], moveToTicketTypeId: '' },
      { id: 'deny', name: 'Deny', emoji: '❌', description: 'Deny the request.', buttonStyle: 'danger', url: '', actions: ['delete'], moveToTicketTypeId: '' },
      { id: 'dm-message', name: 'DM message', emoji: '💬', description: 'Your <ticket_name> request was reviewed.', buttonStyle: 'secondary', url: '', actions: ['transcript'], moveToTicketTypeId: '' },
      { id: 'role-add', name: 'Role-add', emoji: '➕', description: 'Add the selected role to the request author.', buttonStyle: 'primary', url: '', actions: ['move_to'], moveToTicketTypeId: '' },
      { id: 'blacklist', name: 'Blacklist', emoji: '🚫', description: 'Blacklist the request author.', buttonStyle: 'danger', url: '', actions: ['blacklist'], moveToTicketTypeId: '' },
    ];
  }

  function normalizeRequestActions(actions, control = {}) {
    const raw = Array.isArray(actions) ? actions : [];
    const mapped = raw.map((action) => ({
      accept: 'close',
      deny: 'delete',
      dm: 'transcript',
      dm_message: 'transcript',
      role_add: 'move_to',
      'role-add': 'move_to',
      close: 'close',
      delete: 'delete',
      transcript: 'transcript',
      move_to: 'move_to',
      blacklist: 'blacklist',
    })[action]).filter((action) => requestActionOrder.includes(action));
    if (mapped.length) return [...new Set(mapped)].slice(0, 5);
    const id = String(control.id || control.name || '').toLowerCase();
    if (id.includes('deny')) return ['delete'];
    if (id.includes('dm') || id.includes('message')) return ['transcript'];
    if (id.includes('role')) return ['move_to'];
    if (id.includes('blacklist')) return ['blacklist'];
    return ['close'];
  }

  function normalizeRequestControl(control, index) {
    const defaults = requestDefaultControls();
    const base = control && typeof control === 'object' ? control : defaults[index] || defaults[0];
    const actions = normalizeRequestActions(base.actions, base);
    const fallback = defaults.find((item) => item.actions[0] === actions[0]) || defaults[index] || defaults[0];
    return {
      ...fallback,
      ...base,
      id: String(base.id || fallback.id).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32) || fallback.id,
      name: base.name || fallback.name,
      emoji: base.emoji || fallback.emoji,
      description: base.description || fallback.description,
      buttonStyle: base.buttonStyle || fallback.buttonStyle,
      url: '',
      actions,
      moveToTicketTypeId: base.moveToTicketTypeId || base.roleId || '',
    };
  }

  function normalizeRequestAdminPanel(type) {
    const panel = type.adminPanel && typeof type.adminPanel === 'object' ? type.adminPanel : {};
    const controls = Array.isArray(panel.controls) && panel.controls.length ? panel.controls : requestDefaultControls();
    type.adminPanel = {
      enabled: panel.enabled !== false,
      style: panel.style === 'select' ? 'select' : 'buttons',
      controls: controls.slice(0, 25).map(normalizeRequestControl),
    };
  }

  function showTicketKindDialog(nativeButton) {
    document.querySelector('.ticket-kind-dialog')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'ticket-modal-backdrop ticket-kind-dialog';
    backdrop.innerHTML = '<section class="ticket-modal ticket-kind-modal" role="dialog" aria-modal="true"><div class="ticket-modal-head"><div><h3>Create ticket type</h3><p>Choose how members submit this ticket.</p></div><button class="icon-button" type="button" data-kind="cancel">×</button></div><div class="ticket-kind-grid"><button type="button" data-kind="channel"><strong>Channel Ticket</strong><span>Create a private Discord channel for the member and staff.</span></button><button type="button" data-kind="request"><strong>Request Ticket</strong><span>Send a request card to staff for approval or denial.</span></button></div></section>';
    backdrop.addEventListener('click', (event) => {
      const kind = event.target.closest('[data-kind]')?.dataset.kind;
      if (!kind && event.target !== backdrop) return;
      backdrop.remove();
      if (!kind || kind === 'cancel') return;
      pendingRequest = kind === 'request';
      setTimeout(() => {
        if (!nativeButton.isConnected) return;
        allowNativeAdd = true;
        nativeButton.click();
        allowNativeAdd = false;
        requestAnimationFrame(decorateTicketEditor);
      }, 0);
    });
    document.body.append(backdrop);
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function updateControlValue(card, index, field, value) {
    let input = card.querySelector(`.request-hidden-value[data-control-index="${index}"][data-control-field="${field}"]`);
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.className = 'request-hidden-value';
      input.dataset.controlIndex = String(index);
      input.dataset.controlField = field;
      card.append(input);
    }
    input.value = value || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function currentEditedTicketType(root) {
    const heading = root.querySelector('.ticket-editor-head h3')?.textContent || '';
    const types = state.ticketEditor?.getValue?.().tickets?.types || [];
    return types.find((type) => heading.includes(type.name)) || null;
  }

  async function loadRequestTemplates() {
    if (!state.guildId || templatesLoading || templateGuildId === state.guildId) return;
    templatesLoading = true;
    try {
      const response = await fetch(`/api/guilds/${state.guildId}/message-templates`);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        requestTemplates = payload.templates || [];
        templateGuildId = state.guildId;
      }
    } catch {
      requestTemplates = [];
    } finally {
      templatesLoading = false;
      scheduleUiFixes();
    }
  }

  function controlActionsFromCard(card) {
    return [...card.querySelectorAll('.sequence-item strong')].map((node) => node.textContent.trim());
  }

  function hasActionLabel(card, internalAction) {
    const labels = controlActionsFromCard(card);
    const oldLabels = {
      close: 'Close ticket', delete: 'Delete channel', transcript: 'Save transcript', move_to: 'Move to ticket type', blacklist: 'Blacklist author',
    };
    return labels.includes(requestActionLabels[internalAction]) || labels.includes(oldLabels[internalAction]) || labels.includes(internalAction);
  }

  function decorateRequestControlCard(card, ticketType) {
    const index = Number(card.querySelector('[data-control-index]')?.dataset.controlIndex ?? card.querySelector('[data-index]')?.dataset.index ?? -1);
    const control = Number.isFinite(index) && index >= 0 ? ticketType?.adminPanel?.controls?.[index] : null;
    card.querySelectorAll('select[data-action-select] option').forEach((option) => {
      if (requestActionLabels[option.value]) option.textContent = requestActionLabels[option.value];
      else option.remove();
    });
    card.querySelectorAll('.sequence-item strong').forEach((strong) => {
      const label = strong.textContent.trim();
      const entry = Object.entries({ 'Close ticket': 'close', 'Delete channel': 'delete', 'Save transcript': 'transcript', 'Move to ticket type': 'move_to', 'Blacklist author': 'blacklist' }).find(([text]) => text === label);
      if (entry) setText(strong, requestActionLabels[entry[1]]);
    });
    const urlLabel = card.querySelector('input[data-control-field="url"]')?.closest('label');
    if (urlLabel) urlLabel.hidden = true;
    if (!card.querySelector('.request-action-note')) {
      const note = document.createElement('div');
      note.className = 'request-action-note';
      note.textContent = 'Request admin buttons only run request actions: accept, deny, DM message, role-add, or blacklist. They do not close or delete ticket channels.';
      card.append(note);
    }
    if (hasActionLabel(card, 'transcript') && !card.querySelector('.request-dm-field')) {
      loadRequestTemplates();
      const field = document.createElement('div');
      field.className = 'request-extra-field request-dm-field';
      const value = control?.description || '';
      const selectedTemplate = value.startsWith('template:') ? value.slice('template:'.length) : '';
      field.innerHTML = `<span class="field-label">DM message</span><select class="request-template-select"><option value="">Custom text</option>${requestTemplates.map((template) => `<option value="${template.id}" ${selectedTemplate === template.id ? 'selected' : ''}>${template.name}</option>`).join('')}</select><textarea rows="3" maxlength="100" placeholder="Message sent to request author. Use template selection above, or write custom text.">${selectedTemplate ? '' : value}</textarea>`;
      const select = field.querySelector('select');
      const textarea = field.querySelector('textarea');
      select.addEventListener('change', () => {
        const next = select.value ? `template:${select.value}` : textarea.value;
        updateControlValue(card, index, 'description', next);
      });
      textarea.addEventListener('input', () => {
        if (!select.value) updateControlValue(card, index, 'description', textarea.value);
      });
      card.append(field);
    }
    if (hasActionLabel(card, 'move_to') && !card.querySelector('.request-role-field')) {
      const oldLabel = card.querySelector('select[data-control-field="moveToTicketTypeId"]')?.closest('label');
      if (oldLabel) oldLabel.hidden = true;
      const field = document.createElement('div');
      field.className = 'request-extra-field request-role-field';
      field.innerHTML = '<span class="field-label">Role to add</span><div class="request-role-picker"></div>';
      card.append(field);
      renderPicker(field.querySelector('.request-role-picker'), roleOptions(), control?.moveToTicketTypeId || '', {
        type: 'role',
        placeholder: 'Select role to add',
        onChange: (value) => updateControlValue(card, index, 'moveToTicketTypeId', value),
      });
    }
  }

  function decorateRequestAdminPanel(root) {
    if (root.dataset.requestEditor !== 'true' && !pendingRequest) return;
    const heading = [...root.querySelectorAll('.panel-heading h3')].find((node) => node.textContent.trim() === 'Admin panel');
    const panel = heading?.closest('.panel');
    if (!panel) return;
    setText(heading, 'Request admin panel');
    setText(panel.querySelector('.panel-heading p'), 'Configure staff review actions for request cards. These are separate from channel-ticket close/delete actions.');
    const ticketType = currentEditedTicketType(root);
    root.querySelectorAll('.ticket-control-card').forEach((card) => decorateRequestControlCard(card, ticketType));
  }

  function decorateTicketEditor() {
    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;
    root.querySelectorAll('.ticket-type-card').forEach((card) => {
      const id = card.dataset.ticketId || '';
      if (id.startsWith('request-') || id === 'request_role_crew_member_plus') requestIds.add(id);
      const request = requestIds.has(id) || id === 'request_role_crew_member_plus';
      let badge = card.querySelector('.ticket-kind-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ticket-kind-badge';
        card.querySelector('.ticket-type-copy')?.append(badge);
      }
      const className = `ticket-kind-badge ${request ? 'request' : 'channel'}`;
      if (badge.className !== className) badge.className = className;
      setText(badge, `Type: ${request ? 'Request' : 'Channel'}`);
    });
    if (pendingRequest && root.querySelector('.ticket-type-section')) {
      root.dataset.requestEditor = 'true';
      const heading = root.querySelector('.ticket-editor-head h3')?.textContent || '';
      root.dataset.pendingRequestName = heading;
    }
    if (root.dataset.requestEditor === 'true') {
      root.querySelectorAll('.ticket-type-tabs .mini-tab').forEach((tab) => {
        if (tab.textContent.trim() === 'Ticket message') setText(tab, 'Request message');
      });
      const settings = root.querySelector('.ticket-type-section');
      const category = [...(settings?.querySelectorAll('.picker-field') || [])].find((field) => field.querySelector('.field-label')?.textContent.trim() === 'Category override');
      if (category && !category.hidden) category.hidden = true;
      settings?.querySelector('.permission-buttons')?.setAttribute('hidden', '');
      const transcript = [...(settings?.querySelectorAll('.panel') || [])].find((panel) => panel.querySelector('h3')?.textContent.trim() === 'Transcript' || panel.querySelector('h3')?.textContent.trim() === 'Request channel');
      if (transcript) {
        setText(transcript.querySelector('h3'), 'Request channel');
        setText(transcript.querySelector('.panel-heading p'), 'Choose where staff receive and review this request.');
        const checkline = transcript.querySelector('.checkline');
        if (checkline && !checkline.hidden) checkline.hidden = true;
        setText(transcript.querySelector('.field-label'), 'Request review channel');
      }
      const phase = root.querySelector('.form-phase-switch');
      if (phase) {
        phase.querySelectorAll('[data-value="close"]').forEach((button) => button.remove());
        setText(phase.querySelector('p'), 'Sent to the request author before the request is submitted.');
      }
      decorateRequestAdminPanel(root);
    }
  }

  document.addEventListener('click', (event) => {
    const add = event.target.closest('#ticketEditorRoot [data-action="add-ticket"]');
    if (add && !allowNativeAdd) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showTicketKindDialog(add);
      return;
    }
    const card = event.target.closest('.ticket-type-card');
    if (card) pendingRequest = requestIds.has(card.dataset.ticketId) || card.dataset.ticketId === 'request_role_crew_member_plus';
    if (event.target.closest('[data-action="back-list"]')) pendingRequest = false;
  }, true);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\/api\/guilds\/\d{16,20}\/config$/.test(url) && String(init.method || 'GET').toUpperCase() === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      const types = body.tickets?.types || [];
      types.forEach((type, index) => {
        const marked = requestIds.has(type.id) || isRequestType(type) || (pendingRequest && index === types.length - 1);
        if (!marked || type.workflow === 'request_role_crew_member_plus') return;
        if (!String(type.id).startsWith('request-')) type.id = `request-${type.id}`.slice(0, 40);
        requestIds.add(type.id);
        type.transcriptEnabled = true;
        type.authorPermissions = ['UseApplicationCommands'];
        type.categoryChannelId = '';
        normalizeRequestAdminPanel(type);
      });
      init = { ...init, body: JSON.stringify(body) };
    }
    return nativeFetch(input, init);
  };

  const originalApply = applyTabFromConfig;
  applyTabFromConfig = function fixedApply(tabName, config) {
    originalApply(tabName, config);
    if (tabName === 'games') {
      state.channelValues.wordChain = config.channels?.wordChain || '';
      ensureWordChainTools();
    }
    if (tabName === 'roles') queueMicrotask(ensureWordChainTools);
    if (tabName === 'tickets') {
      (config.tickets?.types || []).filter(isRequestType).forEach((type) => requestIds.add(type.id));
      queueMicrotask(decorateTicketEditor);
    }
  };
  const originalCollect = collectTabState;
  collectTabState = function fixedCollect(tabName) {
    const value = originalCollect(tabName);
    return tabName === 'games' ? { ...value, wordChainChannel: state.channelValues.wordChain || '', wordChainPunishmentRole: state.roleValues.wordChainPunishment || '' } : value;
  };
  const originalPatch = collectPatch;
  collectPatch = function fixedPatch() {
    const patch = originalPatch();
    patch.channels = { ...patch.channels, wordChain: state.channelValues.wordChain || '' };
    return patch;
  };
  const originalSetTab = setActiveTab;
  setActiveTab = function fixedSetTab(tabName) {
    originalSetTab(tabName);
    if (tabName === 'games') queueMicrotask(ensureWordChainTools);
    if (tabName === 'tickets') queueMicrotask(decorateTicketEditor);
  };

  function scheduleUiFixes() {
    if (uiFixScheduled) return;
    uiFixScheduled = true;
    requestAnimationFrame(() => {
      uiFixScheduled = false;
      cleanTabIcons();
      ensureWordChainTools();
      decorateTicketEditor();
    });
  }

  new MutationObserver(scheduleUiFixes).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => closePickerMenus());
  elements.configForm.addEventListener('scroll', () => closePickerMenus(), { passive: true });
  scheduleUiFixes();
})();
