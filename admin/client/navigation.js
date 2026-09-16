import { state, elements } from './state.js';
import { loadGuild, snapshot } from './workspace.js';
import { api, loadSession, showToast, confirmAction } from './session.js';
import { templateIsDirty } from './templates.js';
import { reactionRoleIsDirty } from './roles.js';

export function workspaceStatus(message = '', kind = '', retry = false) {
  const notice = document.getElementById('workspaceNotice');
  notice.hidden = !message;
  notice.dataset.kind = kind;
  document.getElementById('workspaceNoticeText').textContent = message;
  document.getElementById('workspaceRetry').hidden = !retry;
  const views = document.getElementById('workspaceViews');
  const unavailable = kind === 'loading' || kind === 'error' || kind === 'empty';
  views.inert = unavailable;
  views.hidden = kind === 'empty';
  views.setAttribute('aria-busy', String(kind === 'loading'));
}

export function hasGuildChanges() {
  return Boolean(state.config && snapshot() !== state.savedSnapshot) || templateIsDirty() || reactionRoleIsDirty();
}

export async function switchGuild(id) {
  if (id === state.guildId) return;
  if (state.pendingWrites || state.saving || state.templateSaving || state.reactionRoleSaving) {
    elements.guildSelect.value = state.guildId;
    showToast('Wait for the current save to finish before switching servers.');
    return;
  }
  if (hasGuildChanges() && !await confirmAction({title:'Switch server?', copy:'This will discard your unsaved settings, template, and reaction-role changes.', confirmLabel:'Discard & switch'})) {
    elements.guildSelect.value = state.guildId;
    return;
  }
  await loadGuild(id);
}

export function initializeWorkspace() {
  document.getElementById('workspaceRetry').addEventListener('click', () => loadGuild(state.guildId));
  document.getElementById('sessionRetry').addEventListener('click', loadSession);
  document.getElementById('sessionReconnect').addEventListener('click',async () => {
    try {
      const session = await api('/api/me');
      if(session.user.id !== state.me?.user.id) return showToast('A different account signed in. Reload before making changes.', 'error');
      state.csrfToken = session.csrfToken;
      document.getElementById('sessionRecovery').hidden = true;
      showToast('Session restored. Your edits are ready to save.');
    } catch(error) { showToast(error.message,'error'); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.accountMenu.hidden) {
      elements.accountMenu.hidden = true;
      elements.userChip.setAttribute('aria-expanded', 'false');
      elements.userChip.focus();
    }
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')].filter(item => !item.disabled && !item.hidden);
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
  });
  window.addEventListener('offline', () => {
    const connection = document.getElementById('connectionState');
    connection.dataset.state = 'error'; connection.textContent = 'Offline';
    showToast('Connection lost. Your unsaved edits are still here. Reconnect before saving.', 'error');
  });
  window.addEventListener('online', () => {
    document.getElementById('connectionState').textContent = 'Connection restored';
    showToast('Connection restored. You can try saving again.');
  });
  // Images always use the existing live bot endpoint. Failed loads have meaningful alt text.
  document.querySelectorAll('img[src="/bot-avatar.png"]').forEach(img => { img.decoding = 'async'; });
}
