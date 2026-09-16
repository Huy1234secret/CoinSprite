import { previewIdentity } from './preview-data.js';
// composer: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { renderXpDrops, validHttpUrl } from './leveling.js';
import { api, escapeHtml, showToast } from './session.js';
import { LEVELING_VARIABLES, MAX_ADDITIONAL_MESSAGE_CONTAINERS, elements, state } from './state.js';
import { formatNumber } from './owner.js';
import { memberMessagePreviewValues } from './welcome.js';
import { genericTemplatePreviewValues } from './templates.js';
import { refreshDirty } from './workspace.js';

export function validMediaTemplate(value) {
    return String(value || '').trim().toLowerCase() === '{user_profile}' || validHttpUrl(value);
  }

export function previewMediaUrl(value) {
    return String(value || '').trim().toLowerCase() === '{user_profile}'
      ? previewIdentity().user_profile
      : validHttpUrl(value) ? String(value).trim() : '';
  }

export function discordInlineMarkdown(value) {
    const code = [];
    let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, content) => {
      code.push(`<code>${content}</code>`);
      return `\uE000${code.length - 1}\uE001`;
    });
    html = html
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
      .replace(/\|\|([^|\n]+)\|\|/g, '<span class="discord-spoiler">$1</span>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>');
    return html.replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)] || '');
  }

export function discordMarkdown(value) {
    return String(value || '').split('\n').map((line) => {
      if (/^###\s/.test(line)) return `<h3>${discordInlineMarkdown(line.slice(4))}</h3>`;
      if (/^##\s/.test(line)) return `<h2>${discordInlineMarkdown(line.slice(3))}</h2>`;
      if (/^#\s/.test(line)) return `<h1>${discordInlineMarkdown(line.slice(2))}</h1>`;
      if (/^>\s?/.test(line)) return `<blockquote>${discordInlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`;
      if (/^-\s/.test(line)) return `<div class="discord-list-item">&#8226;<span>${discordInlineMarkdown(line.slice(2))}</span></div>`;
      return line ? `<div class="discord-line">${discordInlineMarkdown(line)}</div>` : '<div class="discord-line"><br></div>';
    }).join('');
  }

export function editorInlineMarkdown(value) {
    const fragments = [];
    const stash = (html) => {
      fragments.push(html);
      return `\uE000${fragments.length - 1}\uE001`;
    };
    let html = escapeHtml(value);
    html = html
      .replace(/`([^`\n]+)`/g, (_, content) => stash(`<span class="markdown-syntax">\`</span><code>${content}</code><span class="markdown-syntax">\`</span>`))
      .replace(/\*\*([^*\n]+)\*\*/g, (_, content) => stash(`<span class="markdown-syntax">**</span><strong>${content}</strong><span class="markdown-syntax">**</span>`))
      .replace(/__([^_\n]+)__/g, (_, content) => stash(`<span class="markdown-syntax">__</span><u>${content}</u><span class="markdown-syntax">__</span>`))
      .replace(/~~([^~\n]+)~~/g, (_, content) => stash(`<span class="markdown-syntax">~~</span><s>${content}</s><span class="markdown-syntax">~~</span>`))
      .replace(/\|\|([^|\n]+)\|\|/g, (_, content) => stash(`<span class="markdown-syntax">||</span><span class="editor-spoiler">${content}</span><span class="markdown-syntax">||</span>`))
      .replace(/\*([^*\n]+)\*/g, (_, content) => stash(`<span class="markdown-syntax">*</span><em>${content}</em><span class="markdown-syntax">*</span>`))
      .replace(/_([^_\n]+)_/g, (_, content) => stash(`<span class="markdown-syntax">_</span><em>${content}</em><span class="markdown-syntax">_</span>`))
      .replace(/\{(?:user|user_profile|username|level|next_level|server|channel|bar|progress_xp|needed_xp|total_xp|crate_name|xp_min|xp_max|xp|claim_limit|claims_left|list_claimed_user|chance|drop_every|despawn_time|separator)\}/gi, (token) => stash(`<span class="editor-token">${token}</span>`));
    return html.replace(/\uE000(\d+)\uE001/g, (_, index) => fragments[Number(index)] || '');
  }

export function editorMarkdown(value) {
    return String(value || '').split('\n').map((line) => {
      const heading = line.match(/^(#{1,3}\s)(.*)$/);
      const quote = line.match(/^(>\s?)(.*)$/);
      const list = line.match(/^(-\s)(.*)$/);
      if (heading) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(heading[1])}</span><strong>${editorInlineMarkdown(heading[2])}</strong></div>`;
      if (quote) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(quote[1])}</span>${editorInlineMarkdown(quote[2])}</div>`;
      if (list) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(list[1])}</span>${editorInlineMarkdown(list[2])}</div>`;
      return `<div class="editor-source-line">${line ? editorInlineMarkdown(line) : '<br>'}</div>`;
    }).join('');
  }

export function interpolateTemplate(template, values = {}) {
    return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token
    ));
  }

export function previewMessageValue(template, extraValues = {}) {
    const xpDrops = state.config?.leveling?.xpDrops;
    const crate = xpDrops?.crates?.find((item) => item.id === elements.xpDropTestCrate?.value) || xpDrops?.crates?.[0];
    const minimum = crate?.xp?.min ?? 50;
    const maximum = crate?.xp?.max ?? 100;
    const claimed = Math.round((Number(minimum) + Number(maximum)) / 2);
    return interpolateTemplate(template, {
      ...previewIdentity(),
      level: '{level}', next_level: '{next_level}', bar: '{bar}', progress_xp: '{progress_xp}',
      needed_xp: '{needed_xp}', total_xp: '{total_xp}', crate_name: crate?.name || 'Common Crate', xp_min: formatNumber(minimum),
      xp_max: formatNumber(maximum), xp: '{xp}', claim_limit: formatNumber(crate?.claimLimit ?? 3),
      claims_left: '{claims_left}', list_claimed_user: '{list_claimed_user}',
      chance: String(crate?.chancePercent ?? 35), drop_every: crate?.dropEvery || '30m', despawn_time: crate?.despawnAfter || 'never',
      channel: '{channel}', ...extraValues,
    });
  }

export function renderedEditableTemplate(template, previewValues = {}) {
    const preview = previewMessageValue(template, previewValues);
    return preview.split(/\{separator\}/gi)
      .map((segment, index) => `${index ? '<div class="discord-separator"></div>' : ''}<div class="discord-text">${discordMarkdown(segment)}</div>`)
      .join('');
  }

export function syncInlineEditorVisual(input) {
    const editor = input.closest('[data-inline-message-editor]');
    const mirror = editor?.querySelector('[data-inline-message-highlight]');
    const sourceShell = editor?.querySelector('.inline-message-source-shell');
    const display = editor?.querySelector('[data-inline-message-display]');
    if (!editor || !mirror || !sourceShell || !display) return;
    mirror.innerHTML = editorMarkdown(input.value);
    input.style.height = 'auto';
    const height = Math.min(190, Math.max(54, input.scrollHeight));
    input.style.height = `${height}px`;
    sourceShell.style.height = `${height}px`;
    mirror.style.transform = `translateY(-${input.scrollTop}px)`;
    const previewValues = input.dataset.inlineTemplateScope === 'memberMessages'
      ? memberMessagePreviewValues(state.memberMessageEvent)
      : input.dataset.inlineTemplateScope === 'messageTemplate' ? genericTemplatePreviewValues() : {};
    display.innerHTML = `${renderedEditableTemplate(input.value, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
  }

export function beginInlineMessageEdit(trigger) {
    const editor = trigger.closest('[data-inline-message-editor]');
    const input = editor?.querySelector('[data-inline-message-input]');
    if (!editor || !input) return;
    editor.classList.add('editing');
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

export function finishInlineMessageEdit(editor) {
    if (!editor?.classList.contains('editing')) return;
    editor.classList.remove('editing');
    const input = editor.querySelector('[data-inline-message-input]');
    const display = editor.querySelector('[data-inline-message-display]');
    if (input && display) {
      const previewValues = input.dataset.inlineTemplateScope === 'memberMessages'
        ? memberMessagePreviewValues(state.memberMessageEvent)
        : ['messageTemplate', 'reactionRole'].includes(input.dataset.inlineTemplateScope) ? genericTemplatePreviewValues() : {};
      display.innerHTML = `${renderedEditableTemplate(input.value, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
    }
  }

export function inlineTemplateEditor(template, field = 'template', scope = 'announcements', label = 'level-up message', previewValues = {}, maxLength = 3000, additionalContainerIndex = null) {
    const containerData = Number.isInteger(additionalContainerIndex) ? ` data-additional-container-index="${additionalContainerIndex}"` : '';
    return `<div class="inline-message-editor" data-inline-message-editor data-template-field="${escapeHtml(field)}" data-template-scope="${escapeHtml(scope)}"${containerData}>
      <div class="inline-message-display" data-inline-message-display role="button" tabindex="0" aria-label="Edit ${escapeHtml(label)}">${renderedEditableTemplate(template, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span></div>
      <div class="inline-message-source-shell">
        <div class="inline-message-highlight" data-inline-message-highlight aria-hidden="true">${editorMarkdown(template)}</div>
        <textarea class="inline-message-input" data-inline-message-input data-inline-template-field="${escapeHtml(field)}" data-inline-template-scope="${escapeHtml(scope)}"${containerData} maxlength="${maxLength}" rows="5" spellcheck="true" aria-label="${escapeHtml(label)} template">${escapeHtml(template)}</textarea>
      </div>
      <div class="inline-message-actions"><span>Markdown and variables update live.</span><button type="button" data-inline-message-done>Done</button></div>
    </div>`;
  }

export function renderComposerPanel() {
    const panel = state.levelingComposerPanel;
    const layout = state.config.leveling.announcements.layout;
    elements.levelingComposerPanel.hidden = !panel;
    elements.levelingComposerPanel.dataset.panel = panel;
    elements.levelingVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.levelingThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.levelingGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validMediaTemplate));
    if (!panel) return;
    if (panel === 'variables') {
      elements.levelingComposerPanel.innerHTML = `<div class="variable-guide">${LEVELING_VARIABLES.map(([token, meaning]) => `<button type="button" data-copy-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {user_profile}, paste an image URL, or upload any decodable image or GIF up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{user_profile} or https://example.com/thumbnail.png" data-leveling-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-leveling-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="{user_profile} or https://example.com/image.png" data-leveling-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-leveling-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 images with {user_profile}, a URL, or an upload.</small></div><div><button type="button" data-add-gallery-url>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-leveling-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

export function readMediaFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(new Error('Could not read that image.')));
      reader.readAsDataURL(file);
    });
  }

export async function uploadLevelingMedia(input) {
    const file = input.files?.[0];
    if (!file) return;
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
      const dataUrl = await readMediaFile(file);
      const result = await api(`/api/guilds/${state.guildId}/leveling-media`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex)
        ? state.config.leveling.announcements.additionalContainers[containerIndex]?.layout
        : state.config.leveling.announcements.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.levelingMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url;
        layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderMessagePreview();
      refreshDirty();
      showToast('Image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }

export async function uploadXpDropMedia(input) {
    const file = input.files?.[0];
    const index = Number(input.dataset.xpDropMedia);
    const crate = state.config?.leveling?.xpDrops?.crates?.[index];
    if (!file || !crate) return;
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
      const result = await api(`/api/guilds/${state.guildId}/leveling-media`, {
        method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }),
      });
      crate.imageUrl = result.url;
      renderXpDrops();
      refreshDirty();
      showToast('Crate image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }

export async function sendXpDropTest() {
    if (state.xpDropTesting || !state.config) return;
    const crateId = elements.xpDropTestCrate.value;
    if (!crateId) return showToast('Add a crate before sending a test.', 'error');
    state.xpDropTesting = true;
    renderXpDrops();
    try {
      const result = await api(`/api/guilds/${state.guildId}/xp-drops/test`, {
        method: 'POST',
        body: JSON.stringify({
          crateId,
          channelId: elements.xpDropTestChannel.value,
          xpDrops: state.config.leveling.xpDrops,
        }),
      });
      showToast(`Test crate sent to <#${result.channelId}>. Claims will not award XP.`);
    } catch (error) {
      showToast(error.message || 'The test crate could not be sent.', 'error');
    } finally {
      state.xpDropTesting = false;
      renderXpDrops();
    }
  }

export function toggleComposerPanel(panel) {
    state.levelingComposerPanel = state.levelingComposerPanel === panel ? '' : panel;
    renderComposerPanel();
  }

export function renderDiscordComposerPreview({ frame, preview, accentButton, accentInput, containerButton, layout, contentHtml, resolveMedia }) {
    const thumbnailUrl = layout.thumbnailEnabled ? resolveMedia(layout.thumbnailUrl) : '';
    const thumbnail = layout.thumbnailEnabled
      ? thumbnailUrl ? `<img class="discord-thumbnail" src="${escapeHtml(thumbnailUrl)}" alt="">` : '<div class="discord-thumbnail placeholder">IMG</div>'
      : '';
    const gallery = (layout.galleryUrls || []).map(resolveMedia).filter(Boolean);
    const galleryHtml = gallery.length ? `<div class="discord-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div>` : '';
    frame.classList.toggle('has-container', layout.container);
    frame.classList.toggle('no-container', !layout.container);
    frame.style.setProperty('--accent-color', layout.accentColor);
    accentButton.hidden = !layout.container;
    accentInput.value = layout.accentColor;
    containerButton.classList.toggle('active', layout.container);
    containerButton.textContent = layout.container ? 'Container on' : 'Container off';
    preview.innerHTML = `<div class="discord-section"><div>${contentHtml}</div>${thumbnail}</div>${galleryHtml}`;
  }

export function renderAdditionalContainerEditors({ root, containers, prefix, scope, previewValues, resolveMedia, maxLength }) {
    root.innerHTML = containers.map((container, containerIndex) => {
      const layout = container.layout;
      const thumbnailUrl = layout.thumbnailEnabled ? resolveMedia(layout.thumbnailUrl) : '';
      const thumbnail = layout.thumbnailEnabled
        ? thumbnailUrl ? `<img class="discord-thumbnail" src="${escapeHtml(thumbnailUrl)}" alt="">` : '<div class="discord-thumbnail placeholder">IMG</div>'
        : '';
      const gallery = layout.galleryUrls.map(resolveMedia).filter(Boolean);
      const galleryPreview = gallery.length ? `<div class="discord-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div>` : '';
      const galleryRows = layout.galleryUrls.map((url, mediaIndex) => `<div class="media-entry"><span>${mediaIndex + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="https://example.com/image.png" data-${prefix}-additional-gallery-url="${containerIndex}:${mediaIndex}"><label class="media-upload">Upload<input type="file" accept="image/*" data-${prefix}-media-upload="gallery" data-additional-container-index="${containerIndex}" data-media-index="${mediaIndex}"></label><button type="button" data-remove-${prefix}-additional-gallery="${containerIndex}:${mediaIndex}" aria-label="Remove gallery image ${mediaIndex + 1}">&times;</button></div>`).join('');
      const content = inlineTemplateEditor(container.content, 'content', scope, `container ${containerIndex + 2} message`, previewValues, maxLength, containerIndex);
      return `<section class="additional-container-card" style="--accent-color:${escapeHtml(layout.accentColor)}" data-additional-container-card="${containerIndex}">
        <header><strong>Container ${containerIndex + 2}</strong><div><label class="additional-container-color" title="Container color"><span>Accent</span><input type="color" value="${escapeHtml(layout.accentColor)}" data-${prefix}-additional-accent="${containerIndex}" aria-label="Container ${containerIndex + 2} color"></label><button type="button" data-remove-${prefix}-additional-container="${containerIndex}">Remove</button></div></header>
        <div class="discord-section"><div>${content}</div>${thumbnail}</div>${galleryPreview}
        <details class="additional-container-media"><summary>Images</summary><div class="media-entry"><span>Thumb</span><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="Image URL or supported variable" data-${prefix}-additional-thumbnail-url="${containerIndex}"><label class="media-upload">Upload<input type="file" accept="image/*" data-${prefix}-media-upload="thumbnail" data-additional-container-index="${containerIndex}"></label></div><div class="additional-gallery-head"><strong>Gallery</strong><button type="button" data-add-${prefix}-additional-gallery="${containerIndex}">+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-${prefix}-media-upload="gallery" data-additional-container-index="${containerIndex}"></label></div><div class="media-list">${galleryRows || '<p>No gallery images yet.</p>'}</div></details>
      </section>`;
    }).join('');
  }

export function renderMessagePreview(renderTools = true) {
    const announcements = state.config.leveling.announcements;
    const layout = announcements.layout;
    const text = inlineTemplateEditor(announcements.template);
    renderDiscordComposerPreview({
      frame: elements.levelingDiscordFrame, preview: elements.levelingMessagePreview,
      accentButton: elements.levelingAccentButton, accentInput: elements.levelingAccentColor,
      containerButton: elements.levelingContainerAdd, layout, contentHtml: text, resolveMedia: previewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.levelingAdditionalContainers,
      containers: announcements.additionalContainers,
      prefix: 'leveling', scope: 'announcements', previewValues: {}, resolveMedia: previewMediaUrl, maxLength: 3000,
    });
    elements.levelingAdditionalContainerAdd.disabled = announcements.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    if (renderTools) renderComposerPanel();
  }
