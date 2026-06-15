(() => {
  if (window.__coinSpriteMessageComponentActions) return;
  window.__coinSpriteMessageComponentActions = true;

  const root = document.querySelector('#messageTemplatesRoot');
  if (!root) return;

  const templates = new Map();
  const nativeFetch = window.fetch.bind(window);
  let guildId = '';
  let selectedId = '';
  let roles = [];
  let queued = false;
  let saveTimer = null;

  const messageApi = (url) => String(url || '').match(/\/api\/guilds\/(\d{16,20})\/message-templates(?:\/([a-z0-9_-]{1,40}))?/);
  const defaultResponses = new Set(['Thanks, <@mention>!', 'You selected this option, <@mention>.']);

  function normalizeTemplate(template) {
    if (!template?.id) return null;
    templates.set(template.id, template);
    return template;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const match = messageApi(url);
    const response = await nativeFetch(input, init);
    if (match && response.ok) {
      guildId = match[1];
      response.clone().json().then((payload) => {
        for (const template of payload.templates || (payload.template ? [payload.template] : [])) normalizeTemplate(template);
        if (payload.template) selectedId = payload.template.id;
        schedule();
      }).catch(() => null);
    }
    return response;
  };

  function currentTemplate() {
    if (selectedId && templates.has(selectedId)) return templates.get(selectedId);
    const name = root.querySelector('[data-template-field="name"]')?.value;
    if (!name) return null;
    const matches = [...templates.values()].filter((template) => template.name === name);
    if (matches.length === 1) {
      selectedId = matches[0].id;
      return matches[0];
    }
    return null;
  }

  function setSaveState(text, stateName) {
    const status = root.querySelector('#messageSaveState');
    if (!status) return;
    status.textContent = text;
    status.className = `message-save-state ${stateName}`;
  }

  function xhrJson(method, url, body) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, url);
      request.responseType = 'json';
      request.setRequestHeader('Content-Type', 'application/json');
      request.onload = () => {
        const payload = request.response || {};
        if (request.status >= 200 && request.status < 300) resolve(payload);
        else reject(new Error(payload.error || `Request failed (${request.status})`));
      };
      request.onerror = () => reject(new Error('Network request failed.'));
      request.send(body == null ? null : JSON.stringify(body));
    });
  }

  function queueSave() {
    clearTimeout(saveTimer);
    setSaveState('Unsaved changes', 'pending');
    saveTimer = setTimeout(saveActions, 450);
  }

  async function saveActions() {
    const template = currentTemplate();
    if (!template || !guildId) return;
    setSaveState('Saving...', 'pending');
    try {
      const payload = await xhrJson('PUT', `/api/guilds/${guildId}/message-templates/${template.id}`, template);
      normalizeTemplate(payload.template);
      await nativeFetch(`/api/guilds/${guildId}/message-templates`).catch(() => null);
      setSaveState('Saved', 'success');
      schedule();
    } catch (error) {
      setSaveState(error.message, 'error');
    }
  }

  async function loadRoles() {
    if (!guildId || roles.length) return;
    try {
      const response = await nativeFetch(`/api/guilds/${guildId}/directory`);
      const payload = await response.json();
      roles = payload.directory?.roles || [];
      schedule();
    } catch {
      roles = [];
    }
  }

  function actionFromLegacy(item) {
    if (item?.actionType === 'give_role' || item?.roleId) {
      return { type: 'give_role', roleId: item.roleId || '', reverse: Boolean(item.reverse) };
    }
    if (item?.actionType === 'send_message' || item?.templateId || defaultResponses.has(item?.response)) {
      return { type: 'send_message', templateId: item.templateId || '' };
    }
    if (item?.response) return { type: 'legacy_response', response: item.response };
    return { type: 'send_message', templateId: '' };
  }

  function actionsFor(item) {
    if (!Array.isArray(item.actions) || !item.actions.length) item.actions = [actionFromLegacy(item)];
    item.actions = item.actions.slice(0, 2).map((action) => ({ ...action, type: action.type || action.actionType || 'send_message' }));
    delete item.actionType;
    delete item.templateId;
    delete item.roleId;
    delete item.reverse;
    delete item.response;
    return item.actions;
  }

  function itemFor(editor, template) {
    const field = editor.querySelector('[data-row-index][data-item-index]');
    const row = template?.componentRows?.[Number(field?.dataset.rowIndex)];
    if (!row) return null;
    return row.type === 'select'
      ? row.options?.[Number(field.dataset.itemIndex)]
      : row.buttons?.[Number(field.dataset.itemIndex)];
  }

  function option(value, label, selected, disabled = false) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    node.selected = value === selected;
    node.disabled = disabled;
    return node;
  }

  function rebuild(editor) {
    editor.dataset.messageActionSignature = '';
    editor.querySelector('.message-component-action-editor')?.remove();
    schedule();
  }

  function fallbackRolePicker(mount, action, editor) {
    const select = document.createElement('select');
    select.append(option('', 'Select a role', action.roleId || ''));
    roles.forEach((role) => select.append(option(role.id, role.name, action.roleId || '')));
    select.addEventListener('change', () => {
      action.roleId = select.value;
      queueSave();
      rebuild(editor);
    });
    mount.append(select);
  }

  function mountRolePicker(mount, action, editor) {
    const roleItems = roles.map((role) => ({ ...role, label: role.name, optionType: 'role' }));
    try {
      if (typeof renderPicker === 'function') {
        renderPicker(mount, roleItems, action.roleId || '', {
          type: 'role',
          placeholder: 'Select role',
          onChange: (value) => {
            action.roleId = value;
            queueSave();
            rebuild(editor);
          },
        });
        return;
      }
    } catch {}
    fallbackRolePicker(mount, action, editor);
  }

  function resetAction(action, type) {
    for (const key of Object.keys(action)) delete action[key];
    action.type = type;
    if (type === 'send_message') action.templateId = '';
    if (type === 'give_role') Object.assign(action, { roleId: '', reverse: false });
    if (type === 'legacy_response') action.response = '';
  }

  function buildActionCard(editor, item, action, index) {
    const actions = actionsFor(item);
    const card = document.createElement('div');
    card.className = 'message-component-action-card';

    const heading = document.createElement('div');
    heading.className = 'message-component-action-head';
    const title = document.createElement('strong');
    title.textContent = `Action ${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button danger-text';
    remove.textContent = '×';
    remove.title = 'Remove action';
    remove.disabled = actions.length <= 1;
    remove.addEventListener('click', () => {
      if (actions.length <= 1) return;
      actions.splice(index, 1);
      queueSave();
      rebuild(editor);
    });
    heading.append(title, remove);
    card.append(heading);

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Action type';
    const typeSelect = document.createElement('select');
    const used = new Set(actions.map((entry, entryIndex) => entryIndex === index ? '' : entry.type));
    typeSelect.append(
      option('send_message', 'Send message', action.type, used.has('send_message')),
      option('give_role', 'Give role', action.type, used.has('give_role')),
    );
    if (action.type === 'legacy_response') typeSelect.append(option('legacy_response', 'Existing text response', action.type));
    typeSelect.addEventListener('change', () => {
      resetAction(action, typeSelect.value);
      queueSave();
      rebuild(editor);
    });
    typeLabel.append(typeSelect);
    card.append(typeLabel);

    if (action.type === 'send_message') {
      const templateLabel = document.createElement('label');
      templateLabel.textContent = 'Message template';
      const templateSelect = document.createElement('select');
      templateSelect.append(option('', 'Select a template', action.templateId || ''));
      [...templates.values()].forEach((template) => {
        templateSelect.append(option(template.id, template.name, action.templateId || ''));
      });
      templateSelect.addEventListener('change', () => {
        action.templateId = templateSelect.value;
        queueSave();
      });
      templateLabel.append(templateSelect);
      card.append(templateLabel);
    } else if (action.type === 'give_role') {
      const roleField = document.createElement('div');
      roleField.className = 'picker-field message-component-role-field';
      const roleLabel = document.createElement('span');
      roleLabel.className = 'field-label';
      roleLabel.textContent = 'Role';
      const roleMount = document.createElement('div');
      roleField.append(roleLabel, roleMount);
      card.append(roleField);
      mountRolePicker(roleMount, action, editor);

      const reverse = document.createElement('label');
      reverse.className = 'checkline message-component-reverse';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(action.reverse);
      checkbox.addEventListener('change', () => {
        action.reverse = checkbox.checked;
        queueSave();
      });
      const copy = document.createElement('span');
      copy.innerHTML = '<strong>Reverse</strong><small>Remove the role when the member selects this action again.</small>';
      reverse.append(checkbox, copy);
      card.append(reverse);
    } else {
      const legacy = document.createElement('label');
      legacy.textContent = 'Existing response';
      const textarea = document.createElement('textarea');
      textarea.rows = 2;
      textarea.maxLength = 2000;
      textarea.value = action.response || '';
      textarea.addEventListener('input', () => {
        action.response = textarea.value;
        queueSave();
      });
      legacy.append(textarea);
      card.append(legacy);
    }
    return card;
  }

  function buildActionEditor(editor, item) {
    const actions = actionsFor(item);
    const section = document.createElement('div');
    section.className = 'message-component-action-editor message-component-wide';

    const heading = document.createElement('div');
    heading.className = 'message-component-actions-heading';
    const copy = document.createElement('div');
    copy.innerHTML = `<strong>Actions</strong><span>Run one or two actions when this component is selected.</span>`;
    const count = document.createElement('span');
    count.textContent = `${actions.length}/2`;
    heading.append(copy, count);
    section.append(heading);

    const list = document.createElement('div');
    list.className = 'message-component-action-list';
    actions.forEach((action, index) => list.append(buildActionCard(editor, item, action, index)));
    section.append(list);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'button subtle message-component-add-action';
    add.textContent = '+ Add action';
    add.disabled = actions.length >= 2;
    add.addEventListener('click', () => {
      if (actions.length >= 2) return;
      const used = new Set(actions.map((action) => action.type));
      actions.push(used.has('send_message')
        ? { type: 'give_role', roleId: '', reverse: false }
        : { type: 'send_message', templateId: '' });
      queueSave();
      rebuild(editor);
    });
    section.append(add);
    return section;
  }

  function decorateEditor(editor, template) {
    const item = itemFor(editor, template);
    if (!item) return;
    const style = editor.querySelector('[data-component-field="style"]')?.value;
    editor.querySelector('[data-component-field="response"]')?.closest('label')?.remove();
    if (style === 'link') {
      editor.querySelector('.message-component-action-editor')?.remove();
      return;
    }
    const actions = actionsFor(item);
    const signature = `${JSON.stringify(actions)}:${templates.size}:${roles.length}`;
    if (editor.dataset.messageActionSignature === signature && editor.querySelector('.message-component-action-editor')) return;
    editor.dataset.messageActionSignature = signature;
    editor.querySelector('.message-component-action-editor')?.remove();
    editor.querySelector('.message-component-grid')?.append(buildActionEditor(editor, item));
  }

  function decorate() {
    const template = currentTemplate();
    if (!template) return;
    loadRoles();
    root.querySelectorAll('.message-button-editor, .message-select-option-editor').forEach((editor) => decorateEditor(editor, template));
    const heading = root.querySelector('.message-components-heading p');
    if (heading) heading.textContent = 'Add interactive components and run up to two actions from each button or selection option.';
    root.querySelectorAll('.message-component-row-head span').forEach((description) => {
      if (/receive the configured response/i.test(description.textContent)) {
        description.textContent = 'Users choose one or more options and run the configured actions.';
      }
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }

  root.addEventListener('click', (event) => {
    const card = event.target.closest('.message-template-card[data-id]');
    if (card) selectedId = card.dataset.id;
    if (event.target.closest('[data-message-action="back"]')) selectedId = '';
  }, true);

  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
})();
