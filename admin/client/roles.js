// roles: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { genericTemplatePreviewValues, normalizeTemplateLayoutClient, templatePreviewMediaUrl, validTemplateMedia } from './templates.js';
import { channelOptions, normalizeAdditionalContainersClient, roleOptions } from './leveling.js';
import { GENERIC_TEMPLATE_VARIABLES, MAX_ADDITIONAL_MESSAGE_CONTAINERS, elements, state } from './state.js';
import { api, clone, confirmAction, escapeHtml, showToast } from './session.js';
import { inlineTemplateEditor, readMediaFile, renderAdditionalContainerEditors, renderDiscordComposerPreview, renderedEditableTemplate, syncInlineEditorVisual } from './composer.js';
import { refreshDirty } from './workspace.js';
import { preferredInlineInput } from './emoji.js';

export function normalizePickerEmoji(value) {
    const id = /^\d{16,20}$/.test(String(value?.id || '')) ? String(value.id) : '';
    const name = String(value?.name || '').trim().slice(0, 100);
    return { id, name, animated: Boolean(id && value?.animated), source: id && value?.source === 'bot' ? 'bot' : id ? 'group' : 'default' };
  }

export function clientReactionId(prefix) {
    const random = window.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24)
      || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 24);
    return `${prefix}_${random}`;
  }

export function normalizeReactionRolesClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const items = (Array.isArray(source.items) ? source.items : []).map((item, itemIndex) => {
      const message = item?.message && typeof item.message === 'object' ? item.message : {};
      const dropdown = item?.dropdown && typeof item.dropdown === 'object' ? item.dropdown : {};
      return {
        id: String(item?.id || ''),
        name: String(item?.name || `Reaction Roles ${itemIndex + 1}`).trim().slice(0, 80),
        enabled: item?.enabled !== false,
        message: {
          content: String(message.content || '## Choose your roles\nUse the controls below to update your server roles.').slice(0, 4000),
          layout: normalizeTemplateLayoutClient(message.layout),
          additionalContainers: normalizeAdditionalContainersClient(message.additionalContainers, normalizeTemplateLayoutClient, 4000),
          sourceTemplateId: String(message.sourceTemplateId || ''),
        },
        interactionType: item?.interactionType === 'dropdown' ? 'dropdown' : 'button',
        buttons: (Array.isArray(item?.buttons) ? item.buttons : []).slice(0, 25).map((button, index) => ({
          id: String(button?.id || clientReactionId('button')),
          emoji: normalizePickerEmoji(button?.emoji),
          label: String(button?.label || button?.name || `Role ${index + 1}`).trim().slice(0, 80),
          style: ['Primary', 'Secondary', 'Success', 'Danger'].includes(button?.style) ? button.style : 'Secondary',
          roleId: String(button?.roleId || ''), sortOrder: index,
        })),
        dropdown: {
          placeholder: String(dropdown.placeholder || 'Choose your roles').trim().slice(0, 150),
          allowMultiple: dropdown.allowMultiple === true,
          options: (Array.isArray(dropdown.options) ? dropdown.options : []).slice(0, 25).map((option, index) => ({
            id: String(option?.id || clientReactionId('option')),
            emoji: normalizePickerEmoji(option?.emoji),
            title: String(option?.title || option?.label || `Role ${index + 1}`).trim().slice(0, 100),
            description: String(option?.description || '').trim().slice(0, 100),
            roleId: String(option?.roleId || ''), sortOrder: index,
          })),
        },
        channelId: String(item?.channelId || ''), publishedMessageId: String(item?.publishedMessageId || ''),
        createdAt: String(item?.createdAt || ''), updatedAt: String(item?.updatedAt || ''),
      };
    }).filter((item) => item.id);
    return { items };
  }

export function reactionRoleSnapshot() {
    const draft = state.reactionRoleDraft;
    return draft ? JSON.stringify({
      name: draft.name, enabled: draft.enabled, message: draft.message,
      interactionType: draft.interactionType, buttons: draft.buttons,
      dropdown: draft.dropdown, channelId: draft.channelId, publishedMessageId: draft.publishedMessageId,
    }) : '';
  }

export function reactionRoleIsDirty() {
    return Boolean(state.reactionRoleDraft && reactionRoleSnapshot() !== state.reactionRoleSavedSnapshot);
  }

export function reactionRoleEntries(draft = state.reactionRoleDraft) {
    return draft?.interactionType === 'dropdown' ? draft.dropdown.options : draft?.buttons || [];
  }

export function reactionRoleEmojiHtml(emoji) {
    const normalized = normalizePickerEmoji(emoji);
    if (!normalized.name) return '<span aria-hidden="true">＋</span>';
    if (!normalized.id) return `<span aria-hidden="true">${escapeHtml(normalized.name)}</span>`;
    const item = [...(state.directory.emojis?.bot || []), ...(state.directory.emojis?.group || [])].find((entry) => entry.id === normalized.id);
    return item?.url ? `<img src="${escapeHtml(item.url)}" alt="" width="24" height="24">` : `<span aria-hidden="true">:${escapeHtml(normalized.name)}:</span>`;
  }

export function renderReactionRoleList() {
    const items = state.reactionRoles.items;
    elements.reactionRoleCount.textContent = `${items.length} saved`;
    elements.reactionRoleList.innerHTML = items.length ? items.map((item) => `<button type="button" class="${item.id === state.reactionRoleSelectedId ? 'active ' : ''}${item.enabled ? '' : 'is-disabled'}" data-reaction-role-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><i aria-label="${item.enabled ? 'Enabled' : 'Disabled'}"></i></span><small>${item.interactionType === 'dropdown' ? 'Dropdown' : 'Buttons'} · ${reactionRoleEntries(item).length} role${reactionRoleEntries(item).length === 1 ? '' : 's'}</small></button>`).join('') : '<div class="template-list-empty">No Reaction Role templates yet.</div>';
  }

export function renderReactionRoleControlPreview() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    if (draft.interactionType === 'dropdown') {
      elements.reactionRoleControlPreview.innerHTML = `<div class="rr-preview-select">${escapeHtml(draft.dropdown.placeholder)} · ${draft.dropdown.options.length} option${draft.dropdown.options.length === 1 ? '' : 's'}</div>`;
      return;
    }
    elements.reactionRoleControlPreview.innerHTML = draft.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('');
  }

export function renderReactionRoleComposerPanel() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const panel = state.reactionRoleComposerPanel;
    const layout = draft.message.layout;
    elements.reactionRoleComposerPanel.hidden = !panel;
    elements.reactionRoleVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.reactionRoleThumbnailToggle.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.reactionRoleGalleryToggle.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validTemplateMedia));
    if (!panel) return;
    if (panel === 'variables') {
      elements.reactionRoleComposerPanel.innerHTML = `<div class="variable-guide">${GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<button type="button" data-insert-reaction-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.reactionRoleComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {server_icon}, an image URL, or an upload.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-reaction-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{server_icon} or https://example.com/image.png" data-reaction-thumbnail-url><label class="media-upload">Upload<input type="file" accept="image/*" data-reaction-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" data-reaction-gallery-url="${index}" placeholder="https://example.com/image.png"><label class="media-upload">Upload<input type="file" accept="image/*" data-reaction-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-reaction-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.reactionRoleComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-reaction-gallery>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-reaction-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

export function renderReactionRoleMessage() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const content = inlineTemplateEditor(draft.message.content, 'content', 'reactionRole', 'Reaction Role message', genericTemplatePreviewValues(), 4000);
    renderDiscordComposerPreview({
      frame: elements.reactionRoleDiscordFrame, preview: elements.reactionRoleMessagePreview,
      accentButton: elements.reactionRoleAccentButton, accentInput: elements.reactionRoleAccentColor,
      containerButton: elements.reactionRoleContainerToggle, layout: draft.message.layout,
      contentHtml: content, resolveMedia: templatePreviewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.reactionRoleAdditionalContainers, containers: draft.message.additionalContainers,
      prefix: 'reaction', scope: 'reactionRole', previewValues: genericTemplatePreviewValues(),
      resolveMedia: templatePreviewMediaUrl, maxLength: 4000,
    });
    elements.reactionRoleAdditionalContainer.disabled = draft.message.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    renderReactionRoleComposerPanel();
    renderReactionRoleControlPreview();
  }

export function renderReactionRoleControls() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    document.querySelectorAll('[data-reaction-mode]').forEach((button) => button.classList.toggle('active', button.dataset.reactionMode === draft.interactionType));
    elements.reactionRoleAddControl.textContent = draft.interactionType === 'dropdown' ? '+ Add option' : '+ Add button';
    elements.reactionRoleAddControl.disabled = reactionRoleEntries().length >= 25;
    if (draft.interactionType === 'button') {
      elements.reactionRoleControls.innerHTML = `<div class="rr-control-settings">${draft.buttons.map((button, index) => `<article class="rr-control-row" data-rr-row="${index}"><button class="rr-emoji-field" type="button" data-reaction-emoji="button:${index}" aria-label="Choose emoji for ${escapeHtml(button.label)}">${reactionRoleEmojiHtml(button.emoji)}</button><label>Label<input type="text" maxlength="80" value="${escapeHtml(button.label)}" data-rr-button-label="${index}"></label><label>Role<select data-rr-button-role="${index}">${roleOptions(button.roleId)}</select></label><label>Style<select data-rr-button-style="${index}">${['Primary','Secondary','Success','Danger'].map((style) => `<option${style === button.style ? ' selected' : ''}>${style}</option>`).join('')}</select></label><div class="rr-row-actions"><button type="button" data-rr-move="${index}:-1" aria-label="Move up">⬆️</button><button type="button" data-rr-move="${index}:1" aria-label="Move down">⬇️</button><button type="button" data-rr-remove="${index}" aria-label="Remove">×</button></div></article>`).join('')}</div>`;
    } else {
      elements.reactionRoleControls.innerHTML = `<div class="rr-control-settings"><label>Placeholder<input class="reaction-role-composer-input" type="text" maxlength="150" value="${escapeHtml(draft.dropdown.placeholder)}" data-rr-dropdown-placeholder></label><label class="rr-allow-multiple"><input type="checkbox" data-rr-allow-multiple${draft.dropdown.allowMultiple ? ' checked' : ''}><span><strong>Allow multiple selections</strong><small>Add selected roles and remove unselected roles managed by this template.</small></span></label></div><div class="rr-dropdown-options">${draft.dropdown.options.map((option, index) => `<article class="rr-control-row dropdown" data-rr-row="${index}"><button class="rr-emoji-field" type="button" data-reaction-emoji="option:${index}" aria-label="Choose emoji for ${escapeHtml(option.title)}">${reactionRoleEmojiHtml(option.emoji)}</button><label>Selection title<input type="text" maxlength="100" value="${escapeHtml(option.title)}" data-rr-option-title="${index}"></label><label>Description<input type="text" maxlength="100" value="${escapeHtml(option.description)}" data-rr-option-description="${index}"></label><label>Role<select data-rr-option-role="${index}">${roleOptions(option.roleId)}</select></label><div class="rr-row-actions"><button type="button" data-rr-move="${index}:-1" aria-label="Move up">⬆️</button><button type="button" data-rr-move="${index}:1" aria-label="Move down">⬇️</button><button type="button" data-rr-remove="${index}" aria-label="Remove">×</button></div></article>`).join('')}</div>`;
    }
  }

export function renderReactionRoleChannel() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    elements.reactionRoleChannel.innerHTML = channelOptions(draft.channelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    const channel = state.directory.channels.find((entry) => entry.id === draft.channelId);
    const manageRolesMissing = (state.directory.botPermissions?.missing || []).some((item) => item.label === 'Manage Roles');
    const ready = Boolean(channel?.sendable && !manageRolesMissing);
    elements.reactionRolePermissionStatus.className = `rr-permission-status ${ready ? 'ok' : 'error'}`;
    elements.reactionRolePermissionStatus.textContent = ready ? 'CoinSprite can send messages and manage roles here.' : manageRolesMissing ? 'CoinSprite needs Manage Roles before publishing.' : 'Choose a sendable text channel.';
    const controls = draft.interactionType === 'button'
      ? draft.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('')
      : `<div class="rr-preview-select">${escapeHtml(draft.dropdown.placeholder)} · ${draft.dropdown.options.length} option${draft.dropdown.options.length === 1 ? '' : 's'}</div>`;
    elements.reactionRoleFinalPreview.innerHTML = `<div class="rr-final-message"><article style="--accent:${escapeHtml(draft.message.layout.accentColor)}">${renderedEditableTemplate(draft.message.content, genericTemplatePreviewValues())}</article><div class="rr-final-controls">${controls}</div></div>`;
    elements.reactionRolePublish.disabled = state.reactionRoleSaving || !ready || !reactionRoleEntries().length;
  }

export function renderReactionRoleEditor() {
    const draft = state.reactionRoleDraft;
    elements.reactionRoleEmpty.hidden = Boolean(draft);
    elements.reactionRoleEditor.hidden = !draft;
    if (!draft) return;
    elements.reactionRoleName.value = draft.name;
    elements.reactionRoleEnabled.checked = draft.enabled;
    elements.reactionRolePublishedState.textContent = draft.publishedMessageId ? `Published message ${draft.publishedMessageId}` : 'Not published';
    elements.reactionRoleStatus.textContent = reactionRoleIsDirty() ? 'UNSAVED' : 'SAVED';
    elements.reactionRoleStatus.classList.toggle('unsaved', reactionRoleIsDirty());
    document.querySelectorAll('[data-reaction-tab]').forEach((button) => {
      const active = button.dataset.reactionTab === state.reactionRoleTab;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-reaction-panel]').forEach((panel) => {
      const active = panel.dataset.reactionPanel === state.reactionRoleTab;
      panel.hidden = !active; panel.classList.toggle('active', active);
    });
    renderReactionRoleMessage();
    renderReactionRoleControls();
    renderReactionRoleChannel();
    refreshDirty();
  }

export function renderReactionRoles() {
    renderReactionRoleList();
    renderReactionRoleEditor();
  }

export function replaceReactionRoles(payload, selectedId = state.reactionRoleSelectedId) {
    state.reactionRoles = normalizeReactionRolesClient(payload.reactionRoles || payload);
    const item = state.reactionRoles.items.find((entry) => entry.id === selectedId) || null;
    state.reactionRoleSelectedId = item?.id || '';
    state.reactionRoleDraft = item ? clone(item) : null;
    state.reactionRoleSavedSnapshot = reactionRoleSnapshot();
    renderReactionRoles();
  }

export async function selectReactionRole(id) {
    if (id === state.reactionRoleSelectedId) return;
    if (reactionRoleIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved Reaction Role changes?', copy: 'Your current draft has not been saved.', confirmLabel: 'Discard' });
      if (!confirmed) return;
    }
    const item = state.reactionRoles.items.find((entry) => entry.id === id);
    if (!item) return;
    state.reactionRoleSelectedId = item.id; state.reactionRoleDraft = clone(item);
    state.reactionRoleSavedSnapshot = reactionRoleSnapshot(); state.reactionRoleTab = 'message'; state.reactionRoleComposerPanel = '';
    renderReactionRoles();
  }

export async function createReactionRole() {
    if (reactionRoleIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved Reaction Role changes?', copy: 'Creating a template closes this draft.', confirmLabel: 'Discard and create' });
      if (!confirmed) return;
    }
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles`, { method: 'POST', body: JSON.stringify({ name: `Reaction Roles ${state.reactionRoles.items.length + 1}` }) });
    replaceReactionRoles(payload, payload.item.id); state.reactionRoleTab = 'message';
    elements.reactionRoleName.focus(); elements.reactionRoleName.select(); showToast('Reaction Role template created.');
  }

export function reactionRoleUpdateBody() {
    const draft = state.reactionRoleDraft;
    return {
      name: draft.name, enabled: draft.enabled, message: draft.message,
      interactionType: draft.interactionType, buttons: draft.buttons,
      dropdown: draft.dropdown, channelId: draft.channelId, publishedMessageId: draft.publishedMessageId,
    };
  }

export async function saveReactionRole() {
    if (!state.reactionRoleDraft || state.reactionRoleSaving || !reactionRoleIsDirty()) return state.reactionRoleDraft;
    state.reactionRoleSaving = true; refreshDirty();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}`, { method: 'PATCH', body: JSON.stringify(reactionRoleUpdateBody()) });
      replaceReactionRoles(payload, payload.item.id); showToast('Reaction Role draft saved.'); return payload.item;
    } finally { state.reactionRoleSaving = false; refreshDirty(); }
  }

export async function duplicateReactionRole() {
    if (!state.reactionRoleDraft) return;
    if (reactionRoleIsDirty()) return showToast('Save or reset changes before duplicating.', 'error');
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/duplicate`, { method: 'POST', body: '{}' });
    replaceReactionRoles(payload, payload.item.id); showToast('Reaction Role template duplicated.');
  }

export async function deleteReactionRole() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const confirmed = await confirmAction({ title: 'Delete this Reaction Role template?', copy: `“${draft.name}” will be removed. Its existing Discord message will stop responding.`, confirmLabel: 'Delete' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${draft.id}`, { method: 'DELETE', body: '{}' });
    replaceReactionRoles(payload, ''); showToast('Reaction Role template deleted.');
  }

export async function publishReactionRole() {
    if (!state.reactionRoleDraft || state.reactionRoleSaving) return;
    if (reactionRoleIsDirty()) await saveReactionRole();
    const confirmed = await confirmAction({ title: state.reactionRoleDraft.publishedMessageId ? 'Update the published message?' : 'Publish this Reaction Role message?', copy: 'CoinSprite will recheck the channel, role hierarchy, and permissions before sending.', confirmLabel: state.reactionRoleDraft.publishedMessageId ? 'Update message' : 'Publish' });
    if (!confirmed) return;
    state.reactionRoleSaving = true; renderReactionRoleChannel();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/publish`, { method: 'POST', body: '{}' });
      replaceReactionRoles(payload, payload.item.id);
      showToast(payload.updated ? 'Published Reaction Role message updated.' : 'Reaction Role message published.', '', payload.messageUrl);
    } finally { state.reactionRoleSaving = false; refreshDirty(); }
  }

export function updateReactionRoleFromControl(target) {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    if (target.matches('[data-inline-message-input]')) {
      const index = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(index) && draft.message.additionalContainers[index]) draft.message.additionalContainers[index].content = target.value.slice(0, 4000);
      else draft.message.content = target.value.slice(0, 4000);
      syncInlineEditorVisual(target); refreshDirty(); return;
    }
    if (target === elements.reactionRoleName) { draft.name = target.value.slice(0, 80); renderReactionRoleList(); }
    if (target === elements.reactionRoleEnabled) draft.enabled = target.checked;
    if (target === elements.reactionRoleAccentColor) { draft.message.layout.accentColor = target.value; renderReactionRoleMessage(); }
    if (target === elements.reactionRoleChannel) { draft.channelId = target.value; renderReactionRoleChannel(); }
    if (target.matches('[data-reaction-thumbnail-url]')) {
      draft.message.layout.thumbnailUrl = target.value.slice(0, 2000); draft.message.layout.thumbnailEnabled = validTemplateMedia(target.value); renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-gallery-url]')) {
      draft.message.layout.galleryUrls[Number(target.dataset.reactionGalleryUrl)] = target.value.slice(0, 2000); renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-accent]')) {
      const container = draft.message.additionalContainers[Number(target.dataset.reactionAdditionalAccent)]; if (container) container.layout.accentColor = target.value; renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-thumbnail-url]')) {
      const container = draft.message.additionalContainers[Number(target.dataset.reactionAdditionalThumbnailUrl)];
      if (container) { container.layout.thumbnailUrl = target.value.slice(0, 2000); container.layout.thumbnailEnabled = validTemplateMedia(target.value); }
      renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.reactionAdditionalGalleryUrl.split(':').map(Number);
      const container = draft.message.additionalContainers[containerIndex]; if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000); renderReactionRoleMessage();
    }
    if (target.matches('[data-rr-button-label]')) { draft.buttons[Number(target.dataset.rrButtonLabel)].label = target.value.slice(0, 80); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-button-role]')) draft.buttons[Number(target.dataset.rrButtonRole)].roleId = target.value;
    if (target.matches('[data-rr-button-style]')) { draft.buttons[Number(target.dataset.rrButtonStyle)].style = target.value; renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-dropdown-placeholder]')) { draft.dropdown.placeholder = target.value.slice(0, 150); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-allow-multiple]')) draft.dropdown.allowMultiple = target.checked;
    if (target.matches('[data-rr-option-title]')) { draft.dropdown.options[Number(target.dataset.rrOptionTitle)].title = target.value.slice(0, 100); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-option-description]')) draft.dropdown.options[Number(target.dataset.rrOptionDescription)].description = target.value.slice(0, 100);
    if (target.matches('[data-rr-option-role]')) draft.dropdown.options[Number(target.dataset.rrOptionRole)].roleId = target.value;
    elements.reactionRoleStatus.textContent = 'UNSAVED'; elements.reactionRoleStatus.classList.add('unsaved'); refreshDirty();
  }

export function insertReactionRoleVariable(token) {
    const input = preferredInlineInput('reactionRole');
    if (!input) return;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 4000);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus(); input.setSelectionRange(start + token.length, start + token.length);
  }

export async function uploadReactionRoleMedia(input) {
    const file = input.files?.[0]; const draft = state.reactionRoleDraft;
    if (!file || !draft) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { input.value = ''; return showToast(file.size > 10 * 1024 * 1024 ? 'Images must be 10 MB or smaller.' : 'Upload an image file.', 'error'); }
    const label = input.closest('.media-upload'); label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-media`, { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? draft.message.additionalContainers[containerIndex]?.layout : draft.message.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.reactionMediaUpload === 'thumbnail') { layout.thumbnailUrl = result.url; layout.thumbnailEnabled = true; }
      else { const index = Number(input.dataset.mediaIndex); if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url; else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url); }
      renderReactionRoleMessage(); refreshDirty(); showToast('Image uploaded. Save the Reaction Role when ready.');
    } catch (error) { showToast(error.message || 'Image upload failed.', 'error'); }
    finally { label?.classList.remove('uploading'); input.value = ''; }
  }
