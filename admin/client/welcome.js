import { previewIdentity } from './preview-data.js';
// welcome: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { MAX_ADDITIONAL_MESSAGE_CONTAINERS, MEMBER_MESSAGE_COMMON_VARIABLES, MEMBER_MESSAGE_EVENT_VARIABLES, MEMBER_MESSAGE_META, elements, state } from './state.js';
import { beginInlineMessageEdit, inlineTemplateEditor, interpolateTemplate, readMediaFile, renderAdditionalContainerEditors, renderDiscordComposerPreview, syncInlineEditorVisual } from './composer.js';
import { channelOptions, validHttpUrl, validMemberMediaTemplate } from './leveling.js';
import { api, escapeHtml, showToast } from './session.js';
import { refreshDirty } from './workspace.js';

export function currentMemberMessage() {
    return state.config?.memberMessages?.[state.memberMessageEvent];
  }

export function memberMessagePreviewValues() {
  return {
    ...previewIdentity(), member_count: '{member_count}', channel: '{channel}',
    timestamp: '{timestamp}', joined_at: '{joined_at}', account_created: '{account_created}',
    account_age: '{account_age}', time_in_server: '{time_in_server}', boost_count: '{boost_count}',
    boost_level: '{boost_level}', boost_since: '{boost_since}',
  };
}

export function memberMessagePreviewMediaUrl(value, type = state.memberMessageEvent) {
    const resolved = interpolateTemplate(value, memberMessagePreviewValues(type));
    return validHttpUrl(resolved) ? resolved.trim() : '';
  }

export function renderWelcomeComposerPanel() {
    const panel = state.memberMessageComposerPanel;
    const event = currentMemberMessage();
    if (!event) return;
    const layout = event.layout;
    elements.welcomeComposerPanel.hidden = !panel;
    elements.welcomeComposerPanel.dataset.panel = panel;
    elements.welcomeVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.welcomeThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.welcomeGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validMemberMediaTemplate));
    if (!panel) return;
    if (panel === 'variables') {
      const variables = [...MEMBER_MESSAGE_COMMON_VARIABLES, ...MEMBER_MESSAGE_EVENT_VARIABLES[state.memberMessageEvent]];
      elements.welcomeComposerPanel.innerHTML = `<div class="variable-guide">${variables.map(([token, meaning]) => `<button type="button" data-insert-member-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.welcomeComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {user_avatar}, {server_icon}, an image URL, or an upload up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-welcome-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{user_avatar} or https://example.com/image.png" data-welcome-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-welcome-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="{server_icon} or https://example.com/image.png" data-welcome-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-welcome-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-welcome-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.welcomeComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-welcome-gallery-url>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-welcome-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

export function renderWelcomeMessagePreview(renderTools = true) {
    const event = currentMemberMessage();
    if (!event) return;
    const layout = event.layout;
    const values = memberMessagePreviewValues(state.memberMessageEvent);
    const text = inlineTemplateEditor(event.template, 'template', 'memberMessages', `${state.memberMessageEvent} message`, values);
    renderDiscordComposerPreview({
      frame: elements.welcomeDiscordFrame, preview: elements.welcomeMessagePreview,
      accentButton: elements.welcomeAccentButton, accentInput: elements.welcomeAccentColor,
      containerButton: elements.welcomeContainerAdd, layout, contentHtml: text,
      resolveMedia: (url) => memberMessagePreviewMediaUrl(url),
    });
    renderAdditionalContainerEditors({
      root: elements.welcomeAdditionalContainers,
      containers: event.additionalContainers,
      prefix: 'welcome', scope: 'memberMessages', previewValues: values,
      resolveMedia: (url) => memberMessagePreviewMediaUrl(url), maxLength: 3000,
    });
    elements.welcomeAdditionalContainerAdd.disabled = event.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    if (renderTools) renderWelcomeComposerPanel();
  }

export function renderWelcomeMessages() {
    const config = state.config?.memberMessages;
    const event = currentMemberMessage();
    if (!config || !event) return;
    const meta = MEMBER_MESSAGE_META[state.memberMessageEvent];
    elements.welcomeMessagesEnabled.checked = config.enabled;
    elements.welcomeEventEnabled.checked = event.enabled;
    elements.welcomeEventChannel.innerHTML = channelOptions(event.channelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    elements.welcomeEventStep.textContent = meta.step;
    elements.welcomeEventTitle.textContent = meta.title;
    elements.welcomeEventDescription.textContent = meta.description;
    elements.welcomeEventToggleCopy.textContent = meta.toggle;
    elements.welcomePreviewLabel.textContent = meta.preview;
    elements.welcomeEventReset.textContent = `Reset ${state.memberMessageEvent} default`;
    document.querySelectorAll('[data-member-event]').forEach((button) => {
      const active = button.dataset.memberEvent === state.memberMessageEvent;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderWelcomeMessagePreview();
    refreshDirty();
  }

export function toggleWelcomeComposerPanel(panel) {
    state.memberMessageComposerPanel = state.memberMessageComposerPanel === panel ? '' : panel;
    renderWelcomeComposerPanel();
  }

export function insertMemberMessageVariable(token) {
    const event = currentMemberMessage();
    if (!event) return;
    let input = elements.welcomeMessagesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]')
      || elements.welcomeMessagePreview.querySelector('[data-inline-message-input]');
    if (!input) return;
    if (!input.closest('[data-inline-message-editor]')?.classList.contains('editing')) {
      beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
      input = elements.welcomeMessagesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]') || input;
    }
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 3000);
    const containerIndex = Number(input.dataset.additionalContainerIndex);
    if (Number.isInteger(containerIndex) && event.additionalContainers[containerIndex]) event.additionalContainers[containerIndex].content = input.value;
    else event.template = input.value;
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(Math.min(input.value.length, start + token.length), Math.min(input.value.length, start + token.length));
    refreshDirty();
  }

export async function uploadWelcomeMedia(input) {
    const file = input.files?.[0];
    const event = currentMemberMessage();
    if (!file || !event) return;
    if (!file.type.startsWith('image/')) {
      input.value = '';
      return showToast('Upload an image file.', 'error');
    }
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      return showToast('Images must be 10 MB or smaller.', 'error');
    }
    const label = input.closest('.media-upload');
    label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-media`, {
        method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }),
      });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? event.additionalContainers[containerIndex]?.layout : event.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.welcomeMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url;
        layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderWelcomeMessagePreview();
      refreshDirty();
      showToast('Image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }
