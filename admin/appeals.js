(() => {
  if (window.CoinSpriteAppealAdmin?.version >= 2) return;

  const TYPES = ['text', 'number', 'choice', 'checkbox', 'file'];
  const TYPE_LABELS = { text: 'Text', number: 'Number', choice: 'Multiple choice', checkbox: 'Checkbox', file: 'File upload' };
  const TOKENS = ['<appeal-id>', '<case-id>', '<@mention>', '<user-id>', '<punishment>', '<case-reason>', '<form-answers>', '<evidence>', '<public-note>', '<avatar_url>'];
  const PREVIEW = {
    'appeal-id': 'A-000001', 'case-id': 'W-000001', '@mention': '@someone', mention: '@someone',
    'user-id': '123456789012345678', punishment: 'warning', 'case-reason': 'Example case reason',
    'form-answers': '**Why should this case be reconsidered?** Example response', evidence: 'evidence.png',
    'public-note': 'No public note', avatar_url: '/bot-avatar.png',
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);

  let data = defaults();
  let directory = {};
  let directoryGuildId = '';
  let directoryLoading = false;
  let guildId = '';
  let root = null;
  let view = 'appeal-settings';
  let selectedField = 0;

  function logTemplate() {
    return {
      id: 'appeal-log-message',
      name: 'Appeal log message',
      content: '',
      containers: [{
        id: 'appeal-summary',
        accentColor: '#FEE75C',
        text: '## Appeal <appeal-id>\n**User:** <@mention> (<user-id>)\n**Case:** <case-id>\n**Punishment:** <punishment>\n**Reason:** <case-reason>\n<separator>\n**Appeal answers**\n<form-answers>',
        thumbnailUrl: '<avatar_url>',
        imageUrl: '',
      }],
      componentRows: [],
    };
  }

  function defaultQuestion(index = 0) {
    return {
      id: 'question-' + (index + 1),
      order: index + 1,
      type: 'text',
      label: index ? 'Question ' + (index + 1) : 'Why should this case be reconsidered?',
      description: '',
      required: index === 0,
      style: 'paragraph',
      placeholder: '',
      minLength: 0,
      maxLength: 4000,
    };
  }

  function defaults() {
    return {
      enabled: false,
      cooldownSeconds: 0,
      maxSubmissionsPerCase: null,
      logChannelId: '',
      questions: [defaultQuestion(0)],
      logMessage: logTemplate(),
    };
  }

  function normalize(value = {}) {
    const next = { ...defaults(), ...clone(value || {}) };
    next.questions = (Array.isArray(value.questions) && value.questions.length ? value.questions : [defaultQuestion(0)])
      .slice(0, 10)
      .map((field, index) => ({
        ...field,
        id: String(field.id || 'question-' + (index + 1)),
        order: index + 1,
        type: TYPES.includes(field.type) ? field.type : 'text',
        label: String(field.label || 'Question ' + (index + 1)),
        description: String(field.description || ''),
        required: Boolean(field.required),
      }));
    next.logMessage = window.CoinSpriteRichEditor?.normalize(value.logMessage || logTemplate()) || value.logMessage || logTemplate();
    return next;
  }

  function optionsFor(field) {
    const options = Array.isArray(field.options) ? field.options : [];
    return options.length >= 2 ? options : [{ id: 'option-1', label: 'Option 1' }, { id: 'option-2', label: 'Option 2' }];
  }

  function resetType(field, type) {
    const common = { id: field.id, order: field.order, type, label: field.label, description: field.description, required: field.required };
    if (type === 'text') return { ...common, style: 'paragraph', placeholder: '', minLength: 0, maxLength: 4000 };
    if (type === 'number') return { ...common, placeholder: '', minimum: null, maximum: null, step: 1 };
    if (type === 'choice') return { ...common, options: optionsFor(field), multiple: false, minSelections: field.required ? 1 : 0, maxSelections: 1 };
    if (type === 'checkbox') return { ...common, options: optionsFor(field), defaultOptionId: '' };
    return { ...common, maxFiles: 1, maxFileSizeMb: 10, allowedExtensions: [] };
  }

  function channels() {
    return (directory.channels || []).filter((channel) => !['category', 'voice'].includes(channel.kind));
  }

  function channelOptions(selected) {
    const rows = channels().map((channel) => '<option value="' + escapeHtml(channel.id) + '" ' + (selected === channel.id ? 'selected' : '') + '>' + escapeHtml((channel.parentName ? channel.parentName + ' / ' : '') + '#' + channel.name) + '</option>');
    if (selected && !channels().some((channel) => channel.id === selected)) rows.unshift('<option selected value="' + escapeHtml(selected) + '">Unavailable channel</option>');
    return '<option value="">Select channel</option>' + rows.join('');
  }

  function cooldownUnit() {
    const seconds = Number(data.cooldownSeconds) || 0;
    return seconds && seconds % 86400 === 0 ? 86400 : seconds && seconds % 3600 === 0 ? 3600 : seconds && seconds % 60 === 0 ? 60 : 1;
  }

  function markDirty() {
    refreshDirtyState();
  }

  function settingsHtml() {
    const unit = cooldownUnit();
    return '<div class="appeal-settings-view"><header class="appeal-view-header"><div><h3>Appeal access</h3><p>Control availability, review routing, and per-case limits.</p></div><label class="appeal-switch"><input id="appealEnabled" type="checkbox" ' + (data.enabled ? 'checked' : '') + '><span>Enabled</span></label></header>'
      + '<section class="appeal-settings-band"><h4>Review destination</h4><label>Appeal log channel<select id="appealLogChannel">' + channelOptions(data.logChannelId) + '</select></label></section>'
      + '<section class="appeal-settings-band"><h4>Submission limits</h4><div class="appeal-settings-grid"><label>Cooldown<input id="appealCooldownValue" type="number" min="0" value="' + ((Number(data.cooldownSeconds) || 0) / unit) + '"></label><label>Unit<select id="appealCooldownUnit">' + [['Seconds', 1], ['Minutes', 60], ['Hours', 3600], ['Days', 86400]].map((item) => '<option value="' + item[1] + '" ' + (item[1] === unit ? 'selected' : '') + '>' + item[0] + '</option>').join('') + '</select></label><label>Maximum submissions per case<input id="appealMaximum" type="number" min="1" max="100" value="' + escapeHtml(data.maxSubmissionsPerCase ?? '') + '" placeholder="Unlimited"></label></div></section></div>';
  }

  function fieldNavigation() {
    return '<aside class="appeal-field-nav"><div class="appeal-field-nav-head"><strong>Fields</strong><span>' + data.questions.length + '/10</span></div><div class="appeal-field-list">'
      + data.questions.map((field, index) => '<button type="button" class="' + (index === selectedField ? 'active' : '') + '" data-field-select="' + index + '"><span class="appeal-field-order">' + (index + 1) + '</span><span><strong>' + escapeHtml(field.label) + '</strong><small>' + escapeHtml(TYPE_LABELS[field.type]) + (field.required ? ' · Required' : '') + '</small></span></button>').join('')
      + '</div><button type="button" class="appeal-add-field" id="appealAddField" ' + (data.questions.length >= 10 ? 'disabled' : '') + '>+ Add field</button></aside>';
  }

  function commonInspector(field) {
    return '<div class="appeal-inspector-grid"><label>Label<input data-field-key="label" maxlength="80" value="' + escapeHtml(field.label) + '"></label><label>Type<select data-field-key="type">' + TYPES.map((type) => '<option value="' + type + '" ' + (field.type === type ? 'selected' : '') + '>' + TYPE_LABELS[type] + '</option>').join('') + '</select></label><label class="wide">Description<textarea data-field-key="description" rows="2" maxlength="200">' + escapeHtml(field.description || '') + '</textarea></label><label class="appeal-check"><input data-field-key="required" type="checkbox" ' + (field.required ? 'checked' : '') + '> Required</label></div>';
  }

  function optionEditor(field, includeMultiple) {
    const options = optionsFor(field);
    return '<div class="appeal-inspector-grid"><label class="wide">Options<textarea data-field-key="optionsText" rows="6">' + escapeHtml(options.map((option) => option.label).join('\n')) + '</textarea></label>'
      + (includeMultiple ? '<label class="appeal-check"><input data-field-key="multiple" type="checkbox" ' + (field.multiple ? 'checked' : '') + '> Allow multiple selections</label><label>Minimum selections<input data-field-key="minSelections" type="number" min="0" max="25" value="' + Number(field.minSelections || (field.required ? 1 : 0)) + '"></label><label>Maximum selections<input data-field-key="maxSelections" type="number" min="1" max="25" value="' + Number(field.maxSelections || 1) + '"></label>' : '<label>Default option<select data-field-key="defaultOptionId"><option value="">No default</option>' + options.map((option) => '<option value="' + escapeHtml(option.id) + '" ' + (field.defaultOptionId === option.id ? 'selected' : '') + '>' + escapeHtml(option.label) + '</option>').join('') + '</select></label>')
      + '</div>';
  }

  function specificInspector(field) {
    if (field.type === 'text') return '<div class="appeal-inspector-grid"><label>Style<select data-field-key="style"><option value="short" ' + (field.style === 'short' ? 'selected' : '') + '>Short</option><option value="paragraph" ' + (field.style !== 'short' ? 'selected' : '') + '>Paragraph</option></select></label><label>Placeholder<input data-field-key="placeholder" value="' + escapeHtml(field.placeholder || '') + '"></label><label>Minimum length<input data-field-key="minLength" type="number" min="0" max="4000" value="' + Number(field.minLength || 0) + '"></label><label>Maximum length<input data-field-key="maxLength" type="number" min="1" max="4000" value="' + Number(field.maxLength || 4000) + '"></label></div>';
    if (field.type === 'number') return '<div class="appeal-inspector-grid"><label>Minimum<input data-field-key="minimum" type="number" value="' + escapeHtml(field.minimum ?? '') + '"></label><label>Maximum<input data-field-key="maximum" type="number" value="' + escapeHtml(field.maximum ?? '') + '"></label><label>Step<input data-field-key="step" type="number" min="0.000001" value="' + Number(field.step || 1) + '"></label><label>Placeholder<input data-field-key="placeholder" value="' + escapeHtml(field.placeholder || '') + '"></label></div>';
    if (field.type === 'choice') return optionEditor(field, true);
    if (field.type === 'checkbox') return optionEditor(field, false);
    return '<div class="appeal-inspector-grid"><label>Maximum files<input data-field-key="maxFiles" type="number" min="1" max="5" value="' + Number(field.maxFiles || 1) + '"></label><label>Per-file limit (MB)<input data-field-key="maxFileSizeMb" type="number" min="1" max="10" value="' + Number(field.maxFileSizeMb || 10) + '"></label><label class="wide">Allowed extensions<input data-field-key="extensionsText" value="' + escapeHtml((field.allowedExtensions || []).join(', ')) + '" placeholder="png, jpg, pdf"></label></div>';
  }

  function inspector(field) {
    return '<section class="appeal-field-inspector" data-field-index="' + selectedField + '"><header><div><span>Field ' + (selectedField + 1) + '</span><h3>' + escapeHtml(field.label) + '</h3></div><div class="appeal-field-actions"><button type="button" data-field-action="up" title="Move up">↑</button><button type="button" data-field-action="down" title="Move down">↓</button><button type="button" data-field-action="remove" title="Remove">×</button></div></header>' + commonInspector(field) + '<div class="appeal-inspector-divider"></div>' + specificInspector(field) + '</section>';
  }

  function previewField(field) {
    const label = escapeHtml(field.label + (field.required ? ' *' : ''));
    const description = field.description ? '<small>' + escapeHtml(field.description) + '</small>' : '';
    if (field.type === 'text') return '<label>' + label + description + '<textarea rows="' + (field.style === 'short' ? 1 : 4) + '" placeholder="' + escapeHtml(field.placeholder || '') + '"></textarea></label>';
    if (field.type === 'number') return '<label>' + label + description + '<input type="number" placeholder="' + escapeHtml(field.placeholder || '') + '"></label>';
    if (field.type === 'choice' || field.type === 'checkbox') return '<fieldset><legend>' + label + '</legend>' + description + optionsFor(field).map((option) => '<label class="appeal-preview-option"><input disabled type="' + (field.type === 'checkbox' ? 'checkbox' : field.multiple ? 'checkbox' : 'radio') + '" ' + (field.defaultOptionId === option.id ? 'checked' : '') + '> ' + escapeHtml(option.label) + '</label>').join('') + '</fieldset>';
    return '<label>' + label + description + '<input disabled type="file"></label>';
  }

  function formPreview() {
    return '<aside class="appeal-public-preview"><header><strong>Public form</strong><span>Live preview</span></header><div class="appeal-public-preview-body">' + data.questions.map(previewField).join('') + '<button class="button primary" disabled>Submit appeal</button></div></aside>';
  }

  function formHtml() {
    selectedField = Math.max(0, Math.min(selectedField, data.questions.length - 1));
    const field = data.questions[selectedField] || defaultQuestion(0);
    return '<div class="appeal-form-designer">' + fieldNavigation() + inspector(field) + formPreview() + '</div>';
  }

  function messageHtml() {
    return '<div class="appeal-message-view"><div id="appealMessageEditor"></div><div class="appeal-fixed-actions"><span>Review actions are added automatically.</span><div><button class="button success" disabled>Accept</button><button class="button danger" disabled>Deny</button></div></div></div>';
  }

  function render() {
    if (!root) return;
    root.innerHTML = '<div class="appeal-admin">' + (view === 'appeal-settings' ? settingsHtml() : view === 'appeal-form' ? formHtml() : messageHtml()) + '</div>';
    if (view === 'appeal-message') {
      window.CoinSpriteRichEditor?.mount(root.querySelector('#appealMessageEditor'), {
        value: data.logMessage,
        tokens: TOKENS,
        previewTokens: PREVIEW,
        onChange(value) {
          data.logMessage = value;
          markDirty();
        },
      });
    }
  }

  function updatePreview() {
    const preview = root?.querySelector('.appeal-public-preview-body');
    if (preview) preview.innerHTML = data.questions.map(previewField).join('') + '<button class="button primary" disabled>Submit appeal</button>';
    const activeLabel = root?.querySelector('.appeal-field-nav button.active strong');
    if (activeLabel) activeLabel.textContent = data.questions[selectedField]?.label || 'Question';
  }

  async function loadDirectory(force = false) {
    if (!guildId || directoryLoading || (!force && directoryGuildId === guildId)) return;
    directoryLoading = true;
    try {
      const response = await fetch('/api/guilds/' + guildId + '/directory');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load channels.');
      directory = payload.directory || {};
      directoryGuildId = guildId;
      if (view === 'appeal-settings') render();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      directoryLoading = false;
    }
  }

  function updateField(target) {
    const field = data.questions[selectedField];
    const key = target.dataset.fieldKey;
    if (!field || !key) return false;
    if (key === 'optionsText') {
      const previousDefault = field.defaultOptionId;
      field.options = target.value.split('\n').map((label, index) => ({ id: 'option-' + (index + 1), label: label.trim() })).filter((item) => item.label).slice(0, 25);
      if (!field.options.some((option) => option.id === previousDefault)) field.defaultOptionId = '';
    } else if (key === 'extensionsText') field.allowedExtensions = target.value.split(/[\s,]+/).filter(Boolean);
    else if (target.type === 'checkbox') field[key] = target.checked;
    else if (target.type === 'number') field[key] = target.value === '' ? null : Number(target.value);
    else field[key] = target.value;
    return true;
  }

  function styles() {
    if (document.querySelector('#appealAdminStylesV2')) return;
    const style = document.createElement('style');
    style.id = 'appealAdminStylesV2';
    style.textContent = [
      '.appeal-admin{min-width:0}.appeal-view-header{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 0;border-bottom:1px solid var(--border,#30394a)}.appeal-view-header h3{margin:0 0 4px}.appeal-view-header p{margin:0;color:var(--muted,#aeb7c5)}',
      '.appeal-switch{display:flex;align-items:center;gap:9px;font-weight:700}.appeal-settings-band{padding:22px 0;border-bottom:1px solid var(--border,#30394a)}.appeal-settings-band h4{margin:0 0 14px}.appeal-settings-band>label{display:grid;gap:7px;max-width:620px}.appeal-settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.appeal-settings-grid label{display:grid;gap:7px}',
      '.appeal-form-designer{display:grid;grid-template-columns:220px minmax(340px,1fr) minmax(280px,360px);min-height:590px;border:1px solid var(--border,#30394a);border-radius:8px;overflow:hidden;background:var(--panel,#111827)}',
      '.appeal-field-nav{border-right:1px solid var(--border,#30394a);background:#0c121d;padding:12px;display:flex;flex-direction:column;min-width:0}.appeal-field-nav-head{display:flex;justify-content:space-between;padding:7px 5px 12px}.appeal-field-list{display:grid;gap:5px;overflow:auto}.appeal-field-list>button{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;text-align:left;padding:10px;border:1px solid transparent;background:transparent}.appeal-field-list>button.active{border-color:#6d74ff;background:#202746}.appeal-field-list strong,.appeal-field-list small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.appeal-field-list small{color:var(--muted,#aeb7c5);margin-top:2px}.appeal-field-order{display:grid;place-items:center;width:26px;height:26px;border-radius:5px;background:#252e40}.appeal-add-field{margin-top:auto;border-style:dashed}',
      '.appeal-field-inspector{padding:20px;min-width:0;overflow:auto}.appeal-field-inspector>header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px}.appeal-field-inspector>header span{color:var(--muted,#aeb7c5);font-size:12px}.appeal-field-inspector h3{margin:2px 0 0;font-size:18px}.appeal-field-actions{display:flex;gap:6px}.appeal-field-actions button{width:34px;height:34px;padding:0}.appeal-inspector-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.appeal-inspector-grid label{display:grid;gap:6px}.appeal-inspector-grid .wide{grid-column:1/-1}.appeal-inspector-grid .appeal-check{display:flex;align-items:center}.appeal-inspector-divider{height:1px;background:var(--border,#30394a);margin:18px 0}',
      '.appeal-public-preview{border-left:1px solid var(--border,#30394a);background:#0d131f;padding:16px;min-width:0}.appeal-public-preview>header{display:flex;justify-content:space-between;gap:8px;margin-bottom:16px}.appeal-public-preview>header span{color:var(--muted,#aeb7c5);font-size:12px}.appeal-public-preview-body{display:grid;gap:14px}.appeal-public-preview-body>label,.appeal-public-preview fieldset{display:grid;gap:7px}.appeal-public-preview fieldset{margin:0;border:1px solid var(--border,#30394a);border-radius:6px}.appeal-public-preview small{color:var(--muted,#aeb7c5)}.appeal-preview-option{display:flex;align-items:center;gap:8px}',
      '.appeal-fixed-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--border,#30394a);border-top:0}.appeal-fixed-actions>span{color:var(--muted,#aeb7c5)}.appeal-fixed-actions>div{display:flex;gap:8px}.moderator-workspace-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}',
      '@media(max-width:1050px){.appeal-form-designer{grid-template-columns:190px minmax(320px,1fr)}.appeal-public-preview{grid-column:1/-1;border-left:0;border-top:1px solid var(--border,#30394a)}}@media(max-width:760px){.appeal-settings-grid,.appeal-form-designer,.appeal-inspector-grid{grid-template-columns:1fr}.appeal-field-nav{border-right:0;border-bottom:1px solid var(--border,#30394a)}.appeal-field-list{max-height:220px}.appeal-public-preview{grid-column:auto}.appeal-inspector-grid .wide{grid-column:auto}.appeal-view-header,.appeal-fixed-actions{align-items:flex-start;flex-direction:column}.moderator-workspace-tabs{grid-template-columns:1fr!important}}',
    ].join('\n');
    document.head.append(style);
  }

  document.addEventListener('input', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    if (updateField(event.target)) {
      markDirty();
      updatePreview();
      return;
    }
    if (event.target.id === 'appealMaximum') data.maxSubmissionsPerCase = event.target.value === '' ? null : Number(event.target.value);
    else if (event.target.id === 'appealCooldownValue') data.cooldownSeconds = Math.max(0, Number(event.target.value) || 0) * Number(root.querySelector('#appealCooldownUnit')?.value || 1);
    else return;
    markDirty();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    if (event.target.dataset.fieldKey === 'type') {
      data.questions[selectedField] = resetType(data.questions[selectedField], event.target.value);
      markDirty();
      render();
      return;
    }
    if (updateField(event.target)) {
      markDirty();
      if (['multiple', 'required', 'defaultOptionId'].includes(event.target.dataset.fieldKey)) render();
      else updatePreview();
      return;
    }
    if (event.target.id === 'appealEnabled') data.enabled = event.target.checked;
    else if (event.target.id === 'appealLogChannel') data.logChannelId = event.target.value;
    else if (event.target.id === 'appealCooldownUnit') data.cooldownSeconds = Math.max(0, Number(root.querySelector('#appealCooldownValue')?.value) || 0) * Number(event.target.value);
    else return;
    markDirty();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    const select = event.target.closest('[data-field-select]')?.dataset.fieldSelect;
    if (select != null) {
      selectedField = Number(select);
      render();
      return;
    }
    if (event.target.id === 'appealAddField') {
      if (data.questions.length < 10) {
        data.questions.push(defaultQuestion(data.questions.length));
        selectedField = data.questions.length - 1;
        markDirty();
        render();
      }
      return;
    }
    const action = event.target.closest('[data-field-action]')?.dataset.fieldAction;
    if (!action) return;
    const index = selectedField;
    if (action === 'remove' && data.questions.length > 1) data.questions.splice(index, 1);
    else if (action === 'up' && index > 0) {
      [data.questions[index - 1], data.questions[index]] = [data.questions[index], data.questions[index - 1]];
      selectedField -= 1;
    } else if (action === 'down' && index < data.questions.length - 1) {
      [data.questions[index + 1], data.questions[index]] = [data.questions[index], data.questions[index + 1]];
      selectedField += 1;
    } else return;
    markDirty();
    render();
  });

  function mount(nextRoot, nextGuild, nextView) {
    styles();
    root = nextRoot;
    guildId = String(nextGuild || state.guildId || '');
    view = ['appeal-settings', 'appeal-form', 'appeal-message'].includes(nextView) ? nextView : 'appeal-settings';
    render();
    queueMicrotask(loadDirectory);
  }

  styles();
  window.CoinSpriteAppealAdmin = Object.freeze({ version: 2, mount });

  let integrated = false;
  function installMainSaveIntegration() {
    if (integrated) return;
    if (!window.__coinSpriteModeratorTab) {
      setTimeout(installMainSaveIntegration, 0);
      return;
    }
    integrated = true;
    const nativeApplyTab = applyTabFromConfig;
    applyTabFromConfig = function appealApplyTab(tabName, config) {
      nativeApplyTab(tabName, config);
      if (tabName !== 'moderator') return;
      data = normalize(config.moderation?.appeals);
      selectedField = Math.min(selectedField, data.questions.length - 1);
      if (root) render();
    };

    const nativeCollectTab = collectTabState;
    collectTabState = function appealCollectTab(tabName) {
      const snapshot = nativeCollectTab(tabName);
      return tabName === 'moderator' ? { ...snapshot, appeals: clone(data) } : snapshot;
    };

    const nativeCollectPatch = collectPatch;
    collectPatch = function appealCollectPatch() {
      const patch = nativeCollectPatch();
      patch.moderation = { ...(patch.moderation || {}), appeals: clone(data) };
      return patch;
    };

    if (state.savedConfig) {
      data = normalize(state.savedConfig.moderation?.appeals);
      captureSavedSnapshots();
      refreshDirtyState();
      if (root) render();
    }
  }
  setTimeout(installMainSaveIntegration, 0);

})();
