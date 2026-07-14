(() => {
  if (window.__coinSpriteOwnerPanel) return;
  window.__coinSpriteOwnerPanel = true;

  const OTHER_VALUE = '__owner_other_guild__';
  let ownerRoot = null;
  let ownerData = null;
  let ownerView = 'overview';
  let ownerReports = [];
  let ownerReportsLoaded = false;
  let ownerConsoleEntries = [];
  let ownerConsoleAfter = 0;
  let ownerConsoleTimer = null;
  let ownerConsolePaused = false;
  let ownerMetricsTimer = null;
  let ownerMetricsInFlight = false;
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

  function fmtCompactNumber(value) {
    const number = Number(value) || 0;
    if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 1 : 2)}K`;
    return fmtNumber(number);
  }

  function fmtUsd(value) {
    const number = Number(value) || 0;
    if (number <= 0) return '$0.0000';
    if (number < 0.01) return `$${number.toFixed(4)}`;
    if (number < 1) return `$${number.toFixed(3)}`;
    return `$${number.toFixed(2)}`;
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

  function tokenHistoryText(history) {
    const rows = (Array.isArray(history) ? history : [])
      .filter((entry) => Number(entry?.totalTokens) || Number(entry?.requests))
      .slice(0, 3)
      .map((entry) => `${entry.month}: ${fmtCompactNumber(entry.totalTokens)} tok ${fmtUsd(entry.estimatedCostUsd)}`);
    return rows.join(' | ') || '-';
  }

  function recentTokenLogText(recent) {
    const entry = Array.isArray(recent) ? recent[0] : null;
    if (!entry) return '-';
    const when = new Date(entry.at);
    const whenText = Number.isNaN(when.getTime())
      ? String(entry.month || '')
      : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `${whenText} ${fmtCompactNumber(entry.totalTokens)} tok ${fmtUsd(entry.estimatedCostUsd)} ${entry.model || ''}`.trim();
  }

  function guildIcon(guild) {
    if (guild.iconURL) return `<img src="${escapeHtml(guild.iconURL)}" alt="">`;
    const initials = String(guild.name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    return `<span>${escapeHtml(initials || '?')}</span>`;
  }

  function fmtFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function resourceMetricView(kind, metric = {}) {
    const ratio = Math.min(1, Math.max(0, Number(metric.usageRatio) || 0));
    const percent = ratio * 100;
    const peakRatio = Math.min(1, Math.max(0, Number(metric.peakUsageRatio) || 0));
    const hue = Math.round((1 - ratio) * 120);
    if (kind === 'cpu') {
      const maxVcpu = Math.max(1, Number(metric.maxVcpu) || 1);
      return {
        ratio,
        percent,
        color: `hsl(${hue} 78% 48%)`,
        value: `${percent.toFixed(1)}%`,
        detail: `${(Number(metric.usedVcpu) || 0).toFixed(2)} vCPU in use`,
        peak: `Peak ${(peakRatio * 100).toFixed(1)}%`,
        max: `Max ${fmtNumber(maxVcpu)} vCPU`,
      };
    }
    return {
      ratio,
      percent,
      color: `hsl(${hue} 78% 48%)`,
      value: fmtFileSize(metric.usedBytes),
      detail: `${percent.toFixed(1)}% of heap limit`,
      peak: `Peak ${fmtFileSize(metric.peakBytes)}`,
      max: `Max ${fmtFileSize(metric.maxBytes)}`,
    };
  }

  function resourceMetricHtml(kind, label, metric) {
    const view = resourceMetricView(kind, metric);
    return `<div class="owner-stat owner-resource-stat" data-owner-resource="${kind}" style="--owner-meter-color:${view.color}">
      <span>${label}</span>
      <div class="owner-resource-value"><strong data-owner-resource-value>${escapeHtml(view.value)}</strong><small data-owner-resource-detail>${escapeHtml(view.detail)}</small></div>
      <div class="owner-resource-track" data-owner-resource-track role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.percent.toFixed(1)}"><span data-owner-resource-fill style="width:${view.percent.toFixed(2)}%"></span></div>
      <div class="owner-resource-footer"><small data-owner-resource-peak>${escapeHtml(view.peak)}</small><small data-owner-resource-max>${escapeHtml(view.max)}</small></div>
    </div>`;
  }

  function updateResourceMetricDom(kind, metric) {
    const card = ownerRoot?.querySelector(`[data-owner-resource="${kind}"]`);
    if (!card) return;
    const view = resourceMetricView(kind, metric);
    card.style.setProperty('--owner-meter-color', view.color);
    const value = card.querySelector('[data-owner-resource-value]');
    const detail = card.querySelector('[data-owner-resource-detail]');
    const fill = card.querySelector('[data-owner-resource-fill]');
    const track = card.querySelector('[data-owner-resource-track]');
    const peak = card.querySelector('[data-owner-resource-peak]');
    const max = card.querySelector('[data-owner-resource-max]');
    if (value) value.textContent = view.value;
    if (detail) detail.textContent = view.detail;
    if (fill) fill.style.width = `${view.percent.toFixed(2)}%`;
    if (track) track.setAttribute('aria-valuenow', view.percent.toFixed(1));
    if (peak) peak.textContent = view.peak;
    if (max) max.textContent = view.max;
  }

  function updateOwnerMetricsDom(metrics) {
    updateResourceMetricDom('cpu', metrics?.cpu || {});
    updateResourceMetricDom('heap', metrics?.heap || {});
  }

  function reportDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
  }

  function reportAttachmentHtml(report) {
    const attachment = report?.attachment;
    if (!attachment?.data) return '<span class="owner-muted">No attachment</span>';
    const href = `data:${escapeHtml(attachment.type || 'application/octet-stream')};base64,${escapeHtml(attachment.data)}`;
    return `<a class="owner-report-attachment" download="${escapeHtml(attachment.name || 'attachment')}" href="${href}">${escapeHtml(attachment.name || 'attachment')} (${fmtFileSize(attachment.size)})</a>`;
  }

  function safeConsoleLevel(level) {
    return ['command', 'debug', 'error', 'info', 'log', 'ok', 'system', 'warn'].includes(level) ? level : 'log';
  }

  function appendOwnerConsoleEntries(entries) {
    let changed = false;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = Number(entry?.id) || 0;
      if (!id || ownerConsoleEntries.some((item) => item.id === id)) continue;
      ownerConsoleEntries.push({
        id,
        at: entry.at || '',
        time: entry.time || '[--:--:--]',
        level: safeConsoleLevel(String(entry.level || 'log')),
        source: String(entry.source || 'bot'),
        message: String(entry.message || ''),
      });
      ownerConsoleAfter = Math.max(ownerConsoleAfter, id);
      changed = true;
    }
    if (ownerConsoleEntries.length > 500) ownerConsoleEntries = ownerConsoleEntries.slice(-500);
    return changed;
  }

  function renderConsoleLines() {
    if (!ownerConsoleEntries.length) return '<div class="owner-console-empty">No console entries yet.</div>';
    return ownerConsoleEntries.map((entry) => `<div class="owner-console-line level-${safeConsoleLevel(entry.level)}">
      <span class="owner-console-time">${escapeHtml(entry.time)}</span>
      <span class="owner-console-source">${escapeHtml(entry.source)}</span>
      <span class="owner-console-message">${escapeHtml(entry.message)}</span>
    </div>`).join('');
  }

  function renderConsolePanel() {
    return `<section class="owner-table-card owner-console-card">
      <div class="owner-table-head">
        <div><h3>Bot console</h3><p>Live owner-only bot activity. Timestamps use <code>[hh:mm:ss]</code>.</p></div>
        <div class="owner-row-actions">
          <span class="owner-status" data-owner-console-status>${fmtNumber(ownerConsoleEntries.length)} entries</span>
          <button type="button" data-owner-action="console-refresh">Refresh</button>
          <button type="button" data-owner-action="console-pause">${ownerConsolePaused ? 'Resume' : 'Pause'}</button>
          <button type="button" data-owner-action="console-clear">Clear view</button>
        </div>
      </div>
      <div class="owner-console-output" data-owner-console-output>${renderConsoleLines()}</div>
    </section>`;
  }

  function updateConsoleDom() {
    const output = ownerRoot?.querySelector('[data-owner-console-output]');
    if (!output) return;
    const shouldStick = output.scrollTop + output.clientHeight >= output.scrollHeight - 36;
    output.innerHTML = renderConsoleLines();
    if (shouldStick) output.scrollTop = output.scrollHeight;
    const status = ownerRoot?.querySelector('[data-owner-console-status]');
    if (status) status.textContent = ownerConsolePaused ? 'Paused' : `${fmtNumber(ownerConsoleEntries.length)} entries`;
  }

  function reportStatusActions(report) {
    return ['open', 'reviewed', 'closed'].map((status) => (
      `<button type="button" data-owner-action="report-status" data-report-id="${escapeHtml(report.id)}" data-report-status="${status}" ${report.status === status ? 'disabled' : ''}>${status}</button>`
    )).join('');
  }

  function renderReportsPanel() {
    const rows = ownerReports.map((report) => `<article class="owner-report-card">
      <div class="owner-report-main">
        <div><span class="owner-pill ${report.status === 'open' ? 'warn' : report.status === 'closed' ? 'ok' : ''}">${escapeHtml(report.status)}</span><span class="owner-pill">${escapeHtml(report.severity)}</span></div>
        <h3>${escapeHtml(report.title)}</h3>
        <p>${escapeHtml(report.description)}</p>
        ${report.expected ? `<p><strong>Expected:</strong> ${escapeHtml(report.expected)}</p>` : ''}
        ${report.steps ? `<p><strong>Steps:</strong><br>${escapeHtml(report.steps).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
      <div class="owner-report-meta">
        <span><strong>Category:</strong> ${escapeHtml(report.category || 'Other')}</span>
        <span><strong>Reporter:</strong> ${escapeHtml(report.reporter?.globalName || report.reporter?.username || report.reporter?.id || 'Unknown')}</span>
        <span><strong>User ID:</strong> ${escapeHtml(report.reporter?.id || 'Unknown')}</span>
        <span><strong>Guild ID:</strong> ${escapeHtml(report.guildId || 'N/A')}</span>
        <span><strong>Contact:</strong> ${escapeHtml(report.contact || 'N/A')}</span>
        <span><strong>Created:</strong> ${escapeHtml(reportDate(report.createdAt))}</span>
        <span><strong>Page:</strong> ${escapeHtml(report.pageUrl || 'N/A')}</span>
        <span><strong>Attachment:</strong> ${reportAttachmentHtml(report)}</span>
        <div class="owner-row-actions">${reportStatusActions(report)}</div>
      </div>
    </article>`).join('');
    return `<section class="owner-table-card owner-reports-card">
      <div class="owner-table-head"><div><h3>Reports</h3><p>Bug reports submitted from the dashboard.</p></div><span class="owner-status" data-owner-status>${fmtNumber(ownerReports.length)} reports loaded</span></div>
      <div class="owner-report-list">${rows || '<div class="owner-empty">No bug reports submitted yet.</div>'}</div>
    </section>`;
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
    const node = ownerRoot?.querySelector(`.owner-view-panel:not([hidden]) [data-owner-status]`)
      || ownerRoot?.querySelector('[data-owner-status]');
    if (!node) return;
    node.textContent = message;
    node.className = `owner-status${kind ? ` ${kind}` : ''}`;
  }

  function renderOwnerPanel(payload) {
    ownerData = payload;
    const runtimeMetrics = payload.bot?.metrics || {
      cpu: {},
      heap: {
        usedBytes: payload.bot?.memory?.heapUsedBytes || 0,
        maxBytes: payload.bot?.memory?.heapUsedBytes || 1,
      },
    };
    const overviewHidden = ownerView === 'overview' ? '' : ' hidden';
    const consoleHidden = ownerView === 'console' ? '' : ' hidden';
    const reportsHidden = ownerView === 'reports' ? '' : ' hidden';
    const guildRows = (payload.guilds || []).map((guild) => {
      const disabled = guild.disabled;
      const usage = guild.usage || {};
      const aiTokens = usage.aiTokens || {};
      const currentAi = aiTokens.current || {};
      const fullBot = guild.features?.fullBot === true;
      const featureLabel = fullBot ? 'Full bot' : 'GAG2 stock only';
      const featureButton = fullBot ? 'Features enabled' : 'Enable features';
      const limitedInfo = guild.limitedInfo ? '<small>Limited info from Discord guild list</small>' : '';
      return `<tr class="${disabled ? 'is-disabled' : ''}${guild.limitedInfo ? ' is-limited' : ''}">
        <td><div class="owner-guild-cell"><span class="owner-guild-icon">${guildIcon(guild)}</span><div><strong>${escapeHtml(guild.name)}</strong><small>${escapeHtml(guild.id)}</small>${limitedInfo}</div></div></td>
        <td>${fmtNumber(guild.totalUsers)}</td>
        <td>${escapeHtml(guild.ownerId || 'Unknown')}</td>
        <td><span class="owner-pill ${guild.enabled ? 'ok' : 'danger'}">${guild.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td><span class="owner-pill ${fullBot ? 'ok' : 'warn'}">${featureLabel}</span><small>GAG2 stock is enabled by default</small></td>
        <td><div class="owner-usage-stack"><span>${fmtNumber(usage.todayMessages)} messages today</span><small>${fmtCompactNumber(currentAi.totalTokens)} AI tokens (${fmtUsd(currentAi.estimatedCostUsd)}) this month, ${fmtNumber(currentAi.requests)} checks</small><small>History: ${escapeHtml(tokenHistoryText(aiTokens.history))}</small><small>Last AI use: ${escapeHtml(recentTokenLogText(aiTokens.recent))}</small><small>${fmtNumber(usage.messagesTracked)} lifetime messages, ${fmtNumber(usage.messageTemplates)} templates</small></div></td>
        <td><span>${escapeHtml(guild.storage?.label || '0 B')}</span><small>${guild.limitedInfo ? 'Channel/role counts unavailable' : `${fmtNumber(guild.channels)} channels, ${fmtNumber(guild.roles)} roles`}</small></td>
        <td>${disabled ? `<small>${escapeHtml(disabled.reason || 'No reason')}</small>` : '<small>-</small>'}</td>
        <td><div class="owner-row-actions"><button type="button" data-owner-action="edit-guild" data-guild-id="${guild.id}">Edit</button><button type="button" data-owner-action="toggle-features" data-guild-id="${guild.id}">${featureButton}</button>${guild.enabled ? `<button type="button" data-owner-action="disable-row" data-guild-id="${guild.id}">Disable</button>` : `<button type="button" data-owner-action="enable-row" data-guild-id="${guild.id}">Enable</button>`}</div></td>
      </tr>`;
    }).join('');

    ownerRoot.innerHTML = `<section class="owner-head">
      <div><h2>Owner Panel</h2><p>Bot-wide status, guild inventory, and owner-only guild controls.</p></div>
      <div class="owner-head-actions"><nav class="owner-tabs" aria-label="Owner panel views"><button type="button" data-owner-action="owner-view" data-owner-view="overview" class="${ownerView === 'overview' ? 'active' : ''}">Overview</button><button type="button" data-owner-action="owner-view" data-owner-view="console" class="${ownerView === 'console' ? 'active' : ''}">Console</button><button type="button" data-owner-action="owner-view" data-owner-view="reports" class="${ownerView === 'reports' ? 'active' : ''}">Reports</button></nav><button class="button subtle" type="button" data-owner-action="refresh">Refresh</button><button class="button" type="button" data-owner-action="close">Back to admin</button></div>
    </section>
    <div class="owner-view-panel" data-owner-view-panel="overview"${overviewHidden}>
    <section class="owner-stat-grid">
      <div class="owner-stat"><span>Bot ping</span><strong>${fmtNumber(payload.bot?.pingMs)} ms</strong></div>
      <div class="owner-stat"><span>Latency</span><strong>${fmtNumber(payload.bot?.latencyMs)} ms</strong></div>
      <div class="owner-stat"><span>Bot FPS</span><strong>${payload.bot?.fps ? fmtNumber(payload.bot.fps) : 'N/A'}</strong></div>
      <div class="owner-stat"><span>Uptime</span><strong>${fmtUptime(payload.bot?.uptimeMs)}</strong></div>
      <div class="owner-stat"><span>Guilds</span><strong>${fmtNumber(payload.bot?.guildCount)}</strong></div>
      <div class="owner-stat"><span>Total users</span><strong>${fmtNumber(payload.bot?.totalUsers)}</strong></div>
      ${resourceMetricHtml('cpu', 'vCPU Usage', runtimeMetrics.cpu)}
      ${resourceMetricHtml('heap', 'Heap used', runtimeMetrics.heap)}
      <div class="owner-stat"><span>Data storage</span><strong>${escapeHtml(payload.storage?.label || '0 B')}</strong></div>
      <div class="owner-stat"><span>Open reports</span><strong>${fmtNumber(payload.bugReports?.open)}</strong></div>
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
      <div class="owner-table-head"><div><h3>Guilds</h3><p>All guilds currently visible to the bot.</p></div><span id="ownerPanelStatus" class="owner-status" data-owner-status>${fmtNumber(payload.guilds?.length)} guilds loaded</span></div>
      <div class="owner-table-wrap"><table class="owner-guild-table"><thead><tr><th>Guild</th><th>Users</th><th>Owner ID</th><th>Status</th><th>Features</th><th>Usage</th><th>Storage</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${guildRows || '<tr><td colspan="9">No guilds found.</td></tr>'}</tbody></table></div>
    </section>
    </div>
    <div class="owner-view-panel" data-owner-view-panel="console"${consoleHidden}>${renderConsolePanel()}</div>
    <div class="owner-view-panel" data-owner-view-panel="reports"${reportsHidden}>${renderReportsPanel()}</div>`;

    ownerRoot.querySelector('#ownerDisableForm')?.addEventListener('submit', handleDisableSubmit);
    if (ownerView === 'console') requestAnimationFrame(() => {
      const output = ownerRoot?.querySelector('[data-owner-console-output]');
      if (output) output.scrollTop = output.scrollHeight;
    });
    if (ownerView === 'overview') startOwnerMetricsPolling();
    else stopOwnerMetricsPolling();
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

  async function loadOwnerReports() {
    ensurePanel();
    setOwnerStatus('Loading reports...', 'pending');
    const payload = await ownerApi('/api/owner/reports');
    ownerReports = payload.reports || [];
    ownerReportsLoaded = true;
    renderOwnerPanel(ownerData || await ownerApi('/api/owner/overview'));
  }

  async function loadOwnerConsole(options = {}) {
    ensurePanel();
    if (options.reset) {
      ownerConsoleEntries = [];
      ownerConsoleAfter = 0;
    }
    const payload = await ownerApi(`/api/owner/console?after=${ownerConsoleAfter}&limit=${options.reset ? 300 : 100}`);
    appendOwnerConsoleEntries(payload.entries);
    if (ownerView === 'console') {
      renderOwnerPanel(ownerData || await ownerApi('/api/owner/overview'));
      startOwnerConsolePolling();
    }
  }

  async function pollOwnerConsole() {
    if (ownerView !== 'console' || ownerConsolePaused) return;
    try {
      const payload = await ownerApi(`/api/owner/console?after=${ownerConsoleAfter}&limit=100`);
      if (appendOwnerConsoleEntries(payload.entries)) updateConsoleDom();
    } catch (error) {
      const status = ownerRoot?.querySelector('[data-owner-console-status]');
      if (status) {
        status.textContent = error.message;
        status.className = 'owner-status error';
      }
    }
  }

  function startOwnerConsolePolling() {
    if (ownerConsoleTimer) return;
    ownerConsoleTimer = setInterval(pollOwnerConsole, 2000);
  }

  function stopOwnerConsolePolling() {
    if (ownerConsoleTimer) clearInterval(ownerConsoleTimer);
    ownerConsoleTimer = null;
  }

  async function pollOwnerMetrics() {
    if (ownerView !== 'overview' || ownerRoot?.hidden || ownerMetricsInFlight) return;
    ownerMetricsInFlight = true;
    try {
      const metrics = await ownerApi('/api/owner/metrics');
      if (ownerData?.bot) ownerData.bot.metrics = metrics;
      updateOwnerMetricsDom(metrics);
    } catch {
      // Keep the last good resource sample visible during a temporary dashboard error.
    } finally {
      ownerMetricsInFlight = false;
    }
  }

  function startOwnerMetricsPolling() {
    if (ownerMetricsTimer) return;
    void pollOwnerMetrics();
    ownerMetricsTimer = setInterval(pollOwnerMetrics, 2_000);
  }

  function stopOwnerMetricsPolling() {
    if (ownerMetricsTimer) clearInterval(ownerMetricsTimer);
    ownerMetricsTimer = null;
  }

  async function switchOwnerView(view) {
    ownerView = view === 'reports' ? 'reports' : view === 'console' ? 'console' : 'overview';
    if (ownerView !== 'console') stopOwnerConsolePolling();
    if (ownerView !== 'overview') stopOwnerMetricsPolling();
    if (ownerView === 'console') {
      await loadOwnerConsole({ reset: ownerConsoleEntries.length === 0 });
      return;
    }
    if (ownerView === 'reports' && !ownerReportsLoaded) {
      await loadOwnerReports();
      return;
    }
    renderOwnerPanel(ownerData || await ownerApi('/api/owner/overview'));
  }

  function closeOwnerPanel() {
    stopOwnerConsolePolling();
    stopOwnerMetricsPolling();
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

  async function toggleGuildFeatures(guildId) {
    const guild = knownGuild(guildId);
    const fullBot = guild?.features?.fullBot === true;
    setOwnerStatus(fullBot ? 'Switching guild to GAG2 stock only...' : 'Enabling full bot features...', 'pending');
    await ownerApi(`/api/owner/guilds/${guildId}/features`, {
      method: 'POST',
      body: JSON.stringify({ fullBot: !fullBot }),
    });
    renderOwnerPanel(await ownerApi('/api/owner/overview'));
  }

  async function handleOwnerClick(event) {
    const action = event.target.closest('[data-owner-action]')?.dataset.ownerAction;
    if (!action) return;
    event.preventDefault();
    try {
      if (action === 'close') closeOwnerPanel();
      if (action === 'refresh') {
        if (ownerView === 'console') {
          await loadOwnerConsole({ reset: true });
        } else {
          ownerData = await ownerApi('/api/owner/overview');
          if (ownerView === 'reports') ownerReportsLoaded = false;
          if (ownerView === 'reports') await loadOwnerReports();
          else renderOwnerPanel(ownerData);
        }
      }
      if (action === 'owner-view') await switchOwnerView(event.target.closest('[data-owner-view]')?.dataset.ownerView);
      if (action === 'console-refresh') await loadOwnerConsole({ reset: true });
      if (action === 'console-pause') {
        ownerConsolePaused = !ownerConsolePaused;
        renderOwnerPanel(ownerData || await ownerApi('/api/owner/overview'));
        if (!ownerConsolePaused) {
          startOwnerConsolePolling();
          await pollOwnerConsole();
        }
      }
      if (action === 'console-clear') {
        ownerConsoleEntries = [];
        updateConsoleDom();
      }
      if (action === 'report-status') {
        const button = event.target.closest('[data-report-id]');
        setOwnerStatus('Updating report...', 'pending');
        await ownerApi(`/api/owner/reports/${button.dataset.reportId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: button.dataset.reportStatus }),
        });
        ownerData = await ownerApi('/api/owner/overview');
        ownerReportsLoaded = false;
        await loadOwnerReports();
      }
      if (action === 'edit-guild') await loadGuildAsOwner(event.target.closest('[data-guild-id]').dataset.guildId);
      if (action === 'toggle-features') await toggleGuildFeatures(event.target.closest('[data-guild-id]').dataset.guildId);
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
