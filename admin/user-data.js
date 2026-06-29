(() => {
  const root = document.querySelector('#userDataRoot');
  if (!root) return;

  function ensurePreviewPolishAssets() {}

  function ensureDataTabIcon() {
    const button = document.querySelector('.tab[data-tab="data"]');
    if (!button) return;
    let image = button.querySelector('.tab-icon');
    if (!image) {
      image = document.createElement('img');
      image.className = 'tab-icon';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      button.prepend(image);
    }
    if (image.getAttribute('src') !== '/images/data.png') image.src = '/images/data.png';
  }

  function ensureTicketBlacklistField() {
    if (document.querySelector('#userDataTicketBlacklisted')) return;
    const xpLockLabel = document.querySelector('#userDataExpLocked')?.closest('label');
    if (!xpLockLabel) return;
    const label = document.createElement('label');
    label.className = 'checkline';
    label.innerHTML = '<input id="userDataTicketBlacklisted" type="checkbox"> Ticket system blacklist';
    xpLockLabel.after(label);
  }

  function ensureModerationWorkspace() {
    if (document.querySelector('#userModerationWorkspace')) return;
    const actions = document.querySelector('.user-data-card .data-actions');
    if (!actions) return;
    const section = document.createElement('section');
    section.id = 'userModerationWorkspace';
    section.className = 'user-moderation-workspace';
    section.innerHTML = `
      <div class="user-moderation-head">
        <div><span class="eyebrow">Moderation</span><h3>Cases and actions</h3><p>Create a case here without using a Discord command. The user is notified before enforcement.</p></div>
      </div>
      <form id="userModerationActionForm" class="user-moderation-action">
        <div class="user-moderation-action-grid">
          <label>Action<select id="userModerationAction"><option value="warning">Warning</option><option value="mute">Mute</option><option value="kick">Kick</option><option value="ban">Ban</option></select></label>
          <label id="userModerationTimeLabel">Time<input id="userModerationTime" placeholder="30m, 7d, 4w, or permanent"></label>
          <label class="checkline user-moderation-appealable"><input id="userModerationAppealable" type="checkbox" checked> Appealable</label>
          <label class="user-moderation-evidence">Evidence attachment<input id="userModerationEvidence" type="file" accept="image/*,.pdf,.txt,.json"></label>
        </div>
        <label>Reason<textarea id="userModerationReason" rows="3" maxlength="1000" required placeholder="Explain why this action is being taken."></textarea></label>
        <div class="user-moderation-submit"><span id="userModerationStatus" role="status"></span><button class="button danger" id="userModerationSubmit" type="submit">Apply action</button></div>
      </form>
      <div class="user-case-head"><div><h3>Moderation cases</h3><p>Warnings, mutes, kicks, bans, evidence, and appeal status.</p></div><button class="button subtle small" id="userModerationReload" type="button">Refresh cases</button></div>
      <div id="userModerationCases" class="user-case-list"><div class="user-case-empty">Load a user to view cases.</div></div>
    `;
    actions.before(section);
  }

  ensurePreviewPolishAssets();
  ensureDataTabIcon();
  ensureTicketBlacklistField();
  ensureModerationWorkspace();

  const els = {
    guildSelect: document.querySelector('#guildSelect'),
    searchId: document.querySelector('#userDataSearchId'),
    searchButton: document.querySelector('#userDataSearchButton'),
    reloadButton: document.querySelector('#userDataReloadButton'),
    saveButton: document.querySelector('#userDataSaveButton'),
    status: document.querySelector('#userDataStatus'),
    editor: document.querySelector('#userDataEditor'),
    avatar: document.querySelector('#userDataAvatar'),
    title: document.querySelector('#userDataTitle'),
    meta: document.querySelector('#userDataMeta'),
    summary: document.querySelector('#userDataSummary'),
    level: document.querySelector('#userDataLevel'),
    totalXp: document.querySelector('#userDataTotalXp') || document.querySelector('#userDataXp'),
    messages: document.querySelector('#userDataMessages'),
    reactions: document.querySelector('#userDataReactions'),
    punishTier: document.querySelector('#userDataPunishTier'),
    activePunishTier: document.querySelector('#userDataActivePunishTier'),
    punishEndsAt: document.querySelector('#userDataPunishEndsAt'),
    expLocked: document.querySelector('#userDataExpLocked'),
    expLockReason: document.querySelector('#userDataExpLockReason'),
    ticketBlacklisted: document.querySelector('#userDataTicketBlacklisted'),
    moderationForm: document.querySelector('#userModerationActionForm'),
    moderationAction: document.querySelector('#userModerationAction'),
    moderationTime: document.querySelector('#userModerationTime'),
    moderationTimeLabel: document.querySelector('#userModerationTimeLabel'),
    moderationAppealable: document.querySelector('#userModerationAppealable'),
    moderationEvidence: document.querySelector('#userModerationEvidence'),
    moderationReason: document.querySelector('#userModerationReason'),
    moderationSubmit: document.querySelector('#userModerationSubmit'),
    moderationStatus: document.querySelector('#userModerationStatus'),
    moderationReload: document.querySelector('#userModerationReload'),
    moderationCases: document.querySelector('#userModerationCases'),
  };

  let loadedUserId = '';
  let loading = false;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
    return payload;
  }

  function guildId() {
    return els.guildSelect?.value || '';
  }

  function cleanUserId() {
    return String(els.searchId?.value || '').trim();
  }

  function isSnowflake(value) {
    return /^\d{16,20}$/.test(String(value || '').trim());
  }

  function setStatus(message, kind = '') {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.className = `status compact${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(isBusy) {
    loading = isBusy;
    [els.searchButton, els.reloadButton, els.saveButton, els.moderationSubmit, els.moderationReload].forEach((button) => {
      if (button) button.disabled = isBusy;
    });
  }

  function numericValue(field, fallback = 0) {
    const value = Number(field?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function checkedValue(field) {
    return field?.checked === true;
  }

  function setInputValue(field, value) {
    if (field) field.value = value ?? '';
  }

  function setChecked(field, value) {
    if (field) field.checked = Boolean(value);
  }

  function formatDate(ms) {
    const numeric = Number(ms);
    if (!Number.isFinite(numeric) || numeric <= 0) return 'Not set';
    return new Date(numeric).toLocaleString();
  }

  function toDatetimeLocal(ms) {
    const numeric = Number(ms);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    const date = new Date(numeric);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDatetimeLocal(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]);
  }

  function caseEvidence(record) {
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (!attachments.length && !record.evidence) return '';
    const items = attachments.map((attachment, index) => {
      const name = attachment.name || 'Evidence ' + (index + 1);
      const href = attachment.storedName
        ? '/api/guilds/' + encodeURIComponent(guildId()) + '/moderation/evidence/' + encodeURIComponent(record.id) + '/' + encodeURIComponent(attachment.storedName)
        : attachment.url;
      if (!href) return '';
      if (/^image\//i.test(String(attachment.contentType || ''))) {
        return '<a class="user-case-image" href="' + escapeHtml(href) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(href) + '" alt="' + escapeHtml(name) + '"><span>' + escapeHtml(name) + '</span></a>';
      }
      return '<a class="user-case-file" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>';
    }).filter(Boolean);
    if (!items.length && record.evidence) {
      items.push('<a class="user-case-file" href="' + escapeHtml(record.evidence) + '" target="_blank" rel="noopener">Open evidence</a>');
    }
    return items.length ? '<div class="user-case-gallery">' + items.join('') + '</div>' : '';
  }

  function renderModerationCases(records = []) {
    if (!els.moderationCases) return;
    if (!records.length) {
      els.moderationCases.innerHTML = '<div class="user-case-empty">No moderation cases for this user.</div>';
      return;
    }
    els.moderationCases.innerHTML = records.map((record) => {
      const created = Number(record.createdAt) ? new Date(record.createdAt).toLocaleString() : 'Unknown date';
      return '<article class="user-case-card"><header><div><span class="user-case-id">' + escapeHtml(record.id) + '</span><strong>' + escapeHtml(String(record.type || 'case').replace('_', ' ')) + '</strong></div><span class="user-case-status ' + escapeHtml(record.status || '') + '">' + escapeHtml(record.status || 'unknown') + '</span></header>'
        + '<p>' + escapeHtml(record.reason || 'No reason provided.') + '</p>'
        + '<dl><div><dt>Created</dt><dd>' + escapeHtml(created) + '</dd></div><div><dt>Appealable</dt><dd>' + (record.appealable ? 'Yes' : 'No') + '</dd></div><div><dt>Notice</dt><dd>' + escapeHtml(record.delivery?.status || record.references?.notification?.status || 'pending') + '</dd></div></dl>'
        + caseEvidence(record) + '</article>';
    }).join('');
  }

  async function loadModerationCases() {
    const userId = loadedUserId || cleanUserId();
    if (!guildId() || !isSnowflake(userId) || !els.moderationCases) return;
    els.moderationCases.innerHTML = '<div class="user-case-empty">Loading moderation cases...</div>';
    try {
      const params = new URLSearchParams({ targetUserId: userId, pageSize: '50' });
      const payload = await api('/api/guilds/' + guildId() + '/moderation/cases?' + params);
      renderModerationCases(payload.cases || []);
    } catch (error) {
      els.moderationCases.innerHTML = '<div class="user-case-empty error">' + escapeHtml(error.message) + '</div>';
    }
  }

  function updateModerationActionFields() {
    const action = els.moderationAction?.value || 'warning';
    if (els.moderationTimeLabel) els.moderationTimeLabel.hidden = action === 'kick';
    if (els.moderationTime) els.moderationTime.disabled = action === 'kick';
    if (els.moderationSubmit) els.moderationSubmit.textContent = 'Apply ' + action;
  }

  async function submitModerationAction(event) {
    event.preventDefault();
    const userId = loadedUserId || cleanUserId();
    if (!isSnowflake(userId)) {
      if (els.moderationStatus) els.moderationStatus.textContent = 'Load a user before applying an action.';
      return;
    }
    const data = new FormData();
    data.append('action', els.moderationAction?.value || 'warning');
    data.append('reason', String(els.moderationReason?.value || '').trim());
    data.append('time', String(els.moderationTime?.value || '').trim());
    data.append('appealable', String(els.moderationAppealable?.checked !== false));
    const file = els.moderationEvidence?.files?.[0];
    if (file) data.append('evidence', file, file.name);
    setBusy(true);
    if (els.moderationStatus) els.moderationStatus.textContent = 'Notifying the user and applying the action...';
    try {
      const payload = await api('/api/guilds/' + guildId() + '/users/' + userId + '/moderation-actions', {
        method: 'POST',
        body: data,
      });
      if (els.moderationStatus) els.moderationStatus.textContent = 'Created ' + payload.case.id + '. Notice: ' + (payload.delivery || 'sent') + '.';
      if (els.moderationReason) els.moderationReason.value = '';
      if (els.moderationEvidence) els.moderationEvidence.value = '';
      await loadModerationCases();
    } catch (error) {
      if (els.moderationStatus) els.moderationStatus.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  function setXpMode(mode) {
    const field = document.querySelector(`input[name="userDataXpMode"][value="${mode === 'level' ? 'level' : 'xp'}"]`);
    if (field) field.checked = true;
  }

  function getXpMode() {
    return document.querySelector('input[name="userDataXpMode"]:checked')?.value || 'xp';
  }

  function chip(label, value, className = '') {
    const item = document.createElement('div');
    item.className = `data-chip${className ? ` ${className}` : ''}`;
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    return item;
  }

  function renderSummary(payload) {
    if (!els.summary) return;
    const data = payload.data || {};
    const active = data.activePunishment;
    const inGuild = payload.member?.inGuild;
    els.summary.replaceChildren(
      chip('Level', data.level ?? 1),
      chip('Total XP', data.totalXp ?? 0),
      chip('Messages', data.messages ?? 0),
      chip('Guild member', inGuild ? 'Yes' : 'No', inGuild ? 'ok' : 'warn'),
      chip('Stored data', payload.found ? 'Found' : 'New', payload.found ? 'ok' : 'warn'),
      chip('XP locked', data.expLocked ? 'Yes' : 'No', data.expLocked ? 'danger' : 'ok'),
      chip('Ticket blacklist', data.ticketBlacklisted ? 'Yes' : 'No', data.ticketBlacklisted ? 'danger' : 'ok'),
      chip('Active punishment', active?.tier ? `Tier ${active.tier}` : 'None', active?.tier ? 'danger' : 'ok'),
      chip('Punishment ends', active?.endsAt ? formatDate(active.endsAt) : 'Not set'),
    );
  }

  function fill(payload) {
    const data = payload.data || {};
    loadedUserId = payload.userId || cleanUserId();
    if (els.editor) els.editor.hidden = false;
    if (els.avatar) {
      els.avatar.hidden = !payload.user?.avatarUrl;
      if (payload.user?.avatarUrl) els.avatar.src = payload.user.avatarUrl;
    }
    const name = payload.member?.displayName || payload.user?.globalName || payload.user?.username || `User ${loadedUserId}`;
    if (els.title) els.title.textContent = name;
    if (els.meta) els.meta.textContent = `ID ${loadedUserId} • ${payload.member?.inGuild ? 'Currently in guild' : 'Not currently in guild / left guild'}${payload.found ? '' : ' • No saved data yet'}`;
    setInputValue(els.level, data.level ?? 1);
    setInputValue(els.totalXp, data.totalXp ?? 0);
    setInputValue(els.messages, data.messages ?? 0);
    setInputValue(els.reactions, data.reactions ?? 0);
    setInputValue(els.punishTier, data.punishTier ?? 0);
    setInputValue(els.activePunishTier, data.activePunishment?.tier ?? 0);
    setInputValue(els.punishEndsAt, toDatetimeLocal(data.activePunishment?.endsAt));
    setChecked(els.expLocked, data.expLocked === true);
    setInputValue(els.expLockReason, data.expLockReason || '');
    setChecked(els.ticketBlacklisted, data.ticketBlacklisted === true);
    setXpMode('xp');
    renderSummary(payload);
  }

  async function loadUser(userId = cleanUserId()) {
    if (loading) return;
    if (!guildId()) {
      setStatus('Select a server first.', 'error');
      return;
    }
    if (!isSnowflake(userId)) {
      setStatus('Enter a valid Discord user ID, 16-20 digits. The data tab does not list all users.', 'error');
      return;
    }
    setBusy(true);
    setStatus('Loading user data...');
    try {
      const payload = await api(`/api/guilds/${guildId()}/users/${userId}/data`);
      fill(payload);
      await loadModerationCases();
      setStatus(payload.found ? 'User data loaded.' : 'No saved data found. Saving will create this user record.', payload.found ? 'ok' : '');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function collectPatch() {
    const activeTier = Math.max(0, Math.min(5, Math.floor(numericValue(els.activePunishTier, 0))));
    return {
      xpMode: getXpMode(),
      level: Math.max(1, Math.floor(numericValue(els.level, 1))),
      totalXp: Math.max(0, numericValue(els.totalXp, 0)),
      messages: Math.max(0, Math.floor(numericValue(els.messages, 0))),
      reactions: Math.max(0, Math.floor(numericValue(els.reactions, 0))),
      punishTier: Math.max(0, Math.min(5, Math.floor(numericValue(els.punishTier, 0)))),
      activePunishment: {
        tier: activeTier,
        endsAt: activeTier > 0 ? fromDatetimeLocal(els.punishEndsAt?.value) : null,
      },
      expLocked: checkedValue(els.expLocked),
      expLockReason: String(els.expLockReason?.value || '').trim(),
      ticketBlacklisted: checkedValue(els.ticketBlacklisted),
    };
  }

  async function saveUser() {
    if (loading) return;
    const userId = loadedUserId || cleanUserId();
    if (!isSnowflake(userId)) {
      setStatus('Load a user ID before saving.', 'error');
      return;
    }
    setBusy(true);
    setStatus('Saving user data...');
    try {
      const payload = await api(`/api/guilds/${guildId()}/users/${userId}/data`, {
        method: 'PATCH',
        body: JSON.stringify(collectPatch()),
      });
      fill(payload);
      setStatus('User data saved. Leveling and ticket blacklist data remain even if the user leaves the guild.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function clearLoadedUser() {
    loadedUserId = '';
    if (els.editor) els.editor.hidden = true;
    if (els.moderationCases) els.moderationCases.innerHTML = '<div class="user-case-empty">Load a user to view cases.</div>';
    setStatus('Enter a user ID to load stored level, punishment, and ticket blacklist data.');
  }

  els.searchButton?.addEventListener('click', () => loadUser());
  els.reloadButton?.addEventListener('click', () => loadUser(loadedUserId || cleanUserId()));
  els.saveButton?.addEventListener('click', saveUser);
  els.moderationForm?.addEventListener('submit', submitModerationAction);
  els.moderationReload?.addEventListener('click', loadModerationCases);
  els.moderationAction?.addEventListener('change', updateModerationActionFields);
  updateModerationActionFields();
  els.searchId?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loadUser();
  });
  els.guildSelect?.addEventListener('change', clearLoadedUser);

  document.querySelectorAll('input[name="userDataXpMode"]').forEach((field) => {
    field.addEventListener('change', () => {
      const isLevel = getXpMode() === 'level';
      els.level?.classList.toggle('emphasis-input', isLevel);
      els.totalXp?.classList.toggle('emphasis-input', !isLevel);
    });
  });
})();

(() => {
  window.__coinSpritePreviewPolishDisabled = true;

  const style = document.createElement('style');
  style.textContent = `
    .mini-tabs {
      z-index: 90 !important;
      isolation: isolate;
    }
  `;
  document.head.append(style);

  const resetButton = document.querySelector('#resetTabButton');
  const configForm = document.querySelector('#configForm');
  let resetView = null;

  function activeValue(selector) {
    return document.querySelector(selector)?.dataset.value || '';
  }

  function captureResetView() {
    const ticketsActive = document.querySelector('[data-panel="tickets"]')?.classList.contains('active');
    resetView = {
      scrollTop: configForm?.scrollTop || 0,
      ticket: null,
    };
    if (!ticketsActive) return;

    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;
    const heading = root.querySelector('.ticket-editor-head h3')?.textContent.trim() || '';
    const ticketName = root.querySelector('input[data-ticket-field="name"]')?.value.trim() || '';
    resetView.ticket = {
      main: activeValue('#ticketEditorRoot .ticket-main-tabs .mini-tab.active'),
      view: heading === 'Default settings' ? 'defaults' : ticketName ? 'type' : 'list',
      ticketName,
      section: activeValue('#ticketEditorRoot .ticket-type-tabs .mini-tab.active'),
      formPhase: activeValue('#ticketEditorRoot .form-phase-switch button.selected'),
    };
  }

  function clickValue(root, selector, value) {
    if (!value) return;
    const button = [...root.querySelectorAll(selector)].find((item) => item.dataset.value === value);
    button?.click();
  }

  function restoreResetView() {
    const snapshot = resetView;
    resetView = null;
    if (!snapshot) return;

    const root = document.querySelector('#ticketEditorRoot');
    const ticket = snapshot.ticket;
    if (root && ticket) {
      clickValue(root, '.ticket-main-tabs .mini-tab', ticket.main);
      if (ticket.main === 'ticket' && ticket.view === 'defaults') {
        root.querySelector('[data-action="open-defaults"]')?.click();
      } else if (ticket.main === 'ticket' && ticket.view === 'type') {
        const card = [...root.querySelectorAll('.ticket-type-card')].find((item) => (
          item.querySelector('.ticket-type-copy strong')?.textContent.trim() === ticket.ticketName
        ));
        card?.click();
        clickValue(root, '.ticket-type-tabs .mini-tab', ticket.section);
        clickValue(root, '.form-phase-switch button', ticket.formPhase);
      }
    }

    requestAnimationFrame(() => {
      if (configForm) configForm.scrollTop = snapshot.scrollTop;
    });
  }

  resetButton?.addEventListener('pointerdown', captureResetView, true);
  resetButton?.addEventListener('mousedown', () => {
    if (!resetView) captureResetView();
  }, true);
  resetButton?.addEventListener('click', () => setTimeout(restoreResetView, 0));
})();
