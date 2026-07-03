(() => {
  if (window.__coinSpriteChannelRules) return;
  window.__coinSpriteChannelRules = true;

  const CONTEXT_LABELS = {
    text: 'Text',
    link: 'Links',
    image: 'Images',
    video: 'Videos',
    audio: 'Audio files',
    voice_message: 'Voice messages',
    file: 'Other files',
    sticker: 'Stickers',
    embed: 'Embeds',
    poll: 'Polls',
  };
  const ACTION_LABELS = {
    delete: 'Delete message',
    report: 'Report',
    mute: 'Mute',
    kick: 'Kick',
    ban: 'Ban',
    send_message: 'Send message',
  };
  const state = {
    guildId: '',
    rules: [],
    savedRules: [],
    templates: [],
    contexts: Object.keys(CONTEXT_LABELS),
    activeId: '',
    open: false,
    dirty: false,
    loading: false,
    status: '',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function unique(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function newRule() {
    const id = 'channel-rule-' + Date.now().toString(36);
    return {
      id,
      name: 'New channel rule',
      enabled: true,
      channelIds: [],
      mode: 'allowed',
      contexts: ['text'],
      actions: [{ type: 'delete', reason: 'This content is not permitted in this channel.' }],
    };
  }

  function newAction(type = 'delete') {
    if (type === 'report') return { type, reason: 'Channel rule violation.', reportChannelId: '' };
    if (type === 'mute') return { type, reason: 'Channel rule violation.', time: '10m' };
    if (type === 'kick') return { type, reason: 'Channel rule violation.' };
    if (type === 'ban') return { type, reason: 'Channel rule violation.', time: 'permanent' };
    if (type === 'send_message') return { type, templateId: '', ephemeral: false };
    return { type: 'delete', reason: 'This content is not permitted in this channel.' };
  }

  function selectedRule() {
    return state.rules.find((rule) => rule.id === state.activeId) || state.rules[0] || null;
  }

  function setStatus(message, error = false) {
    state.status = message || '';
    const node = document.querySelector('#channelRulesStatus');
    if (node) {
      node.textContent = state.status;
      node.classList.toggle('error', error);
    }
  }

  function setDirty() {
    state.dirty = true;
    setStatus('Unsaved channel rule changes.');
    if (typeof refreshDirtyState === 'function') refreshDirtyState();
  }

  function textChannelOptions() {
    if (typeof channelOptions !== 'function') return [];
    return channelOptions().filter((option) => !['category', 'voice'].includes(option.optionType));
  }

  function userTemplates() {
    return state.templates.filter((template) => (
      template && template.type !== 'folder' && !template.botDefault && !template.defaultLocked
    ));
  }

  function actionFields(action, index) {
    if (action.type === 'send_message') {
      const options = userTemplates().map((template) => (
        '<option value="' + escapeHtml(template.id) + '" ' + (template.id === action.templateId ? 'selected' : '') + '>'
        + escapeHtml(template.name || template.id) + '</option>'
      )).join('');
      return '<label class="channel-rule-wide">User template<select data-channel-action-field="templateId">'
        + '<option value="">Select a user-created template</option>' + options + '</select></label>'
        + '<label class="checkline"><input data-channel-action-field="ephemeral" type="checkbox" '
        + (action.ephemeral ? 'checked' : '') + '> Ephemeral (send privately by DM)</label>';
    }
    let fields = '<label class="channel-rule-wide">Reason<input data-channel-action-field="reason" maxlength="1000" value="'
      + escapeHtml(action.reason || '') + '"></label>';
    if (action.type === 'mute' || action.type === 'ban') {
      const defaultTime = action.type === 'mute' ? '10m' : 'permanent';
      const timeValue = action.time == null ? defaultTime : action.time;
      fields += '<label>Time (empty = permanent)<input data-channel-action-field="time" value="' + escapeHtml(timeValue)
        + '" placeholder="' + (action.type === 'mute' ? '10m, 12h, 7d; maximum 28d' : '7d or permanent') + '"></label>';
    }
    if (action.type === 'report') {
      fields += '<div class="picker-field channel-rule-wide"><span class="field-label">Report channel</span>'
        + '<div data-channel-report-mount="' + index + '"></div></div>';
    }
    return fields;
  }

  function actionRow(action, index) {
    return '<div class="channel-rule-action" data-channel-action-index="' + index + '">'
      + '<label>Action<select data-channel-action-field="type">'
      + Object.entries(ACTION_LABELS).map(([value, label]) => (
        '<option value="' + value + '" ' + (action.type === value ? 'selected' : '') + '>' + label + '</option>'
      )).join('') + '</select></label>'
      + actionFields(action, index)
      + '<button class="button small danger" type="button" data-channel-rule-action="remove-action">Remove</button>'
      + '</div>';
  }

  function ruleEditor(rule) {
    if (!rule) {
      return '<div class="panel empty-state"><h3>No channel rules</h3><p>Add a channel rule to control what members may send.</p>'
        + '<button class="button primary" type="button" data-channel-rule-action="add-rule">Add channel</button></div>';
    }
    return '<div class="channel-rule-editor">'
      + '<div class="panel"><div class="panel-heading"><h3>Channel rule</h3>'
      + '<p>Choose one or more channels, then define the content that is allowed or not allowed.</p></div>'
      + '<div class="grid compact-grid"><label>Name<input id="channelRuleName" maxlength="80" value="' + escapeHtml(rule.name) + '"></label>'
      + '<label class="checkline"><input id="channelRuleEnabled" type="checkbox" ' + (rule.enabled ? 'checked' : '') + '> Enabled</label></div>'
      + '<div class="picker-field"><span class="field-label">Channels</span><div id="channelRuleChannelsMount"></div></div>'
      + '<div class="mode-setting"><div><span class="field-label">Context mode</span>'
      + '<p>Allowed rejects anything outside the selection. Not allowed rejects anything in the selection.</p></div>'
      + '<div class="segmented-control">'
      + '<label><input name="channelRuleMode" type="radio" value="allowed" ' + (rule.mode === 'allowed' ? 'checked' : '') + '><span>Allowed</span></label>'
      + '<label><input name="channelRuleMode" type="radio" value="not_allowed" ' + (rule.mode === 'not_allowed' ? 'checked' : '') + '><span>Not allowed</span></label>'
      + '</div></div>'
      + '<fieldset class="channel-contexts"><legend>Allowed context</legend>'
      + state.contexts.map((context) => '<label class="checkline"><input data-channel-context="' + context + '" type="checkbox" '
        + (rule.contexts.includes(context) ? 'checked' : '') + '> ' + escapeHtml(CONTEXT_LABELS[context] || context) + '</label>').join('')
      + '</fieldset></div>'
      + '<div class="panel"><div class="panel-head"><div class="panel-heading"><h3>Actions</h3>'
      + '<p>Punishments use the bot\'s existing default alert messages. Reports use the default moderation action report.</p></div>'
      + '<button class="button small" type="button" data-channel-rule-action="add-action">Add action</button></div>'
      + '<div class="channel-rule-actions">' + rule.actions.map(actionRow).join('') + '</div></div>'
      + '<div class="channel-rule-footer"><button class="button danger" type="button" data-channel-rule-action="remove-rule">Delete channel rule</button></div>'
      + '<div class="status compact" id="channelRulesStatus" role="status">' + escapeHtml(state.status) + '</div></div>';
  }

  function nativeChannelLayout() {
    const root = document.querySelector('#moderatorRoot');
    const shell = root?.querySelector('.moderator-shell');
    const tabs = shell?.querySelector('.mini-tabs');
    return { root, shell, tabs };
  }

  function setNativePanelHidden(shell, tabs, hidden) {
    if (!shell || !tabs) return;
    let afterTabs = false;
    [...shell.children].forEach((child) => {
      if (child === tabs) {
        afterTabs = true;
        return;
      }
      if (!afterTabs || child.classList.contains('channel-rules-content')) return;
      if (hidden) {
        if (!child.hasAttribute('data-channel-rules-was-hidden')) {
          child.dataset.channelRulesWasHidden = child.hidden ? 'true' : 'false';
        }
        child.hidden = true;
      } else if (child.hasAttribute('data-channel-rules-was-hidden')) {
        child.hidden = child.dataset.channelRulesWasHidden === 'true';
        delete child.dataset.channelRulesWasHidden;
      }
    });
  }

  function render() {
    if (!state.open) return;
    const { shell, tabs } = nativeChannelLayout();
    if (!shell || !tabs) return;
    setNativePanelHidden(shell, tabs, true);

    const channelTab = tabs.querySelector('[data-channel-rules-open]');
    tabs.querySelectorAll('.mini-tab').forEach((button) => button.classList.toggle('active', button === channelTab));

    let content = shell.querySelector('.channel-rules-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'channel-rules-content';
      tabs.insertAdjacentElement('afterend', content);
    }

    const rule = selectedRule();
    if (rule && !state.activeId) state.activeId = rule.id;
    content.innerHTML = '<div class="channel-rule-subtabs"><button class="button small primary" type="button" data-channel-rule-action="add-rule">Add channel</button>'
      + state.rules.map((item) => '<button class="mini-tab ' + (item.id === state.activeId ? 'active' : '')
        + '" type="button" data-channel-rule-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</button>').join('')
      + '</div>'
      + (state.loading ? '<div class="panel empty-state">Loading channel rules...</div>' : ruleEditor(rule));

    if (!rule || state.loading) return;
    const channelMount = content.querySelector('#channelRuleChannelsMount');
    if (channelMount && typeof renderPicker === 'function') {
      renderPicker(channelMount, textChannelOptions(), rule.channelIds, {
        multiple: true,
        type: 'channel',
        placeholder: 'Select channels',
        onChange: (value) => {
          rule.channelIds = unique(value);
          setDirty();
        },
      });
    }
    content.querySelectorAll('[data-channel-report-mount]').forEach((mount) => {
      const index = Number(mount.dataset.channelReportMount);
      const action = rule.actions[index];
      if (!action || typeof renderPicker !== 'function') return;
      renderPicker(mount, textChannelOptions(), action.reportChannelId || '', {
        type: 'channel',
        placeholder: 'Select report channel',
        onChange: (value) => {
          action.reportChannelId = value || '';
          setDirty();
        },
      });
    });
  }

  async function load() {
    const guildId = document.querySelector('#guildSelect')?.value || '';
    if (!guildId) return;
    state.guildId = guildId;
    state.loading = true;
    state.status = 'Loading channel rules...';
    render();
    try {
      const [rulesResponse, templateResponse] = await Promise.all([
        fetch('/api/guilds/' + guildId + '/channel-rules'),
        fetch('/api/guilds/' + guildId + '/message-templates'),
      ]);
      const rulesPayload = await rulesResponse.json();
      const templatePayload = await templateResponse.json();
      if (!rulesResponse.ok) throw new Error(rulesPayload.error || 'Could not load channel rules.');
      state.rules = Array.isArray(rulesPayload.rules) ? rulesPayload.rules : [];
      state.savedRules = clone(state.rules);
      state.contexts = Array.isArray(rulesPayload.contextTypes) ? rulesPayload.contextTypes : Object.keys(CONTEXT_LABELS);
      state.templates = templateResponse.ok && Array.isArray(templatePayload.templates) ? templatePayload.templates : [];
      state.activeId = state.rules[0]?.id || '';
      state.dirty = false;
      state.status = state.rules.length ? 'Channel rules loaded.' : 'No channel rules configured.';
    } catch (error) {
      state.status = error.message;
    } finally {
      state.loading = false;
      render();
      if (typeof refreshDirtyState === 'function') refreshDirtyState();
    }
  }

  async function save() {
    if (!state.guildId) return;
    setStatus('Saving channel rules...');
    try {
      const response = await fetch('/api/guilds/' + state.guildId + '/channel-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: state.rules }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save channel rules.');
      state.rules = payload.rules || [];
      state.savedRules = clone(state.rules);
      if (!state.rules.some((rule) => rule.id === state.activeId)) state.activeId = state.rules[0]?.id || '';
      state.dirty = false;
      state.status = 'Channel rules saved.';
      render();
      if (typeof refreshDirtyState === 'function') refreshDirtyState();
      return true;
    } catch (error) {
      setStatus(error.message, true);
      if (typeof refreshDirtyState === 'function') refreshDirtyState();
      return false;
    }
  }

  function applyChannelDirtyState() {
    if (!state.dirty) return;
    const unsavedBar = document.querySelector('#unsavedBar');
    const savedState = document.querySelector('#savedState');
    const resetButton = document.querySelector('#resetTabButton');
    const detail = document.querySelector('#unsavedDetail');
    if (unsavedBar) unsavedBar.hidden = false;
    if (savedState) {
      savedState.textContent = 'Unsaved changes';
      savedState.classList.add('dirty');
    }
    if (resetButton) resetButton.disabled = !state.open;
    if (detail) detail.textContent = 'Changed: Channel rules';
    document.body.classList.add('has-unsaved-changes');
  }

  const nativeRefreshDirtyState = typeof refreshDirtyState === 'function' ? refreshDirtyState : null;
  if (nativeRefreshDirtyState) {
    refreshDirtyState = function channelRulesRefreshDirtyState() {
      nativeRefreshDirtyState();
      applyChannelDirtyState();
    };
  }

  const defaultSaveButton = document.querySelector('#saveButton');
  defaultSaveButton?.addEventListener('click', async (event) => {
    if (!state.dirty || defaultSaveButton.dataset.channelRulesForwarding === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    defaultSaveButton.disabled = true;
    defaultSaveButton.textContent = 'Saving...';
    const saved = await save();
    defaultSaveButton.disabled = false;
    defaultSaveButton.textContent = 'Save changes';
    if (!saved) return;
    defaultSaveButton.dataset.channelRulesForwarding = 'true';
    defaultSaveButton.click();
    delete defaultSaveButton.dataset.channelRulesForwarding;
  }, true);

  document.querySelector('#resetTabButton')?.addEventListener('click', (event) => {
    if (!state.open || !state.dirty) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.rules = clone(state.savedRules);
    state.activeId = state.rules.some((rule) => rule.id === state.activeId) ? state.activeId : (state.rules[0]?.id || '');
    state.dirty = false;
    state.status = 'Channel rules reset to the last saved values.';
    render();
    if (typeof refreshDirtyState === 'function') refreshDirtyState();
  }, true);

  function ensureChannelTab() {
    const root = document.querySelector('#moderatorRoot');
    const shell = root?.querySelector('.moderator-shell');
    if (!shell || !root.querySelector('[data-moderator-workspace="auto"].active')) return;
    const tabs = shell.querySelector('.mini-tabs');
    if (!tabs || tabs.querySelector('[data-channel-rules-open]')) return;
    const button = document.createElement('button');
    button.className = 'mini-tab';
    button.type = 'button';
    button.dataset.channelRulesOpen = 'true';
    button.textContent = 'Channel';
    tabs.appendChild(button);
  }

  async function openChannelRules() {
    state.open = true;
    state.status = 'Loading channel rules...';
    render();
    const guildId = document.querySelector('#guildSelect')?.value || '';
    if (guildId !== state.guildId || !state.rules.length) await load();
  }

  function deactivateChannelRules() {
    const { shell, tabs } = nativeChannelLayout();
    shell?.querySelector('.channel-rules-content')?.remove();
    setNativePanelHidden(shell, tabs, false);
    state.open = false;
    queueMicrotask(ensureChannelTab);
  }

  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-channel-rules-open]');
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openChannelRules();
      return;
    }
    if (state.open && event.target.closest('#moderatorRoot [data-moderator-view], #moderatorRoot [data-moderator-workspace]')) {
      if (state.dirty) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof showUnsavedNavigationBlock === 'function') showUnsavedNavigationBlock();
        return;
      }
      deactivateChannelRules();
      return;
    }
    if (!event.target.closest('.channel-rules-content')) return;
    const ruleId = event.target.closest('[data-channel-rule-id]')?.dataset.channelRuleId;
    if (ruleId) {
      state.activeId = ruleId;
      render();
      return;
    }
    const actionName = event.target.closest('[data-channel-rule-action]')?.dataset.channelRuleAction;
    if (!actionName) return;
    const rule = selectedRule();
    if (actionName === 'add-rule') {
      const next = newRule();
      state.rules.push(next);
      state.activeId = next.id;
      setDirty();
      render();
    } else if (actionName === 'remove-rule' && rule) {
      state.rules = state.rules.filter((item) => item.id !== rule.id);
      state.activeId = state.rules[0]?.id || '';
      setDirty();
      render();
    } else if (actionName === 'add-action' && rule) {
      rule.actions.push(newAction());
      setDirty();
      render();
    } else if (actionName === 'remove-action' && rule) {
      const index = Number(event.target.closest('[data-channel-action-index]')?.dataset.channelActionIndex);
      if (Number.isInteger(index)) rule.actions.splice(index, 1);
      setDirty();
      render();
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.closest('.channel-rules-content')) return;
    const rule = selectedRule();
    if (!rule) return;
    if (event.target.id === 'channelRuleName') {
      rule.name = event.target.value;
      const activeTab = document.querySelector('[data-channel-rule-id="' + CSS.escape(rule.id) + '"]');
      if (activeTab) activeTab.textContent = event.target.value || 'Unnamed rule';
    }
    const field = event.target.dataset.channelActionField;
    if (field && !['type', 'ephemeral'].includes(field)) {
      const index = Number(event.target.closest('[data-channel-action-index]')?.dataset.channelActionIndex);
      if (rule.actions[index]) rule.actions[index][field] = event.target.value;
    }
    setDirty();
  }, true);

  document.addEventListener('change', (event) => {
    if (!event.target.closest('.channel-rules-content')) return;
    const rule = selectedRule();
    if (!rule) return;
    if (event.target.id === 'channelRuleEnabled') rule.enabled = Boolean(event.target.checked);
    if (event.target.name === 'channelRuleMode') rule.mode = event.target.value;
    if (event.target.dataset.channelContext) {
      const context = event.target.dataset.channelContext;
      rule.contexts = event.target.checked ? unique([...rule.contexts, context]) : rule.contexts.filter((item) => item !== context);
    }
    const field = event.target.dataset.channelActionField;
    if (field) {
      const index = Number(event.target.closest('[data-channel-action-index]')?.dataset.channelActionIndex);
      const action = rule.actions[index];
      if (action) {
        if (field === 'type') {
          rule.actions[index] = newAction(event.target.value);
          setDirty();
          render();
          return;
        }
        action[field] = field === 'ephemeral' ? Boolean(event.target.checked) : event.target.value;
      }
    }
    setDirty();
  }, true);

  document.querySelector('#guildSelect')?.addEventListener('change', () => {
    state.guildId = '';
    state.rules = [];
    state.savedRules = [];
    state.templates = [];
    state.activeId = '';
    if (state.open) load();
  });

  new MutationObserver(ensureChannelTab).observe(document.documentElement, { childList: true, subtree: true });
  ensureChannelTab();
})();
