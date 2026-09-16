// session: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { elements, state, toastTimer } from './state.js';
import { loadOwner, stopConsolePolling, stopOwnerMetricPolling } from './owner.js';
import { updateTemplateDeepLink } from './templates.js';
import { loadGuild, refreshDirty } from './workspace.js';
import { loadProfile } from './card-studio.js';
import { workspaceStatus } from './navigation.js';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

export function avatarUrl(user) {
    if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

import { api } from './http.js';
export { api } from './http.js';

export function showToast(message, kind = '', link = '') {
    window.clearTimeout(toastTimer.value);
    elements.toast.replaceChildren(document.createTextNode(message));
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = ' Open message';
      elements.toast.append(anchor);
    }
    elements.toast.className = `toast${kind ? ` ${kind}` : ''}`;
    elements.toast.hidden = false;
    toastTimer.value = window.setTimeout(() => { elements.toast.hidden = true; }, 3800);
  }

export function renderSession() {
    const user = state.me?.user;
    const profileRoute = location.pathname.startsWith('/profile');
    const returnTo = `${location.pathname}${location.search}`;
    elements.loginButton.href = `/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
    elements.loginPanel.hidden = Boolean(user);
    elements.appShell.hidden = !user || profileRoute;
    elements.profileShell.hidden = !user || !profileRoute;
    document.body.classList.toggle('is-authenticated', Boolean(user));
    elements.logoutButton.hidden = !user;
    elements.accountWrap.hidden = !user;
    elements.ownerNav.hidden = !state.me?.owner;
    if (!user) return;

    elements.sessionLabel.textContent = user.globalName || user.username;
    elements.userAvatar.src = avatarUrl(user);
    elements.userAvatar.alt = `${user.globalName || user.username} avatar`;
    elements.profileAvatar.src = avatarUrl(user).replace('size=64', 'size=256');
    elements.profileAvatar.alt = `${user.globalName || user.username} avatar`;
    elements.profileName.textContent = user.globalName || user.username;
    elements.guildSelect.replaceChildren();
    if (!state.guilds.length) {
      elements.guildSelect.append(new Option('No editable servers', ''));
      elements.guildSelect.disabled = true;
      elements.serverMeta.textContent = 'Administrator access is required to configure a server.';
      workspaceStatus('No editable servers. You need Discord Administrator permission in a server where CoinSprite is installed. Your profile and inventory are still available.', 'empty');
      return;
    }
    for (const guild of state.guilds) elements.guildSelect.append(new Option(guild.name, guild.id));
    elements.guildSelect.disabled = false;
  }

export function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

export function setView(view) {
    if (!['leveling','member-messages','message-templates','reaction-roles','games','owner'].includes(view)) return;
    if (view === 'owner' && !state.me?.owner) return;
    if (view === 'leveling' && state.config?.features?.leveling !== true) {
      showToast('Leveling is locked for this server. The bot owner can unlock it from Fleet control.', 'error');
      return;
    }
    state.currentView = view;
    document.body.classList.remove('mobile-nav-open');
    elements.mobileNavToggle?.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if(active) { button.setAttribute('aria-current','page'); document.getElementById('currentSection').textContent = button.querySelector('strong').textContent; }
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    const params = new URLSearchParams(location.search);
    params.set('view',view);
    if(state.guildId) params.set('guild',state.guildId);
    if(view !== 'message-templates') { params.delete('template'); params.delete('folder'); }
    history.replaceState(null,'',`/admin?${params}`);
    if (view === 'owner') { workspaceStatus(); loadOwner(); }
    else {
      if (!state.config) workspaceStatus('Server settings are unavailable. Choose an accessible server or try loading again.',state.guilds.length ? 'error' : 'empty',Boolean(state.guilds.length));
      stopConsolePolling();
      stopOwnerMetricPolling();
      if (view === 'message-templates') updateTemplateDeepLink();
    }
    refreshDirty();
  }

export function confirmAction({ title, copy, input = false, inputLabel = 'Reason', inputValue = '', confirmLabel = 'Confirm' }) {
    elements.dialogTitle.textContent = title;
    elements.dialogCopy.textContent = copy;
    elements.dialogInputWrap.hidden = !input;
    elements.dialogInputWrap.firstChild.nodeValue = inputLabel;
    elements.dialogInput.value = inputValue;
    elements.dialogConfirm.textContent = confirmLabel;
    elements.dialog.returnValue = '';
    elements.dialog.showModal();
    if (input) elements.dialogInput.focus();
    return new Promise((resolve) => {
      const onClose = () => {
        elements.dialog.removeEventListener('close', onClose);
        const confirmed = elements.dialog.returnValue === 'confirm';
        resolve(confirmed ? (input ? elements.dialogInput.value.trim() : true) : false);
      };
      elements.dialog.addEventListener('close', onClose);
    });
  }

export async function loadSession() {
    document.getElementById('sessionRetry').hidden = true;
    elements.loginStatus.textContent = 'Checking your session…';
    const desired = new URLSearchParams(location.search);
    try {
      const payload = await api('/api/me');
      state.me = payload;
      state.csrfToken = payload.csrfToken || '';
      state.guilds = payload.guilds || [];
      renderSession();
      if (location.pathname.startsWith('/profile')) await loadProfile();
      else if (state.guilds.length) {
        const deepLink = desired;
        const requestedGuild = deepLink.get('guild');
        const guildId = state.guilds.some((guild) => guild.id === requestedGuild) ? requestedGuild : state.guilds[0].id;
        await loadGuild(guildId);
        setView(deepLink.get('view') || (state.config?.features?.leveling ? 'leveling' : 'member-messages'));
      }
    } catch (error) {
      state.me = null;
      state.guilds = [];
      renderSession();
      elements.loginStatus.textContent = error.status === 401 ? 'Sign in to open your dashboard.' : error.message;
      document.getElementById('sessionRetry').hidden = error.status === 401;
      document.getElementById('connectionState').textContent = error.status === 401 ? 'Sign in to connect' : 'Connection interrupted';
    }
  }
