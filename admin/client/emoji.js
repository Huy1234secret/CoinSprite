// emoji: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { normalizePickerEmoji, reactionRoleEmojiHtml, renderReactionRoleEditor } from './roles.js';
import { DEFAULT_EMOJI_DATA, DEFAULT_EMOJI_DATA_URL, EMOJI_RENDER_BATCH, EMPTY_EMOJI_DATA, defaultEmojiDataPromise, defaultEmojiItemCache, directoryEmojiItemCache, elements, emojiSearchTimer, state } from './state.js';
import { beginInlineMessageEdit } from './composer.js';
import { showToast } from './session.js';
import { refreshTemplateDirty, renderTemplateControlPreview, syncTemplateJson, templateControlAt } from './templates.js';

export function customEmojiMarkup(emoji) {
    const item = normalizePickerEmoji(emoji);
    if (!item.id) return item.name;
    return `<${item.animated ? 'a' : ''}:${item.name}:${item.id}>`;
  }

export function ensureDefaultEmojiData() {
    if (DEFAULT_EMOJI_DATA.value.groups.length) return Promise.resolve(DEFAULT_EMOJI_DATA.value);
    if (defaultEmojiDataPromise.value) return defaultEmojiDataPromise.value;
    defaultEmojiDataPromise.value = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DEFAULT_EMOJI_DATA_URL;
      script.async = true;
      script.addEventListener('load', () => {
        DEFAULT_EMOJI_DATA.value = window.COINSPRITE_EMOJI_DATA || EMPTY_EMOJI_DATA;
        if (!DEFAULT_EMOJI_DATA.value.groups.length) {
          defaultEmojiDataPromise.value = null;
          reject(new Error('The default emoji catalog is unavailable.'));
          return;
        }
        defaultEmojiItemCache.clear();
        if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.value.groups[0]?.id || '';
        resolve(DEFAULT_EMOJI_DATA.value);
      }, { once: true });
      script.addEventListener('error', () => {
        defaultEmojiDataPromise.value = null;
        reject(new Error('The default emoji catalog could not be loaded.'));
      }, { once: true });
      document.head.append(script);
    });
    return defaultEmojiDataPromise.value;
  }

export function defaultEmojiItems(groupId = '') {
    const cacheKey = groupId || '*';
    if (defaultEmojiItemCache.has(cacheKey)) return defaultEmojiItemCache.get(cacheKey);
    const groups = groupId ? DEFAULT_EMOJI_DATA.value.groups.filter((group) => group.id === groupId) : DEFAULT_EMOJI_DATA.value.groups;
    const items = groups.flatMap((group) => group.emojis.map(([character, name]) => Object.freeze({
      id: '', name: character, character, animated: false, source: 'default', searchName: name,
      searchText: `${name} ${character}`.toLowerCase(), groupId: group.id,
    })));
    defaultEmojiItemCache.set(cacheKey, items);
    return items;
  }

export function pickerItems(section = state.emojiSection, allDefaults = false) {
    if (section === 'default') return defaultEmojiItems(allDefaults ? '' : state.emojiCategory);
    const source = state.directory.emojis?.[section] || [];
    const cached = directoryEmojiItemCache.get(section);
    if (cached?.source === source) return cached.items;
    const items = source.map((emoji) => {
      const item = { ...normalizePickerEmoji(emoji), url: String(emoji.url || ''), searchName: String(emoji.name || '') };
      item.searchText = `${item.searchName} ${item.name}`.toLowerCase();
      return Object.freeze(item);
    });
    directoryEmojiItemCache.set(section, { source, items });
    return items;
  }

export function renderEmojiCategories(search) {
    const visible = state.emojiSection === 'default';
    elements.emojiPickerCategories.hidden = !visible;
    elements.emojiPickerCategories.replaceChildren();
    if (!visible) return;
    const fragment = document.createDocumentFragment();
    for (const group of DEFAULT_EMOJI_DATA.value.groups) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.emojiCategory = group.id;
      button.textContent = group.icon; button.title = group.name; button.setAttribute('aria-label', group.name);
      const active = !search && group.id === state.emojiCategory;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      fragment.append(button);
    }
    elements.emojiPickerCategories.append(fragment);
  }

export function appendEmojiPickerBatch(reset = false) {
    const items = state.emojiPickerItems;
    if (reset) {
      elements.emojiPickerGrid.replaceChildren();
      state.emojiRenderedCount = 0;
    }
    elements.emojiPickerGrid.querySelector('.emoji-picker-more')?.remove();
    if (!items.length) {
      if (!reset) return;
      const search = elements.emojiPickerSearch.value.trim();
      const empty = document.createElement('div'); empty.className = 'emoji-picker-empty';
      empty.textContent = search ? 'No emojis match this search.' : `No ${state.emojiSection === 'bot' ? 'Bot' : state.emojiSection === 'group' ? 'Group' : 'Default'} Emojis are available.`;
      elements.emojiPickerGrid.append(empty); return;
    }
    const start = state.emojiRenderedCount;
    const end = Math.min(items.length, start + EMOJI_RENDER_BATCH);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const emoji = items[index];
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'gridcell');
      button.dataset.emojiIndex = String(index); button.setAttribute('aria-label', emoji.searchName || emoji.name); button.title = emoji.searchName || emoji.name;
      if (emoji.animated) button.classList.add('animated');
      if (emoji.id && emoji.url) {
        const image = document.createElement('img'); image.src = emoji.url; image.alt = ''; image.loading = 'lazy'; button.append(image);
      } else button.textContent = emoji.name;
      fragment.append(button);
    }
    state.emojiRenderedCount = end;
    if (end < items.length) {
      const more = document.createElement('div'); more.className = 'emoji-picker-more';
      more.textContent = `Showing ${end} of ${items.length}`; fragment.append(more);
    }
    elements.emojiPickerGrid.append(fragment);
  }

export function renderEmojiPicker() {
    const search = elements.emojiPickerSearch.value.trim().toLowerCase();
    document.querySelectorAll('[data-emoji-section]').forEach((button) => {
      const active = button.dataset.emojiSection === state.emojiSection;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    const failed = state.emojiSection !== 'default' && state.directory.emojis?.errors?.[state.emojiSection];
    renderEmojiCategories(search);
    const items = pickerItems(state.emojiSection, Boolean(search)).filter((emoji) => !search || emoji.searchText.includes(search));
    state.emojiPickerItems = items;
    const activeGroup = DEFAULT_EMOJI_DATA.value.groups.find((group) => group.id === state.emojiCategory);
    elements.emojiPickerStatus.className = `emoji-picker-status${failed ? ' error' : ''}`;
    elements.emojiPickerStatus.textContent = failed
      ? `${state.emojiSection === 'bot' ? 'Bot' : 'Group'} emojis could not be loaded. The other sections still work.`
      : state.emojiSection === 'default'
        ? `${items.length} emoji${items.length === 1 ? '' : 's'}${search ? ' found across all categories' : ` · ${activeGroup?.name || 'Default Emojis'}`} · Unicode ${DEFAULT_EMOJI_DATA.value.version}`
        : `${items.length} emoji${items.length === 1 ? '' : 's'}${search ? ' found' : ''}`;
    appendEmojiPickerBatch(true);
    elements.emojiPickerGrid.scrollTop = 0;
  }

export function preferredInlineInput(scope) {
    const roots = {
      leveling: elements.levelingView,
      memberMessages: elements.welcomeMessagesView,
      messageTemplate: elements.messageTemplatesView,
      reactionRole: elements.reactionRolesView,
      xpDrop: elements.xpDropMessagePreview,
      xpClaim: elements.xpDropClaimPreview,
    };
    const root = roots[scope];
    if (!root) return null;
    const bookmark = state.inlineTextCarets.get(scope);
    const remembered = bookmark?.input?.isConnected && root.contains(bookmark.input) ? bookmark.input : null;
    const active = document.activeElement?.matches?.('[data-inline-message-input]') && root.contains(document.activeElement) ? document.activeElement : null;
    const editing = root.querySelector('[data-inline-message-editor].editing [data-inline-message-input]');
    const input = active || remembered || editing || root.querySelector('[data-inline-message-input]');
    if (input && !input.closest('[data-inline-message-editor]')?.classList.contains('editing')) {
      beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
    }
    return input || root.querySelector('[data-inline-message-editor].editing [data-inline-message-input]');
  }

export function rememberInlineTextCaret(input) {
    if (!input?.matches?.('[data-inline-message-input]')) return;
    const scope = String(input.dataset.inlineTemplateScope || '');
    if (!scope) return;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    state.inlineTextCarets.set(scope, { input, start, end });
  }

export function restoreEmojiTextTarget(target, start = target?.start, end = start) {
    const input = target?.input;
    if (!input?.isConnected) return;
    const safeStart = Math.max(0, Math.min(input.value.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(input.value.length, Number(end) || safeStart));
    input.closest('[data-inline-message-editor]')?.classList.add('editing');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.setSelectionRange(safeStart, safeEnd);
      rememberInlineTextCaret(input);
    }));
  }

export async function openEmojiPicker(target) {
    const resolved = typeof target === 'string' ? { type: 'text', scope: target, input: preferredInlineInput(target) } : target;
    if (resolved?.type === 'text' && !resolved.input) return showToast('Open a message editor before choosing an emoji.', 'error');
    resolved.trigger = resolved.trigger || document.activeElement;
    if (resolved?.type === 'text') {
      const bookmark = state.inlineTextCarets.get(resolved.scope);
      resolved.start = bookmark?.input === resolved.input ? bookmark.start : Number.isInteger(resolved.input.selectionStart) ? resolved.input.selectionStart : resolved.input.value.length;
      resolved.end = bookmark?.input === resolved.input ? bookmark.end : Number.isInteger(resolved.input.selectionEnd) ? resolved.input.selectionEnd : resolved.start;
      rememberInlineTextCaret(resolved.input);
    }
    state.emojiTarget = resolved;
    state.emojiCategory = DEFAULT_EMOJI_DATA.value.groups[0]?.id || '';
    state.emojiSection = pickerItems('bot').length ? 'bot' : pickerItems('group').length ? 'group' : 'default';
    elements.emojiPickerSearch.value = '';
    elements.emojiPickerDialog.showModal();
    elements.emojiPickerSearch.focus();
    if (state.emojiSection === 'default' && !DEFAULT_EMOJI_DATA.value.groups.length) {
      elements.emojiPickerStatus.className = 'emoji-picker-status';
      elements.emojiPickerStatus.textContent = 'Loading the default emoji catalog…';
      elements.emojiPickerGrid.replaceChildren();
      const loading = document.createElement('div'); loading.className = 'emoji-picker-empty'; loading.textContent = 'Loading emojis…';
      elements.emojiPickerGrid.append(loading);
      try {
        await ensureDefaultEmojiData();
      } catch (error) {
        elements.emojiPickerStatus.className = 'emoji-picker-status error';
        elements.emojiPickerStatus.textContent = error.message;
        loading.textContent = 'Try opening the picker again.';
        return;
      }
    }
    if (state.emojiTarget !== resolved || !elements.emojiPickerDialog.open) return;
    if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.value.groups[0]?.id || '';
    renderEmojiPicker();
  }

export function closeEmojiPicker(restoreText = true) {
    const target = state.emojiTarget;
    window.clearTimeout(emojiSearchTimer.value);
    emojiSearchTimer.value = null;
    if (elements.emojiPickerDialog.open) elements.emojiPickerDialog.close();
    if (restoreText && target?.type === 'text') restoreEmojiTextTarget(target, target.start, target.end);
    else if (target?.trigger?.isConnected) window.requestAnimationFrame(() => target.trigger.focus({ preventScroll: true }));
  }

export function applyPickedEmoji(emoji) {
    const target = state.emojiTarget;
    if (!target) return;
    const normalized = normalizePickerEmoji(emoji);
    if (target.type === 'text') {
      const input = target.input;
      const insertion = customEmojiMarkup(normalized);
      const maximum = Number(input.maxLength) > 0 ? Number(input.maxLength) : 4000;
      input.value = `${input.value.slice(0, target.start)}${insertion}${input.value.slice(target.end)}`.slice(0, maximum);
      const cursor = Math.min(input.value.length, target.start + insertion.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeEmojiPicker(false);
      restoreEmojiTextTarget(target, cursor, cursor);
      return;
    }
    if (['template-button', 'template-option'].includes(target.type)) {
      const control = templateControlAt(target.spec);
      if (!control) return;
      control.entry.emoji = normalized;
      const row = elements.templateControls.querySelector(`[data-template-control-row="${target.spec}"]`);
      const button = row?.querySelector('[data-template-control-emoji]');
      if (button) {
        button.innerHTML = reactionRoleEmojiHtml(normalized);
        button.setAttribute('aria-label', `Choose emoji for ${control.entry.label || control.entry.title || 'control'}`);
      }
      closeEmojiPicker(); renderTemplateControlPreview(); syncTemplateJson(); refreshTemplateDirty();
      return;
    }
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const entries = target.type === 'button' ? draft.buttons : draft.dropdown.options;
    if (entries[target.index]) entries[target.index].emoji = normalized;
    closeEmojiPicker(); renderReactionRoleEditor();
  }
