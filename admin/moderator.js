(() => {
  if (window.__coinSpriteModeratorTab) return;
  window.__coinSpriteModeratorTab = true;

  const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
  const MODERATOR_TAB_HTML = '<img class="tab-icon" src="https://raw.githubusercontent.com/Huy1234secret/CoinSprite/main/images/moderator.png" alt="" aria-hidden="true"><span>Moderator</span>';
  const ACTION_TYPES = ['delete', 'warn', 'timeout', 'report', 'log'];
  const DEFAULT_LINK_ACTIONS = [{ type: 'delete' }, { type: 'log' }];
  const moderatorState = {
    view: 'overview',
    cases: [],
    caseQuery: '',
    casesLoading: false,
    casesLoaded: false,
    enabled: false,
    lowSeverityLogChannelId: '',
    severeLogChannelId: '',
    scanChannelIds: [],
    excludeRoleIds: [],
    alertTemplateId: DEFAULT_ALERT_TEMPLATE_ID,
    maxInputChars: 1500,
    warnings: {
      enabled: false,
      defaultExpiryDays: 90,
      fallbackChannelId: '',
      staffLogChannelId: '',
      escalationRules: [
        { threshold: 3, action: 'timeout', durationSeconds: 3600, enabled: true },
        { threshold: 5, action: 'timeout', durationSeconds: 86400, enabled: true },
        { threshold: 8, action: 'timeout', durationSeconds: 604800, enabled: true },
        { threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true },
      ],
    },
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
      next.points = Math.max(1, Math.min(10, Math.round(Number(source.points) || 1)));
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
    const warnings = config.moderation?.warnings || {};
    const defaultRules = [
      { threshold: 3, action: 'timeout', durationSeconds: 3600, enabled: true },
      { threshold: 5, action: 'timeout', durationSeconds: 86400, enabled: true },
      { threshold: 8, action: 'timeout', durationSeconds: 604800, enabled: true },
      { threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true },
    ];
    return {
      enabled: Boolean(ai.enabled),
      lowSeverityLogChannelId: String(ai.lowSeverityLogChannelId || legacyLogChannelId),
      severeLogChannelId: String(ai.severeLogChannelId || legacyLogChannelId),
      scanChannelIds: uniqueIds(ai.scanChannelIds),
      excludeRoleIds: uniqueIds(ai.excludeRoleIds),
      alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
      maxInputChars: Number(ai.maxInputChars) || 1500,
      warnings: {
        enabled: Boolean(warnings.enabled),
        defaultExpiryDays: Math.max(0, Math.min(3650, Number(warnings.defaultExpiryDays) || 90)),
        fallbackChannelId: String(warnings.fallbackChannelId || ''),
        staffLogChannelId: String(warnings.staffLogChannelId || ''),
        escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : defaultRules).map((rule) => ({
          threshold: Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1))),
          action: ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert',
          durationSeconds: clampSeconds(rule.durationSeconds, rule.action === 'staff_alert' ? 0 : 3600),
          enabled: rule.enabled !== false,
        })),
      },
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
        <label class="automod-warn-field">Case reason <input data-link-action-field="message" type="text" maxlength="500" value="${escapeHtml(action.message || '')}"></label>
        <label>Points <input data-link-action-field="points" type="number" min="1" max="10" step="1" value="${Number(action.points) || 1}"></label>
        <label class="automod-duration-field">Case expiry seconds (0 = never) <input data-link-action-field="durationSeconds" type="number" min="0" max="2419200" step="1" value="${Number(action.durationSeconds) || 300}"></label>
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

function caseStats() {
  const active = moderatorState.cases.filter((record) => record.status === 'active');
  const members = new Map();
  for (const record of active) members.set(record.memberId, (members.get(record.memberId) || 0) + Number(record.points || 0));
  const near = [...members.values()].filter((points) => points >= 3).length;
  const failures = moderatorState.cases.flatMap((record) => record.enforcementEvents || []).filter((event) => event.success === false).length;
  return { active: active.length, members: members.size, near, failures };
}

function renderOverviewPanel() {
  const stats = caseStats();
  const recent = moderatorState.cases.slice(0, 5);
  return `<div class="moderator-status-grid">
    <div class="moderator-stat"><span class="field-label">Active cases</span><strong>${stats.active}</strong></div>
    <div class="moderator-stat"><span class="field-label">Members warned</span><strong>${stats.members}</strong></div>
    <div class="moderator-stat"><span class="field-label">Near thresholds</span><strong>${stats.near}</strong></div>
    <div class="moderator-stat"><span class="field-label">Enforcement failures</span><strong>${stats.failures}</strong></div>
  </div>
  <div class="panel"><div class="panel-heading"><h3>Recent warning cases</h3><p>Newest moderation activity across manual commands and AutoMod.</p></div>
    ${moderatorState.casesLoading ? '<p>Loading cases...</p>' : recent.length ? recent.map((record) => `<div class="automod-action-row"><strong>${escapeHtml(record.id)}</strong><span>&lt;@${escapeHtml(record.memberId)}&gt; · ${record.points} point(s) · ${escapeHtml(record.status)}</span><span>${escapeHtml(record.reason)}</span></div>`).join('') : '<p>No warning cases yet.</p>'}
  </div>`;
}

function warningRuleRow(rule, index) {
  return `<div class="automod-action-row" data-warning-rule-index="${index}">
    <label>Threshold <input data-warning-rule-field="threshold" type="number" min="1" max="100" value="${rule.threshold}"></label>
    <label>Action <select data-warning-rule-field="action">
      ${['timeout', 'kick', 'ban', 'staff_alert'].map((action) => `<option value="${action}" ${rule.action === action ? 'selected' : ''}>${action.replace('_', ' ')}</option>`).join('')}
    </select></label>
    ${rule.action === 'timeout' ? `<label>Duration seconds <input data-warning-rule-field="durationSeconds" type="number" min="1" max="2419200" value="${rule.durationSeconds || 3600}"></label>` : ''}
    <label class="checkline"><input data-warning-rule-field="enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}> Enabled</label>
    <button class="button small danger" type="button" data-moderator-action="remove-warning-rule">Remove</button>
  </div>`;
}

function renderWarningsPanel() {
  const warnings = moderatorState.warnings;
  return `<div class="panel moderator-ai-panel">
    <div class="panel-heading"><h3>Point-based warnings</h3><p>Cases remain auditable after they expire or are pardoned.</p></div>
    <label class="checkline"><input id="warningsEnabled" type="checkbox" ${warnings.enabled ? 'checked' : ''}> Enable persistent warning cases</label>
    <div class="settings-grid">
      <label>Default expiry days <input id="warningDefaultExpiryDays" type="number" min="0" max="3650" value="${warnings.defaultExpiryDays}"></label>
      <div class="picker-field"><span class="field-label">DM fallback channel</span><div id="warningFallbackChannelMount"></div></div>
      <div class="picker-field"><span class="field-label">Staff log channel</span><div id="warningStaffLogChannelMount"></div></div>
    </div>
    <div class="automod-action-head"><h3>Escalation ladder</h3><button class="button small" type="button" data-moderator-action="add-warning-rule">Add rule</button></div>
    <div class="automod-action-list">${warnings.escalationRules.map(warningRuleRow).join('')}</div>
  </div>
  <div class="panel"><div class="panel-heading"><h3>Create warning case</h3><p>The member receives a DM, with fallback delivery when configured.</p></div>
    <div class="settings-grid">
      <label>Member ID <input id="warningCreateMember" inputmode="numeric" placeholder="123456789012345678"></label>
      <label>Points <input id="warningCreatePoints" type="number" min="1" max="10" value="1"></label>
      <label>Expires <input id="warningCreateExpires" placeholder="90d, 4w, or never"></label>
      <label>Evidence URL <input id="warningCreateEvidence" type="url" placeholder="https://discord.com/channels/..."></label>
    </div>
    <label>Reason <textarea id="warningCreateReason" rows="3" maxlength="1000"></textarea></label>
    <button class="button primary" type="button" data-moderator-action="create-warning">Create warning</button>
    <span id="warningCreateStatus"></span>
  </div>`;
}

function renderCasesPanel() {
  const rows = moderatorState.cases.filter((record) => {
    const query = moderatorState.caseQuery.toLowerCase();
    return !query || [record.id, record.memberId, record.reason, record.status, record.source].some((value) => String(value || '').toLowerCase().includes(query));
  });
  return `<div class="panel">
    <div class="panel-heading"><h3>Cases & logs</h3><p>Search, edit, or pardon warning cases without deleting their audit history.</p></div>
    <label>Search cases <input id="warningCaseSearch" value="${escapeHtml(moderatorState.caseQuery)}" placeholder="Case ID, member, reason, source"></label>
    <div class="automod-action-list">${moderatorState.casesLoading ? '<p>Loading cases...</p>' : rows.map((record) => `<div class="automod-action-row" data-case-id="${escapeHtml(record.id)}">
      <strong>${escapeHtml(record.id)}</strong>
      <span>Member ${escapeHtml(record.memberId)} · ${record.points} point(s) · ${escapeHtml(record.status)} · ${escapeHtml(record.source)}</span>
      <label>Reason <input data-case-field="reason" maxlength="1000" value="${escapeHtml(record.reason)}" ${record.status === 'pardoned' ? 'disabled' : ''}></label>
      <label>Points <input data-case-field="points" type="number" min="1" max="10" value="${record.points}" ${record.status === 'pardoned' ? 'disabled' : ''}></label>
      <label>Evidence <input data-case-field="evidence" value="${escapeHtml(record.evidence || '')}" ${record.status === 'pardoned' ? 'disabled' : ''}></label>
      ${record.status === 'pardoned' ? `<span>Pardoned: ${escapeHtml(record.pardonReason || '')}</span>` : '<button class="button small" type="button" data-moderator-action="save-case">Save</button><button class="button small danger" type="button" data-moderator-action="pardon-case">Pardon</button>'}
    </div>`).join('') || '<p>No matching cases.</p>'}</div>
  </div>`;
}

function renderSettingsPanel() {
  return `<div class="panel"><div class="panel-heading"><h3>Moderation settings</h3><p>Shared behavior for moderation staff and warning records.</p></div>
    <p>Dashboard and case APIs accept server administrators. Discord warning commands also accept the configured staff role.</p>
    <p>Warning notification and log channels are configured in the Warnings tab. AI-specific channels remain in AI Moderation.</p>
    <p>Case IDs are permanent and reserved for a future appeals workflow.</p>
  </div>`;
}

function warningSnapshot() {
  return {
    enabled: Boolean(moderatorState.warnings.enabled),
    defaultExpiryDays: Math.max(0, Math.min(3650, Number(moderatorState.warnings.defaultExpiryDays) || 90)),
    fallbackChannelId: moderatorState.warnings.fallbackChannelId || '',
    staffLogChannelId: moderatorState.warnings.staffLogChannelId || '',
    escalationRules: moderatorState.warnings.escalationRules.map((rule) => ({
      threshold: Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1))),
      action: ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert',
      durationSeconds: Math.max(0, Math.min(2419200, Number(rule.durationSeconds) || 0)),
      enabled: rule.enabled !== false,
    })).sort((a, b) => a.threshold - b.threshold),
  };
}

async function loadWarningCases() {
  const guildId = document.querySelector('#guildSelect')?.value;
  if (!guildId || moderatorState.casesLoading || moderatorState.casesLoaded) return;
  moderatorState.casesLoading = true;
  renderModerator();
  try {
    const response = await fetch(`/api/guilds/${guildId}/moderation/cases`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load warning cases.');
    moderatorState.cases = payload.cases || [];
    moderatorState.casesLoaded = true;
  } catch (error) {
    console.error(error);
    moderatorState.cases = [];
    moderatorState.casesLoaded = true;
  } finally {
    moderatorState.casesLoading = false;
    renderModerator();
  }
}

function mountWarningPickers(root) {
  const warnings = moderatorState.warnings;
  const fallback = root.querySelector('#warningFallbackChannelMount');
  if (fallback) renderPicker(fallback, textChannelOptions(), warnings.fallbackChannelId, {
    type: 'channel', placeholder: 'No fallback channel',
    onChange: (value) => setAndDirty(() => { warnings.fallbackChannelId = value; }),
  });
  const staffLog = root.querySelector('#warningStaffLogChannelMount');
  if (staffLog) renderPicker(staffLog, textChannelOptions(), warnings.staffLogChannelId, {
    type: 'channel', placeholder: 'No staff log channel',
    onChange: (value) => setAndDirty(() => { warnings.staffLogChannelId = value; }),
  });
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
    const tabs = [
      ['overview', 'Overview'],
      ['warnings', 'Warnings'],
      ['auto', 'AutoMod'],
      ['ai', 'AI Moderation'],
      ['cases', 'Cases & Logs'],
      ['settings', 'Settings'],
    ];
    let panel = renderOverviewPanel();
    if (moderatorState.view === 'warnings') panel = renderWarningsPanel();
    if (moderatorState.view === 'auto') panel = renderAutoPanel();
    if (moderatorState.view === 'ai') panel = renderAiPanel();
    if (moderatorState.view === 'cases') panel = renderCasesPanel();
    if (moderatorState.view === 'settings') panel = renderSettingsPanel();
    root.innerHTML = `<div class="moderator-shell">
      <nav class="mini-tabs" aria-label="Moderator settings">
        ${tabs.map(([value, label]) => `<button class="mini-tab ${moderatorState.view === value ? 'active' : ''}" type="button" data-moderator-view="${value}">${label}</button>`).join('')}
      </nav>
      ${panel}
    </div>`;
    if (moderatorState.view === 'auto') mountLinkPickers(root);
    if (moderatorState.view === 'ai') mountAiPickers(root);
    if (moderatorState.view === 'warnings') mountWarningPickers(root);
    if ((moderatorState.view === 'overview' || moderatorState.view === 'cases') && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);
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

  document.addEventListener('click', async (event) => {
    const view = event.target.closest('[data-moderator-view]')?.dataset.moderatorView;
    if (view) {
      moderatorState.view = ['overview', 'warnings', 'auto', 'ai', 'cases', 'settings'].includes(view) ? view : 'overview';
      renderModerator();
      return;
    }
    const action = event.target.closest('[data-moderator-action]')?.dataset.moderatorAction;
    if (!action) return;
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    const guildId = document.querySelector('#guildSelect')?.value;
    if (action === 'add-warning-rule') {
      moderatorState.warnings.escalationRules.push({ threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true });
      renderModerator();
      refreshDirtyState();
      return;
    }
    if (action === 'remove-warning-rule') {
      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);
      if (Number.isInteger(index)) moderatorState.warnings.escalationRules.splice(index, 1);
      renderModerator();
      refreshDirtyState();
      return;
    }
    if (action === 'create-warning') {
      const status = document.querySelector('#warningCreateStatus');
      if (status) status.textContent = 'Creating...';
      try {
        const response = await fetch(`/api/guilds/${guildId}/moderation/cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memberId: document.querySelector('#warningCreateMember')?.value || '',
            points: Number(document.querySelector('#warningCreatePoints')?.value) || 1,
            expires: document.querySelector('#warningCreateExpires')?.value || '',
            evidence: document.querySelector('#warningCreateEvidence')?.value || '',
            reason: document.querySelector('#warningCreateReason')?.value || '',
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not create warning.');
        if (status) status.textContent = `Created ${payload.case.id}.`;
        moderatorState.casesLoaded = false;
        await loadWarningCases();
      } catch (error) {
        if (status) status.textContent = error.message;
      }
      return;
    }
    if (action === 'save-case') {
      const row = event.target.closest('[data-case-id]');
      const patch = {};
      row.querySelectorAll('[data-case-field]').forEach((field) => { patch[field.dataset.caseField] = field.type === 'number' ? Number(field.value) : field.value; });
      const response = await fetch(`/api/guilds/${guildId}/moderation/cases/${row.dataset.caseId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok) return window.alert(payload.error || 'Could not update case.');
      moderatorState.casesLoaded = false;
      await loadWarningCases();
      return;
    }
    if (action === 'pardon-case') {
      const row = event.target.closest('[data-case-id]');
      const reason = window.prompt('Reason for pardoning this case:');
      if (!reason) return;
      const response = await fetch(`/api/guilds/${guildId}/moderation/cases/${row.dataset.caseId}/pardon`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const payload = await response.json();
      if (!response.ok) return window.alert(payload.error || 'Could not pardon case.');
      moderatorState.casesLoaded = false;
      await loadWarningCases();
      return;
    }
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
    if (event.target.id === 'warningDefaultExpiryDays') moderatorState.warnings.defaultExpiryDays = Number(event.target.value) || 90;
    if (event.target.id === 'warningCaseSearch') {
      moderatorState.caseQuery = event.target.value;
      renderModerator();
      const search = document.querySelector('#warningCaseSearch');
      search?.focus();
      search?.setSelectionRange?.(search.value.length, search.value.length);
      return;
    }
    const warningRuleField = event.target.dataset.warningRuleField;
    if (warningRuleField && warningRuleField !== 'action' && warningRuleField !== 'enabled') {
      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);
      const rule = moderatorState.warnings.escalationRules[index];
      if (rule) rule[warningRuleField] = Number(event.target.value) || 0;
    }
    if (event.target.id === 'allowedInviteGuildIds') link.allowedInviteGuildIds = lineValues(event.target.value);
    if (event.target.id === 'domainRules') {
      if (normalizeDomainMode(link.domainMode, link.domainWhitelist) === 'whitelist') link.domainWhitelist = lineValues(event.target.value);
      else link.domainBlacklist = lineValues(event.target.value);
    }
    const actionField = event.target.dataset.linkActionField;
    if (actionField && actionField !== 'type') {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (link.actions[index]) {
        link.actions[index][actionField] = ['durationSeconds', 'points'].includes(actionField) ? Number(event.target.value) || (actionField === 'points' ? 1 : 300) : event.target.value;
      }
    }
    refreshDirtyState();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationAiEnabled') moderatorState.enabled = Boolean(event.target.checked);
    if (event.target.id === 'warningsEnabled') moderatorState.warnings.enabled = Boolean(event.target.checked);
    const warningRuleField = event.target.dataset.warningRuleField;
    if (warningRuleField) {
      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);
      const rule = moderatorState.warnings.escalationRules[index];
      if (rule) {
        if (warningRuleField === 'enabled') rule.enabled = Boolean(event.target.checked);
        else if (warningRuleField === 'action') rule.action = event.target.value;
      }
    }
    if (event.target.id === 'linkAutoEnabled') link.enabled = Boolean(event.target.checked);
    if (event.target.id === 'linkBlockInvites') link.blockDiscordInvites = Boolean(event.target.checked);
    if (event.target.id === 'domainMode') link.domainMode = normalizeDomainMode(event.target.value, link.domainWhitelist);
    const actionField = event.target.dataset.linkActionField;
    if (actionField) {
      const index = Number(event.target.closest('[data-action-index]')?.dataset.actionIndex);
      if (link.actions[index]) {
        if (actionField === 'type') link.actions[index] = actionDefaults(event.target.value, link.actions[index]);
        else link.actions[index][actionField] = ['durationSeconds', 'points'].includes(actionField) ? Number(event.target.value) || (actionField === 'points' ? 1 : 300) : event.target.value;
      }
    }
    refreshDirtyState();
    if (['moderationAiEnabled', 'warningsEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode'].includes(event.target.id) || actionField === 'type' || warningRuleField === 'action') renderModerator();
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
      moderatorState.warnings = next.warnings;
      moderatorState.auto = next.auto;
      moderatorState.cases = [];
      moderatorState.casesLoaded = false;
      renderModerator();
      return;
    }
    nativeApplyTabFromConfig(tabName, config);
  };

  const nativeCollectTabState = collectTabState;
  collectTabState = function moderatorCollectTab(tabName) {
    if (tabName === 'moderator') return { ai: moderationSnapshot(), auto: autoSnapshot(), warnings: warningSnapshot() };
    return nativeCollectTabState(tabName);
  };

  const nativeCollectPatch = collectPatch;
  collectPatch = function moderatorCollectPatch() {
    const patch = nativeCollectPatch();
    patch.moderation = {
      ...(patch.moderation || {}),
      ai: moderationSnapshot(),
      auto: autoSnapshot(),
      warnings: warningSnapshot(),
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
    moderatorState.cases = [];
    moderatorState.casesLoaded = false;
    renderModerator();
    captureSavedSnapshots();
    refreshDirtyState();
  }
})();