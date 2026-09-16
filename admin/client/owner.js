// owner: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { api, confirmAction, escapeHtml, showToast } from './session.js';
import { elements, state } from './state.js';

export function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

export function formatUptime(ms) {
    const totalMinutes = Math.floor((Number(ms) || 0) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor(totalMinutes % 1440 / 60);
    const minutes = totalMinutes % 60;
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

export function guildIcon(guild) {
    return guild.iconURL
      ? `<img src="${escapeHtml(guild.iconURL)}" alt="">`
      : `<span class="guild-fallback">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
  }

export function renderOwnerOverview(payload) {
    const metrics = [
      ['ping', 'Bot ping', `${formatNumber(payload.bot.pingMs)} ms`, 'Discord gateway', null, null],
      ['uptime', 'Uptime', formatUptime(payload.bot.uptimeMs), payload.bot.tag, null, null],
      ['communities', 'Communities', formatNumber(payload.bot.guildCount), `${formatNumber(payload.bot.totalUsers)} members`, null, null],
      ['heap', 'Heap', payload.bot.memory.heapUsedLabel, 'Live process usage', payload.bot.memory.usageRatio, payload.bot.memory.heapLimitLabel],
      ['storage', 'Storage', payload.storage.label, 'Live data and logs', payload.storage.usageRatio, payload.storage.maxLabel],
    ];
    const rows = (payload.guilds || []).map((guild) => {
      const featureCount = Number(guild.features?.leveling === true);
      return `<tr>
      <td><div class="guild-cell">${guildIcon(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>${guild.id}</small></span></div></td>
      <td>${formatNumber(guild.totalUsers)}</td>
      <td><span class="status-pill ${guild.enabled ? '' : 'off'}">${guild.enabled ? 'Online' : 'Disabled'}</span></td>
      <td><details class="feature-dropdown"><summary>${featureCount} feature${featureCount === 1 ? '' : 's'}</summary><div>
        <label><input type="checkbox" data-owner-feature="leveling" data-guild-id="${guild.id}" ${guild.features?.leveling ? 'checked' : ''}><span><strong>Leveling</strong><small>${guild.features?.leveling ? 'Unlocked' : 'Locked'}</small></span></label>
      </div></details></td>
      <td><div class="row-actions"><button class="text-button" type="button" data-owner-load="${guild.id}">Open</button><button class="text-button" type="button" data-owner-toggle="${guild.id}" data-enabled="${guild.enabled}">${guild.enabled ? 'Disable' : 'Enable'}</button></div></td>
    </tr>`;
    }).join('');
    elements.ownerOverview.innerHTML = `
      <section class="metric-grid">${metrics.map(([key, label, value, detail, ratio, maxLabel]) => {
        const colorStyle = ratio > 0.85 ? 'color: #ef4444;' : '';
        const maxInfo = maxLabel ? `<br><small style="opacity: 0.7;">Max: ${maxLabel} (${(ratio * 100).toFixed(1)}%)</small>` : '';
        return `<article class="metric-card"><small>${label}</small><strong data-owner-metric="${key}" style="${colorStyle}">${escapeHtml(value)}</strong><span data-owner-metric-detail="${key}">${escapeHtml(detail)}${maxInfo}</span></article>`;
      }).join('')}</section>
      <section class="fleet-panel"><header class="fleet-head"><h2>Community fleet</h2><span>${payload.guilds.length} connected</span></header><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>Community</th><th>Members</th><th>Status</th><th>Feature access</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No communities available.</td></tr>'}</tbody></table></div></section>`;
  }

export async function pollOwnerMetrics() {
    if (state.currentView !== 'owner') return;
    const payload = await api('/api/owner/metrics');

    const updateMetric = (key, data, detailLabel) => {
      const el = elements.ownerOverview.querySelector(`[data-owner-metric="${key}"]`);
      if (el) {
        el.textContent = data.label;
        el.style.color = data.usageRatio > 0.85 ? '#ef4444' : '';
      }
      const detailEl = elements.ownerOverview.querySelector(`[data-owner-metric-detail="${key}"]`);
      if (detailEl && data.maxLabel) {
        detailEl.innerHTML = `${detailLabel}<br><small style="opacity: 0.7;">Max: ${data.maxLabel} (${(data.usageRatio * 100).toFixed(1)}%)</small>`;
      }
    };
    if (payload.heap) updateMetric('heap', payload.heap, 'Live process usage');
    if (payload.storage) updateMetric('storage', payload.storage, 'Live data and logs');
  }

export function startOwnerMetricPolling() {
    window.clearInterval(state.metricsTimer);
    sample('metrics', pollOwnerMetrics);
    state.metricsTimer = window.setInterval(() => sample('metrics', pollOwnerMetrics), 2000);
  }

export function stopOwnerMetricPolling() {
    window.clearInterval(state.metricsTimer);
    state.metricsTimer = null;
  }

export async function loadOwner() {
    if (!state.me?.owner) return;
    elements.ownerOverview.innerHTML = '<section class="metric-card"><small>OWNER PANEL</small><strong>Loading…</strong></section>';
    try {
      const overview = await api('/api/owner/overview');
      if (state.currentView !== 'owner') return;
      renderOwnerOverview(overview);
      await pollConsole(true);
      if (state.currentView !== 'owner') return;
      startConsolePolling();
      startOwnerMetricPolling();
    } catch (error) {
      elements.ownerOverview.innerHTML = `<section class="metric-card"><small>ERROR</small><strong>Unavailable</strong><span>${escapeHtml(error.message)}</span></section>`;
    }
  }

export function renderConsole() {
    if (!state.consoleEntries.length) {
      elements.consoleOutput.innerHTML = '<p class="console-empty">Waiting for bot activity…</p>';
      return;
    }
    elements.consoleOutput.innerHTML = state.consoleEntries.map((entry) => `<div class="console-line ${escapeHtml(entry.level)}"><span class="console-time">${escapeHtml(entry.time)}</span><span class="console-source">${escapeHtml(entry.source)}</span><span class="console-message">${escapeHtml(entry.message)}</span></div>`).join('');
    elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
  }

export function addConsoleEntries(entries) {
    for (const entry of entries || []) {
      if (state.consoleEntries.some((existing) => existing.id === entry.id)) continue;
      state.consoleEntries.push(entry);
      state.consoleAfter = Math.max(state.consoleAfter, Number(entry.id) || 0);
    }
    if (state.consoleEntries.length > 500) state.consoleEntries.splice(0, state.consoleEntries.length - 500);
    renderConsole();
  }

export async function pollConsole(reset = false) {
    if (state.consolePaused || state.currentView !== 'owner') return;
    if (reset) {
      state.consoleEntries = [];
      state.consoleAfter = 0;
    }
    const payload = await api(`/api/owner/console?after=${state.consoleAfter}&limit=${reset ? 250 : 100}`);
    addConsoleEntries(payload.entries || payload.items || payload);
  }

export function startConsolePolling() {
    window.clearInterval(state.consoleTimer);
    state.consoleTimer = window.setInterval(() => sample('console', pollConsole), 2200);
  }

export function stopConsolePolling() {
    window.clearInterval(state.consoleTimer);
    state.consoleTimer = null;
  }

const pendingSamples = new Set();
const failedSamples = new Set();
async function sample(kind, read) {
  if (pendingSamples.has(kind) || document.hidden || state.currentView !== 'owner') return;
  pendingSamples.add(kind);
  try { await read(); failedSamples.delete(kind); }
  catch { failedSamples.add(kind); }
  finally {
    pendingSamples.delete(kind);
    document.getElementById('ownerLiveStatus').textContent = failedSamples.size
      ? `Live ${[...failedSamples].join(' and ')} updates interrupted. Retrying automatically; displayed values may be stale.`
      : 'Live updates connected. Metrics refresh every 2 seconds.';
  }
}

export async function handleOwnerToggle(button) {
    const guildId = button.dataset.ownerToggle;
    const enabled = button.dataset.enabled === 'true';
    let reason = '';
    if (enabled) {
      reason = await confirmAction({ title: 'Disable this community?', copy: 'CoinSprite commands and features will stop immediately. The guild owner will be notified.', input: true, confirmLabel: 'Disable' });
      if (!reason) return;
    } else {
      const confirmed = await confirmAction({ title: 'Enable this community?', copy: 'CoinSprite will resume its configured features for this server.', confirmLabel: 'Enable' });
      if (!confirmed) return;
    }
    await api(`/api/owner/guilds/${guildId}/${enabled ? 'disable' : 'enable'}`, {
      method: 'POST', body: JSON.stringify(enabled ? { reason } : {}),
    });
    showToast(`Community ${enabled ? 'disabled' : 'enabled'}.`);
    await loadOwner();
  }
