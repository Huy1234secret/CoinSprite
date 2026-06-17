(() => {
  if (window.__coinSpriteModeratorTab) return;
  window.__coinSpriteModeratorTab = true;

  const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
  const MODERATOR_TAB_HTML = '<span class="tab-icon-frame" aria-hidden="true"><img class="tab-icon" src="/images/moderator.png" alt=""></span><span>Moderator</span>';
  const DEFAULT_LINK_ACTIONS = [{ type: 'delete' }, { type: 'log' }];
  const moderatorState = {
    view: 'ai',
    enabled: false,
    logChannelId: '',
    scanChannelIds: [],
    alertTemplateId: DEFAULT_ALERT_TEMPLATE_ID,
    maxInputChars: 1500,
    auto: {
      link: {
        enabled: false,
        blockDiscordInvites: true,
        allowedInviteGuildIds: [],
        allowedInviteCodes: [],
        domainBlacklist: [],
        domainWhitelist: [],
        scanChannelIds: [],
        excludeChannelIds: [],
        excludeRoleIds: [],
        actions: DEFAULT_LINK_ACTIONS.map((item) => ({ ...item })),
      },
    },
  };

  function ensureModeratorTab() {
    TAB_NAMES.moderator = 'Moderator';
    const tabs = document.querySelector('#tabList');
    if (tabs) {
      const existing = tabs.querySelector('[data-tab="moderator"]');
      if (existing) {
        if (!existing.querySelector('.tab-icon-frame')) existing.innerHTML = MODERATOR_TAB_HTML;
      } else {
        const tab = document.createElement('button');
        tab.className = 'tab';
        tab.type = 'button';
        tab.dataset.tab = 'moderator';
        tab.innerHTML = MODERATOR_TAB_HTML;
        (tabs.querySelector('[data-tab="messages"]') || tabs.querySelector('[data-tab="games"]') || tabs.lastElementChild)?.before(tab);
      }
    }

    const form = document.querySelector('#configForm');
    if (form && !form.querySelector('[data-panel="moderator"]')) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'moderator';
      panel.innerHTML = '<div id="moderatorRoot"></div>';
      (form.querySelector('[data-panel="messages"]') || form.querySelector('[data-panel="games"]') || form.lastElementChild)?.before(panel);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function uniqueIds(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function lines(value) {
    return uniqueIds(value).join('\n');
  }

  function lineValues(value) {
    return uniqueIds(String(value || '').split(/[\n,]+/));
  }

  function normalizeActions(actions) {
    const source = Array.isArray(actions) && actions.length ? actions : DEFAULT_LINK_ACTIONS;
    return source.map((action) => ({
      type: ['delete', 'warn', 'timeout', 'report', 'log'].includes(action?.type) ? action.type : 'log',
      message: String(action?.message || 'Your message was blocked by Auto-Moderator.').slice(0, 500),
      delivery: ['dm', 'reply'].includes(action?.delivery) ? action.delivery : 'reply',
      durationSeconds: Math.max(0, Math.min(2419200, Number(action?.durationSeconds) || 300)),
    }));
  }

  function normalizeModeration(config = {}) {
    const ai = config.moderation?.ai || {};
    const link = config.moderation?.auto?.link || {};
    return {
      enabled: Boolean(ai.enabled),
      logChannelId: String(ai.logChannelId || ''),
      scanChannelIds: uniqueIds(ai.scanChannelIds),
      alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
      maxInputChars: Number(ai.maxInputChars) || 1500,
      auto: {
        link: {
          enabled: Boolean(link.enabled),
          blockDiscordInvites: link.blockDiscordInvites !== false,
          allowedInviteGuildIds: uniqueIds(link.allowedInviteGuildIds),
          allowedInviteCodes: uniqueIds(link.allowedInviteCodes),
          domainBlacklist: uniqueIds(link.domainBlacklist),
          domainWhitelist: uniqueIds(link.domainWhitelist),
          scanChannelIds: uniqueIds(link.scanChannelIds),
          excludeChannelIds: uniqueIds(link.excludeChannelIds),
          excludeRoleIds: uniqueIds(link.excludeRoleIds),
          actions: normalizeActions(link.actions),
        },
      },
    };
  }

  function textChannelOptions() {
    return channelOptions().filter((option) => !['category', 'voice'].includes(option.optionType));
  }

  function setAndDirty(callback) {
    callback();
    renderModerator();
    refreshDirtyState();
  }

  function renderAiPanel() {
    const scanCount = moderatorState.scanChannelIds.length;
    return `
      <div class="moderator-status-grid">
        <div class="moderator-stat"><span class="field-label">Status</span><strong>${moderatorState.enabled ? 'Enabled' : 'Disabled'}</strong></div>
        <div class="moderator-stat"><span class="field-label">Scan channels</span><strong>${scanCount || 'All'}</strong></div>
        <div class="moderator-stat"><span class="field-label">AI input limit</span><strong>${moderatorState.maxInputChars}</strong></div>
      </div>
      <div class="panel moderator-ai-panel">
        <div class="panel-heading">
          <h3>AI moderation</h3>
          <p>Uses local checks first, then sends suspicious messages to OpenAI with a smaller input cap.</p>
        </div>
        <label class="checkline"><input id="moderationAiEnabled" type="checkbox" ${moderatorState.enabled ? 'checked' : ''}> Enable AI moderation checks</label>
        <div class="settings-grid">
          <div class="picker-field"><span class="field-label">Scan channels</span><div id="moderationScanChannelsMount"></div></div>
          <div class="picker-field"><span class="field-label">Log channel</span><div id="moderationLogChannelMount"></div></div>
          <label>AI max input characters <input id="moderationMaxInputChars" type="number" min="250" max="4000" step="50" value="${moderatorState.maxInputChars}"></label>
        </div>
        <div class="moderator-template-note">If no scan channels are selected, AI moderation checks every text channel. It uses <strong>Default: AI moderation alert</strong> from the Message tab for staff alerts.</div>
      </div>
    `;
  }

  function actionRow(action, index) {
    return `<div class="automod-action-row" data-action-index="${index}">
      <label>Action
        <select data-link-action-field="type">
          ${['delete', 'warn', 'timeout', 'report', 'log'].map((type) => `<option value="${type}" ${action.type === type ? 'selected' : ''}>${type}</option>`).join('')}
        </select>
      </label>
      <label class="automod-warn-field">Warn text <input data-link-action-field="message" type="text" maxlength="500" value="${escapeHtml(action.message || '')}"></label>
      <label class="automod-delivery-field">Delivery
        <select data-link-action-field="delivery"><option value="reply" ${action.delivery !== 'dm' ? 'selected' : ''}>Reply</option><option value="dm" ${action.delivery === 'dm' ? 'selected' : ''}>DM</option></select>
      </label>
      <label class="automod-timeout-field">Timeout seconds <input data-link-action-field="durationSeconds" type="number" min="1" max="2419200" step="1" value="${Number(action.durationSeconds) || 300}"></label>
      <button class="button small danger" type="button" data-moderator-action="remove-link-action">Remove</button>
    </div>`;
  }

  function renderLinkPanel() {
    const link = moderatorState.auto.link;
    return `<div class="automod-detail">
      <div class="panel moderator-ai-panel">
        <div class="panel-heading">
          <h3>Link Auto-Moderator</h3>
          <p>Block Discord invites, scam domains, or any link outside an allowed domain list.</p>
        </div>
        <label class="checkline"><input id="linkAutoEnabled" type="checkbox" ${link.enabled ? 'checked' : ''}> Enable Link Auto-Moderator</label>
        <label class="checkline"><input id="linkBlockInvites" type="checkbox" ${link.blockDiscordInvites ? 'checked' : ''}> Block Discord invites</label>
        <div class="settings-grid">
          <div class="picker-field"><span class="field-label">Scan channels</span><div id="linkScanChannelsMount"></div></div>
          <div class="picker-field"><span class="field-label">Exclude channels</span><div id="linkExcludeChannelsMount"></div></div>
          <div class="picker-field"><span class="field-label">Exclude roles</span><div id="linkExcludeRolesMount"></div></div>
        </div>
        <div class="grid compact-grid automod-textareas">
          <label>Allowed invite guild IDs <textarea id="allowedInviteGuildIds" rows="4" spellcheck="false" placeholder="123456789012345678">${escapeHtml(lines(link.allowedInviteGuildIds))}</textarea></label>
          <label>Allowed invite codes <textarea id="allowedInviteCodes" rows="4" spellcheck="false" placeholder="abc123">${escapeHtml(lines(link.allowedInviteCodes))}</textarea></label>
          <label>Domain blacklist <textarea id="domainBlacklist" rows="4" spellcheck="false" placeholder="scam.example">${escapeHtml(lines(link.domainBlacklist))}</textarea></label>
          <label>Domain whitelist <textarea id="domainWhitelist" rows="4" spellcheck="false" placeholder="youtube.com&#10;twitch.tv&#10;github.com">${escapeHtml(lines(link.domainWhitelist))}</textarea></label>
        </div>
        <div class="automod-action-head"><h3>Actions</h3><button class="button small" type="button" data-moderator-action="add-link-action">Add action</button></div>
        <div class="automod-action-list">${link.actions.map(actionRow).join('')}</div>
      </div>
    </div>`;
  }

  function renderAutoPanel() {
    const link = moderatorState.auto.link;
    return `<div class="automod-grid">
      <button class="automod-module-card active" type="button" data-moderator-action="open-link">
        <strong>Link</strong>
        <span>${link.enabled ? 'Enabled' : 'Disabled'} · ${link.actions.map((action) => action.type).join(', ') || 'no actions'}</span>
      </button>
      ${renderLinkPanel()}
    </div>`;
  }

  function mountAiPickers(root) {
    const scanMount = root.querySelector('#moderationScanChannelsMount');
    if (scanMount) {
      renderPicker(scanMount, textChannelOptions(), moderatorState.scanChannelIds, {
        multiple: true,
        type: 'channel',
        placeholder: 'Select channels to scan',
        onChange: (value) => setAndDirty(() => { moderatorState.scanChannelIds = uniqueIds(value); }),
      });
    }
    const logMount = root.querySelector('#moderationLogChannelMount');
    if (logMount) {
      renderPicker(logMount, textChannelOptions(), moderatorState.logChannelId, {
        type: 'channel',
        placeholder: 'Select staff alert channel',
        onChange: (value) => setAndDirty(() => { moderatorState.logChannelId = value; }),
      });
    }
  }

  function mountLinkPickers(root) {
    const link = moderatorState.auto.link;
    const linkScan = root.querySelector('#linkScanChannelsMount');
    if (linkScan) renderPicker(linkScan, textChannelOptions(), link.scanChannelIds, {
      multiple: true, type: 'channel', placeholder: 'All text channels',
      onChange: (value) => setAndDirty(() => { link.scanChannelIds = uniqueIds(value); }),
    });
    const excludeChannels = root.querySelector('#linkExcludeChannelsMount');
    if (excludeChannels) renderPicker(excludeChannels, textChannelOptions(), link.excludeChannelIds, {
      multiple: true, type: 'channel', placeholder: 'No excluded channels',
      onChange: (value) => setAndDirty(() => { link.excludeChannelIds = uniqueIds(value); }),
    });
    const excludeRoles = root.querySelector('#linkExcludeRolesMount');
    if (excludeRoles) renderPicker(excludeRoles, roleOptions(), link.excludeRoleIds, {
      multiple: true, type: 'role', placeholder: 'No excluded roles',
      onChange: (value) => setAndDirty(() => { link.excludeRoleIds = uniqueIds(value); }),
    });
  }

  function renderModerator() {
    ensureModeratorTab();
    const root = document.querySelector('#moderatorRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="moderator-shell">
        <nav class="mini-tabs" aria-label="Moderator settings">
          <button class="mini-tab ${moderatorState.view === 'ai' ? 'active' : ''}" type="button" data-moderator-view="ai">AI moderation</button>
          <button class="mini-tab ${moderatorState.view === 'auto' ? 'active' : ''}" type="button" data-moderator-view="auto">Auto-Moderator</button>
        </nav>
        ${moderatorState.view === 'auto' ? renderAutoPanel() : renderAiPanel()}
      </div>
    `;
    if (moderatorState.view === 'auto') mountLinkPickers(root);
    else mountAiPickers(root);
  }

  function moderationSnapshot() {
    return {
      enabled: Boolean(moderatorState.enabled),
      logChannelId: moderatorState.logChannelId || '',
      scanChannelIds: uniqueIds(moderatorState.scanChannelIds),
      alertTemplateId: moderatorState.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID,
      maxInputChars: Math.max(250, Math.min(4000, Number(moderatorState.maxInputChars) || 1500)),
    };
  }

  function autoSnapshot() {
    const link = moderatorState.auto.link;
    return {
      link: {
        enabled: Boolean(link.enabled),
        blockDiscordInvites: link.blockDiscordInvites !== false,
        allowedInviteGuildIds: uniqueIds(link.allowedInviteGuildIds),
        allowedInviteCodes: uniqueIds(link.allowedInviteCodes),
        domainBlacklist: uniqueIds(link.domainBlacklist),
        domainWhitelist: uniqueIds(link.domainWhitelist),
        scanChannelIds: uniqueIds(link.scanChannelIds),
        excludeChannelIds: uniqueIds(link.excludeChannelIds),
        excludeRoleIds: uniqueIds(link.excludeRoleIds),
        actions: normalizeActions(link.actions),
      },
    };
  }

  ensureModeratorTab();

  document.addEventListener('click', (event) => {
    const view = event.target.closest('[data-moderator-view]')?.dataset.moderatorView;
    if (view) {
      moderatorState.view = view === 'auto' ? 'auto' : 'ai';
      renderModerator();
      return;
    }
    const action = event.target.closest('[data-moderator-action]')?.dataset.moderatorAction;
    if (!action) return;
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    if (action === 'add-link-action') {
      link.actions.push({ type: 'log', message: 'Your message was blocked by Auto-Moderator.', delivery: 'reply', durationSeconds: 300 });
      renderModerator();
      refreshDirtyState();
    }
    if (action === 'remove-link-action') {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (Number.isFinite(index)) link.actions.splice(index, 1);
      if (!link.actions.length) link.actions.push({ type: 'log' });
      renderModerator();
      refreshDirtyState();
    }
  });

  document.addEventListener('input', (event) => {
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationMaxInputChars') moderatorState.maxInputChars = Number(event.target.value) || 1500;
    if (event.target.id === 'allowedInviteGuildIds') link.allowedInviteGuildIds = lineValues(event.target.value);
    if (event.target.id === 'allowedInviteCodes') link.allowedInviteCodes = lineValues(event.target.value);
    if (event.target.id === 'domainBlacklist') link.domainBlacklist = lineValues(event.target.value);
    if (event.target.id === 'domainWhitelist') link.domainWhitelist = lineValues(event.target.value);
    const actionField = event.target.dataset.linkActionField;
    if (actionField) {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (link.actions[index]) {
        link.actions[index][actionField] = actionField === 'durationSeconds' ? Number(event.target.value) || 300 : event.target.value;
      }
    }
    refreshDirtyState();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationAiEnabled') moderatorState.enabled = Boolean(event.target.checked);
    if (event.target.id === 'linkAutoEnabled') link.enabled = Boolean(event.target.checked);
    if (event.target.id === 'linkBlockInvites') link.blockDiscordInvites = Boolean(event.target.checked);
    const actionField = event.target.dataset.linkActionField;
    if (actionField) {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (link.actions[index]) link.actions[index][actionField] = actionField === 'durationSeconds' ? Number(event.target.value) || 300 : event.target.value;
    }
    refreshDirtyState();
    if (['moderationAiEnabled', 'linkAutoEnabled', 'linkBlockInvites'].includes(event.target.id) || actionField === 'type') renderModerator();
  });

  const nativeApplyTabFromConfig = applyTabFromConfig;
  applyTabFromConfig = function moderatorApplyTab(tabName, config) {
    if (tabName === 'moderator') {
      const next = normalizeModeration(config);
      moderatorState.enabled = next.enabled;
      moderatorState.logChannelId = next.logChannelId;
      moderatorState.scanChannelIds = next.scanChannelIds;
      moderatorState.alertTemplateId = next.alertTemplateId;
      moderatorState.maxInputChars = next.maxInputChars;
      moderatorState.auto = next.auto;
      renderModerator();
      return;
    }
    nativeApplyTabFromConfig(tabName, config);
  };

  const nativeCollectTabState = collectTabState;
  collectTabState = function moderatorCollectTab(tabName) {
    if (tabName === 'moderator') return { ai: moderationSnapshot(), auto: autoSnapshot() };
    return nativeCollectTabState(tabName);
  };

  const nativeCollectPatch = collectPatch;
  collectPatch = function moderatorCollectPatch() {
    const patch = nativeCollectPatch();
    patch.moderation = {
      ...(patch.moderation || {}),
      ai: moderationSnapshot(),
      auto: autoSnapshot(),
    };
    return patch;
  };

  const nativeSetActiveTab = setActiveTab;
  setActiveTab = function moderatorSetActiveTab(tabName) {
    nativeSetActiveTab(tabName);
    if (tabName === 'moderator') queueMicrotask(renderModerator);
  };

  if (state.savedConfig) {
    const next = normalizeModeration(state.savedConfig);
    Object.assign(moderatorState, next);
    renderModerator();
    captureSavedSnapshots();
    refreshDirtyState();
  }
})();
