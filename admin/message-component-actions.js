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

  function actionType(item) {
    if (item?.actionType === 'give_role') return 'give_role';
    return 'send_message';
  }

  function itemFor(editor, template) {
    const field = editor.querySelector('[data-row-index][data-item-index]');
    const row = template?.componentRows?.[Number(field?.dataset.rowIndex)];
    if (!row) return null;
    return row.type === 'select'
      ? row.options?.[Number(field.dataset.itemIndex)]
      : row.buttons?.[Number(field.dataset.itemIndex)];
  }

  function option(value, label, selected) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    node.selected = value === selected;
    return node;
  }

  function rebuild(editor) {
    editor.dataset.messageActionSignature = '';
    editor.querySelector('.message-component-action-editor')?.remove();
    schedule();
  }

  function fallbackRolePicker(mount, item, editor) {
    const select = document.createElement('select');
    select.append(option('', 'Select a role', item.roleId || ''));
    roles.forEach((role) => select.append(option(role.id, role.name, item.roleId || '')));
    select.addEventListener('change', () => {
      item.roleId = select.value;
      queueSave();
      rebuild(editor);
    });
    mount.append(select);
  }

  function mountRolePicker(mount, item, editor) {
    const roleItems = roles.map((role) => ({ ...role, label: role.name, optionType: 'role' }));
    try {
      if (typeof renderPicker === 'function') {
        renderPicker(mount, roleItems, item.roleId || '', {
          type: 'role',
          placeholder: 'Select role',
          onChange: (value) => {
            item.roleId = value;
            queueSave();
            rebuild(editor);
          },
        });
        return;
      }
    } catch {}
    fallbackRolePicker(mount, item, editor);
  }

  function buildActionEditor(editor, item) {
    const type = actionType(item);
    item.actionType = type;
    const section = document.createElement('div');
    section.className = 'message-component-action-editor message-component-wide';

    const actionLabel = document.createElement('label');
    actionLabel.textContent = 'Action';
    const actionSelect = document.createElement('select');
    actionSelect.append(
      option('send_message', 'Send message', type),
      option('give_role', 'Give role', type),
    );
    actionLabel.append(actionSelect);
    section.append(actionLabel);

    actionSelect.addEventListener('change', () => {
      item.actionType = actionSelect.value;
      queueSave();
      rebuild(editor);
    });

    if (type === 'send_message') {
      const templateLabel = document.createElement('label');
      templateLabel.textContent = 'Message template';
      const templateSelect = document.createElement('select');
      templateSelect.append(option('', 'Select a template', item.templateId || ''));
      [...templates.values()].forEach((template) => {
        templateSelect.append(option(template.id, template.name, item.templateId || ''));
      });
      templateSelect.addEventListener('change', () => {
        item.templateId = templateSelect.value;
        queueSave();
      });
      templateLabel.append(templateSelect);
      section.append(templateLabel);
    } else {
      const roleField = document.createElement('div');
      roleField.className = 'picker-field message-component-role-field';
      const roleLabel = document.createElement('span');
      roleLabel.className = 'field-label';
      roleLabel.textContent = 'Role';
      const roleMount = document.createElement('div');
      roleField.append(roleLabel, roleMount);
      section.append(roleField);
      mountRolePicker(roleMount, item, editor);

      const reverse = document.createElement('label');
      reverse.className = 'checkline message-component-reverse';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.reverse);
      checkbox.addEventListener('change', () => {
        item.reverse = checkbox.checked;
        queueSave();
      });
      const copy = document.createElement('span');
      copy.innerHTML = '<strong>Reverse</strong><small>Remove the role when the member selects this action again.</small>';
      reverse.append(checkbox, copy);
      section.append(reverse);
    }
    return section;
  }

  function decorateEditor(editor, template) {
    const item = itemFor(editor, template);
    if (!item) return;
    const style = editor.querySelector('[data-component-field="style"]')?.value;
    const response = editor.querySelector('[data-component-field="response"]');
    response?.closest('label')?.remove();
    if (style === 'link') {
      editor.querySelector('.message-component-action-editor')?.remove();
      return;
    }
    const signature = `${actionType(item)}:${item.templateId || ''}:${item.roleId || ''}:${Boolean(item.reverse)}:${templates.size}:${roles.length}`;
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
    if (heading) heading.textContent = 'Add interactive components and choose what each button or selection option does.';
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
