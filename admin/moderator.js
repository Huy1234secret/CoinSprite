(() => {
  if (window.__coinSpriteModeratorTab) return;
  window.__coinSpriteModeratorTab = true;

  const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
  const MODERATOR_TAB_HTML = '<img class="tab-icon" src="/images/moderator.png" alt="" aria-hidden="true"><span>Moderator</span>';
  const ACTION_TYPES = ['delete', 'warn', 'timeout', 'report', 'log'];
  const DEFAULT_LINK_ACTIONS = [{ type: 'delete' }, { type: 'log' }];
  const moderatorState = {
    workspace: 'auto',
    view: 'ai',
    actionLogChannelId: '',
    cases: [],
    selectedCaseId: '',
    caseFilters: { query: '', status: '', type: '' },
    casePagination: { page: 1, pageSize: 20, total: 0, totalPages: 1, hasPrevious: false, hasNext: false },
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
    const moderationLogs = config.logging?.categories?.moderation || {};
    const logOverrides = moderationLogs.eventOverrides || {};
    const defaultRules = [
      { threshold: 3, action: 'timeout', durationSeconds: 3600, enabled: true },
      { threshold: 5, action: 'timeout', durationSeconds: 86400, enabled: true },
      { threshold: 8, action: 'timeout', durationSeconds: 604800, enabled: true },
      { threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true },
    ];
    return {
      enabled: Boolean(ai.enabled),
      lowSeverityLogChannelId: String(logOverrides.ai_low || moderationLogs.defaultChannelId || ai.lowSeverityLogChannelId || legacyLogChannelId),
      severeLogChannelId: String(logOverrides.ai_severe || moderationLogs.defaultChannelId || ai.severeLogChannelId || legacyLogChannelId),
      actionLogChannelId: String(logOverrides.action || moderationLogs.defaultChannelId || ''),
      scanChannelIds: uniqueIds(ai.scanChannelIds),
      excludeRoleIds: uniqueIds(ai.excludeRoleIds),
      alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
      maxInputChars: Number(ai.maxInputChars) || 1500,
      warnings: {
        enabled: Boolean(warnings.enabled),
        defaultExpiryDays: Math.max(0, Math.min(3650, Number(warnings.defaultExpiryDays) || 90)),
        fallbackChannelId: String(warnings.fallbackChannelId || ''),
        staffLogChannelId: String(logOverrides.warning || moderationLogs.defaultChannelId || warnings.staffLogChannelId || ''),
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

function renderLoggingPanel() {
  return `<div class="panel moderator-ai-panel moderation-logging-panel">
    <div class="panel-heading"><h3>Moderation channel logging</h3><p>Route manual warnings, mutes, kicks, and bans to staff channels. Logs use <strong>Default: Moderation action log</strong> from Messages and include an evidence gallery when files are attached.</p></div>
    <div class="settings-grid">
      <div class="picker-field"><span class="field-label">Action log channel</span><div id="moderationActionLogChannelMount"></div></div>
      <div class="picker-field"><span class="field-label">Warning log channel</span><div id="warningLoggingChannelMount"></div></div>
    </div>
    <div class="moderator-template-note">The action log covers mute, kick, and ban. Warning logs may use a separate channel. Leave either field empty to disable that event log.</div>
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
    <label>Private staff notes <textarea id="warningCreateStaffNotes" rows="2" maxlength="1000"></textarea></label>
    <button class="button primary" type="button" data-moderator-action="create-warning">Create warning</button>
    <span id="warningCreateStatus"></span>
  </div>`;
}

function caseProfile(profile, fallbackId) {
  const value = profile || {};
  return {
    id: value.id || fallbackId || '',
    name: value.displayName || value.username || 'Unknown user',
    username: value.username || 'Unknown user',
    avatarUrl: value.avatarUrl || '',
  };
}

function renderCaseDetail(record) {
  const target = caseProfile(record.profiles?.target, record.targetUserId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const editable = record.status !== 'pardoned';
  const avatar = target.avatarUrl
    ? '<img src="' + escapeHtml(target.avatarUrl) + '" alt="">'
    : '<span class="case-avatar-fallback" aria-hidden="true">?</span>';
  const actions = editable
    ? '<div class="case-actions"><button class="button primary" type="button" data-moderator-action="save-case">Save case</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon</button></div>'
    : '<p class="case-pardon-note">Pardoned: ' + escapeHtml(record.pardonReason || 'No reason recorded.') + '</p>';
  const events = [...(record.events || [])].reverse().map((event) => [
    '<li><span>', new Date(event.createdAt).toLocaleString(), '</span><strong>',
    escapeHtml(event.type), '</strong><span>', event.actorId ? 'Actor ' + escapeHtml(event.actorId) : 'System', '</span></li>',
  ].join('')).join('') || '<li>No audit events.</li>';
  return '<div class="case-detail">'
    + '<button class="button small case-back" type="button" data-moderator-action="back-to-cases">← Back to cases</button>'
    + '<div class="panel case-detail-hero"><div class="case-profile">' + avatar + '<div><span class="field-label">Target</span><strong>' + escapeHtml(target.name) + '</strong><span>@' + escapeHtml(target.username) + ' · ' + escapeHtml(target.id) + '</span></div></div>'
    + '<div class="case-detail-heading"><span class="case-status ' + escapeHtml(record.status) + '">' + escapeHtml(record.status) + '</span><h2>' + escapeHtml(record.id) + '</h2><p>' + escapeHtml(record.type) + ' · ' + escapeHtml(record.source) + ' · created ' + new Date(record.createdAt).toLocaleString() + '</p></div></div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-detail-grid" data-case-id="' + escapeHtml(record.id) + '"><div class="panel">'
    + '<div class="panel-heading"><h3>Case details</h3><p>Edits append an actor-aware audit event.</p></div>'
    + '<label>Reason <textarea data-case-field="reason" maxlength="1000" rows="4" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label>'
    + '<div class="settings-grid"><label>Points <input data-case-field="points" type="number" min="1" max="10" value="' + Number(record.points) + '" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label>New expiry <input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, or use 30d/never" ' + (editable ? '' : 'disabled') + '></label></div>'
    + '<label>Evidence <input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label>Private staff notes <textarea data-case-field="staffNotes" maxlength="1000" rows="3" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</div>'
    + '<aside class="panel case-reference-panel"><div class="panel-heading"><h3>References</h3><p>Delivery and log messages retained on the case.</p></div><dl class="case-reference-list">'
    + '<dt>Author</dt><dd>' + escapeHtml(author.name) + ' · ' + escapeHtml(author.id) + '</dd>'
    + '<dt>Notice</dt><dd>' + escapeHtml(notification.status || 'pending') + ' · channel ' + escapeHtml(notification.channelId || 'not recorded') + ' · message ' + escapeHtml(notification.messageId || 'not recorded') + '</dd>'
    + '<dt>Staff log</dt><dd>channel ' + escapeHtml(staffLog.channelId || 'not recorded') + ' · message ' + escapeHtml(staffLog.messageId || 'not recorded') + '</dd>'
    + '<dt>Source</dt><dd>channel ' + escapeHtml(record.references?.source?.channelId || 'not recorded') + ' · message ' + escapeHtml(record.references?.source?.messageId || 'not recorded') + '</dd></dl></aside></div>'
    + '<div class="panel case-audit-panel"><div class="panel-heading"><h3>Audit trail</h3><p>Append-only lifecycle and action events.</p></div><ol class="case-audit-list">' + events + '</ol></div></div>';
}

function renderCasesPanel() {
  const selected = moderatorState.cases.find((record) => record.id === moderatorState.selectedCaseId);
  if (selected) return renderCaseDetail(selected);
  const page = moderatorState.casePagination;
  const rows = moderatorState.cases.map((record) => {
    const target = caseProfile(record.profiles?.target, record.targetUserId);
    return '<button class="case-row" type="button" role="row" data-moderator-action="select-case" data-case-id="' + escapeHtml(record.id) + '">'
      + '<strong>' + escapeHtml(record.id) + '<small>' + escapeHtml(record.type) + '</small></strong>'
      + '<span>' + escapeHtml(target.name) + '<small>' + escapeHtml(target.id) + '</small></span>'
      + '<span>' + escapeHtml(record.reason) + '</span><span class="case-status ' + escapeHtml(record.status) + '">' + escapeHtml(record.status) + '</span>'
      + '<time>' + new Date(record.createdAt).toLocaleDateString() + '</time></button>';
  }).join('');
  const statusOptions = ['active', 'expired', 'pardoned'].map((value) => '<option value="' + value + '" ' + (moderatorState.caseFilters.status === value ? 'selected' : '') + '>' + value + '</option>').join('');
  const typeOptions = ['warning', 'automod_warning', 'note', 'appeal'].map((value) => '<option value="' + value + '" ' + (moderatorState.caseFilters.type === value ? 'selected' : '') + '>' + value.replace('_', ' ') + '</option>').join('');
  return '<div class="panel case-list-panel"><div class="panel-heading"><h3>Cases</h3><p>Server-filtered records. Select a row for its audit and edit workflow.</p></div>'
    + '<div class="case-filter-bar"><label>Search <input id="warningCaseSearch" value="' + escapeHtml(moderatorState.caseFilters.query) + '" placeholder="Case, user, reason, source"></label>'
    + '<label>Status <select id="warningCaseStatus"><option value="">All statuses</option>' + statusOptions + '</select></label>'
    + '<label>Type <select id="warningCaseType"><option value="">All types</option>' + typeOptions + '</select></label></div>'
    + '<div class="case-table" role="table" aria-label="Moderation cases"><div class="case-table-head" role="row"><span>Case</span><span>Target</span><span>Reason</span><span>Status</span><span>Created</span></div>'
    + (moderatorState.casesLoading ? '<p class="case-empty">Loading cases…</p>' : rows || '<p class="case-empty">No matching cases.</p>') + '</div>'
    + '<div class="case-pagination"><span>Page ' + page.page + ' of ' + page.totalPages + ' · ' + page.total + ' cases</span><div>'
    + '<button class="button small" type="button" data-moderator-action="previous-case-page" ' + (page.hasPrevious ? '' : 'disabled') + '>Previous</button>'
    + '<button class="button small" type="button" data-moderator-action="next-case-page" ' + (page.hasNext ? '' : 'disabled') + '>Next</button></div></div></div>';
}

let caseSearchTimer = null;

function showModeratorToast(message, tone = 'success') {
  let region = document.querySelector('#moderatorToastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'moderatorToastRegion';
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const toast = document.createElement('div');
  toast.className = 'app-toast ' + tone;
  toast.textContent = String(message || '');
  region.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function closeModeratorModal() {
  document.querySelector('#moderatorModalBackdrop')?.remove();
}

function openPardonModal(caseId) {
  closeModeratorModal();
  const backdrop = document.createElement('div');
  backdrop.id = 'moderatorModalBackdrop';
  backdrop.className = 'app-modal-backdrop';
  backdrop.innerHTML = '<form class="app-modal" role="dialog" aria-modal="true" aria-labelledby="pardonModalTitle">'
    + '<h2 id="pardonModalTitle">Pardon ' + escapeHtml(caseId) + '</h2>'
    + '<p>The case remains in history and an audit event records this action.</p>'
    + '<label>Reason <textarea id="pardonReason" maxlength="1000" rows="4" required></textarea></label>'
    + '<div id="pardonModalError" class="inline-error" role="alert" hidden></div>'
    + '<div class="app-modal-actions"><button class="button" type="button" data-moderator-action="close-modal">Cancel</button>'
    + '<button class="button danger" type="submit" data-moderator-action="confirm-pardon" data-case-id="' + escapeHtml(caseId) + '">Pardon case</button></div></form>';
  document.body.append(backdrop);
  const dialog = backdrop.querySelector('.app-modal');
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeModeratorModal(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button, textarea, input, select')].filter((node) => !node.disabled);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModeratorModal(); });
  backdrop.querySelector('#pardonReason')?.focus();
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

async function loadWarningCases(force = false) {
  const guildId = document.querySelector('#guildSelect')?.value;
  if (!guildId || moderatorState.casesLoading || (!force && moderatorState.casesLoaded)) return;
  moderatorState.casesLoading = true;
  if (!force) renderModerator();
  try {
    const params = new URLSearchParams({
      page: String(moderatorState.casePagination.page || 1),
      pageSize: String(moderatorState.casePagination.pageSize || 20),
    });
    for (const [key, value] of Object.entries(moderatorState.caseFilters)) if (value) params.set(key, value);
    const response = await fetch('/api/guilds/' + guildId + '/moderation/cases?' + params, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load moderation cases.');
    moderatorState.cases = payload.cases || [];
    moderatorState.casePagination = payload.pagination || { page: 1, pageSize: 20, total: payload.total || 0, totalPages: 1, hasPrevious: false, hasNext: false };
    moderatorState.casesLoaded = true;
    if (moderatorState.selectedCaseId && !moderatorState.cases.some((record) => record.id === moderatorState.selectedCaseId)) moderatorState.selectedCaseId = '';
  } catch (error) {
    console.error(error);
    moderatorState.cases = [];
    moderatorState.casesLoaded = true;
    showModeratorToast(error.message, 'error');
  } finally {
    moderatorState.casesLoading = false;
    renderModerator();
  }
}

function mountLoggingPickers(root) {
  const actionLog = root.querySelector('#moderationActionLogChannelMount');
  if (actionLog) renderPicker(actionLog, textChannelOptions(), moderatorState.actionLogChannelId, {
    type: 'channel', placeholder: 'No action log channel',
    onChange: (value) => setAndDirty(() => { moderatorState.actionLogChannelId = value; }),
  });
  const warningLog = root.querySelector('#warningLoggingChannelMount');
  if (warningLog) renderPicker(warningLog, textChannelOptions(), moderatorState.warnings.staffLogChannelId, {
    type: 'channel', placeholder: 'No warning log channel',
    onChange: (value) => setAndDirty(() => { moderatorState.warnings.staffLogChannelId = value; }),
  });
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
    const autoTabs = [['ai', 'AI Moderation'], ['auto', 'Link Moderation']];
    const moderationTabs = [['warnings', 'Warn System'], ['cases', 'Cases']];
    const tabs = moderatorState.workspace === 'auto' ? autoTabs : moderationTabs;
    if (!tabs.some(([value]) => value === moderatorState.view)) moderatorState.view = tabs[0][0];
    let panel = moderatorState.view === 'ai' ? renderAiPanel()
      : moderatorState.view === 'auto' ? renderAutoPanel()
        : moderatorState.view === 'warnings' ? renderWarningsPanel()
          : renderCasesPanel();
    root.innerHTML = '<div class="moderator-shell"><nav class="moderator-workspace-tabs" aria-label="Moderator workspace">'
      + '<button class="moderator-workspace-tab ' + (moderatorState.workspace === 'auto' ? 'active' : '') + '" type="button" data-moderator-workspace="auto"><strong>Auto Moderation</strong><span>AI and link controls</span></button>'
      + '<button class="moderator-workspace-tab ' + (moderatorState.workspace === 'moderation' ? 'active' : '') + '" type="button" data-moderator-workspace="moderation"><strong>Moderation</strong><span>Warnings and cases</span></button></nav>'
      + '<nav class="mini-tabs" aria-label="Workspace sections">'
      + tabs.map(([value, label]) => '<button class="mini-tab ' + (moderatorState.view === value ? 'active' : '') + '" type="button" data-moderator-view="' + value + '">' + label + '</button>').join('')
      + '</nav>' + panel + '</div>';
    if (moderatorState.view === 'auto') mountLinkPickers(root);
    if (moderatorState.view === 'ai') mountAiPickers(root);
    if (moderatorState.view === 'warnings') mountWarningPickers(root);
    if (moderatorState.view === 'logging') mountLoggingPickers(root);
    if (moderatorState.view === 'cases' && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);
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
    const workspace = event.target.closest('[data-moderator-workspace]')?.dataset.moderatorWorkspace;
    if (workspace) {
      moderatorState.workspace = workspace === 'moderation' ? 'moderation' : 'auto';
      moderatorState.view = moderatorState.workspace === 'moderation' ? 'warnings' : 'ai';
      renderModerator();
      return;
    }
    const view = event.target.closest('[data-moderator-view]')?.dataset.moderatorView;
    if (view) {
      moderatorState.view = ['warnings', 'auto', 'ai', 'cases'].includes(view) ? view : (moderatorState.workspace === 'auto' ? 'ai' : 'warnings');
      renderModerator();
      return;
    }
    const action = event.target.closest('[data-moderator-action]')?.dataset.moderatorAction;
    if (!action) return;
    if (!event.target.closest('#moderatorRoot')) return;
    const link = moderatorState.auto.link;
    const guildId = document.querySelector('#guildSelect')?.value;
    if (action === 'select-case') {
      moderatorState.selectedCaseId = event.target.closest('[data-case-id]')?.dataset.caseId || '';
      renderModerator();
      return;
    }
    if (action === 'back-to-cases') {
      moderatorState.selectedCaseId = '';
      renderModerator();
      return;
    }
    if (action === 'previous-case-page' || action === 'next-case-page') {
      moderatorState.casePagination.page += action === 'next-case-page' ? 1 : -1;
      moderatorState.casesLoaded = false;
      await loadWarningCases(true);
      return;
    }
    if (action === 'close-modal') {
      closeModeratorModal();
      return;
    }
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
            staffNotes: document.querySelector('#warningCreateStaffNotes')?.value || '',
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
      const form = document.querySelector('#caseDetailForm');
      const errorNode = document.querySelector('#caseDetailError');
      const patch = {};
      form?.querySelectorAll('[data-case-field]').forEach((field) => {
        if (field.dataset.caseOptional === 'true' && !field.value.trim()) return;
        patch[field.dataset.caseField] = field.type === 'number' ? Number(field.value) : field.value;
      });
      try {
        const response = await fetch('/api/guilds/' + guildId + '/moderation/cases/' + form.dataset.caseId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not update case.');
        moderatorState.casesLoaded = false;
        await loadWarningCases(true);
        moderatorState.selectedCaseId = payload.case.id;
        showModeratorToast('Case ' + payload.case.id + ' updated.');
      } catch (error) {
        if (errorNode) { errorNode.textContent = error.message; errorNode.hidden = false; }
      }
      return;
    }
    if (action === 'pardon-case') {
      const caseId = document.querySelector('#caseDetailForm')?.dataset.caseId;
      if (caseId) openPardonModal(caseId);
      return;
    }
    if (action === 'confirm-pardon') {
      event.preventDefault();
      const caseId = event.target.dataset.caseId;
      const reason = document.querySelector('#pardonReason')?.value.trim();
      const errorNode = document.querySelector('#pardonModalError');
      if (!reason) {
        if (errorNode) { errorNode.textContent = 'A pardon reason is required.'; errorNode.hidden = false; }
        return;
      }
      try {
        const response = await fetch('/api/guilds/' + guildId + '/moderation/cases/' + caseId + '/pardon', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not pardon case.');
        closeModeratorModal();
        moderatorState.casesLoaded = false;
        await loadWarningCases(true);
        moderatorState.selectedCaseId = payload.case.id;
        showModeratorToast('Case ' + payload.case.id + ' pardoned.');
      } catch (error) {
        if (errorNode) { errorNode.textContent = error.message; errorNode.hidden = false; }
      }
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
      moderatorState.caseFilters.query = event.target.value;
      clearTimeout(caseSearchTimer);
      caseSearchTimer = setTimeout(() => {
        moderatorState.casePagination.page = 1;
        moderatorState.casesLoaded = false;
        loadWarningCases(true);
      }, 300);
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
    if (event.target.id === 'warningCaseStatus' || event.target.id === 'warningCaseType') {
      const key = event.target.id === 'warningCaseStatus' ? 'status' : 'type';
      moderatorState.caseFilters[key] = event.target.value;
      moderatorState.casePagination.page = 1;
      moderatorState.casesLoaded = false;
      loadWarningCases(true);
      return;
    }
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
      moderatorState.actionLogChannelId = next.actionLogChannelId;
      moderatorState.scanChannelIds = next.scanChannelIds;
      moderatorState.excludeRoleIds = next.excludeRoleIds;
      moderatorState.alertTemplateId = next.alertTemplateId;
      moderatorState.maxInputChars = next.maxInputChars;
      moderatorState.warnings = next.warnings;
      moderatorState.auto = next.auto;
      moderatorState.cases = [];
      moderatorState.selectedCaseId = '';
      moderatorState.casePagination.page = 1;
      moderatorState.casesLoaded = false;
      renderModerator();
      return;
    }
    nativeApplyTabFromConfig(tabName, config);
  };

  const nativeCollectTabState = collectTabState;
  collectTabState = function moderatorCollectTab(tabName) {
    if (tabName === 'moderator') return { ai: moderationSnapshot(), auto: autoSnapshot(), warnings: warningSnapshot(), actionLogChannelId: moderatorState.actionLogChannelId };
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
    patch.logging = {
      ...(patch.logging || {}),
      categories: {
        ...(patch.logging?.categories || {}),
        moderation: {
          defaultChannelId: '',
          eventOverrides: {
            ai_low: moderatorState.lowSeverityLogChannelId || '',
            ai_severe: moderatorState.severeLogChannelId || '',
            warning: moderatorState.warnings.staffLogChannelId || '',
            action: moderatorState.actionLogChannelId || '',
          },
        },
      },
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