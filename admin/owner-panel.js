(() => {
  if (window.__coinSpriteOwnerPanel) return;
  window.__coinSpriteOwnerPanel = true;

  const OTHER_VALUE = '__owner_other_guild__';
  let ownerRoot = null;
  let ownerData = null;
  let installed = false;
  let messageAssetsStarted = false;

  function ensureStylesheet(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }

  function loadScript(src) {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', resolve, { once: true });
      });
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', resolve, { once: true });
      document.body.append(script);
    });
  }

  function loadMessageAssetsWhenReady() {
    if (messageAssetsStarted) return;
    ensureStylesheet('/admin/message-components.css');
    ensureStylesheet('/admin/message-component-actions.css');
    const timer = setInterval(() => {
      if (!document.querySelector('#messageTemplatesRoot')) return;
      clearInterval(timer);
      messageAssetsStarted = true;
      (async () => {
        await loadScript('/admin/message-components.js');
        await loadScript('/admin/message-component-actions.js');
        await loadScript('/admin/emoji-picker-upgrade.js');
        await loadScript('/admin/message-action-select-fix.js');
      })();
    }, 100);
  }

  loadMessageAssetsWhenReady();

  async function ownerApi(path, options = {}) {
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

  function fmtNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function fmtUptime(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return `${days}d ${hours}h ${minutes}m`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function guildIcon(guild) {
    if (guild.iconURL) return `<img src="${escapeHtml(guild.iconURL)}" alt="">`;
    const initials = String(guild.name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    return `<span>${escapeHtml(initials || '?')}</span>`;
  }

  function ensurePanel() {
    if (ownerRoot) return ownerRoot;
    ownerRoot = document.createElement('main');
    ownerRoot.id = 'ownerPanel';
    ownerRoot.className = 'owner-panel-page';
    ownerRoot.hidden = true;
    document.body.append(ownerRoot);
    ownerRoot.addEventListener('click', handleOwnerClick);
    return ownerRoot;
  }

  function setOwnerStatus(message, kind = '') {
    const node = document.querySelector('#ownerPanelStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `owner-status${kind ? ` ${kind}` : ''}`;
  }

  function renderOwnerPanel(payload) {
    ownerData = payload;
    const guildRows = (payload.guilds || []).map((guild) => {
      const disabled = guild.disabled;
      const usage = guild.usage || {};
      return `<tr class="${disabled ? 'is-disabled' : ''}">
        <td><div class="owner-guild-cell"><span class="owner-guild-icon">${guildIcon(guild)}</span><div><strong>${escapeHtml(guild.name)}</strong><small>${escapeHtml(guild.id)}</small></div></div></td>
        <td>${fmtNumber(guild.totalUsers)}</td>
        <td>${escapeHtml(guild.ownerId || 'Unknown')}</td>
        <td><span class="owner-pill ${guild.enabled ? 'ok' : 'danger'}">${guild.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td><span>${fmtNumber(usage.levelingUsers)} users</span><small>${fmtNumber(usage.messagesTracked)} messages, ${fmtNumber(usage.messageTemplates)} templates</small></td>
        <td><span>${escapeHtml(guild.storage?.label || '0 B')}</span><small>${fmtNumber(guild.channels)} channels, ${fmtNumber(guild.roles)} roles</small></td>
        <td>${disabled ? `<small>${escapeHtml(disabled.reason || 'No reason')}</small>` : '<small>-</small>'}</td>
        <td><div class="owner-row-actions"><button type="button" data-owner-action="edit-guild" data-guild-id="${guild.id}">Edit</button>${guild.enabled ? `<button type="button" data-owner-action="disable-row" data-guild-id="${guild.id}">Disable</button>` : `<button type="button" data-owner-action="enable-row" data-guild-id="${guild.id}">Enable</button>`}</div></td>
      </tr>`;
    }).join('');

    ownerRoot.innerHTML = `<section class="owner-head">
      <div><h2>Owner Panel</h2><p>Bot-wide status, guild inventory, and owner-only guild controls.</p></div>
      <div class="owner-head-actions"><button class="button subtle" type="button" data-owner-action="refresh">Refresh</button><button class="button" type="button" data-owner-action="close">Back to admin</button></div>
    </section>
    <section class="owner-stat-grid">
      <div class="owner-stat"><span>Bot ping</span><strong>${fmtNumber(payload.bot?.pingMs)} ms</strong></div>
      <div class="owner-stat"><span>Latency</span><strong>${fmtNumber(payload.bot?.latencyMs)} ms</strong></div>
      <div class="owner-stat"><span>Bot FPS</span><strong>${payload.bot?.fps ? fmtNumber(payload.bot.fps) : 'N/A'}</strong></div>
      <div class="owner-stat"><span>Uptime</span><strong>${fmtUptime(payload.bot?.uptimeMs)}</strong></div>
      <div class="owner-stat"><span>Guilds</span><strong>${fmtNumber(payload.bot?.guildCount)}</strong></div>
      <div class="owner-stat"><span>Total users</span><strong>${fmtNumber(payload.bot?.totalUsers)}</strong></div>
      <div class="owner-stat"><span>Heap</span><strong>${escapeHtml(payload.bot?.memory?.heapUsedLabel || '0 B')}</strong></div>
      <div class="owner-stat"><span>Data storage</span><strong>${escapeHtml(payload.storage?.label || '0 B')}</strong></div>
    </section>
    <section class="owner-control-grid">
      <form class="owner-control-card" id="ownerDisableForm">
        <div><h3>Disable guild</h3><p>The bot stops responding in this guild. The guild owner is notified by DM, with channel fallback.</p></div>
        <label>Guild ID <input id="ownerDisableGuildId" type="text" inputmode="numeric" pattern="\\d{16,20}" maxlength="20" placeholder="123456789012345678"></label>
        <label>Reason <textarea id="ownerDisableReason" rows="4" maxlength="500" placeholder="Reason shown to the guild owner"></textarea></label>
        <div class="owner-form-actions"><button class="button danger" type="submit">Disable guild</button><button class="button subtle" type="button" data-owner-action="enable-form">Enable guild</button></div>
      </form>
      <div class="owner-control-card">
        <div><h3>Load other guild</h3><p>Open settings for any guild the bot is in without adding it to the server selector.</p></div>
        <label>Guild ID <input id="ownerLoadGuildId" type="text" inputmode="numeric" pattern="\\d{16,20}" maxlength="20" placeholder="123456789012345678"></label>
        <div class="owner-form-actions"><button class="button primary" type="button" data-owner-action="load-other-input">Load settings</button><button class="button subtle" type="button" data-owner-action="open-data-input">Load data tab</button></div>
      </div>
    </section>
    <section class="owner-table-card">
      <div class="owner-table-head"><div><h3>Guilds</h3><p>All guilds currently visible to the bot.</p></div><span id="ownerPanelStatus" class="owner-status">${fmtNumber(payload.guilds?.length)} guilds loaded</span></div>
      <div class="owner-table-wrap"><table class="owner-guild-table"><thead><tr><th>Guild</th><th>Users</th><th>Owner ID</th><th>Status</th><th>Usage</th><th>Storage</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${guildRows || '<tr><td colspan="8">No guilds found.</td></tr>'}</tbody></table></div>
    </section>`;

    ownerRoot.querySelector('#ownerDisableForm')?.addEventListener('submit', handleDisableSubmit);
  }

  async function loadOwnerPanel() {
    ensurePanel();
    ownerRoot.hidden = false;
    document.querySelector('#appShell')?.setAttribute('hidden', '');
    document.querySelector('#loginPanel')?.setAttribute('hidden', '');
    ownerRoot.innerHTML = '<section class="owner-loading">Loading owner panel...</section>';
    try {
      renderOwnerPanel(await ownerApi('/api/owner/overview'));
    } catch (error) {
      ownerRoot.innerHTML = `<section class="owner-loading error">${escapeHtml(error.message)}</section>`;
    }
  }

  function closeOwnerPanel() {
    ensurePanel().hidden = true;
    if (state?.me?.user) document.querySelector('#appShell')?.removeAttribute('hidden');
  }

  function knownGuild(id) {
    return ownerData?.guilds?.find((guild) => guild.id === id) || null;
  }

  async function loadGuildAsOwner(guildId, tabName = null) {
    const id = String(guildId || '').trim();
    if (!/^\d{16,20}$/.test(id)) throw new Error('Enter a valid guild ID.');
    closeOwnerPanel();
    await loadGuild(id);
    const guild = knownGuild(id);
    if (guild) {
      elements.guildTitle.textContent = guild.name;
      elements.serverMeta.textContent = `Guild ID ${guild.id} - owner ${guild.ownerId || 'unknown'}`;
    }
    if (tabName && typeof setActiveTab === 'function') setActiveTab(tabName);
  }

  function showOtherGuildDialog(tabName = null) {
    document.querySelector('.owner-dialog-backdrop')?.remove();
    const box = document.createElement('div');
    box.className = 'owner-dialog-backdrop';
    box.innerHTML = `<section class="owner-dialog" role="dialog" aria-modal="true"><h3>Load other guild</h3><p>Enter a guild ID. It will open in the editor but will not be added to the server list.</p><label>Guild ID <input id="ownerOtherGuildInput" type="text" inputmode="numeric" maxlength="20" autofocus></label><div class="owner-form-actions"><button class="button subtle" type="button" data-owner-dialog="cancel">Cancel</button><button class="button primary" type="button" data-owner-dialog="load">Load</button></div><div class="owner-dialog-status"></div></section>`;
    const input = box.querySelector('#ownerOtherGuildInput');
    const status = box.querySelector('.owner-dialog-status');
    const submit = async () => {
      try {
        status.textContent = 'Loading...';
        await loadGuildAsOwner(input.value, tabName);
        box.remove();
      } catch (error) {
        status.textContent = error.message;
      }
    };
    box.addEventListener('click', (event) => {
      if (event.target === box || event.target.closest('[data-owner-dialog="cancel"]')) box.remove();
      if (event.target.closest('[data-owner-dialog="load"]')) submit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
      if (event.key === 'Escape') box.remove();
    });
    document.body.append(box);
    input.focus({ preventScroll: true });
  }

  async function handleDisableSubmit(event) {
    event.preventDefault();
    const guildId = ownerRoot.querySelector('#ownerDisableGuildId')?.value.trim();
    const reason = ownerRoot.querySelector('#ownerDisableReason')?.value.trim();
    try {
      setOwnerStatus('Disabling guild...', 'pending');
      const payload = await ownerApi(`/api/owner/guilds/${guildId}/disable`, { method: 'POST', body: JSON.stringify({ reason }) });
      setOwnerStatus(`Guild disabled. Notification: ${payload.notification}.`, 'ok');
      renderOwnerPanel(await ownerApi('/api/owner/overview'));
    } catch (error) {
      setOwnerStatus(error.message, 'error');
    }
  }

  async function enableGuild(guildId) {
    setOwnerStatus('Enabling guild...', 'pending');
    await ownerApi(`/api/owner/guilds/${guildId}/enable`, { method: 'POST' });
    renderOwnerPanel(await ownerApi('/api/owner/overview'));
  }

  async function handleOwnerClick(event) {
    const action = event.target.closest('[data-owner-action]')?.dataset.ownerAction;
    if (!action) return;
    event.preventDefault();
    try {
      if (action === 'close') closeOwnerPanel();
      if (action === 'refresh') renderOwnerPanel(await ownerApi('/api/owner/overview'));
      if (action === 'edit-guild') await loadGuildAsOwner(event.target.closest('[data-guild-id]').dataset.guildId);
      if (action === 'disable-row') {
        const guildId = event.target.closest('[data-guild-id]').dataset.guildId;
        ownerRoot.querySelector('#ownerDisableGuildId').value = guildId;
        ownerRoot.querySelector('#ownerDisableReason').focus();
        setOwnerStatus('Add a reason, then press Disable guild.', 'pending');
      }
      if (action === 'enable-row') await enableGuild(event.target.closest('[data-guild-id]').dataset.guildId);
      if (action === 'enable-form') {
        const guildId = ownerRoot.querySelector('#ownerDisableGuildId')?.value.trim();
        if (!/^\d{16,20}$/.test(guildId)) throw new Error('Enter a valid guild ID to enable.');
        await enableGuild(guildId);
      }
      if (action === 'load-other-input') await loadGuildAsOwner(ownerRoot.querySelector('#ownerLoadGuildId')?.value);
      if (action === 'open-data-input') await loadGuildAsOwner(ownerRoot.querySelector('#ownerLoadGuildId')?.value, 'data');
    } catch (error) {
      setOwnerStatus(error.message, 'error');
    }
  }

  function installOwnerButton() {
    if (document.querySelector('#ownerPanelButton')) return;
    const title = document.querySelector('.brand-copy h1');
    if (!title) return;
    const button = document.createElement('button');
    button.id = 'ownerPanelButton';
    button.type = 'button';
    button.className = 'owner-panel-button';
    button.textContent = 'Owner Panel';
    button.addEventListener('click', loadOwnerPanel);
    title.append(button);
  }

  function installOtherOption() {
    if (!state?.me?.owner || !elements?.guildSelect) return;
    if (![...elements.guildSelect.options].some((option) => option.value === OTHER_VALUE)) {
      elements.guildSelect.append(new Option('Other [Owner only]', OTHER_VALUE));
    }
  }

  function installOtherSelectorTrap() {
    if (elements?.guildSelect?.dataset.ownerTrap) return;
    elements.guildSelect.dataset.ownerTrap = 'true';
    elements.guildSelect.addEventListener('change', (event) => {
      if (elements.guildSelect.value !== OTHER_VALUE) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      elements.guildSelect.value = state.guildId || '';
      showOtherGuildDialog();
    }, true);
  }

  function install() {
    if (!state?.me?.owner) return;
    installed = true;
    installOwnerButton();
    installOtherOption();
    installOtherSelectorTrap();
  }

  const originalRenderSession = typeof renderSession === 'function' ? renderSession : null;
  if (originalRenderSession) {
    renderSession = function ownerRenderSessionPatch() {
      originalRenderSession();
      install();
    };
  }

  const timer = setInterval(() => {
    install();
    if (installed) clearInterval(timer);
  }, 300);
})();
