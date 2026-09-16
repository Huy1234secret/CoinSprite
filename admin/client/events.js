// events: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { $, DEFAULT_EMOJI_DATA, EMOJI_SEARCH_DEBOUNCE_MS, MAX_ADDITIONAL_MESSAGE_CONTAINERS, elements, emojiSearchTimer, state } from './state.js';
import { loadGuild, refreshDirty, renderFeatureAccess, renderGameCommandSettings, resetUnsavedChanges, saveConfig, snapshot } from './workspace.js';
import { addCardText, applyCardTemplate, beginCardInputHistory, beginCardPointer, cardLayerBySelection, cardSelectionObject, cardSnapshot, constrainCardSelection, endCardPointer, finishCardInputHistory, getCardField, moveCardPointer, mutateCardDesign, redoCardDesign, refreshCardDirty, renderCardInspector, renderCardLayers, renderCardStudio, saveProfileCard, scheduleCardDraw, setCardField, undoCardDesign, uploadCardMedia } from './card-studio.js';
import { api, clone, confirmAction, loadSession, renderSession, setView, showToast } from './session.js';
import { applyTemplateSnapshot, createMessageTemplate, createTemplateFolder, deleteMessageTemplate, deleteTemplateFolder, duplicateMessageTemplate, duplicateTemplateOptionTitle, insertTemplateVariable, newTemplateDropdown, newTemplateOption, openTemplateActionDialog, openTemplatePicker, refreshTemplateDirty, renameTemplateFolder, renderTemplateComposerPanel, renderTemplateComposerPreview, renderTemplateControlPreview, renderTemplateControls, renderTemplateEditor, renderTemplateFolders, renderTemplateList, renderTemplatePicker, resetTemplateDraft, resolvedTemplatePayloadPreview, saveComposerAsTemplate, saveMessageTemplate, saveTemplateActionDialog, selectMessageTemplate, sendCurrentTemplate, syncTemplateJson, templateControlAt, templateDropdownAt, templateIsDirty, updateTemplateDeepLink, updateTemplateDraftFromControl, updateTemplateJsonFromInput, uploadTemplateMedia, visibleTemplates } from './templates.js';
import { clientReactionId, createReactionRole, deleteReactionRole, duplicateReactionRole, insertReactionRoleVariable, publishReactionRole, reactionRoleEntries, reactionRoleSnapshot, renderReactionRoleComposerPanel, renderReactionRoleEditor, renderReactionRoles, saveReactionRole, selectReactionRole, updateReactionRoleFromControl, uploadReactionRoleMedia } from './roles.js';
import { addLevelBoost, addLevelReward, addXpDrop, newAdditionalContainer, normalizeLevelingConfig, normalizeMemberMessagesConfig, renderLevelingBoosts, renderLevelingRewards, renderXpDropMessagePreviews, renderXpDrops, resetCurrentMemberMessage, updateLevelingFromControl, updateMemberMessagesFromControl } from './leveling.js';
import { beginInlineMessageEdit, finishInlineMessageEdit, renderComposerPanel, renderMessagePreview, sendXpDropTest, toggleComposerPanel, uploadLevelingMedia, uploadXpDropMedia } from './composer.js';
import { currentMemberMessage, insertMemberMessageVariable, renderWelcomeComposerPanel, renderWelcomeMessagePreview, renderWelcomeMessages, toggleWelcomeComposerPanel, uploadWelcomeMedia } from './welcome.js';
import { appendEmojiPickerBatch, applyPickedEmoji, closeEmojiPicker, ensureDefaultEmojiData, openEmojiPicker, rememberInlineTextCaret, renderEmojiPicker } from './emoji.js';
import { handleOwnerToggle, loadOwner, pollConsole, renderConsole } from './owner.js';

import { switchGuild } from './navigation.js';
elements.guildSelect.addEventListener('change', () => switchGuild(elements.guildSelect.value));

elements.userChip.addEventListener('click', () => {
    const open = elements.accountMenu.hidden;
    elements.accountMenu.hidden = !open;
    elements.userChip.setAttribute('aria-expanded', String(open));
  });

elements.cardBackgroundButton.addEventListener('click', () => elements.cardBackgroundFile.click());

elements.cardImageButton.addEventListener('click', () => elements.cardImageFile.click());

elements.cardTextButton.addEventListener('click', addCardText);

elements.cardTemplateButton.addEventListener('click', applyCardTemplate);

elements.cardUndoButton.addEventListener('click', undoCardDesign);

elements.cardRedoButton.addEventListener('click', redoCardDesign);

elements.cardBackgroundFile.addEventListener('change', () => uploadCardMedia(elements.cardBackgroundFile, 'background'));

elements.cardImageFile.addEventListener('change', () => uploadCardMedia(elements.cardImageFile, 'image'));

elements.cardLayerList.addEventListener('click', (event) => {
    const visibility = event.target.closest('[data-card-visibility]');
    if (visibility) {
      const selection = visibility.dataset.cardVisibility;
      const target = cardSelectionObject(selection);
      if (!target) return;
      mutateCardDesign(() => { target.visible = target.visible === false; });
      state.cardSelection = selection;
      renderCardStudio();
      return;
    }
    const button = event.target.closest('[data-card-selection]');
    if (!button) return;
    state.cardSelection = button.dataset.cardSelection;
    renderCardStudio();
  });

elements.cardInspector.addEventListener('input', (event) => {
    const input = event.target.closest('[data-card-field]');
    if (!input || !state.profile) return;
    beginCardInputHistory();
    setCardField(input.dataset.cardField, input.value);
    constrainCardSelection();
    const constrained = getCardField(input.dataset.cardField);
    if (typeof constrained === 'number') input.value = String(Math.round(constrained * 100) / 100);
    if (input.tagName === 'TEXTAREA') renderCardLayers();
    scheduleCardDraw();
    refreshCardDirty();
  });

elements.cardInspector.addEventListener('focusin', (event) => {
    if (event.target.closest('[data-card-field]')) beginCardInputHistory();
  });

elements.cardInspector.addEventListener('change', (event) => {
    if (event.target.closest('[data-card-field]')) finishCardInputHistory();
  });

elements.cardInspector.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-card-field]')) finishCardInputHistory();
  });

elements.cardInspector.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-card-toggle]');
    if (toggle) {
      const path = toggle.dataset.cardToggle;
      mutateCardDesign(() => {
        setCardField(path, !getCardField(path));
        constrainCardSelection();
      });
      renderCardInspector();
      scheduleCardDraw();
      refreshCardDirty();
      return;
    }
    if (!event.target.closest('[data-delete-card-layer]')) return;
    const layer = cardLayerBySelection();
    if (!layer) return;
    mutateCardDesign(() => {
      state.profile.design.layers = state.profile.design.layers.filter((item) => item.id !== layer.id);
    });
    state.cardSelection = 'background';
    renderCardStudio();
  });

elements.cardCanvasWrap.addEventListener('pointerdown', beginCardPointer);

elements.cardCanvasWrap.addEventListener('pointermove', moveCardPointer);

elements.cardCanvasWrap.addEventListener('pointerup', endCardPointer);

elements.cardCanvasWrap.addEventListener('pointercancel', endCardPointer);

elements.cardSaveButton.addEventListener('click', saveProfileCard);

elements.cardResetButton.addEventListener('click', () => {
    if (!state.profile || state.cardSaving || !state.profileSavedSnapshot) return;
    mutateCardDesign(() => { state.profile.design = JSON.parse(state.profileSavedSnapshot); });
    state.cardSelection = 'background';
    renderCardStudio();
    showToast('Unsaved card changes reset.');
  });

window.addEventListener('keydown', (event) => {
    if (!state.profile || elements.profileShell.hidden || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoCardDesign();
      else undoCardDesign();
    } else if (key === 'y') {
      event.preventDefault();
      redoCardDesign();
    }
  });

elements.saveButton.addEventListener('click', () => {
    if (state.currentView === 'message-templates') saveMessageTemplate().catch((error) => showToast(error.message, 'error'));
    else if (state.currentView === 'reaction-roles') saveReactionRole().catch((error) => showToast(error.message, 'error'));
    else saveConfig();
  });

elements.resetButton.addEventListener('click', () => {
    if (state.currentView === 'message-templates') resetTemplateDraft();
    else if (state.currentView === 'reaction-roles') {
      const stored = state.reactionRoles.items.find((item) => item.id === state.reactionRoleSelectedId);
      if (stored) { state.reactionRoleDraft = clone(stored); state.reactionRoleSavedSnapshot = reactionRoleSnapshot(); renderReactionRoles(); showToast('Unsaved Reaction Role changes reset.'); }
    }
    else resetUnsavedChanges();
  });

elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });

elements.levelingView.addEventListener('input', (event) => updateLevelingFromControl(event.target));

elements.levelingView.addEventListener('change', (event) => updateLevelingFromControl(event.target));

elements.welcomeMessagesView.addEventListener('input', (event) => updateMemberMessagesFromControl(event.target));

elements.welcomeMessagesView.addEventListener('change', (event) => updateMemberMessagesFromControl(event.target));

elements.gamesView.addEventListener('change', (event) => {
    if (!state.config?.counting || !state.config?.games) return;
    if (event.target === elements.countingChannel) state.config.counting.channelId = event.target.value;
    if (event.target === $('#lotteryChannel')) state.config.games.lotteryChannelId = event.target.value;
    const channelIndex = event.target.dataset.gameSettingChannels;
    const commandIndex = event.target.dataset.gameSettingCommands;
    if (channelIndex !== undefined) state.config.games.commandSettings[Number(channelIndex)].channelIds = [...event.target.selectedOptions].map((option) => option.value).filter(Boolean);
    if (commandIndex !== undefined) state.config.games.commandSettings[Number(commandIndex)].commands = [...event.target.selectedOptions].map((option) => option.value).filter(Boolean);
    refreshDirty();
  });

elements.gamesView.addEventListener('click', (event) => {
    if (!state.config?.games) return;
    if (event.target === elements.gameAddCommandSetting) {
      state.config.games.commandSettings.push({ id: clientReactionId('game'), channelIds: [], commands: [] });
      renderGameCommandSettings();
      refreshDirty();
      return;
    }
    const index = event.target.dataset.removeGameSetting;
    if (index !== undefined) {
      state.config.games.commandSettings.splice(Number(index), 1);
      renderGameCommandSettings();
      refreshDirty();
    }
  });

elements.messageTemplatesView.addEventListener('input', (event) => {
    if (event.target === elements.templateSearch) return renderTemplateList();
    if (event.target === elements.templateJsonEditor) return updateTemplateJsonFromInput();
    updateTemplateDraftFromControl(event.target);
  });

elements.messageTemplatesView.addEventListener('change', (event) => updateTemplateDraftFromControl(event.target));

elements.reactionRolesView.addEventListener('input', (event) => updateReactionRoleFromControl(event.target));

elements.reactionRolesView.addEventListener('change', (event) => updateReactionRoleFromControl(event.target));

for (const preview of [
    elements.levelingMessagePreview, elements.levelingAdditionalContainers,
    elements.welcomeMessagePreview, elements.welcomeAdditionalContainers,
    elements.templateMessagePreview, elements.templateAdditionalContainers,
    elements.reactionRoleMessagePreview, elements.reactionRoleAdditionalContainers,
    elements.xpDropMessagePreview, elements.xpDropClaimPreview,
  ]) {
    preview.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-inline-message-display]');
      if (edit) return beginInlineMessageEdit(edit);
      const done = event.target.closest('[data-inline-message-done]');
      if (done) finishInlineMessageEdit(done.closest('[data-inline-message-editor]'));
    });
    preview.addEventListener('keydown', (event) => {
      const edit = event.target.closest('[data-inline-message-display]');
      if (edit && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        beginInlineMessageEdit(edit);
        return;
      }
      if (event.target.matches('[data-inline-message-input]') && event.key === 'Escape') event.target.blur();
    });
    preview.addEventListener('focusout', (event) => {
      const editor = event.target.closest('[data-inline-message-editor]');
      if (!editor) return;
      window.setTimeout(() => {
        if (!editor.contains(document.activeElement)) finishInlineMessageEdit(editor);
      }, 0);
    });
    preview.addEventListener('scroll', (event) => {
      const input = event.target.closest?.('[data-inline-message-input]');
      const mirror = input?.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-highlight]');
      if (input && mirror) mirror.style.transform = `translateY(-${input.scrollTop}px)`;
    }, true);
  }

elements.levelingAddReward.addEventListener('click', addLevelReward);

elements.levelingAddBoost.addEventListener('click', addLevelBoost);

elements.xpDropAdd.addEventListener('click', addXpDrop);

elements.xpDropTestButton.addEventListener('click', sendXpDropTest);

elements.xpDropTestCrate.addEventListener('change', renderXpDropMessagePreviews);

elements.xpDropVariables.addEventListener('click', async (event) => {
    const variable = event.target.closest('[data-copy-variable]');
    if (!variable) return;
    await navigator.clipboard?.writeText?.(variable.dataset.copyVariable).catch(() => null);
    showToast(`${variable.dataset.copyVariable} copied.`);
  });

elements.xpDropList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-xp-drop]');
    if (!button || !state.config) return;
    state.config.leveling.xpDrops.crates.splice(Number(button.dataset.removeXpDrop), 1);
    renderXpDrops();
    refreshDirty();
  });

elements.xpDropList.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-xp-drop-media]');
    if (upload) uploadXpDropMedia(upload);
  });

elements.levelingContainerAdd.addEventListener('click', () => {
    state.config.leveling.announcements.layout.container = !state.config.leveling.announcements.layout.container;
    renderMessagePreview();
    refreshDirty();
  });

elements.levelingAdditionalContainerAdd.addEventListener('click', () => {
    const announcements = state.config?.leveling?.announcements;
    if (!announcements || announcements.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    announcements.additionalContainers.push(newAdditionalContainer(announcements.layout.accentColor));
    renderMessagePreview();
    refreshDirty();
    elements.levelingAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });

elements.levelingAdditionalContainers.addEventListener('click', (event) => {
    const announcements = state.config?.leveling?.announcements;
    if (!announcements) return;
    const removeContainer = event.target.closest('[data-remove-leveling-additional-container]');
    if (removeContainer) {
      announcements.additionalContainers.splice(Number(removeContainer.dataset.removeLevelingAdditionalContainer), 1);
      renderMessagePreview(); refreshDirty(); return;
    }
    const addGallery = event.target.closest('[data-add-leveling-additional-gallery]');
    if (addGallery) {
      const layout = announcements.additionalContainers[Number(addGallery.dataset.addLevelingAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderMessagePreview(); refreshDirty(); return;
    }
    const removeGallery = event.target.closest('[data-remove-leveling-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeLevelingAdditionalGallery.split(':').map(Number);
      announcements.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderMessagePreview(); refreshDirty();
    }
  });

elements.levelingAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-leveling-media-upload]');
    if (upload) uploadLevelingMedia(upload);
  });

elements.levelingVariablesToggle.addEventListener('click', () => toggleComposerPanel('variables'));

elements.levelingThumbnailAdd.addEventListener('click', () => toggleComposerPanel('thumbnail'));

elements.levelingGalleryAdd.addEventListener('click', () => toggleComposerPanel('gallery'));

elements.levelingAccentButton.addEventListener('click', () => elements.levelingAccentColor.click());

elements.levelingComposerPanel.addEventListener('click', async (event) => {
    const variable = event.target.closest('[data-copy-variable]');
    if (variable) {
      await navigator.clipboard?.writeText?.(variable.dataset.copyVariable).catch(() => null);
      return showToast(`${variable.dataset.copyVariable} copied.`);
    }
    if (event.target.closest('[data-remove-thumbnail]')) {
      const layout = state.config.leveling.announcements.layout;
      layout.thumbnailEnabled = false;
      layout.thumbnailUrl = '';
      renderMessagePreview();
      refreshDirty();
      return;
    }
    if (event.target.closest('[data-add-gallery-url]')) {
      const gallery = state.config.leveling.announcements.layout.galleryUrls;
      if (gallery.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      gallery.push('');
      renderComposerPanel();
      refreshDirty();
      elements.levelingComposerPanel.querySelector('[data-leveling-gallery-url]:last-of-type')?.focus();
      return;
    }
    const button = event.target.closest('[data-remove-gallery]');
    if (!button) return;
    state.config.leveling.announcements.layout.galleryUrls.splice(Number(button.dataset.removeGallery), 1);
    renderMessagePreview();
    refreshDirty();
  });

elements.levelingComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-leveling-media-upload]');
    if (upload) uploadLevelingMedia(upload);
  });

elements.welcomeMessagesView.querySelector('.member-message-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-member-event]');
    if (!button || button.dataset.memberEvent === state.memberMessageEvent) return;
    state.memberMessageEvent = button.dataset.memberEvent;
    state.memberMessageComposerPanel = '';
    renderWelcomeMessages();
  });

elements.welcomeEventReset.addEventListener('click', resetCurrentMemberMessage);

elements.welcomeContainerAdd.addEventListener('click', () => {
    const event = currentMemberMessage();
    if (!event) return;
    event.layout.container = !event.layout.container;
    renderWelcomeMessagePreview();
    refreshDirty();
  });

elements.welcomeAdditionalContainerAdd.addEventListener('click', () => {
    const current = currentMemberMessage();
    if (!current || current.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    current.additionalContainers.push(newAdditionalContainer(current.layout.accentColor));
    renderWelcomeMessagePreview(); refreshDirty();
    elements.welcomeAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });

elements.welcomeAdditionalContainers.addEventListener('click', (event) => {
    const current = currentMemberMessage();
    if (!current) return;
    const removeContainer = event.target.closest('[data-remove-welcome-additional-container]');
    if (removeContainer) {
      current.additionalContainers.splice(Number(removeContainer.dataset.removeWelcomeAdditionalContainer), 1);
      renderWelcomeMessagePreview(); refreshDirty(); return;
    }
    const addGallery = event.target.closest('[data-add-welcome-additional-gallery]');
    if (addGallery) {
      const layout = current.additionalContainers[Number(addGallery.dataset.addWelcomeAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderWelcomeMessagePreview(); refreshDirty(); return;
    }
    const removeGallery = event.target.closest('[data-remove-welcome-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeWelcomeAdditionalGallery.split(':').map(Number);
      current.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderWelcomeMessagePreview(); refreshDirty();
    }
  });

elements.welcomeAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-welcome-media-upload]');
    if (upload) uploadWelcomeMedia(upload);
  });

elements.welcomeVariablesToggle.addEventListener('click', () => toggleWelcomeComposerPanel('variables'));

elements.welcomeThumbnailAdd.addEventListener('click', () => toggleWelcomeComposerPanel('thumbnail'));

elements.welcomeGalleryAdd.addEventListener('click', () => toggleWelcomeComposerPanel('gallery'));

elements.welcomeAccentButton.addEventListener('click', () => elements.welcomeAccentColor.click());

elements.welcomeComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-member-variable]');
    if (variable) return insertMemberMessageVariable(variable.dataset.insertMemberVariable);
    const current = currentMemberMessage();
    if (!current) return;
    if (event.target.closest('[data-remove-welcome-thumbnail]')) {
      current.layout.thumbnailEnabled = false;
      current.layout.thumbnailUrl = '';
      renderWelcomeMessagePreview();
      refreshDirty();
      return;
    }
    if (event.target.closest('[data-add-welcome-gallery-url]')) {
      if (current.layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      current.layout.galleryUrls.push('');
      renderWelcomeComposerPanel();
      refreshDirty();
      elements.welcomeComposerPanel.querySelector('[data-welcome-gallery-url]:last-of-type')?.focus();
      return;
    }
    const remove = event.target.closest('[data-remove-welcome-gallery]');
    if (!remove) return;
    current.layout.galleryUrls.splice(Number(remove.dataset.removeWelcomeGallery), 1);
    renderWelcomeMessagePreview();
    refreshDirty();
  });

elements.welcomeComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-welcome-media-upload]');
    if (upload) uploadWelcomeMedia(upload);
  });

for (const button of [elements.templateCreateButton, elements.templateListCreate, elements.templateEmptyCreate]) {
    button.addEventListener('click', () => createMessageTemplate().catch((error) => showToast(error.message, 'error')));
  }

elements.templateFolderCreate.addEventListener('click', () => createTemplateFolder().catch((error) => showToast(error.message, 'error')));

elements.templateFolderList.addEventListener('click', async (event) => {
    const rename = event.target.closest('[data-template-folder-rename]');
    if (rename) return renameTemplateFolder(rename.dataset.templateFolderRename).catch((error) => showToast(error.message, 'error'));
    const remove = event.target.closest('[data-template-folder-delete]');
    if (remove) return deleteTemplateFolder(remove.dataset.templateFolderDelete).catch((error) => showToast(error.message, 'error'));
    const folder = event.target.closest('[data-template-folder]');
    if (!folder) return;
    const nextFolderId = folder.dataset.templateFolder;
    const items = visibleTemplates(nextFolderId);
    if (state.templateSelectedId && !items.some((item) => item.id === state.templateSelectedId) && templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Opening this collection will close the current draft.', confirmLabel: 'Discard' });
      if (!confirmed) return;
    }
    state.templateFolderId = nextFolderId;
    renderTemplateFolders();
    renderTemplateList();
    updateTemplateDeepLink();
    if (state.templateSelectedId && !items.some((item) => item.id === state.templateSelectedId)) {
      if (items[0]) selectMessageTemplate(items[0].id, { force: true }).catch((error) => showToast(error.message, 'error'));
      else { state.templateSelectedId = ''; state.templateDraft = null; state.templateSavedSnapshot = ''; renderTemplateEditor(); }
    }
  });

elements.templateList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-template-id]');
    if (item) selectMessageTemplate(item.dataset.templateId).catch((error) => showToast(error.message, 'error'));
  });

elements.templateEditor.querySelector('.template-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-template-tab]');
    if (!tab) return;
    state.templateTab = tab.dataset.templateTab;
    renderTemplateEditor();
  });

elements.templateEditor.addEventListener('click', async (event) => {
    const mode = event.target.closest('[data-template-control-mode]');
    if (mode && state.templateDraft) {
      state.templateDraft.controls.type = mode.dataset.templateControlMode;
      state.templateSaveError = '';
      if (state.templateDraft.controls.type === 'dropdown' && !state.templateDraft.controls.dropdowns.length) {
        state.templateDraft.controls.dropdowns.push(newTemplateDropdown());
      }
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty(); return;
    }
    const emoji = event.target.closest('[data-template-control-emoji]');
    if (emoji) {
      const spec = emoji.dataset.templateControlEmoji;
      openEmojiPicker({ type: spec.startsWith('button:') ? 'template-button' : 'template-option', spec, trigger: emoji })
        .catch((error) => showToast(error.message, 'error'));
      return;
    }
    const configure = event.target.closest('[data-template-configure-action]');
    if (configure) { openTemplateActionDialog(configure.dataset.templateConfigureAction); return; }
    const duplicate = event.target.closest('[data-template-control-duplicate]');
    if (duplicate) {
      const target = templateControlAt(duplicate.dataset.templateControlDuplicate);
      if (!target?.dropdown) return;
      if (target.entries.length >= 25) return showToast('A dropdown supports up to 25 options.', 'error');
      const copy = clone(target.entry);
      copy.id = clientReactionId('control');
      copy.title = duplicateTemplateOptionTitle(target.dropdown, target.entry.title);
      target.entries.splice(target.index + 1, 0, copy);
      target.entries.forEach((entry, index) => { entry.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-option-title="${target.dropdown.id}:${copy.id}"]`)?.focus();
      return;
    }
    const remove = event.target.closest('[data-template-control-remove]');
    if (remove) {
      const target = templateControlAt(remove.dataset.templateControlRemove);
      if (!target) return;
      if (target.dropdown && target.entries.length <= 1) {
        showToast('A dropdown must keep at least one option.', 'error');
        remove.focus();
        return;
      }
      if (target.dropdown) {
        const confirmed = await confirmAction({
          title: `Delete “${target.entry.title || 'this option'}”?`,
          copy: 'The option and its configured action will be removed from this unsaved draft.',
          confirmLabel: 'Delete option',
        });
        if (!confirmed) { remove.focus(); return; }
      }
      const focusEntry = target.entries[target.index + 1] || target.entries[target.index - 1];
      if (target) target.entries.splice(target.index, 1);
      target?.entries.forEach((entry, index) => { entry.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      if (target.dropdown && focusEntry) elements.templateControls.querySelector(`[data-template-option-title="${target.dropdown.id}:${focusEntry.id}"]`)?.focus();
      return;
    }
    const move = event.target.closest('[data-template-control-move]');
    if (move) {
      const value = move.dataset.templateControlMove;
      const separator = value.lastIndexOf(':');
      const target = templateControlAt(value.slice(0, separator));
      const delta = Number(value.slice(separator + 1));
      const to = target ? target.index + delta : -1;
      if (target?.entries[target.index] && target.entries[to]) { const [item] = target.entries.splice(target.index, 1); target.entries.splice(to, 0, item); target.entries.forEach((entry, index) => { entry.sortOrder = index; }); }
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-control-move^="${target?.spec}:"]`)?.focus();
      return;
    }
    const removeDropdown = event.target.closest('[data-template-dropdown-remove]');
    if (removeDropdown) {
      const resolved = templateDropdownAt(removeDropdown.dataset.templateDropdownRemove);
      if (!resolved) return;
      if (state.templateDraft.controls.dropdowns.length <= 1) {
        showToast('Dropdown mode must keep at least one dropdown.', 'error');
        removeDropdown.focus();
        return;
      }
      state.templateDraft.controls.dropdowns.splice(resolved.dropdownIndex, 1);
      state.templateDraft.controls.dropdowns.forEach((dropdown, index) => { dropdown.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      return;
    }
    const moveDropdown = event.target.closest('[data-template-dropdown-move]');
    if (moveDropdown) {
      const [id, deltaText] = moveDropdown.dataset.templateDropdownMove.split(':');
      const resolved = templateDropdownAt(id); const delta = Number(deltaText);
      const entries = state.templateDraft.controls.dropdowns; const to = resolved ? resolved.dropdownIndex + delta : -1;
      if (resolved && entries[to]) { const [dropdown] = entries.splice(resolved.dropdownIndex, 1); entries.splice(to, 0, dropdown); entries.forEach((entry, index) => { entry.sortOrder = index; }); }
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-dropdown-move^="${id}:"]`)?.focus();
      return;
    }
    const addOption = event.target.closest('[data-template-dropdown-add-option]');
    if (addOption) {
      const dropdown = templateDropdownAt(addOption.dataset.templateDropdownAddOption)?.dropdown;
      if (!dropdown || dropdown.options.length >= 25) return;
      const option = newTemplateOption(dropdown.options.length);
      dropdown.options.push(option);
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-option-title="${dropdown.id}:${option.id}"]`)?.focus();
    }
  });

elements.templateAddControl.addEventListener('click', () => {
    const draft = state.templateDraft; if (!draft || draft.controls.type === 'none') return;
    if (draft.controls.type === 'button') {
      if (draft.controls.buttons.length >= 25) return;
      draft.controls.buttons.push({ id: clientReactionId('control'), emoji: { id: '', name: '✨', animated: false, source: 'default' }, label: `Button ${draft.controls.buttons.length + 1}`, style: 'Secondary', sortOrder: draft.controls.buttons.length, action: { type: 'send_message', templateId: '' } });
    }
    else {
      if (draft.controls.dropdowns.length >= 5) return;
      draft.controls.dropdowns.push(newTemplateDropdown(draft.controls.dropdowns.length));
    }
    state.templateSaveError = '';
    renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    refreshTemplateDirty();
    (draft.controls.type === 'button'
      ? elements.templateControls.querySelector('[data-template-configure-action]:last-of-type')
      : elements.templateControls.querySelector(`[data-template-dropdown-card="${draft.controls.dropdowns.at(-1).id}"] [data-template-dropdown-placeholder]`))?.focus();
  });

elements.templateDuplicateButton.addEventListener('click', () => duplicateMessageTemplate().catch((error) => showToast(error.message, 'error')));

elements.templateDeleteButton.addEventListener('click', () => deleteMessageTemplate().catch((error) => showToast(error.message, 'error')));

elements.templateContainerAdd.addEventListener('click', () => {
    if (!state.templateDraft) return;
    state.templateDraft.layout.container = !state.templateDraft.layout.container;
    renderTemplateComposerPreview();
  });

elements.templateAdditionalContainerAdd.addEventListener('click', () => {
    if (!state.templateDraft || state.templateDraft.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    state.templateDraft.additionalContainers.push(newAdditionalContainer(state.templateDraft.layout.accentColor));
    renderTemplateComposerPreview();
    elements.templateAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });

elements.templateAdditionalContainers.addEventListener('click', (event) => {
    if (!state.templateDraft) return;
    const removeContainer = event.target.closest('[data-remove-template-additional-container]');
    if (removeContainer) {
      state.templateDraft.additionalContainers.splice(Number(removeContainer.dataset.removeTemplateAdditionalContainer), 1);
      renderTemplateComposerPreview(); return;
    }
    const addGallery = event.target.closest('[data-add-template-additional-gallery]');
    if (addGallery) {
      const layout = state.templateDraft.additionalContainers[Number(addGallery.dataset.addTemplateAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderTemplateComposerPreview(); return;
    }
    const removeGallery = event.target.closest('[data-remove-template-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeTemplateAdditionalGallery.split(':').map(Number);
      state.templateDraft.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderTemplateComposerPreview();
    }
  });

elements.templateAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-template-media-upload]');
    if (upload) uploadTemplateMedia(upload);
  });

elements.templateVariablesToggle.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'variables' ? '' : 'variables'; renderTemplateComposerPanel();
  });

elements.templateThumbnailAdd.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'thumbnail' ? '' : 'thumbnail'; renderTemplateComposerPanel();
  });

elements.templateGalleryAdd.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'gallery' ? '' : 'gallery'; renderTemplateComposerPanel();
  });

elements.templateAccentButton.addEventListener('click', () => elements.templateAccentColor.click());

elements.templateComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-template-variable]');
    if (variable) return insertTemplateVariable(variable.dataset.insertTemplateVariable);
    if (!state.templateDraft) return;
    if (event.target.closest('[data-remove-template-thumbnail]')) {
      state.templateDraft.layout.thumbnailEnabled = false;
      state.templateDraft.layout.thumbnailUrl = '';
      return renderTemplateComposerPreview();
    }
    if (event.target.closest('[data-add-template-gallery]')) {
      if (state.templateDraft.layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      state.templateDraft.layout.galleryUrls.push('');
      renderTemplateComposerPanel(); syncTemplateJson(); refreshTemplateDirty();
      return elements.templateComposerPanel.querySelector('[data-template-gallery-url]:last-of-type')?.focus();
    }
    const remove = event.target.closest('[data-remove-template-gallery]');
    if (!remove) return;
    state.templateDraft.layout.galleryUrls.splice(Number(remove.dataset.removeTemplateGallery), 1);
    renderTemplateComposerPreview();
  });

elements.templateComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-template-media-upload]');
    if (upload) uploadTemplateMedia(upload);
  });

elements.templateJsonFormat.addEventListener('click', () => {
    if (!updateTemplateJsonFromInput()) return;
    syncTemplateJson(true);
    showToast('Template JSON formatted.');
  });

elements.templateJsonImport.addEventListener('click', () => {
    if (!updateTemplateJsonFromInput(true)) elements.templateJsonEditor.focus();
    else syncTemplateJson(true);
  });

elements.templateJsonCopy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText?.(elements.templateJsonEditor.value).catch(() => null);
    showToast('Template JSON copied.');
  });

elements.templateSendTest.addEventListener('click', () => sendCurrentTemplate('test'));

elements.templateSendNow.addEventListener('click', () => sendCurrentTemplate('send'));

elements.templateCopyLink.addEventListener('click', async () => {
    await navigator.clipboard?.writeText?.(elements.templateShareLink.value).catch(() => null);
    showToast('Authenticated template link copied.');
  });

elements.templateActionSave.addEventListener('click', saveTemplateActionDialog);

elements.levelingUseTemplate.addEventListener('click', () => openTemplatePicker('leveling'));

elements.welcomeUseTemplate.addEventListener('click', () => openTemplatePicker('memberMessages'));

elements.levelingSaveAsTemplate.addEventListener('click', () => saveComposerAsTemplate('leveling').catch((error) => showToast(error.message, 'error')));

elements.welcomeSaveAsTemplate.addEventListener('click', () => saveComposerAsTemplate('memberMessages').catch((error) => showToast(error.message, 'error')));

elements.templatePickerSearch.addEventListener('input', renderTemplatePicker);

elements.templatePickerList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-pick-template]');
    if (item) applyTemplateSnapshot(item.dataset.pickTemplate).catch((error) => showToast(error.message, 'error'));
  });

for (const button of [elements.reactionRoleCreate, elements.reactionRoleEmptyCreate]) button.addEventListener('click', () => createReactionRole().catch((error) => showToast(error.message, 'error')));

elements.reactionRoleList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reaction-role-id]');
    if (button) selectReactionRole(button.dataset.reactionRoleId).catch((error) => showToast(error.message, 'error'));
  });

elements.reactionRoleEditor.querySelector('.reaction-role-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-reaction-tab]'); if (!tab) return;
    state.reactionRoleTab = tab.dataset.reactionTab; renderReactionRoleEditor();
  });

elements.reactionRoleEditor.addEventListener('click', (event) => {
    const mode = event.target.closest('[data-reaction-mode]');
    if (mode && state.reactionRoleDraft) { state.reactionRoleDraft.interactionType = mode.dataset.reactionMode; renderReactionRoleEditor(); return; }
    const emoji = event.target.closest('[data-reaction-emoji]');
    if (emoji) { const [type, index] = emoji.dataset.reactionEmoji.split(':'); openEmojiPicker({ type: type === 'button' ? 'button' : 'option', index: Number(index) }); return; }
    const remove = event.target.closest('[data-rr-remove]');
    if (remove) { reactionRoleEntries().splice(Number(remove.dataset.rrRemove), 1); renderReactionRoleEditor(); return; }
    const move = event.target.closest('[data-rr-move]');
    if (move) {
      const [from, delta] = move.dataset.rrMove.split(':').map(Number); const entries = reactionRoleEntries(); const to = from + delta;
      if (entries[from] && entries[to]) { const [item] = entries.splice(from, 1); entries.splice(to, 0, item); entries.forEach((entry, index) => { entry.sortOrder = index; }); renderReactionRoleEditor(); }
    }
  });

elements.reactionRoleAddControl.addEventListener('click', () => {
    const draft = state.reactionRoleDraft; if (!draft || reactionRoleEntries().length >= 25) return;
    const used = new Set(reactionRoleEntries().map((entry) => entry.roleId));
    const role = (state.directory.roles || []).find((entry) => entry.editable !== false && !entry.administrator && !used.has(entry.id));
    if (draft.interactionType === 'button') draft.buttons.push({ id: clientReactionId('button'), emoji: { id: '', name: '🎭', animated: false, source: 'default' }, label: role?.name || `Role ${draft.buttons.length + 1}`, style: 'Secondary', roleId: role?.id || '', sortOrder: draft.buttons.length });
    else draft.dropdown.options.push({ id: clientReactionId('option'), emoji: { id: '', name: '🎭', animated: false, source: 'default' }, title: role?.name || `Role ${draft.dropdown.options.length + 1}`, description: '', roleId: role?.id || '', sortOrder: draft.dropdown.options.length });
    renderReactionRoleEditor();
  });

elements.reactionRoleDuplicate.addEventListener('click', () => duplicateReactionRole().catch((error) => showToast(error.message, 'error')));

elements.reactionRoleDelete.addEventListener('click', () => deleteReactionRole().catch((error) => showToast(error.message, 'error')));

elements.reactionRoleSaveDraft.addEventListener('click', () => saveReactionRole().catch((error) => showToast(error.message, 'error')));

elements.reactionRolePublish.addEventListener('click', () => publishReactionRole().catch((error) => showToast(error.message, 'error')));

elements.reactionRoleUseTemplate.addEventListener('click', () => openTemplatePicker('reactionRoles'));

elements.reactionRoleContainerToggle.addEventListener('click', () => { if (!state.reactionRoleDraft) return; state.reactionRoleDraft.message.layout.container = !state.reactionRoleDraft.message.layout.container; renderReactionRoleEditor(); });

elements.reactionRoleAdditionalContainer.addEventListener('click', () => { const draft = state.reactionRoleDraft; if (!draft || draft.message.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return; draft.message.additionalContainers.push(newAdditionalContainer(draft.message.layout.accentColor)); renderReactionRoleEditor(); });

elements.reactionRoleVariablesToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'variables' ? '' : 'variables'; renderReactionRoleComposerPanel(); });

elements.reactionRoleThumbnailToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'thumbnail' ? '' : 'thumbnail'; renderReactionRoleComposerPanel(); });

elements.reactionRoleGalleryToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'gallery' ? '' : 'gallery'; renderReactionRoleComposerPanel(); });

elements.reactionRoleAccentButton.addEventListener('click', () => elements.reactionRoleAccentColor.click());

elements.reactionRoleComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-reaction-variable]'); if (variable) return insertReactionRoleVariable(variable.dataset.insertReactionVariable);
    const draft = state.reactionRoleDraft; if (!draft) return;
    if (event.target.closest('[data-remove-reaction-thumbnail]')) { draft.message.layout.thumbnailEnabled = false; draft.message.layout.thumbnailUrl = ''; renderReactionRoleEditor(); return; }
    if (event.target.closest('[data-add-reaction-gallery]')) { if (draft.message.layout.galleryUrls.length < 10) draft.message.layout.galleryUrls.push(''); renderReactionRoleEditor(); return; }
    const remove = event.target.closest('[data-remove-reaction-gallery]'); if (remove) { draft.message.layout.galleryUrls.splice(Number(remove.dataset.removeReactionGallery), 1); renderReactionRoleEditor(); }
  });

elements.reactionRoleComposerPanel.addEventListener('change', (event) => { const input = event.target.closest('[data-reaction-media-upload]'); if (input) uploadReactionRoleMedia(input); });

elements.reactionRoleAdditionalContainers.addEventListener('click', (event) => {
    const draft = state.reactionRoleDraft; if (!draft) return;
    const remove = event.target.closest('[data-remove-reaction-additional-container]'); if (remove) { draft.message.additionalContainers.splice(Number(remove.dataset.removeReactionAdditionalContainer), 1); renderReactionRoleEditor(); return; }
    const addGallery = event.target.closest('[data-add-reaction-additional-gallery]'); if (addGallery) { const layout = draft.message.additionalContainers[Number(addGallery.dataset.addReactionAdditionalGallery)]?.layout; if (layout?.galleryUrls.length < 10) layout.galleryUrls.push(''); renderReactionRoleEditor(); return; }
    const removeGallery = event.target.closest('[data-remove-reaction-additional-gallery]'); if (removeGallery) { const [containerIndex, mediaIndex] = removeGallery.dataset.removeReactionAdditionalGallery.split(':').map(Number); draft.message.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1); renderReactionRoleEditor(); }
  });

elements.reactionRoleAdditionalContainers.addEventListener('change', (event) => { const input = event.target.closest('[data-reaction-media-upload]'); if (input) uploadReactionRoleMedia(input); });

document.addEventListener('selectionchange', () => rememberInlineTextCaret(document.activeElement));

document.addEventListener('pointerdown', () => rememberInlineTextCaret(document.activeElement), true);

document.addEventListener('keyup', (event) => rememberInlineTextCaret(event.target), true);

document.addEventListener('input', (event) => rememberInlineTextCaret(event.target), true);

elements.levelingEmojiToggle.addEventListener('click', () => openEmojiPicker('leveling').catch((error) => showToast(error.message, 'error')));

elements.welcomeEmojiToggle.addEventListener('click', () => openEmojiPicker('memberMessages').catch((error) => showToast(error.message, 'error')));

elements.templateEmojiToggle.addEventListener('click', () => openEmojiPicker('messageTemplate').catch((error) => showToast(error.message, 'error')));

elements.xpDropEmojiToggle.addEventListener('click', () => openEmojiPicker('xpDrop').catch((error) => showToast(error.message, 'error')));

elements.xpClaimEmojiToggle.addEventListener('click', () => openEmojiPicker('xpClaim').catch((error) => showToast(error.message, 'error')));

elements.reactionRoleEmojiToggle.addEventListener('click', () => openEmojiPicker('reactionRole').catch((error) => showToast(error.message, 'error')));

elements.emojiPickerClose.addEventListener('click', closeEmojiPicker);

elements.emojiPickerSearch.addEventListener('input', () => {
    window.clearTimeout(emojiSearchTimer.value);
    elements.emojiPickerStatus.className = 'emoji-picker-status';
    elements.emojiPickerStatus.textContent = 'Searching…';
    emojiSearchTimer.value = window.setTimeout(renderEmojiPicker, EMOJI_SEARCH_DEBOUNCE_MS);
  });

document.querySelector('.emoji-picker-tabs').addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-emoji-section]'); if (!tab) return;
    state.emojiSection = tab.dataset.emojiSection;
    if (state.emojiSection === 'default' && !DEFAULT_EMOJI_DATA.value.groups.length) {
      elements.emojiPickerStatus.className = 'emoji-picker-status'; elements.emojiPickerStatus.textContent = 'Loading the default emoji catalog…';
      try { await ensureDefaultEmojiData(); }
      catch (error) { elements.emojiPickerStatus.className = 'emoji-picker-status error'; elements.emojiPickerStatus.textContent = error.message; return; }
    }
    if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.value.groups[0]?.id || '';
    renderEmojiPicker();
  });

elements.emojiPickerCategories.addEventListener('click', (event) => {
    const category = event.target.closest('[data-emoji-category]');
    if (!category) return;
    state.emojiCategory = category.dataset.emojiCategory;
    elements.emojiPickerSearch.value = '';
    renderEmojiPicker();
  });

elements.emojiPickerGrid.addEventListener('click', (event) => { const button = event.target.closest('[data-emoji-index]'); if (button) applyPickedEmoji(state.emojiPickerItems[Number(button.dataset.emojiIndex)]); });

elements.emojiPickerGrid.addEventListener('scroll', () => {
    if (elements.emojiPickerGrid.scrollTop + elements.emojiPickerGrid.clientHeight >= elements.emojiPickerGrid.scrollHeight - 120) appendEmojiPickerBatch();
  }, { passive: true });

elements.emojiPickerGrid.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    if (event.key === 'End' && state.emojiRenderedCount < state.emojiPickerItems.length) appendEmojiPickerBatch();
    const buttons = [...elements.emojiPickerGrid.querySelectorAll('[data-emoji-index]')]; const current = buttons.indexOf(event.target.closest('[data-emoji-index]')); if (current < 0) return;
    event.preventDefault(); const columns = Math.max(1, Math.round(elements.emojiPickerGrid.clientWidth / (buttons[0].offsetWidth + 6)));
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + delta)); buttons[next]?.focus();
  });

elements.emojiPickerDialog.addEventListener('click', (event) => { if (event.target !== elements.emojiPickerDialog) return; const box = elements.emojiPickerDialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeEmojiPicker(); });

elements.levelingRewards.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-level-reward]');
    if (!button || !state.config) return;
    state.config.leveling.roleRewards.splice(Number(button.dataset.removeLevelReward), 1);
    renderLevelingRewards();
    refreshDirty();
  });

elements.levelingBoosts.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-level-boost]');
    if (!button || !state.config) return;
    state.config.leveling.roleBoosts.splice(Number(button.dataset.removeLevelBoost), 1);
    renderLevelingBoosts();
    refreshDirty();
  });

document.addEventListener('click', (event) => {
    if (!event.target.closest('.account-wrap')) {
      elements.accountMenu.hidden = true;
      elements.userChip.setAttribute('aria-expanded', 'false');
    }
  });

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    elements.accountMenu.hidden = true;
    elements.userChip.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-nav-open');
    elements.mobileNavToggle?.setAttribute('aria-expanded', 'false');
  });

elements.mobileNavToggle?.addEventListener('click', () => {
    const open = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', open);
    elements.mobileNavToggle.setAttribute('aria-expanded', String(open));
  });

document.querySelector('.nav-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

elements.ownerRefresh.addEventListener('click', loadOwner);

elements.ownerOverview.addEventListener('click', async (event) => {
    const load = event.target.closest('[data-owner-load]');
    if (load) {
      const guildId = load.dataset.ownerLoad;
      if (!state.guilds.some((guild) => guild.id === guildId)) state.guilds.push({ id: guildId, name: `Guild ${guildId}` });
      renderSession();
      await loadGuild(guildId);
      const preferred = state.config?.features?.leveling ? 'leveling' : 'member-messages';
      setView(preferred);
      return;
    }
    const toggle = event.target.closest('[data-owner-toggle]');
    if (toggle) handleOwnerToggle(toggle).catch((error) => showToast(error.message, 'error'));
  });

elements.ownerOverview.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-owner-feature]');
    if (!input) return;
    input.disabled = true;
    try {
      const featureInputs = [...input.closest('.feature-dropdown').querySelectorAll('[data-owner-feature]')];
      const features = Object.fromEntries(featureInputs.map((featureInput) => [featureInput.dataset.ownerFeature, featureInput.checked]));
      const payload = await api(`/api/owner/guilds/${input.dataset.guildId}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ features }),
      });
      if (state.guildId === input.dataset.guildId && state.config) {
        state.config.features = payload.features;
        state.config.leveling = normalizeLevelingConfig(payload.config);
        state.config.memberMessages = normalizeMemberMessagesConfig(payload.config);
        state.savedConfig = clone(state.config);
        state.savedSnapshot = snapshot();
        renderFeatureAccess();
      }
      showToast(`Leveling ${input.checked ? 'unlocked' : 'locked'} for this server.`);
      await loadOwner();
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      showToast(error.message, 'error');
    }
  });

elements.consoleClear.addEventListener('click', () => { state.consoleEntries = []; renderConsole(); });

elements.consoleToggle.addEventListener('click', () => {
    state.consolePaused = !state.consolePaused;
    elements.consoleToggle.textContent = state.consolePaused ? 'Resume' : 'Pause';
    if (!state.consolePaused) pollConsole().catch(() => null);
  });

window.addEventListener('beforeunload', (event) => {
    const dashboardDirty = state.config && snapshot() !== state.savedSnapshot;
    const profileDirty = state.profile && cardSnapshot() !== state.profileSavedSnapshot;
    const messageTemplateDirty = templateIsDirty();
    if (!dashboardDirty && !profileDirty && !messageTemplateDirty && !(state.reactionRoleDraft && reactionRoleSnapshot() !== state.reactionRoleSavedSnapshot)) return;
    event.preventDefault();
    event.returnValue = '';
  });

loadSession();
