(() => {
  const pickerMenus = new Set();
  const requestIds = new Set();
  const REQUEST_ACTIONS = [
    ['accept', 'Accept request'],
    ['deny', 'Deny request'],
    ['dm_message', 'DM message'],
    ['role_add', 'Role add'],
    ['blacklist', 'Blacklist author'],
  ];
  const REQUEST_ACTION_TEXT = new Map([
    ['accept', 'accept'], ['accept request', 'accept'], ['close', 'accept'], ['close ticket', 'accept'],
    ['deny', 'deny'], ['deny request', 'deny'], ['delete', 'deny'], ['delete channel', 'deny'],
    ['dm', 'dm_message'], ['dm message', 'dm_message'], ['transcript', 'dm_message'], ['save transcript', 'dm_message'],
    ['role_add', 'role_add'], ['role add', 'role_add'], ['role-add', 'role_add'], ['move_to', 'role_add'], ['move to ticket type', 'role_add'],
    ['blacklist', 'blacklist'], ['blacklist author', 'blacklist'], ['blacklist user', 'blacklist'],
  ]);
  const REQUEST_SAVE_ACTIONS = {
    accept: 'close',
    deny: 'delete',
    dm_message: 'transcript',
    dm: 'transcript',
    role_add: 'move_to',
    'role-add': 'move_to',
    blacklist: 'blacklist',
    close: 'close',
    delete: 'delete',
    transcript: 'transcript',
    move_to: 'move_to',
  };
  let allowNativeAdd = false;
  let pendingRequest = false;
  let uiFixScheduled = false;

  function installInlineSurfaceTextPatch() {
    if (HTMLElement.prototype.__coinSpriteInlineTextPatch) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    if (!descriptor?.get || !descriptor?.set) return;
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        if (this.classList?.contains('message-inline-surface')) {
          const lines = [...this.children]
            .filter((child) => child.classList?.contains('message-inline-line'))
            .map((line) => String(line.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
          if (lines.length) return lines.join('\n').replace(/\n+$/g, '');
        }
        return descriptor.get.call(this);
      },
      set(value) {
        descriptor.set.call(this, value);
      },
    });
    HTMLElement.prototype.__coinSpriteInlineTextPatch = true;
  }

  function cleanTabIcons() {
    document.querySelectorAll('.tab-image-icon, .message-tab-icon').forEach((image) => image.remove());
    const sources = {
      leveling: '/admin/images/leveling.png',
      tickets: '/admin/images/ticket.png',
      messages: '/admin/images/message.png',
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

  function ensureLevelUpOutsideField() {
    const content = document.querySelector('#levelUpContent');
    if (!content) return null;
    let field = document.querySelector('#levelUpOutsideContent');
    if (!field) {
      field = document.createElement('textarea');
      field.id = 'levelUpOutsideContent';
      field.name = 'xp.levelUpMessage.outsideContent';
      field.hidden = true;
      field.className = 'message-source-hidden';
      content.after(field);
      field.addEventListener('input', renderLevelUpRootPreview);
      field.addEventListener('change', renderLevelUpRootPreview);
    }
    return field;
  }

  function levelUpRootHtml(value) {
    const context = typeof previewContext === 'function' ? previewContext() : {};
    const rendered = typeof renderPreviewTemplate === 'function'
      ? renderPreviewTemplate(value, context)
      : String(value || '');
    const clean = String(rendered || '').trim();
    if (!clean) return '';
    return typeof previewMarkdown === 'function'
      ? previewMarkdown(clean)
      : clean.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  }

  function levelUpHasContainer() {
    const content = document.querySelector('#levelUpContent')?.value.trim() || '';
    const thumb = document.querySelector('[name="xp.levelUpMessage.thumbnailUrl"]')?.value.trim() || '';
    const image = document.querySelector('[name="xp.levelUpMessage.imageUrl"]')?.value.trim() || '';
    return Boolean(content || thumb || image);
  }

  function renderLevelUpRootPreview() {
    const field = ensureLevelUpOutsideField();
    const preview = document.querySelector('#levelUpPreview');
    const container = document.querySelector('#levelUpPreviewContainer');
    if (!field || !preview || !container) return;
    let root = document.querySelector('#levelUpRootContent');
    if (!root) {
      root = document.createElement('div');
      root.id = 'levelUpRootContent';
      container.before(root);
    }
    const html = levelUpRootHtml(field.value);
    root.className = `message-root-content${html ? '' : ' message-root-empty'}`;
    root.innerHTML = html || 'Add text outside the container';
    container.hidden = !levelUpHasContainer();
    let add = document.querySelector('#levelUpAddContainer');
    if (!add) {
      add = document.createElement('button');
      add.id = 'levelUpAddContainer';
      add.type = 'button';
      add.className = 'button subtle message-add-container';
      add.textContent = '+ Add container';
      preview.append(add);
    }
    add.hidden = levelUpHasContainer();
  }

  function startLevelUpRootEditor(root) {
    const field = ensureLevelUpOutsideField();
    if (!field || root.querySelector('[contenteditable="true"]')) return;
    const original = field.value || '';
    root.classList.add('message-inline-edit-host', 'is-inline-editing');
    const editor = document.createElement('div');
    editor.className = 'message-inline-surface';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = original;
    root.replaceChildren(editor);
    const finish = (commit) => {
      field.value = commit ? String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/g, '') : original;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      root.classList.remove('message-inline-edit-host', 'is-inline-editing');
      renderLevelUpRootPreview();
      refreshDirtyState();
    };
    editor.addEventListener('input', () => {
      field.value = String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
      refreshDirtyState();
    });
    editor.addEventListener('blur', () => finish(true), { once: true });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    editor.focus({ preventScroll: true });
  }

  function setLevelUpContainerStarter() {
    const field = document.querySelector('#levelUpContent');
    if (!field) return;
    field.value = '## Container message\nWrite your container message here.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    renderLevelUpRootPreview();
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

  function requestActionValue(value) {
    return REQUEST_ACTION_TEXT.get(String(value || '').trim().toLowerCase()) || String(value || '').trim();
  }

  function requestActionLabel(value) {
    const normalized = requestActionValue(value);
    return REQUEST_ACTIONS.find(([action]) => action === normalized)?.[1] || value;
  }

  function requestActionSaveValue(value) {
    return REQUEST_SAVE_ACTIONS[requestActionValue(value)] || REQUEST_SAVE_ACTIONS[value] || value;
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

  function controlActionsFromCard(card) {
    return [...card.querySelectorAll('.sequence-item strong')].map((node) => requestActionValue(node.textContent)).filter(Boolean);
  }

  function controlIndexFromCard(card) {
    return card.querySelector('[data-control-index]')?.dataset.controlIndex
      || card.querySelector('[data-index]')?.dataset.index
      || '0';
  }

  function dispatchInput(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function decorateRequestRoleField(card, actions) {
    const existing = card.querySelector('.request-role-add-field');
    const nativeMoveLabel = card.querySelector('select[data-control-field="moveToTicketTypeId"]')?.closest('label');
    if (!actions.includes('role_add')) {
      existing?.remove();
      if (nativeMoveLabel) nativeMoveLabel.hidden = false;
      return;
    }
    if (nativeMoveLabel) nativeMoveLabel.hidden = true;
    const controlIndex = controlIndexFromCard(card);
    let field = existing;
    if (!field) {
      field = document.createElement('label');
      field.className = 'request-role-add-field';
      field.innerHTML = '<span class="field-label">Role to add</span><input type="hidden" data-request-role-value><div data-request-role-picker></div><span class="request-action-note">This role is added to the request author when this control runs.</span>';
      card.querySelector('.action-sequence')?.append(field);
    }
    const hidden = field.querySelector('[data-request-role-value]');
    const nativeSelect = card.querySelector('select[data-control-field="moveToTicketTypeId"]');
    hidden.dataset.controlIndex = controlIndex;
    hidden.dataset.controlField = 'moveToTicketTypeId';
    if (!hidden.value && nativeSelect?.value) hidden.value = nativeSelect.value;
    const mount = field.querySelector('[data-request-role-picker]');
    if (mount && !mount.querySelector('.picker')) {
      renderPicker(mount, roleOptions(), hidden.value, {
        type: 'role',
        placeholder: 'Select role to add',
        onChange: (value) => {
          hidden.value = value;
          dispatchInput(hidden);
          refreshDirtyState();
        },
      });
    }
  }

  function decorateRequestDmField(card, actions) {
    const descriptionInput = card.querySelector('[data-control-field="description"]');
    const descriptionLabel = descriptionInput?.closest('label');
    const existing = card.querySelector('.request-dm-field');
    if (!actions.includes('dm_message')) {
      existing?.remove();
      if (descriptionLabel) descriptionLabel.firstChild.textContent = 'Description ';
      return;
    }
    if (descriptionLabel) {
      descriptionLabel.firstChild.textContent = 'DM message ';
      return;
    }
    const controlIndex = controlIndexFromCard(card);
    let field = existing;
    if (!field) {
      field = document.createElement('label');
      field.className = 'request-dm-field';
      field.innerHTML = '<span class="field-label">DM message</span><textarea rows="3" maxlength="100" data-request-dm-value placeholder="Your <ticket_name> request was reviewed."></textarea><span class="request-action-note">Use &lt;ticket_name&gt; and &lt;reason&gt; in this message.</span>';
      card.querySelector('.action-sequence')?.append(field);
    }
    const textarea = field.querySelector('[data-request-dm-value]');
    textarea.dataset.controlIndex = controlIndex;
    textarea.dataset.controlField = 'description';
  }

  function decorateRequestAdminPanel(root) {
    if (!root.dataset.requestEditor) return;
    root.querySelectorAll('.action-sequence').forEach((sequence) => {
      const hint = sequence.querySelector('.sequence-head span:last-child');
      setText(hint, 'Request actions run in the order shown.');
      const card = sequence.closest('.ticket-control-card');
      sequence.querySelectorAll('.sequence-item strong').forEach((label) => setText(label, requestActionLabel(label.textContent)));
      const actions = card ? controlActionsFromCard(card) : [];
      const select = sequence.querySelector('select[data-action-select]');
      if (select) {
        const signature = actions.join('|');
        if (select.dataset.requestOptionsSignature !== signature) {
          const available = REQUEST_ACTIONS.filter(([value]) => !actions.includes(value));
          select.replaceChildren(...available.map(([value, label]) => new Option(label, value)));
          select.dataset.requestOptionsSignature = signature;
        }
      }
      if (card) {
        decorateRequestDmField(card, actions);
        decorateRequestRoleField(card, actions);
      }
    });
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
      root.querySelectorAll('.ticket-type-tabs .mini-tab').forEach((tab) => {
        if (tab.textContent.trim() === 'Ticket message') setText(tab, 'Request message');
      });
      const settings = root.querySelector('.ticket-type-section');
      const category = [...settings.querySelectorAll('.picker-field')].find((field) => field.querySelector('.field-label')?.textContent.trim() === 'Category override');
      if (category && !category.hidden) category.hidden = true;
      settings.querySelector('.permission-buttons')?.setAttribute('hidden', '');
      const transcript = [...settings.querySelectorAll('.panel')].find((panel) => panel.querySelector('h3')?.textContent.trim() === 'Transcript' || panel.querySelector('h3')?.textContent.trim() === 'Request channel');
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
    }
    decorateRequestAdminPanel(root);
  }

  function defaultRequestControls() {
    return [
      { id: 'accept', name: 'Accept', emoji: '✅', description: '', buttonStyle: 'success', url: '', actions: ['close'], moveToTicketTypeId: '' },
      { id: 'deny', name: 'Deny', emoji: '❌', description: '', buttonStyle: 'danger', url: '', actions: ['delete'], moveToTicketTypeId: '' },
      { id: 'dm-message', name: 'DM Message', emoji: '📩', description: 'Your <ticket_name> request was reviewed.', buttonStyle: 'secondary', url: '', actions: ['transcript'], moveToTicketTypeId: '' },
      { id: 'role-add', name: 'Role Add', emoji: '➕', description: '', buttonStyle: 'success', url: '', actions: ['move_to'], moveToTicketTypeId: '' },
      { id: 'blacklist', name: 'Blacklist', emoji: '🚫', description: '', buttonStyle: 'danger', url: '', actions: ['blacklist'], moveToTicketTypeId: '' },
    ];
  }

  function normalizeRequestControl(control, index) {
    const actions = [...new Set((control.actions || []).map(requestActionSaveValue).filter(Boolean))];
    if (!actions.length) actions.push(index === 0 ? 'close' : 'delete');
    if (control.dmMessage) control.description = control.dmMessage;
    if (control.roleId) control.moveToTicketTypeId = control.roleId;
    control.url = '';
    control.actions = actions;
    return control;
  }

  function normalizeRequestTypeForSave(type, index) {
    if (!String(type.id || '').startsWith('request-')) type.id = `request-${type.id || `ticket-${index + 1}`}`.slice(0, 40);
    requestIds.add(type.id);
    type.transcriptEnabled = true;
    type.authorPermissions = ['UseApplicationCommands'];
    const controls = type.adminPanel?.controls || [];
    if (!controls.length || (controls.length === 1 && controls[0].name === 'Close Ticket')) {
      type.adminPanel = { enabled: true, style: 'buttons', controls: defaultRequestControls() };
    } else {
      type.adminPanel = {
        ...(type.adminPanel || {}),
        enabled: type.adminPanel?.enabled !== false,
        controls: controls.map(normalizeRequestControl),
      };
    }
  }

  document.addEventListener('click', (event) => {
    const addContainer = event.target.closest('#levelUpAddContainer');
    if (addContainer) {
      event.preventDefault();
      setLevelUpContainerStarter();
      return;
    }
    const levelRoot = event.target.closest('#levelUpRootContent');
    if (levelRoot && !event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startLevelUpRootEditor(levelRoot);
      return;
    }
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
      const outside = ensureLevelUpOutsideField();
      if (body.xp?.levelUpMessage && outside) body.xp.levelUpMessage.outsideContent = outside.value.trim();
      const types = body.tickets?.types || [];
      types.forEach((type, index) => {
        const marked = requestIds.has(type.id) || isRequestType(type) || (pendingRequest && index === types.length - 1);
        if (!marked) return;
        normalizeRequestTypeForSave(type, index);
      });
      init = { ...init, body: JSON.stringify(body) };
    }
    return nativeFetch(input, init);
  };

  const originalApply = applyTabFromConfig;
  applyTabFromConfig = function fixedApply(tabName, config) {
    originalApply(tabName, config);
    if (tabName === 'leveling') {
      const outside = ensureLevelUpOutsideField();
      if (outside) outside.value = config.xp?.levelUpMessage?.outsideContent || '';
      renderLevelUpRootPreview();
    }
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
    if (tabName === 'leveling') return { ...value, outsideContent: ensureLevelUpOutsideField()?.value.trim() || '' };
    return tabName === 'games' ? { ...value, wordChainChannel: state.channelValues.wordChain || '', wordChainPunishmentRole: state.roleValues.wordChainPunishment || '' } : value;
  };
  const originalPatch = collectPatch;
  collectPatch = function fixedPatch() {
    const patch = originalPatch();
    patch.channels = { ...patch.channels, wordChain: state.channelValues.wordChain || '' };
    if (patch.xp?.levelUpMessage) patch.xp.levelUpMessage.outsideContent = ensureLevelUpOutsideField()?.value.trim() || '';
    return patch;
  };
  const originalLevelPreview = renderLevelUpPreview;
  renderLevelUpPreview = function fixedLevelPreview() {
    originalLevelPreview();
    renderLevelUpRootPreview();
  };
  const originalSetTab = setActiveTab;
  setActiveTab = function fixedSetTab(tabName) {
    originalSetTab(tabName);
    if (tabName === 'leveling') queueMicrotask(renderLevelUpRootPreview);
    if (tabName === 'games') queueMicrotask(ensureWordChainTools);
    if (tabName === 'tickets') queueMicrotask(decorateTicketEditor);
  };

  function scheduleUiFixes() {
    if (uiFixScheduled) return;
    uiFixScheduled = true;
    requestAnimationFrame(() => {
      uiFixScheduled = false;
      cleanTabIcons();
      renderLevelUpRootPreview();
      ensureWordChainTools();
      decorateTicketEditor();
    });
  }

  installInlineSurfaceTextPatch();
  new MutationObserver(scheduleUiFixes).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => closePickerMenus());
  elements.configForm.addEventListener('scroll', () => closePickerMenus(), { passive: true });
  scheduleUiFixes();
})();
