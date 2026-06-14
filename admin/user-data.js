(() => {
  const root = document.querySelector('#userDataRoot');
  if (!root) return;

  function ensurePreviewPolishAssets() {
    if (!document.querySelector('link[href="/admin/message-preview-polish.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/admin/message-preview-polish.css';
      document.head.append(link);
    }
    if (!document.querySelector('script[src="/admin/message-preview-polish.js"]')) {
      const script = document.createElement('script');
      script.src = '/admin/message-preview-polish.js';
      script.defer = true;
      document.body.append(script);
    }
  }

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
    if (image.getAttribute('src') !== '/admin/images/data.png') image.src = '/admin/images/data.png';
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

  ensurePreviewPolishAssets();
  ensureDataTabIcon();
  ensureTicketBlacklistField();

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
    totalXp: document.querySelector('#userDataTotalXp'),
    messages: document.querySelector('#userDataMessages'),
    reactions: document.querySelector('#userDataReactions'),
    punishTier: document.querySelector('#userDataPunishTier'),
    activePunishTier: document.querySelector('#userDataActivePunishTier'),
    punishEndsAt: document.querySelector('#userDataPunishEndsAt'),
    expLocked: document.querySelector('#userDataExpLocked'),
    expLockReason: document.querySelector('#userDataExpLockReason'),
    ticketBlacklisted: document.querySelector('#userDataTicketBlacklisted'),
  };

  let loadedUserId = '';
  let loading = false;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
    [els.searchButton, els.reloadButton, els.saveButton].forEach((button) => {
      if (button) button.disabled = isBusy;
    });
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
    els.editor.hidden = false;
    if (els.avatar) {
      els.avatar.hidden = !payload.user?.avatarUrl;
      if (payload.user?.avatarUrl) els.avatar.src = payload.user.avatarUrl;
    }
    const name = payload.member?.displayName || payload.user?.globalName || payload.user?.username || `User ${loadedUserId}`;
    els.title.textContent = name;
    els.meta.textContent = `ID ${loadedUserId} • ${payload.member?.inGuild ? 'Currently in guild' : 'Not currently in guild / left guild'}${payload.found ? '' : ' • No saved data yet'}`;
    els.level.value = data.level ?? 1;
    els.totalXp.value = data.totalXp ?? 0;
    els.messages.value = data.messages ?? 0;
    els.reactions.value = data.reactions ?? 0;
    els.punishTier.value = data.punishTier ?? 0;
    els.activePunishTier.value = data.activePunishment?.tier ?? 0;
    els.punishEndsAt.value = toDatetimeLocal(data.activePunishment?.endsAt);
    els.expLocked.checked = data.expLocked === true;
    els.expLockReason.value = data.expLockReason || '';
    if (els.ticketBlacklisted) els.ticketBlacklisted.checked = data.ticketBlacklisted === true;
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
      setStatus(payload.found ? 'User data loaded.' : 'No saved data found. Saving will create this user record.', payload.found ? 'ok' : '');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function collectPatch() {
    const activeTier = Math.max(0, Math.min(5, Math.floor(Number(els.activePunishTier.value) || 0)));
    return {
      xpMode: getXpMode(),
      level: Math.max(1, Math.floor(Number(els.level.value) || 1)),
      totalXp: Math.max(0, Number(els.totalXp.value) || 0),
      messages: Math.max(0, Math.floor(Number(els.messages.value) || 0)),
      reactions: Math.max(0, Math.floor(Number(els.reactions.value) || 0)),
      punishTier: Math.max(0, Math.min(5, Math.floor(Number(els.punishTier.value) || 0))),
      activePunishment: {
        tier: activeTier,
        endsAt: activeTier > 0 ? fromDatetimeLocal(els.punishEndsAt.value) : null,
      },
      expLocked: els.expLocked.checked,
      expLockReason: String(els.expLockReason.value || '').trim(),
      ticketBlacklisted: els.ticketBlacklisted?.checked === true,
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
    els.editor.hidden = true;
    setStatus('Enter a user ID to load stored level, punishment, and ticket blacklist data.');
  }

  els.searchButton?.addEventListener('click', () => loadUser());
  els.reloadButton?.addEventListener('click', () => loadUser(loadedUserId || cleanUserId()));
  els.saveButton?.addEventListener('click', saveUser);
  els.searchId?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loadUser();
  });
  els.guildSelect?.addEventListener('change', clearLoadedUser);

  document.querySelectorAll('input[name="userDataXpMode"]').forEach((field) => {
    field.addEventListener('change', () => {
      const isLevel = getXpMode() === 'level';
      els.level.classList.toggle('emphasis-input', isLevel);
      els.totalXp.classList.toggle('emphasis-input', !isLevel);
    });
  });
})();
