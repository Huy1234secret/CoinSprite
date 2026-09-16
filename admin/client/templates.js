import { previewIdentity } from './preview-data.js';
// templates: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { channelOptions, normalizeAdditionalContainersClient, renderCurvePreview, renderLevelingBoosts, renderLevelingChannels, renderLevelingRewards, renderXpDrops, roleColor, validHttpUrl } from './leveling.js';
import { GENERIC_TEMPLATE_VARIABLES, LEVELING_VARIABLES, MAX_ADDITIONAL_MESSAGE_CONTAINERS, MEMBER_MESSAGE_COMMON_VARIABLES, MEMBER_MESSAGE_EVENT_VARIABLES, TEMPLATE_ACTION_LABELS, TEMPLATE_ACTION_TYPES, TEMPLATE_CONTROL_DEFAULTS, TEMPLATE_LAYOUT_DEFAULTS, elements, state } from './state.js';
import { clientReactionId, normalizePickerEmoji, reactionRoleEmojiHtml, renderReactionRoleEditor } from './roles.js';
import { api, clone, confirmAction, escapeHtml, setView, showToast } from './session.js';
import { beginInlineMessageEdit, inlineTemplateEditor, interpolateTemplate, readMediaFile, renderAdditionalContainerEditors, renderDiscordComposerPreview, renderMessagePreview, syncInlineEditorVisual } from './composer.js';
import { refreshDirty } from './workspace.js';
import { currentMemberMessage, renderWelcomeMessagePreview } from './welcome.js';

export function genericTemplatePreviewValues() {
    return {
      ...previewIdentity(), channel: '{channel}', timestamp: '{timestamp}',
    };
  }

export function validTemplateMedia(value) {
    const text = String(value || '').trim().toLowerCase();
    return ['{server_icon}', '{user_avatar}', '{user_profile}'].includes(text) || validHttpUrl(text);
  }

export function normalizeTemplateLayoutClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      container: source.container !== false,
      accentColor: /^#[0-9a-f]{6}$/i.test(source.accentColor || '') ? source.accentColor.toLowerCase() : '#b9f547',
      thumbnailEnabled: source.thumbnailEnabled === true,
      thumbnailUrl: validTemplateMedia(source.thumbnailUrl) ? String(source.thumbnailUrl).trim() : '',
      galleryUrls: [...new Set((Array.isArray(source.galleryUrls) ? source.galleryUrls : [])
        .map((url) => String(url).trim()).filter(validTemplateMedia))].slice(0, 10),
    };
  }

export function normalizeTemplateActionClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const type = TEMPLATE_ACTION_TYPES.includes(source.type) ? source.type : 'send_message';
    return ['give_role', 'remove_role'].includes(type)
      ? { type, roleId: /^\d{16,20}$/.test(String(source.roleId || '')) ? String(source.roleId) : '' }
      : { type, templateId: /^[a-zA-Z0-9_-]{8,64}$/.test(String(source.templateId || '')) ? String(source.templateId) : '' };
  }

export function normalizeTemplateControlsClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      type: ['button', 'dropdown'].includes(source.type) ? source.type : 'none',
      buttons: (Array.isArray(source.buttons) ? source.buttons : []).slice(0, 25).map((button, index) => ({
        id: String(button?.id || clientReactionId('control')),
        emoji: normalizePickerEmoji(button?.emoji),
        label: String(button?.label || `Button ${index + 1}`).trim().slice(0, 80) || `Button ${index + 1}`,
        style: ['Primary', 'Secondary', 'Success', 'Danger'].includes(button?.style) ? button.style : 'Secondary',
        sortOrder: index,
        action: normalizeTemplateActionClient(button?.action),
      })),
      dropdowns: (Array.isArray(source.dropdowns) ? source.dropdowns : []).slice(0, 5).map((dropdown, dropdownIndex) => ({
        id: String(dropdown?.id || clientReactionId('dropdown')),
        placeholder: String(dropdown?.placeholder || `Choose an option ${dropdownIndex + 1}`).trim().slice(0, 150) || `Choose an option ${dropdownIndex + 1}`,
        allowMultiple: dropdown?.allowMultiple === true,
        sortOrder: dropdownIndex,
        options: (Array.isArray(dropdown?.options) ? dropdown.options : []).slice(0, 25).map((option, optionIndex) => ({
          id: String(option?.id || clientReactionId('control')),
          emoji: normalizePickerEmoji(option?.emoji),
          title: String(option?.title || `Option ${optionIndex + 1}`).trim().slice(0, 100) || `Option ${optionIndex + 1}`,
          description: String(option?.description || '').trim().slice(0, 100),
          sortOrder: optionIndex,
          action: normalizeTemplateActionClient(option?.action),
        })),
      })),
    };
  }

export function normalizeTemplateControlsV2Client(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const dropdown = source.dropdown && typeof source.dropdown === 'object' && !Array.isArray(source.dropdown) ? source.dropdown : {};
    return normalizeTemplateControlsClient({
      type: source.type,
      buttons: source.buttons,
      dropdowns: [{ ...dropdown, id: clientReactionId('dropdown'), sortOrder: 0 }],
    });
  }

export function normalizeMessageTemplatesClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const folders = (Array.isArray(source.folders) ? source.folders : []).map((folder) => ({
      id: String(folder.id || ''), name: String(folder.name || 'Folder').trim().slice(0, 80),
      createdAt: String(folder.createdAt || ''), updatedAt: String(folder.updatedAt || ''),
    })).filter((folder) => folder.id);
    const folderIds = new Set(folders.map((folder) => folder.id));
    const items = (Array.isArray(source.items) ? source.items : []).map((item) => ({
      id: String(item.id || ''), folderId: folderIds.has(String(item.folderId || '')) ? String(item.folderId) : null,
      name: String(item.name || 'Template').trim().slice(0, 80), description: String(item.description || '').trim().slice(0, 500),
      version: 3, content: String(item.content || '').slice(0, 4000), layout: normalizeTemplateLayoutClient(item.layout),
      additionalContainers: normalizeAdditionalContainersClient(item.additionalContainers, normalizeTemplateLayoutClient, 4000),
      controls: Number(item.version) === 1
        ? clone(TEMPLATE_CONTROL_DEFAULTS)
        : Number(item.version) === 2 ? normalizeTemplateControlsV2Client(item.controls) : normalizeTemplateControlsClient(item.controls),
      defaultChannelId: String(item.defaultChannelId || ''), enabled: item.enabled !== false,
      createdAt: String(item.createdAt || ''), updatedAt: String(item.updatedAt || ''),
    })).filter((item) => item.id);
    return { folders, items };
  }

export function templateDocument(draft = state.templateDraft) {
    return {
      version: 3,
      content: String(draft?.content || '').slice(0, 4000),
      layout: normalizeTemplateLayoutClient(draft?.layout),
      additionalContainers: normalizeAdditionalContainersClient(draft?.additionalContainers, normalizeTemplateLayoutClient, 4000),
      controls: normalizeTemplateControlsClient(draft?.controls),
    };
  }

export function parseTemplateLayoutClient(layout, label = 'layout') {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error(`${label} must be an object.`);
    const unknownLayout = Object.keys(layout).filter((key) => !['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'].includes(key));
    if (unknownLayout.length) throw new Error(`Unknown ${label} field${unknownLayout.length === 1 ? '' : 's'}: ${unknownLayout.join(', ')}.`);
    if (typeof layout.container !== 'boolean') throw new Error(`${label}.container must be true or false.`);
    if (typeof layout.thumbnailEnabled !== 'boolean') throw new Error(`${label}.thumbnailEnabled must be true or false.`);
    if (!/^#[0-9a-f]{6}$/i.test(String(layout.accentColor || ''))) throw new Error(`${label}.accentColor must be a six-digit hex color.`);
    if (!Array.isArray(layout.galleryUrls)) throw new Error(`${label}.galleryUrls must be an array.`);
    if (layout.galleryUrls.length > 10) throw new Error('A gallery supports up to 10 images.');
    if (layout.thumbnailUrl && !validTemplateMedia(layout.thumbnailUrl)) throw new Error(`${label} thumbnail must be an HTTP/HTTPS URL or a supported media variable.`);
    layout.galleryUrls.forEach((url, index) => {
      if (!validTemplateMedia(url)) throw new Error(`${label} gallery image ${index + 1} must be an HTTP/HTTPS URL or a supported media variable.`);
    });
    return normalizeTemplateLayoutClient(layout);
  }

export function assertTemplateJsonFields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new Error(`Unknown ${label} field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
  }

export function parseTemplateEmojiClient(value, label) {
    assertTemplateJsonFields(value, ['id', 'name', 'animated', 'source'], label);
    if (value.id && !/^\d{16,20}$/.test(String(value.id))) throw new Error(`${label}.id must be a Discord ID.`);
    if (typeof value.name !== 'string') throw new Error(`${label}.name must be a string.`);
    if (typeof value.animated !== 'boolean') throw new Error(`${label}.animated must be true or false.`);
    if (!['default', 'group', 'bot'].includes(value.source)) throw new Error(`${label}.source is invalid.`);
    return normalizePickerEmoji(value);
  }

export function parseTemplateActionClient(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !TEMPLATE_ACTION_TYPES.includes(value.type)) throw new Error(`${label}.type is invalid.`);
    const templateAction = ['send_message', 'dm_message'].includes(value.type);
    assertTemplateJsonFields(value, templateAction ? ['type', 'templateId'] : ['type', 'roleId'], label);
    if (templateAction) {
      const templateId = String(value.templateId || '');
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(templateId)) throw new Error(`${label}.templateId is invalid.`);
      const stored = currentStoredTemplate();
      const preservedMissing = [
        ...(stored?.controls?.buttons || []),
        ...(stored?.controls?.dropdowns || []).flatMap((dropdown) => dropdown.options || []),
      ]
        .some((entry) => ['send_message', 'dm_message'].includes(entry.action?.type) && entry.action.templateId === templateId);
      if (!state.messageTemplates.items.some((item) => item.id === templateId) && !preservedMissing) throw new Error(`${label} must reference a Message Template in this server.`);
      return { type: value.type, templateId };
    }
    if (!/^\d{16,20}$/.test(String(value.roleId || ''))) throw new Error(`${label}.roleId must be a Discord ID.`);
    return { type: value.type, roleId: String(value.roleId) };
  }

export function parseTemplateControlsClient(value) {
    assertTemplateJsonFields(value, ['type', 'buttons', 'dropdowns'], 'controls');
    if (!['none', 'button', 'dropdown'].includes(value.type)) throw new Error('controls.type must be none, button, or dropdown.');
    if (!Array.isArray(value.buttons) || value.buttons.length > 25) throw new Error('controls.buttons must be an array with at most 25 entries.');
    const buttonIds = new Set();
    const buttons = value.buttons.map((button, index) => {
      const label = `controls.buttons[${index}]`;
      assertTemplateJsonFields(button, ['id', 'emoji', 'label', 'style', 'sortOrder', 'action'], label);
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(button.id || '')) || buttonIds.has(button.id)) throw new Error(`${label}.id must be unique and stable.`);
      buttonIds.add(button.id);
      if (typeof button.label !== 'string' || !button.label.trim() || button.label.trim().length > 80) throw new Error(`${label}.label must be between 1 and 80 characters.`);
      if (!['Primary', 'Secondary', 'Success', 'Danger'].includes(button.style)) throw new Error(`${label}.style is unsupported.`);
      if (!Number.isInteger(button.sortOrder) || button.sortOrder < 0) throw new Error(`${label}.sortOrder must be a non-negative integer.`);
      return { id: button.id, emoji: parseTemplateEmojiClient(button.emoji, `${label}.emoji`), label: button.label.trim(), style: button.style, sortOrder: button.sortOrder, action: parseTemplateActionClient(button.action, `${label}.action`) };
    }).sort((left, right) => left.sortOrder - right.sortOrder).map((button, index) => ({ ...button, sortOrder: index }));
    if (!Array.isArray(value.dropdowns) || value.dropdowns.length > 5) throw new Error('controls.dropdowns must be an array with at most 5 entries.');
    const dropdownIds = new Set();
    const dropdowns = value.dropdowns.map((dropdown, dropdownIndex) => {
      const dropdownLabel = `controls.dropdowns[${dropdownIndex}]`;
      assertTemplateJsonFields(dropdown, ['id', 'placeholder', 'allowMultiple', 'sortOrder', 'options'], dropdownLabel);
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(dropdown.id || '')) || dropdownIds.has(dropdown.id)) throw new Error(`${dropdownLabel}.id must be unique and stable.`);
      dropdownIds.add(dropdown.id);
      if (typeof dropdown.placeholder !== 'string' || !dropdown.placeholder.trim() || dropdown.placeholder.trim().length > 150) throw new Error(`${dropdownLabel}.placeholder must be between 1 and 150 characters.`);
      if (typeof dropdown.allowMultiple !== 'boolean') throw new Error(`${dropdownLabel}.allowMultiple must be true or false.`);
      if (!Number.isInteger(dropdown.sortOrder) || dropdown.sortOrder < 0) throw new Error(`${dropdownLabel}.sortOrder must be a non-negative integer.`);
      if (!Array.isArray(dropdown.options) || dropdown.options.length > 25) throw new Error(`${dropdownLabel}.options must be an array with at most 25 entries.`);
      const optionIds = new Set();
      const options = dropdown.options.map((option, optionIndex) => {
        const label = `${dropdownLabel}.options[${optionIndex}]`;
        assertTemplateJsonFields(option, ['id', 'emoji', 'title', 'description', 'sortOrder', 'action'], label);
        if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(option.id || '')) || optionIds.has(option.id)) throw new Error(`${label}.id must be unique and stable.`);
        optionIds.add(option.id);
        if (typeof option.title !== 'string' || !option.title.trim() || option.title.trim().length > 100) throw new Error(`${label}.title must be between 1 and 100 characters.`);
        if (typeof option.description !== 'string' || option.description.trim().length > 100) throw new Error(`${label}.description must be 100 characters or fewer.`);
        if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) throw new Error(`${label}.sortOrder must be a non-negative integer.`);
        return { id: option.id, emoji: parseTemplateEmojiClient(option.emoji, `${label}.emoji`), title: option.title.trim(), description: option.description.trim(), sortOrder: option.sortOrder, action: parseTemplateActionClient(option.action, `${label}.action`) };
      }).sort((left, right) => left.sortOrder - right.sortOrder).map((option, index) => ({ ...option, sortOrder: index }));
      return { id: dropdown.id, placeholder: dropdown.placeholder.trim(), allowMultiple: dropdown.allowMultiple, sortOrder: dropdown.sortOrder, options };
    }).sort((left, right) => left.sortOrder - right.sortOrder).map((dropdown, index) => ({ ...dropdown, sortOrder: index }));
    return { type: value.type, buttons, dropdowns };
  }

export function parseTemplateControlsV2Client(value) {
    assertTemplateJsonFields(value, ['type', 'buttons', 'dropdown'], 'controls');
    assertTemplateJsonFields(value.dropdown, ['placeholder', 'allowMultiple', 'options'], 'controls.dropdown');
    return parseTemplateControlsClient({
      type: value.type,
      buttons: value.buttons,
      dropdowns: [{
        id: clientReactionId('dropdown'),
        placeholder: value.dropdown.placeholder,
        allowMultiple: value.dropdown.allowMultiple,
        sortOrder: 0,
        options: value.dropdown.options,
      }],
    });
  }

export function parseTemplateJsonText(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Template JSON must be an object.');
    const version = Number(parsed.version);
    const unknown = Object.keys(parsed).filter((key) => !(version === 1
      ? ['version', 'content', 'layout', 'additionalContainers']
      : ['version', 'content', 'layout', 'additionalContainers', 'controls']).includes(key));
    if (unknown.length) throw new Error(`Unknown template field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
    if (![1, 2, 3].includes(version)) throw new Error('Template JSON version must be 1, 2, or 3.');
    if (typeof parsed.content !== 'string') throw new Error('content must be a string.');
    if (parsed.content.length > 4000) throw new Error('content must be 4000 characters or fewer.');
    if ((parsed.content.match(/\{separator\}/gi) || []).length > 4) throw new Error('Templates support up to 4 dividers.');
    const layout = parseTemplateLayoutClient(parsed.layout);
    const additional = parsed.additionalContainers === undefined ? [] : parsed.additionalContainers;
    if (!Array.isArray(additional)) throw new Error('additionalContainers must be an array.');
    if (additional.length > MAX_ADDITIONAL_MESSAGE_CONTAINERS) throw new Error(`Templates support up to ${MAX_ADDITIONAL_MESSAGE_CONTAINERS} additional containers.`);
    const additionalContainers = additional.map((container, index) => {
      if (!container || typeof container !== 'object' || Array.isArray(container)) throw new Error(`Additional container ${index + 1} must be an object.`);
      const unknownContainer = Object.keys(container).filter((key) => !['content', 'layout'].includes(key));
      if (unknownContainer.length) throw new Error(`Unknown additional container ${index + 1} field${unknownContainer.length === 1 ? '' : 's'}: ${unknownContainer.join(', ')}.`);
      if (typeof container.content !== 'string') throw new Error(`Additional container ${index + 1} content must be a string.`);
      if (container.content.length > 4000) throw new Error(`Additional container ${index + 1} content must be 4000 characters or fewer.`);
      if ((container.content.match(/\{separator\}/gi) || []).length > 4) throw new Error(`Additional container ${index + 1} supports up to 4 dividers.`);
      return { content: container.content, layout: { ...parseTemplateLayoutClient(container.layout, `additionalContainers[${index}].layout`), container: true } };
    });
    const controls = version === 1
      ? clone(TEMPLATE_CONTROL_DEFAULTS)
      : version === 2 ? parseTemplateControlsV2Client(parsed.controls) : parseTemplateControlsClient(parsed.controls);
    return { version: 3, content: parsed.content, layout, additionalContainers, controls };
  }

export function templateVariableNames(item = state.templateDraft) {
    const found = new Set();
    const values = [
      item?.content, item?.layout?.thumbnailUrl, ...(item?.layout?.galleryUrls || []),
      ...(item?.additionalContainers || []).flatMap((container) => [container.content, container.layout?.thumbnailUrl, ...(container.layout?.galleryUrls || [])]),
    ];
    for (const value of values) String(value || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => {
      found.add(key.toLowerCase()); return token;
    });
    return [...found];
  }

export function templateSnapshot() {
    return state.templateDraft ? JSON.stringify({
      name: state.templateDraft.name, description: state.templateDraft.description,
      folderId: state.templateDraft.folderId, defaultChannelId: state.templateDraft.defaultChannelId,
      enabled: state.templateDraft.enabled, ...templateDocument(),
    }) : '';
  }

export function templateIsDirty() {
    return Boolean(state.templateDraft && templateSnapshot() !== state.templateSavedSnapshot);
  }

export function currentStoredTemplate() {
    return state.messageTemplates.items.find((item) => item.id === state.templateSelectedId) || null;
  }

export function formatTemplateDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
  }

export function templateFolderName(folderId) {
    return state.messageTemplates.folders.find((folder) => folder.id === folderId)?.name || 'Unfiled';
  }

export function updateTemplateDeepLink() {
    if (!state.guildId || state.currentView !== 'message-templates') return;
    const params = new URLSearchParams({ guild: state.guildId, view: 'message-templates' });
    if (state.templateSelectedId) params.set('template', state.templateSelectedId);
    const linkedFolder = state.templateDraft?.folderId || (!['all', 'unfiled'].includes(state.templateFolderId) ? state.templateFolderId : '');
    if (linkedFolder) params.set('folder', linkedFolder);
    history.replaceState(null, '', `/admin?${params}`);
    if (state.templateDraft) elements.templateShareLink.value = `${location.origin}/admin?${params}`;
  }

export function renderTemplateFolders() {
    const total = state.messageTemplates.items.length;
    const unfiled = state.messageTemplates.items.filter((item) => !item.folderId).length;
    elements.templateTotalCount.textContent = `${total} template${total === 1 ? '' : 's'}`;
    const special = [
      ['all', '📚', 'All templates', total], ['unfiled', '📁', 'Unfiled', unfiled],
    ];
    const rows = special.map(([id, icon, name, count]) => `<div class="template-folder-row${state.templateFolderId === id ? ' active' : ''}"><button type="button" data-template-folder="${id}"><i>${icon}</i><span>${name}</span><b>${count}</b></button></div>`);
    for (const folder of state.messageTemplates.folders) {
      const count = state.messageTemplates.items.filter((item) => item.folderId === folder.id).length;
      rows.push(`<div class="template-folder-row${state.templateFolderId === folder.id ? ' active' : ''}"><button type="button" data-template-folder="${escapeHtml(folder.id)}"><i>□</i><span>${escapeHtml(folder.name)}</span><b>${count}</b></button><span class="template-folder-actions"><button type="button" data-template-folder-rename="${escapeHtml(folder.id)}" aria-label="Rename ${escapeHtml(folder.name)}" title="Rename folder">✎</button><button type="button" data-template-folder-delete="${escapeHtml(folder.id)}" aria-label="Delete ${escapeHtml(folder.name)}" title="Delete folder">×</button></span></div>`);
    }
    elements.templateFolderList.innerHTML = rows.join('');
  }

export function visibleTemplates(folderId = state.templateFolderId) {
    const search = elements.templateSearch.value.trim().toLowerCase();
    return state.messageTemplates.items.filter((item) => {
      const inFolder = folderId === 'all' || (folderId === 'unfiled' ? !item.folderId : item.folderId === folderId);
      return inFolder && (!search || item.name.toLowerCase().includes(search));
    }).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt) || left.name.localeCompare(right.name));
  }

export function renderTemplateList() {
    const items = visibleTemplates();
    elements.templateList.innerHTML = items.length ? items.map((item) => `<button class="template-list-item${item.id === state.templateSelectedId ? ' active' : ''}${item.enabled ? '' : ' is-disabled'}" type="button" data-template-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><i aria-label="${item.enabled ? 'Enabled' : 'Disabled'}"></i></span><small>${escapeHtml(templateFolderName(item.folderId))} · Updated ${escapeHtml(formatTemplateDate(item.updatedAt))}</small></button>`).join('') : `<div class="template-list-empty">${state.messageTemplates.items.length ? 'No templates match this collection or search.' : 'No templates yet. Create a blank template to get started.'}</div>`;
  }

export function templatePreviewMediaUrl(value) {
    const resolved = interpolateTemplate(value, genericTemplatePreviewValues());
    return validHttpUrl(resolved) ? resolved.trim() : '';
  }

export function templateControlEntries(draft = state.templateDraft) {
    return draft?.controls?.type === 'dropdown' ? draft.controls.dropdowns : draft?.controls?.buttons || [];
  }

export function templateActionStatus(action) {
    const label = TEMPLATE_ACTION_LABELS[action?.type] || 'Unknown action';
    if (['send_message', 'dm_message'].includes(action?.type)) {
      if (!action.templateId) return { complete: false, summary: `${label}: Choose a template` };
      const target = state.messageTemplates.items.find((item) => item.id === action.templateId);
      if (!target) return { complete: false, summary: `${label}: Missing template` };
      if (!target.enabled) return { complete: false, summary: `${label}: ${target.name} is disabled` };
      return { complete: true, summary: `${label}: ${target.name}` };
    }
    if (!action?.roleId) return { complete: false, summary: `${label}: Choose a role` };
    const role = (state.directory.roles || []).find((item) => item.id === action.roleId);
    if (!role) return { complete: false, summary: `${label}: Missing role` };
    if (role.managed || role.administrator || role.editable === false || role.belowBot === false) return { complete: false, summary: `${label}: @${role.name} is not manageable` };
    return { complete: true, summary: `${label}: @${role.name}` };
  }

export function templateActionOptions(selected) {
    return TEMPLATE_ACTION_TYPES.map((type) => `<option value="${type}"${type === selected ? ' selected' : ''}>${TEMPLATE_ACTION_LABELS[type]}</option>`).join('');
  }

export function templateDropdownAt(id) {
    const dropdowns = state.templateDraft?.controls?.dropdowns || [];
    const dropdownIndex = dropdowns.findIndex((entry) => entry.id === id);
    return dropdownIndex >= 0 ? { dropdown: dropdowns[dropdownIndex], dropdownIndex, dropdowns } : null;
  }

export function newTemplateOption(index = 0, title = `Option ${index + 1}`) {
    return {
      id: clientReactionId('control'), emoji: { id: '', name: '✨', animated: false, source: 'default' },
      title, description: '', sortOrder: index, action: { type: 'send_message', templateId: '' },
    };
  }

export function newTemplateDropdown(index = 0) {
    return {
      id: clientReactionId('dropdown'), placeholder: `Choose an option${index ? ` ${index + 1}` : ''}`,
      allowMultiple: false, sortOrder: index, options: [newTemplateOption()],
    };
  }

export function duplicateTemplateOptionTitle(dropdown, sourceTitle) {
    const base = `${String(sourceTitle || 'Option').trim() || 'Option'} copy`.slice(0, 100);
    const used = new Set(dropdown.options.map((option) => String(option.title || '').trim().toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let suffix = 2;
    while (suffix < 100) {
      const ending = ` ${suffix++}`;
      const candidate = `${base.slice(0, 100 - ending.length)}${ending}`;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `Option ${clientReactionId('copy').slice(-8)}`;
  }

export function templateOptionValidation(dropdown, option) {
    const title = String(option?.title || '').trim();
    if (!title) return 'Title is required.';
    if (title.length > 100) return 'Title must be 100 characters or fewer.';
    const duplicate = dropdown.options.some((entry) => entry.id !== option.id && String(entry.title || '').trim().toLocaleLowerCase() === title.toLocaleLowerCase());
    if (duplicate) return 'Use a unique title in this dropdown.';
    if (String(option?.description || '').trim().length > 100) return 'Description must be 100 characters or fewer.';
    return '';
  }

export function templateDropdownValidation(dropdown) {
    if (!String(dropdown?.placeholder || '').trim()) return 'Placeholder is required.';
    if (String(dropdown.placeholder).trim().length > 150) return 'Placeholder must be 150 characters or fewer.';
    if (!dropdown.options.length) return 'Add at least one option.';
    return '';
  }

export function templateControlsValidationErrors() {
    const draft = state.templateDraft;
    if (!draft || draft.controls.type !== 'dropdown') return [];
    if (!draft.controls.dropdowns.length) return ['Add at least one dropdown.'];
    return draft.controls.dropdowns.flatMap((dropdown) => [
      templateDropdownValidation(dropdown),
      ...dropdown.options.map((option) => templateOptionValidation(dropdown, option)),
    ]).filter(Boolean);
  }

export function refreshTemplateControlValidation() {
    state.templateControlsValid = templateControlsValidationErrors().length === 0;
    for (const card of elements.templateControls.querySelectorAll('[data-template-dropdown-card]')) {
      const resolved = templateDropdownAt(card.dataset.templateDropdownCard);
      if (!resolved) continue;
      const cardError = templateDropdownValidation(resolved.dropdown);
      card.classList.toggle('incomplete', Boolean(cardError) || resolved.dropdown.options.some((option) => templateOptionValidation(resolved.dropdown, option)));
      const message = card.querySelector('.template-dropdown-error');
      if (message) { message.textContent = cardError; message.hidden = !cardError; }
      const placeholder = card.querySelector('[data-template-dropdown-placeholder]');
      placeholder?.setAttribute('aria-invalid', String(!String(resolved.dropdown.placeholder || '').trim()));
    }
    for (const row of elements.templateControls.querySelectorAll('[data-template-control-row^="option:"]')) {
      const target = templateControlAt(row.dataset.templateControlRow);
      if (!target?.dropdown) continue;
      const validation = templateOptionValidation(target.dropdown, target.entry);
      row.classList.toggle('incomplete', Boolean(validation) || !templateActionStatus(target.entry.action).complete);
      const message = row.querySelector('.template-option-validation');
      if (message) { message.textContent = validation; message.hidden = !validation; }
      const title = row.querySelector('[data-template-option-title]');
      title?.setAttribute('aria-invalid', String(Boolean(validation)));
    }
  }

export function renderTemplateControlPreview() {
    const draft = state.templateDraft;
    if (!draft) return;
    if (draft.controls.type === 'dropdown') {
      elements.templateControlPreview.innerHTML = draft.controls.dropdowns.map((dropdown) => {
        const count = dropdown.options.length;
        return `<div class="rr-preview-select">${escapeHtml(dropdown.placeholder)} · ${count} option${count === 1 ? '' : 's'}${dropdown.allowMultiple ? ' · Multiple' : ''}</div>`;
      }).join('');
      return;
    }
    elements.templateControlPreview.innerHTML = draft.controls.type === 'button'
      ? draft.controls.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('')
      : '';
  }

export function renderTemplateControls() {
    const draft = state.templateDraft;
    if (!draft) return;
    document.querySelectorAll('[data-template-control-mode]').forEach((button) => {
      const active = button.dataset.templateControlMode === draft.controls.type;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.templateAddControl.hidden = draft.controls.type === 'none';
    elements.templateAddControl.textContent = draft.controls.type === 'dropdown' ? '+ Add dropdown' : '+ Add button';
    elements.templateAddControl.disabled = templateControlEntries().length >= (draft.controls.type === 'dropdown' ? 5 : 25);
    if (draft.controls.type === 'none') {
      elements.templateControls.innerHTML = '<p class="template-control-empty">This template has no interactive controls.</p>';
      state.templateControlsValid = true;
      return;
    }
    if (draft.controls.type === 'button') {
      const rows = draft.controls.buttons.map((button, index) => {
        const status = templateActionStatus(button.action);
        const spec = `button:${button.id}`;
        return `<article class="template-control-row${status.complete ? '' : ' incomplete'}" data-template-control-row="${spec}"><button class="rr-emoji-field" type="button" data-template-control-emoji="${spec}" aria-label="Choose emoji for ${escapeHtml(button.label)}">${reactionRoleEmojiHtml(button.emoji)}</button><label class="template-control-primary">Label<input type="text" maxlength="80" value="${escapeHtml(button.label)}" data-template-button-label="${escapeHtml(button.id)}"></label><label class="template-control-secondary">Style<select data-template-button-style="${escapeHtml(button.id)}">${['Primary','Secondary','Success','Danger'].map((style) => `<option${style === button.style ? ' selected' : ''}>${style}</option>`).join('')}</select></label><label class="template-control-action">Action<select data-template-control-action="${spec}">${templateActionOptions(button.action.type)}</select></label><button class="template-action-configure" type="button" data-template-configure-action="${spec}" aria-label="Configure action for ${escapeHtml(button.label)}" title="Configure action">⚙️</button><span class="template-action-summary" role="status">${escapeHtml(status.summary)}</span><div class="rr-row-actions"><button type="button" data-template-control-move="${spec}:-1" aria-label="Move ${escapeHtml(button.label)} up" title="Move up"${index === 0 ? ' disabled' : ''}>⬆️</button><button type="button" data-template-control-move="${spec}:1" aria-label="Move ${escapeHtml(button.label)} down" title="Move down"${index === draft.controls.buttons.length - 1 ? ' disabled' : ''}>⬇️</button><button type="button" data-template-control-remove="${spec}" aria-label="Delete ${escapeHtml(button.label)}" title="Delete button">🗑️</button></div></article>`;
      }).join('');
      elements.templateControls.innerHTML = `<div class="template-control-list">${rows || '<p class="template-control-empty">Add a button to configure its action.</p>'}</div>`;
      state.templateControlsValid = true;
      return;
    }
    elements.templateControls.innerHTML = draft.controls.dropdowns.length ? draft.controls.dropdowns.map((dropdown, dropdownIndex) => {
      const rows = dropdown.options.map((option, optionIndex) => {
        const status = templateActionStatus(option.action);
        const spec = `option:${dropdown.id}:${option.id}`;
        const validation = templateOptionValidation(dropdown, option);
        const validationId = `template-option-error-${option.id}`;
        return `<article class="template-control-row dropdown${status.complete && !validation ? '' : ' incomplete'}" data-template-control-row="${spec}"><button class="rr-emoji-field" type="button" data-template-control-emoji="${spec}" aria-label="Choose emoji for ${escapeHtml(option.title || 'option')}">${reactionRoleEmojiHtml(option.emoji)}</button><label class="template-control-primary">Title<input type="text" maxlength="100" value="${escapeHtml(option.title)}" data-template-option-title="${escapeHtml(dropdown.id)}:${escapeHtml(option.id)}" aria-describedby="${validationId}" aria-invalid="${Boolean(validation)}"></label><label class="template-control-secondary">Description<input type="text" maxlength="100" value="${escapeHtml(option.description)}" data-template-option-description="${escapeHtml(dropdown.id)}:${escapeHtml(option.id)}"></label><label class="template-control-action">Action<select data-template-control-action="${spec}">${templateActionOptions(option.action.type)}</select></label><button class="template-action-configure" type="button" data-template-configure-action="${spec}" aria-label="Configure action for ${escapeHtml(option.title || 'option')}" title="Configure action">⚙️</button><span class="template-action-summary" role="status">${escapeHtml(status.summary)}</span><span class="template-option-validation" id="${validationId}"${validation ? '' : ' hidden'}>${escapeHtml(validation)}</span><div class="rr-row-actions template-option-actions"><button type="button" data-template-control-move="${spec}:-1" aria-label="Move ${escapeHtml(option.title || 'option')} up" title="Move up"${optionIndex === 0 ? ' disabled' : ''}>⬆️</button><button type="button" data-template-control-move="${spec}:1" aria-label="Move ${escapeHtml(option.title || 'option')} down" title="Move down"${optionIndex === dropdown.options.length - 1 ? ' disabled' : ''}>⬇️</button><button type="button" data-template-control-duplicate="${spec}" aria-label="Duplicate ${escapeHtml(option.title || 'option')}" title="Duplicate option">📋</button><button type="button" data-template-control-remove="${spec}" aria-label="Delete ${escapeHtml(option.title || 'option')}" title="Delete option">🗑️</button></div></article>`;
      }).join('');
      const optionCount = `${dropdown.options.length} option${dropdown.options.length === 1 ? '' : 's'}`;
      const dropdownError = templateDropdownValidation(dropdown);
      return `<section class="template-dropdown-card${dropdownError || dropdown.options.some((option) => templateOptionValidation(dropdown, option)) ? ' incomplete' : ''}" data-template-dropdown-card="${escapeHtml(dropdown.id)}"><header><div class="template-dropdown-title"><strong>Dropdown ${dropdownIndex + 1}</strong><span class="template-dropdown-count">${optionCount}</span></div><div class="template-dropdown-actions"><button type="button" class="template-dropdown-add-option" data-template-dropdown-add-option="${escapeHtml(dropdown.id)}"${dropdown.options.length >= 25 ? ' disabled' : ''}>+ Add option</button><div class="rr-row-actions"><button type="button" data-template-dropdown-move="${escapeHtml(dropdown.id)}:-1" aria-label="Move dropdown ${dropdownIndex + 1} up" title="Move dropdown up"${dropdownIndex === 0 ? ' disabled' : ''}>⬆️</button><button type="button" data-template-dropdown-move="${escapeHtml(dropdown.id)}:1" aria-label="Move dropdown ${dropdownIndex + 1} down" title="Move dropdown down"${dropdownIndex === draft.controls.dropdowns.length - 1 ? ' disabled' : ''}>⬇️</button><button type="button" data-template-dropdown-remove="${escapeHtml(dropdown.id)}" aria-label="Delete dropdown ${dropdownIndex + 1}" title="Delete dropdown">🗑️</button></div></div></header><div class="template-dropdown-settings"><label>Placeholder<input type="text" maxlength="150" value="${escapeHtml(dropdown.placeholder)}" data-template-dropdown-placeholder="${escapeHtml(dropdown.id)}" aria-invalid="${!String(dropdown.placeholder || '').trim()}"></label><label class="rr-allow-multiple"><input type="checkbox" data-template-dropdown-multiple="${escapeHtml(dropdown.id)}"${dropdown.allowMultiple ? ' checked' : ''}><span><strong>Allow multiple selections</strong><small>Only selected options in this dropdown run their configured actions.</small></span></label></div><p class="template-dropdown-error"${dropdownError ? '' : ' hidden'}>${escapeHtml(dropdownError)}</p><div class="template-control-list">${rows || '<p class="template-control-empty">Add an option to configure this dropdown.</p>'}</div></section>`;
    }).join('') : '<p class="template-control-empty">Add a dropdown to configure its options and actions.</p>';
    refreshTemplateControlValidation();
  }

export function syncTemplateJson(force = false) {
    if (!state.templateDraft || (!force && document.activeElement === elements.templateJsonEditor)) return;
    elements.templateJsonEditor.value = JSON.stringify(templateDocument(), null, 2);
    state.templateJsonValid = true;
    elements.templateJsonError.hidden = true;
  }

export function resolvedTemplatePayloadPreview() {
    if (!state.templateDraft) return {};
    const values = genericTemplatePreviewValues();
    const buildContainer = (content, layout, forceContainer = false) => {
      const inner = interpolateTemplate(content, values).split(/\{separator\}/gi).slice(0, 5).flatMap((part, index) => {
        const result = [];
        if (index) result.push({ type: 14, divider: true, spacing: 1 });
        if (part.trim()) result.push({ type: 10, content: part.trim() });
        return result;
      });
      if (!inner.length) inner.push({ type: 10, content: '-# Message template' });
      const thumbnailUrl = layout.thumbnailEnabled ? templatePreviewMediaUrl(layout.thumbnailUrl) : '';
      if (thumbnailUrl) {
        const firstTextIndex = inner.findIndex((component) => component.type === 10);
        if (firstTextIndex >= 0) {
          const firstText = inner[firstTextIndex];
          inner.splice(firstTextIndex, 1, { type: 9, components: [firstText], accessory: { type: 11, media: { url: thumbnailUrl } } });
        }
      }
      const gallery = layout.galleryUrls.map(templatePreviewMediaUrl).filter(Boolean);
      if (gallery.length) inner.push({ type: 12, items: gallery.map((url) => ({ media: { url } })) });
      return layout.container || forceContainer
        ? [{ type: 17, accent_color: Number.parseInt(layout.accentColor.slice(1), 16), components: inner }]
        : inner;
    };
    const components = buildContainer(state.templateDraft.content, state.templateDraft.layout);
    for (const container of state.templateDraft.additionalContainers) components.push(...buildContainer(container.content, container.layout, true));
    const previewId = (kind, id = '') => `mt:${String(state.guildId || 'guild').slice(-20)}:${kind}:${String(state.templateDraft.id || 'template').slice(-20)}${id ? `:${String(id).slice(-20)}` : ''}`.slice(0, 100);
    const payloadEmoji = (value) => {
      const emoji = normalizePickerEmoji(value);
      if (!emoji.name) return undefined;
      return emoji.id ? { id: emoji.id, name: emoji.name, animated: emoji.animated } : { name: emoji.name };
    };
    if (state.templateDraft.controls.type === 'button') {
      const buttons = state.templateDraft.controls.buttons.map((button) => {
        const component = { type: 2, style: { Primary: 1, Secondary: 2, Success: 3, Danger: 4 }[button.style], custom_id: previewId('b', button.id), label: button.label };
        const emoji = payloadEmoji(button.emoji); if (emoji) component.emoji = emoji;
        return component;
      });
      for (let index = 0; index < buttons.length; index += 5) components.push({ type: 1, components: buttons.slice(index, index + 5) });
    }
    if (state.templateDraft.controls.type === 'dropdown') {
      for (const dropdown of state.templateDraft.controls.dropdowns) {
        if (!dropdown.options.length) continue;
        components.push({ type: 1, components: [{
          type: 3, custom_id: previewId('d', dropdown.id), placeholder: dropdown.placeholder,
          min_values: 1, max_values: dropdown.allowMultiple ? dropdown.options.length : 1,
          options: dropdown.options.map((option) => {
            const item = { label: option.title, value: `option:${String(option.id).slice(-32)}`.slice(0, 100) };
            if (option.description) item.description = option.description;
            const emoji = payloadEmoji(option.emoji); if (emoji) item.emoji = emoji;
            return item;
          }),
        }] });
      }
    }
    return { flags: 32768, allowedMentions: { parse: [], users: [], roles: [] }, components };
  }

export function renderTemplateVariableReference() {
    const generic = new Set(GENERIC_TEMPLATE_VARIABLES.map(([token]) => token.slice(1, -1)));
    const used = templateVariableNames();
    const chips = GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<span class="template-variable-chip"><code>${escapeHtml(token)}</code><small>Generic · ${escapeHtml(meaning)}</small></span>`);
    for (const name of used.filter((name) => name !== 'separator' && !generic.has(name))) chips.push(`<span class="template-variable-chip context"><code>{${escapeHtml(name)}}</code><small>Context-specific</small></span>`);
    elements.templateVariableReference.innerHTML = chips.join('');
    const unresolved = used.filter((name) => name !== 'separator' && !generic.has(name));
    elements.templateSendHint.textContent = unresolved.length
      ? `Direct sending is blocked until these context variables are removed: ${unresolved.map((name) => `{${name}}`).join(', ')}`
      : 'Test and live sends use the same visible content. Role/user pings stay disabled.';
    return unresolved;
  }

export function refreshTemplateDirty() {
    const dirty = templateIsDirty();
    state.templateControlsValid = templateControlsValidationErrors().length === 0;
    elements.templateStatusBadge.textContent = state.templateSaving ? 'SAVING' : state.templateSaveError ? 'SAVE ERROR' : dirty ? 'UNSAVED' : 'SAVED';
    elements.templateStatusBadge.classList.toggle('unsaved', dirty && !state.templateSaveError);
    elements.templateStatusBadge.classList.toggle('saving', state.templateSaving);
    elements.templateStatusBadge.classList.toggle('error', Boolean(state.templateSaveError));
    const unresolved = templateVariableNames().filter((name) => !['server', 'server_icon', 'channel', 'timestamp', 'separator'].includes(name));
    elements.templateSendTest.disabled = dirty || !state.templateControlsValid || Boolean(unresolved.length);
    elements.templateSendNow.disabled = dirty || !state.templateControlsValid || !state.templateDraft?.enabled || Boolean(unresolved.length);
    refreshDirty();
  }

export function renderTemplateComposerPanel() {
    const panel = state.templateComposerPanel;
    const draft = state.templateDraft;
    if (!draft) return;
    const layout = draft.layout;
    elements.templateComposerPanel.hidden = !panel;
    elements.templateComposerPanel.dataset.panel = panel;
    elements.templateVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.templateThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.templateGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validTemplateMedia));
    if (!panel) return;
    if (panel === 'variables') {
      elements.templateComposerPanel.innerHTML = `<div class="variable-guide">${GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<button type="button" data-insert-template-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.templateComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {server_icon}, a supported context media variable, an image URL, or an upload up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-template-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{server_icon} or https://example.com/image.png" data-template-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-template-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="https://example.com/image.png" data-template-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-template-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-template-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.templateComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-template-gallery>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-template-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

export function renderTemplateComposerPreview(renderTools = true, updateJson = true) {
    const draft = state.templateDraft;
    if (!draft) return;
    const contentHtml = inlineTemplateEditor(draft.content, 'content', 'messageTemplate', 'message template', genericTemplatePreviewValues(), 4000);
    renderDiscordComposerPreview({
      frame: elements.templateDiscordFrame, preview: elements.templateMessagePreview,
      accentButton: elements.templateAccentButton, accentInput: elements.templateAccentColor,
      containerButton: elements.templateContainerAdd, layout: draft.layout, contentHtml, resolveMedia: templatePreviewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.templateAdditionalContainers,
      containers: draft.additionalContainers,
      prefix: 'template', scope: 'messageTemplate', previewValues: genericTemplatePreviewValues(),
      resolveMedia: templatePreviewMediaUrl, maxLength: 4000,
    });
    elements.templateAdditionalContainerAdd.disabled = draft.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    elements.templateCharacterCount.textContent = `${draft.content.length} / 4000`;
    if (renderTools) renderTemplateComposerPanel();
    renderTemplateControlPreview();
    if (updateJson) syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    renderTemplateVariableReference();
    refreshTemplateDirty();
  }

export function templateFolderOptions(selected) {
    return [`<option value="">Unfiled</option>`, ...state.messageTemplates.folders.map((folder) => `<option value="${escapeHtml(folder.id)}"${folder.id === selected ? ' selected' : ''}>${escapeHtml(folder.name)}</option>`)].join('');
  }

export function renderTemplateEditor() {
    const draft = state.templateDraft;
    elements.templateEmptyState.hidden = Boolean(draft);
    elements.templateEditor.hidden = !draft;
    if (!draft) return;
    elements.templateEditorTitle.textContent = draft.name;
    elements.templateTimestamps.textContent = `Created ${formatTemplateDate(draft.createdAt)} · Updated ${formatTemplateDate(draft.updatedAt)}`;
    elements.templateName.value = draft.name;
    elements.templateDescription.value = draft.description;
    elements.templateFolderSelect.innerHTML = templateFolderOptions(draft.folderId);
    elements.templateChannel.innerHTML = channelOptions(draft.defaultChannelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'No default channel');
    elements.templateSendChannel.innerHTML = channelOptions(draft.defaultChannelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    elements.templateEnabled.checked = draft.enabled;
    document.querySelectorAll('[data-template-tab]').forEach((button) => {
      const active = button.dataset.templateTab === state.templateTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-template-panel]').forEach((panel) => {
      const active = panel.dataset.templatePanel === state.templateTab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    renderTemplateComposerPreview();
    renderTemplateControls();
    syncTemplateJson(true);
    updateTemplateDeepLink();
  }

export function renderTemplateWorkspace() {
    renderTemplateFolders();
    renderTemplateList();
    renderTemplateEditor();
  }

export async function selectMessageTemplate(id, options = {}) {
    const item = state.messageTemplates.items.find((entry) => entry.id === id);
    if (!item) return false;
    if (!options.force && id !== state.templateSelectedId && templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Your current template edits have not been saved.', confirmLabel: 'Discard' });
      if (!confirmed) return false;
    }
    state.templateSelectedId = item.id;
    state.templateDraft = clone(item);
    state.templateSavedSnapshot = templateSnapshot();
    state.templateComposerPanel = '';
    state.templateJsonValid = true;
    state.templateSaveError = '';
    if (options.reveal) state.templateFolderId = item.folderId || 'unfiled';
    renderTemplateWorkspace();
    return true;
  }

export function replaceTemplateCollection(payload, selectedId = state.templateSelectedId, options = {}) {
    const preservedDraft = options.preserveDraft && state.templateDraft?.id === selectedId ? clone(state.templateDraft) : null;
    state.messageTemplates = normalizeMessageTemplatesClient(payload.messageTemplates || payload);
    const selected = state.messageTemplates.items.find((item) => item.id === selectedId);
    if (selected) {
      state.templateSelectedId = selected.id;
      state.templateDraft = clone(selected);
      state.templateSavedSnapshot = templateSnapshot();
      if (preservedDraft) {
        if (preservedDraft.folderId && !state.messageTemplates.folders.some((folder) => folder.id === preservedDraft.folderId)) preservedDraft.folderId = null;
        state.templateDraft = preservedDraft;
      }
    } else {
      state.templateSelectedId = '';
      state.templateDraft = null;
      state.templateSavedSnapshot = '';
    }
    renderTemplateWorkspace();
  }

export async function createMessageTemplate() {
    if (templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Creating a new template will close the current draft.', confirmLabel: 'Discard and create' });
      if (!confirmed) return;
    }
    const base = 'Untitled template';
    let name = base;
    let number = 2;
    while (state.messageTemplates.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) name = `${base} ${number++}`;
    const folderId = !['all', 'unfiled'].includes(state.templateFolderId) ? state.templateFolderId : null;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates`, {
      method: 'POST', body: JSON.stringify({ name, folderId, content: '', layout: clone(TEMPLATE_LAYOUT_DEFAULTS) }),
    });
    replaceTemplateCollection(payload, payload.item.id);
    state.templateFolderId = payload.item.folderId || 'unfiled';
    renderTemplateWorkspace();
    elements.templateName.focus();
    elements.templateName.select();
    showToast('Blank template created.');
  }

export async function saveMessageTemplate() {
    if (!state.templateDraft || state.templateSaving || !templateIsDirty() || !state.templateJsonValid || !state.templateControlsValid) return;
    state.templateSaving = true;
    state.templateSaveError = '';
    refreshTemplateDirty();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}`, {
        method: 'PATCH', body: JSON.stringify({
          name: state.templateDraft.name, description: state.templateDraft.description,
          folderId: state.templateDraft.folderId, defaultChannelId: state.templateDraft.defaultChannelId,
          enabled: state.templateDraft.enabled, document: templateDocument(),
        }),
      });
      replaceTemplateCollection(payload, payload.item.id);
      state.templateFolderId = payload.item.folderId || 'unfiled';
      renderTemplateWorkspace();
      showToast('Message template saved.');
    } catch (error) {
      state.templateSaveError = error.message || 'Message template could not be saved.';
      throw error;
    } finally {
      state.templateSaving = false;
      refreshTemplateDirty();
    }
  }

export function resetTemplateDraft() {
    const stored = currentStoredTemplate();
    if (!stored || state.templateSaving) return;
    state.templateDraft = clone(stored);
    state.templateSavedSnapshot = templateSnapshot();
    state.templateJsonValid = true;
    state.templateSaveError = '';
    renderTemplateEditor();
    showToast('Unsaved template changes reset.');
  }

export async function duplicateMessageTemplate() {
    if (!state.templateDraft) return;
    if (templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Duplicate uses the last saved version of this template.', confirmLabel: 'Discard and duplicate' });
      if (!confirmed) return;
    }
    const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/duplicate`, { method: 'POST', body: '{}' });
    replaceTemplateCollection(payload, payload.item.id);
    state.templateFolderId = payload.item.folderId || 'unfiled';
    renderTemplateWorkspace();
    showToast('Template duplicated.');
  }

export async function deleteMessageTemplate() {
    if (!state.templateDraft) return;
    const confirmed = await confirmAction({ title: 'Delete this template?', copy: `“${state.templateDraft.name}” will be permanently removed.`, confirmLabel: 'Delete' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}`, { method: 'DELETE', body: '{}' });
    replaceTemplateCollection(payload, '');
    showToast('Template deleted.');
  }

export async function createTemplateFolder() {
    const name = await confirmAction({ title: 'Create a folder', copy: 'Folders keep related message templates together.', input: true, inputLabel: 'Folder name', confirmLabel: 'Create folder' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders`, { method: 'POST', body: JSON.stringify({ name }) });
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    state.templateFolderId = payload.folder.id;
    renderTemplateWorkspace();
    showToast('Template folder created.');
  }

export async function renameTemplateFolder(folderId) {
    const folder = state.messageTemplates.folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    const name = await confirmAction({ title: 'Rename folder', copy: 'Choose a short, recognizable folder name.', input: true, inputLabel: 'Folder name', inputValue: folder.name, confirmLabel: 'Rename' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders/${folderId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    showToast('Folder renamed.');
  }

export async function deleteTemplateFolder(folderId) {
    const folder = state.messageTemplates.folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    const count = state.messageTemplates.items.filter((item) => item.folderId === folderId).length;
    const confirmed = await confirmAction({ title: 'Delete this folder?', copy: `${count} template${count === 1 ? '' : 's'} will move to Unfiled; no templates will be deleted.`, confirmLabel: 'Delete folder' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders/${folderId}`, { method: 'DELETE', body: '{}' });
    state.templateFolderId = 'unfiled';
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    showToast(`Folder deleted. ${payload.moved || 0} template${payload.moved === 1 ? '' : 's'} moved to Unfiled.`);
  }

export function insertTemplateVariable(token) {
    if (!state.templateDraft) return;
    let input = elements.messageTemplatesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]')
      || elements.templateMessagePreview.querySelector('[data-inline-message-input]');
    if (!input) return;
    if (!input.closest('[data-inline-message-editor]')?.classList.contains('editing')) beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
    input = elements.messageTemplatesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]') || input;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 4000);
    const containerIndex = Number(input.dataset.additionalContainerIndex);
    if (Number.isInteger(containerIndex) && state.templateDraft.additionalContainers[containerIndex]) state.templateDraft.additionalContainers[containerIndex].content = input.value;
    else state.templateDraft.content = input.value;
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(Math.min(input.value.length, start + token.length), Math.min(input.value.length, start + token.length));
    if (!Number.isInteger(containerIndex)) elements.templateCharacterCount.textContent = `${input.value.length} / 4000`;
    syncTemplateJson();
    renderTemplateVariableReference();
    refreshTemplateDirty();
  }

export async function uploadTemplateMedia(input) {
    const file = input.files?.[0];
    if (!file || !state.templateDraft) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      input.value = '';
      return showToast(file.size > 10 * 1024 * 1024 ? 'Images must be 10 MB or smaller.' : 'Upload an image file.', 'error');
    }
    const label = input.closest('.media-upload');
    label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-media`, { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? state.templateDraft.additionalContainers[containerIndex]?.layout : state.templateDraft.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.templateMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url; layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderTemplateComposerPreview();
      showToast('Template image uploaded. Save the template when ready.');
    } catch (error) { showToast(error.message || 'Image upload failed.', 'error'); }
    finally { label?.classList.remove('uploading'); input.value = ''; }
  }

export async function sendCurrentTemplate(mode) {
    if (!state.templateDraft || templateIsDirty()) return showToast('Save template changes before sending.', 'error');
    const channelId = elements.templateSendChannel.value || state.templateDraft.defaultChannelId;
    if (!channelId) return showToast('Choose a destination channel.', 'error');
    if (mode === 'send') {
      const channel = state.directory.channels.find((entry) => entry.id === channelId);
      const confirmed = await confirmAction({ title: 'Send this message now?', copy: `“${state.templateDraft.name}” will be posted in #${channel?.name || channelId}. Mentions remain disabled.`, confirmLabel: 'Send now' });
      if (!confirmed) return;
    }
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/send`, {
        method: 'POST', body: JSON.stringify({ mode, channelId, confirm: mode === 'send' }),
      });
      showToast(`${mode === 'test' ? 'Test message' : 'Message'} sent to #${result.channelName}.`, '', result.messageUrl);
    } catch (error) { showToast(error.message || 'The message could not be sent.', 'error'); }
  }

export function updateTemplateJsonFromInput(showSuccess = false) {
    if (!state.templateDraft) return false;
    try {
      const documentValue = parseTemplateJsonText(elements.templateJsonEditor.value);
      state.templateDraft.content = documentValue.content;
      state.templateDraft.layout = documentValue.layout;
      state.templateDraft.additionalContainers = documentValue.additionalContainers;
      state.templateDraft.controls = documentValue.controls;
      state.templateJsonValid = true;
      elements.templateJsonError.hidden = true;
      renderTemplateComposerPreview(true, false);
      renderTemplateControls();
      if (showSuccess) showToast('JSON imported into the visual editor. Save to persist it.');
      return true;
    } catch (error) {
      state.templateJsonValid = false;
      elements.templateJsonError.textContent = error.message;
      elements.templateJsonError.hidden = false;
      refreshTemplateDirty();
      return false;
    }
  }

export function updateTemplateDraftFromControl(target) {
    const draft = state.templateDraft;
    if (!draft) return;
    if (target.matches('[data-inline-message-input]') && target.dataset.inlineTemplateScope === 'messageTemplate') {
      const containerIndex = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(containerIndex) && draft.additionalContainers[containerIndex]) draft.additionalContainers[containerIndex].content = target.value.slice(0, 4000);
      else draft.content = target.value.slice(0, 4000);
      syncInlineEditorVisual(target);
      if (!Number.isInteger(containerIndex)) elements.templateCharacterCount.textContent = `${draft.content.length} / 4000`;
      syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      renderTemplateVariableReference();
      refreshTemplateDirty();
      return;
    }
    if (target === elements.templateName) {
      draft.name = target.value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
      elements.templateEditorTitle.textContent = draft.name.trim() || 'Untitled template';
    }
    if (target === elements.templateDescription) draft.description = target.value.slice(0, 500);
    if (target === elements.templateFolderSelect) draft.folderId = target.value || null;
    if (target === elements.templateChannel) {
      draft.defaultChannelId = target.value;
      elements.templateSendChannel.value = target.value;
    }
    if (target === elements.templateEnabled) draft.enabled = target.checked;
    if (target === elements.templateAccentColor) {
      draft.layout.accentColor = target.value;
      renderTemplateComposerPreview();
      return;
    }
    if (target.matches('[data-template-additional-accent]')) {
      const container = draft.additionalContainers[Number(target.dataset.templateAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderTemplateComposerPreview();
      return;
    }
    if (target.matches('[data-template-thumbnail-url]')) {
      draft.layout.thumbnailUrl = target.value.slice(0, 2000);
      draft.layout.thumbnailEnabled = Boolean(target.value.trim());
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-gallery-url]')) {
      draft.layout.galleryUrls[Number(target.dataset.templateGalleryUrl)] = target.value.slice(0, 2000);
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-additional-thumbnail-url]')) {
      const container = draft.additionalContainers[Number(target.dataset.templateAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validTemplateMedia(target.value);
      }
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.templateAdditionalGalleryUrl.split(':').map(Number);
      const container = draft.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-button-label]')) {
      const button = draft.controls.buttons.find((entry) => entry.id === target.dataset.templateButtonLabel);
      if (button) button.label = target.value.slice(0, 80);
    }
    if (target.matches('[data-template-button-style]')) {
      const button = draft.controls.buttons.find((entry) => entry.id === target.dataset.templateButtonStyle);
      if (button) button.style = target.value;
    }
    if (target.matches('[data-template-option-title]')) {
      const option = templateControlAt(`option:${target.dataset.templateOptionTitle}`)?.entry;
      if (option) option.title = target.value.slice(0, 100);
    }
    if (target.matches('[data-template-option-description]')) {
      const option = templateControlAt(`option:${target.dataset.templateOptionDescription}`)?.entry;
      if (option) option.description = target.value.slice(0, 100);
    }
    if (target.matches('[data-template-dropdown-placeholder]')) {
      const dropdown = templateDropdownAt(target.dataset.templateDropdownPlaceholder)?.dropdown;
      if (dropdown) dropdown.placeholder = target.value.slice(0, 150);
    }
    if (target.matches('[data-template-dropdown-multiple]')) {
      const dropdown = templateDropdownAt(target.dataset.templateDropdownMultiple)?.dropdown;
      if (dropdown) dropdown.allowMultiple = target.checked;
    }
    if (target.matches('[data-template-control-action]')) {
      const control = templateControlAt(target.dataset.templateControlAction);
      const type = TEMPLATE_ACTION_TYPES.includes(target.value) ? target.value : 'send_message';
      if (control) control.entry.action = ['give_role', 'remove_role'].includes(type) ? { type, roleId: '' } : { type, templateId: '' };
    }
    if (target.closest?.('[data-template-control-row]') || target.matches('[data-template-dropdown-placeholder],[data-template-dropdown-multiple]')) {
      if (target.matches('[data-template-control-action]')) renderTemplateControls();
      else refreshTemplateControlValidation();
      renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    }
    state.templateSaveError = '';
    updateTemplateDeepLink();
    refreshTemplateDirty();
  }

export function templateControlAt(spec) {
    const [kind, firstId, secondId] = String(spec || '').split(':');
    if (kind === 'button') {
      const entries = state.templateDraft?.controls?.buttons || [];
      const index = entries.findIndex((entry) => entry.id === firstId);
      return index >= 0 ? { kind, dropdownIndex: null, index, entry: entries[index], entries, spec: `button:${firstId}` } : null;
    }
    if (kind !== 'option') return null;
    const resolved = templateDropdownAt(firstId);
    if (!resolved) return null;
    const entries = resolved.dropdown.options;
    const index = entries.findIndex((entry) => entry.id === secondId);
    return index >= 0 ? {
      kind, dropdown: resolved.dropdown, dropdownIndex: resolved.dropdownIndex, index,
      entry: entries[index], entries, spec: `option:${firstId}:${secondId}`,
    } : null;
  }

export function safeTemplateRoles() {
    return (state.directory.roles || []).filter((role) => role.managed !== true && role.administrator !== true && role.editable !== false && role.belowBot !== false);
  }

export function openTemplateActionDialog(spec) {
    const target = templateControlAt(spec);
    if (!target) return;
    state.templateActionTarget = { spec: target.spec };
    const action = target.entry.action;
    const templateAction = ['send_message', 'dm_message'].includes(action.type);
    elements.templateActionTitle.textContent = `Configure ${TEMPLATE_ACTION_LABELS[action.type]}`;
    elements.templateActionCopy.textContent = templateAction
      ? 'Choose a Message Template from this server. It is resolved again when the member interacts.'
      : 'Choose a safe Discord role below CoinSprite. Role safety is rechecked at interaction time.';
    elements.templateActionTargetLabel.textContent = templateAction ? 'Message Template' : 'Discord role';
    if (templateAction) {
      const selected = String(action.templateId || '');
      const items = [...state.messageTemplates.items].sort((left, right) => left.name.localeCompare(right.name));
      const options = ['<option value="">Choose a Message Template</option>', ...items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}${item.enabled ? '' : ' (disabled)'}</option>`)];
      if (selected && !items.some((item) => item.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected disabled>Missing template (${escapeHtml(selected)})</option>`);
      elements.templateActionTarget.innerHTML = options.join('');
      elements.templateActionHelp.textContent = action.type === 'dm_message' ? 'Closed DMs produce a friendly private error.' : 'The template is shown only to the member who used the button or dropdown.';
    } else {
      const selected = String(action.roleId || '');
      const roles = safeTemplateRoles();
      const options = ['<option value="">Choose a manageable role</option>', ...roles.map((role) => `<option value="${role.id}"${role.id === selected ? ' selected' : ''} style="color:${roleColor(role.id)}">● @${escapeHtml(role.name)}</option>`)];
      if (selected && !roles.some((role) => role.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected disabled>Missing or unmanageable role (${escapeHtml(selected)})</option>`);
      elements.templateActionTarget.innerHTML = options.join('');
      elements.templateActionHelp.textContent = 'Managed, Administrator, and above-bot roles are excluded.';
    }
    elements.templateActionDialog.showModal();
    elements.templateActionTarget.focus();
  }

export function saveTemplateActionDialog() {
    const target = templateControlAt(state.templateActionTarget?.spec);
    if (!target) return elements.templateActionDialog.close();
    const selected = elements.templateActionTarget.value;
    if (!selected) return showToast(`Choose a ${['send_message', 'dm_message'].includes(target.entry.action.type) ? 'Message Template' : 'Discord role'}.`, 'error');
    if (['send_message', 'dm_message'].includes(target.entry.action.type)) target.entry.action.templateId = selected;
    else target.entry.action.roleId = selected;
    state.templateActionTarget = null;
    state.templateSaveError = '';
    elements.templateActionDialog.close();
    renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    refreshTemplateDirty();
  }

export function renderTemplatePicker() {
    const search = elements.templatePickerSearch.value.trim().toLowerCase();
    const items = state.messageTemplates.items.filter((item) => !search || item.name.toLowerCase().includes(search));
    elements.templatePickerList.innerHTML = items.length ? items.map((item) => `<button type="button" data-pick-template="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(templateFolderName(item.folderId))}${item.description ? ` · ${escapeHtml(item.description)}` : ''}</small></button>`).join('') : '<p class="template-list-empty">No matching templates.</p>';
  }

export function openTemplatePicker(context) {
    if (!state.messageTemplates.items.length) {
      setView('message-templates');
      showToast('Create a message template first.', 'error');
      return;
    }
    state.templatePickerContext = context;
    elements.templatePickerSearch.value = '';
    renderTemplatePicker();
    elements.templatePickerDialog.showModal();
    elements.templatePickerSearch.focus();
  }

export function contextVariableSet(context) {
    if (context === 'leveling') return new Set(LEVELING_VARIABLES.map(([token]) => token.slice(1, -1)));
    if (context === 'reactionRoles') return new Set(GENERIC_TEMPLATE_VARIABLES.map(([token]) => token.slice(1, -1)));
    return new Set([...MEMBER_MESSAGE_COMMON_VARIABLES, ...MEMBER_MESSAGE_EVENT_VARIABLES[state.memberMessageEvent]].map(([token]) => token.slice(1, -1)));
  }

export async function applyTemplateSnapshot(templateId) {
    const item = state.messageTemplates.items.find((entry) => entry.id === templateId);
    if (!item) return;
    const supported = contextVariableSet(state.templatePickerContext);
    const unavailable = templateVariableNames(item).filter((name) => name !== 'separator' && !supported.has(name));
    if (unavailable.length) {
      const confirmed = await confirmAction({ title: 'Some variables are unavailable', copy: `${unavailable.map((name) => `{${name}}`).join(', ')} will remain unresolved in this destination context. Apply the snapshot anyway?`, confirmLabel: 'Apply anyway' });
      if (!confirmed) return;
    }
    if (state.templatePickerContext === 'leveling') {
      state.config.leveling.announcements.template = item.content.slice(0, 3000);
      state.config.leveling.announcements.layout = clone(item.layout);
      state.config.leveling.announcements.additionalContainers = clone(item.additionalContainers).map((container) => ({
        ...container, content: container.content.slice(0, 3000),
      }));
      renderMessagePreview();
    } else if (state.templatePickerContext === 'reactionRoles') {
      if (!state.reactionRoleDraft) return;
      state.reactionRoleDraft.message = {
        content: item.content.slice(0, 4000), layout: clone(item.layout),
        additionalContainers: clone(item.additionalContainers), sourceTemplateId: item.id,
      };
      renderReactionRoleEditor();
    } else {
      const event = currentMemberMessage();
      event.template = item.content.slice(0, 3000);
      event.layout = clone(item.layout);
      event.additionalContainers = clone(item.additionalContainers).map((container) => ({
        ...container, content: container.content.slice(0, 3000),
      }));
      renderWelcomeMessagePreview();
    }
    elements.templatePickerDialog.close();
    refreshDirty();
    showToast(`Applied “${item.name}” as a snapshot.`);
  }

export async function saveComposerAsTemplate(context) {
    const defaults = context === 'leveling' ? state.config.leveling.announcements : currentMemberMessage();
    if (!defaults) return;
    const name = await confirmAction({ title: 'Save as a message template', copy: 'This creates an independent snapshot you can organize and edit later.', input: true, inputLabel: 'Template name', confirmLabel: 'Save template' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates`, {
      method: 'POST', body: JSON.stringify({ name, content: defaults.template, layout: defaults.layout, additionalContainers: defaults.additionalContainers }),
    });
    state.messageTemplates = normalizeMessageTemplatesClient(payload.messageTemplates);
    renderTemplateFolders(); renderTemplateList();
    showToast(`Saved “${payload.item.name}” as a template.`);
  }

export function renderLeveling() {
    const leveling = state.config.leveling;
    elements.levelingEnabled.checked = leveling.enabled;
    elements.levelingXpMin.value = leveling.xp.min;
    elements.levelingXpMax.value = leveling.xp.max;
    elements.levelingCooldown.value = leveling.xp.cooldownSeconds;
    elements.levelingBaseXp.value = leveling.curve.baseXp;
    elements.levelingGrowth.value = leveling.curve.growth;
    elements.levelingMaxLevel.value = leveling.curve.maxLevel;
    elements.levelingAnnounceEnabled.checked = leveling.announcements.enabled;
    elements.levelingAnnounceChannel.innerHTML = channelOptions(leveling.announcements.channelId, (channel) => channel.kind !== 'forum');
    elements.levelingAnnounceChannel.options[0].textContent = 'Use the channel where XP was earned';
    elements.levelingStackRewards.checked = leveling.stackRoleRewards;
    renderCurvePreview();
    renderLevelingChannels();
    renderLevelingRewards();
    renderLevelingBoosts();
    renderMessagePreview();
    renderXpDrops();
    refreshDirty();
  }
