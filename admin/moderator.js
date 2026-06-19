(() => {
  if (window.__coinSpriteModeratorTab) return;
  window.__coinSpriteModeratorTab = true;

  const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
  const MODERATOR_TAB_HTML = '<img class="tab-icon" src="/CoinSprite/images/moderator.png" alt="" aria-hidden="true"><span>Moderator</span>';
  const ACTION_TYPES = ['delete', 'warn', 'timeout', 'report', 'log'];
  const DEFAULT_LINK_ACTIONS = [{ type: 'delete' }, { type: 'log' }];
  const moderatorState = {
    view: 'ai',
    enabled: false,
    lowSeverityLogChannelId: '',
    severeLogChannelId: '',
    scanChannelIds: [],
    excludeRoleIds: [],
    alertTemplateId: DEFAULT_ALERT_TEMPLATE_ID,
    maxInputChars: 1500,
    auto: {
      link: {
        enabled: false,
        blockDiscordInvites: true,
        allowedInviteGuildIds: [],
        domainMode: 'blacklist',
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
        if (existing.innerHTML !== MODERATOR_TAB_HTML) existing.innerHTML = MODERATOR_TAB_HTML;
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

  function clampSeconds(value, fallback = 300) {
    return Math.max(0, Math.min(2419200, Number(value) || fallback));
  }

  function normalizeActionType(value) {
    return ACTION_TYPES.includes(value) ? value : 'log';
  }

  function normalizeDomainMode(value, whitelist = []) {
    if (value === 'whitelist' || value === 'blacklist') return value;
    return whitelist.length ? 'whitelist' : 'blacklist';
  }

  function actionDefaults(type, source = {}) {
    const actionType = normalizeActionType(type);
    const next = { type: actionType };
    if (actionType === 'warn') {
      next.message = String(source.message || 'Your message was blocked by Auto-Moderator.').slice(0, 500);
      next.durationSeconds = clampSeconds(source.durationSeconds, 300);
    }
    if (actionType === 'timeout') {
      next.durationSeconds = clampSeconds(source.durationSeconds, 300);
    }
    return next;
  }

  function normalizeActions(actions) {
    const source = Array.isArray(actions) && actions.length ? actions : DEFAULT_LINK_ACTIONS;
    return source.map((action) => actionDefaults(normalizeActionType(action?.type), action));
  }

  function normalizeModeration(config = {}) {
    const ai = config.moderation?.ai || {};
    const link = config.moderation?.auto?.link || {};
    const domainWhitelist = uniqueIds(link.domainWhitelist);
    const legacyLogChannelId = String(ai.logChannelId || '');
    return {
      enabled: Boolean(ai.enabled),
      lowSeverityLogChannelId: String(ai.lowSeverityLogChannelId || legacyLogChannelId),
      severeLogChannelId: String(ai.severeLogChannelId || legacyLogChannelId),
      scanChannelIds: uniqueIds(ai.scanChannelIds),
      excludeRoleIds: uniqueIds(ai.excludeRoleIds),
      alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
      maxInputChars: Number(ai.maxInputChars) || 1500,
      auto: {
        link: {
          enabled: Boolean(link.enabled),
          blockDiscordInvites: link.blockDiscordInvites !== false,
          allowedInviteGuildIds: uniqueIds(link.allowedInviteGuildIds),
          domainMode: normalizeDomainMode(link.domainMode, domainWhitelist),
          domainBlacklist: uniqueIds(link.domainBlacklist),
          domainWhitelist,
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
          <div class="picker-field"><span class="field-label">Log channel (severity &lt; 8)</span><div id="moderationLowSeverityLogChannelMount"></div></div>
          <div class="picker-field"><span class="field-label">Log channel (severity ≥ 8)</span><div id="moderationSevereLogChannelMount"></div></div>
          <div class="picker-field"><span class="field-label">Exclude roles</span><div id="moderationExcludeRolesMount"></div></div>
          <label>AI max input characters <input id="moderationMaxInputChars" type="number" min="250" max="4000" step="50" value="${moderatorState.maxInputChars}"></label>
        </div>
        <div class="moderator-template-note">If no scan channels are selected, AI moderation checks every text channel. It uses <strong>Default: AI moderation alert</strong> from the Message tab for staff alerts.</div>
      </div>
    `;
  }

  function actionFields(action) {
    if (action.type === 'warn') {
      return `
        <label class="automod-warn-field">Warn text <input data-link-action-field="message" type="text" maxlength="500" value="${escapeHtml(action.message || '')}"></label>
        <label class="automod-duration-field">Warn duration seconds <input data-link-action-field="durationSeconds" type="number" min="0" max="2419200" step="1" value="${Number(action.durationSeconds) || 300}"></label>
      `;
    }
    if (action.type === 'timeout') {
      return `<label class="automod-duration-field">Timeout seconds <input data-link-action-field="durationSeconds" type="number" min="1" max="2419200" step="1" value="${Number(action.durationSeconds) || 300}"></label>`;
    }
    return '';
  }

  function actionRow(action, index) {
    const normalized = actionDefaults(action.type, action);
    return `<div class="automod-action-row" data-action-index="${index}" data-action-type="${normalized.type}">
      <label>Action
        <select data-link-action-field="type">
          ${ACTION_TYPES.map((type) => `<option value="${type}" ${normalized.type === type ? 'selected' : ''}>${type}</option>`).join('')}
        </select>
      </label>
      ${actionFields(normalized)}
      <button class="button small danger" type="button" data-moderator-action="remove-link-action">Remove</button>
    </div>`;
  }

  function renderLinkPanel() {
    const link = moderatorState.auto.link;
    const domainMode = normalizeDomainMode(link.domainMode, link.domainWhitelist);
    const domainRules = domainMode === 'whitelist' ? link.domainWhitelist : link.domainBlacklist;
    const domainLabel = domainMode === 'whitelist' ? 'Allowed domains' : 'Blocked domains';
    const domainPlaceholder = domainMode === 'whitelist' ? 'youtube.com\ntwitch.tv\ngithub.com' : 'scam.example\nphishing.example';
    return `<div class="automod-detail">
      <div class="panel moderator-ai-panel">
        <div class="panel-heading">
          <h3>Link Auto-Moderator</h3>
          <p>Block Discord invites, scam domains, or every link outside an allowed domain list.</p>
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
          <label class="automod-domain-mode">Domain filter
            <select id="domainMode">
              <option value="blacklist" ${domainMode === 'blacklist' ? 'selected' : ''}>Allow all links except blocked domains</option>
              <option value="whitelist" ${domainMode === 'whitelist' ? 'selected' : ''}>Block all links except allowed domains</option>
            </select>
          </label>
          <label>${domainLabel} <textarea id="domainRules" rows="4" spellcheck="false" placeholder="${escapeHtml(domainPlaceholder)}">${escapeHtml(lines(domainRules))}</textarea></label>
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
    const lowSeverityLogMount = root.querySelector('#moderationLowSeverityLogChannelMount');
    if (lowSeverityLogMount) {
      renderPicker(lowSeverityLogMount, textChannelOptions(), moderatorState.lowSeverityLogChannelId, {
        type: 'channel',
        placeholder: 'Select channel for severity below 8',
        onChange: (value) => setAndDirty(() => { moderatorState.lowSeverityLogChannelId = value; }),
      });
    }
    const severeLogMount = root.querySelector('#moderationSevereLogChannelMount');
    if (severeLogMount) {
      renderPicker(severeLogMount, textChannelOptions(), moderatorState.severeLogChannelId, {
        type: 'channel',
        placeholder: 'Select channel for severity 8 or higher',
        onChange: (value) => setAndDirty(() => { moderatorState.severeLogChannelId = value; }),
      });
    }
    const excludeRoles = root.querySelector('#moderationExcludeRolesMount');
    if (excludeRoles) {
      renderPicker(excludeRoles, roleOptions(), moderatorState.excludeRoleIds, {
        multiple: true,
        type: 'role',
        placeholder: 'No excluded roles',
        onChange: (value) => setAndDirty(() => { moderatorState.excludeRoleIds = uniqueIds(value); }),
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
      lowSeverityLogChannelId: moderatorState.lowSeverityLogChannelId || '',
      severeLogChannelId: moderatorState.severeLogChannelId || '',
      scanChannelIds: uniqueIds(moderatorState.scanChannelIds),
      excludeRoleIds: uniqueIds(moderatorState.excludeRoleIds),
      alertTemplateId: moderatorState.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID,
      maxInputChars: Math.max(250, Math.min(4000, Number(moderatorState.maxInputChars) || 1500)),
    };
  }

  function autoSnapshot() {
    const link = moderatorState.auto.link;
    const domainMode = normalizeDomainMode(link.domainMode, link.domainWhitelist);
    return {
      link: {
        enabled: Boolean(link.enabled),
        blockDiscordInvites: link.blockDiscordInvites !== false,
        allowedInviteGuildIds: uniqueIds(link.allowedInviteGuildIds),
        domainMode,
        domainBlacklist: domainMode === 'blacklist' ? uniqueIds(link.domainBlacklist) : [],
        domainWhitelist: domainMode === 'whitelist' ? uniqueIds(link.domainWhitelist) : [],
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
      link.actions.push(actionDefaults('log'));
      renderModerator();
      refreshDirtyState();
    }
    if (action === 'remove-link-action') {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (Number.isFinite(index)) link.actions.splice(index, 1);
      if (!link.actions.length) link.actions.push(actionDefaults('log'));
      renderModerator();
      refreshDirtyState();
    }
  });

  document.addEventListener('input', (event) => {
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationMaxInputChars') moderatorState.maxInputChars = Number(event.target.value) || 1500;
    if (event.target.id === 'allowedInviteGuildIds') link.allowedInviteGuildIds = lineValues(event.target.value);
    if (event.target.id === 'domainRules') {
      if (normalizeDomainMode(link.domainMode, link.domainWhitelist) === 'whitelist') link.domainWhitelist = lineValues(event.target.value);
      else link.domainBlacklist = lineValues(event.target.value);
    }
    const actionField = event.target.dataset.linkActionField;
    if (actionField && actionField !== 'type') {
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
    if (event.target.id === 'domainMode') link.domainMode = normalizeDomainMode(event.target.value, link.domainWhitelist);
    const actionField = event.target.dataset.linkActionField;
    if (actionField) {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (link.actions[index]) {
        if (actionField === 'type') link.actions[index] = actionDefaults(event.target.value, link.actions[index]);
        else link.actions[index][actionField] = actionField === 'durationSeconds' ? Number(event.target.value) || 300 : event.target.value;
      }
    }
    refreshDirtyState();
    if (['moderationAiEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode'].includes(event.target.id) || actionField === 'type') renderModerator();
  });

  const nativeApplyTabFromConfig = applyTabFromConfig;
  applyTabFromConfig = function moderatorApplyTab(tabName, config) {
    if (tabName === 'moderator') {
      const next = normalizeModeration(config);
      moderatorState.enabled = next.enabled;
      moderatorState.lowSeverityLogChannelId = next.lowSeverityLogChannelId;
      moderatorState.severeLogChannelId = next.severeLogChannelId;
      moderatorState.scanChannelIds = next.scanChannelIds;
      moderatorState.excludeRoleIds = next.excludeRoleIds;
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