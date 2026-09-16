// workspace: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { $, directoryEmojiItemCache, elements, state } from './state.js';
import { channelOptions, normalizeCountingConfig, normalizeGamesConfig, normalizeLevelingConfig, normalizeMemberMessagesConfig } from './leveling.js';
import { api, clone, setView, showToast } from './session.js';
import { normalizeMessageTemplatesClient, renderLeveling, renderTemplateWorkspace, selectMessageTemplate, templateIsDirty } from './templates.js';
import { normalizeReactionRolesClient, reactionRoleIsDirty, renderReactionRoles } from './roles.js';
import { renderWelcomeMessages } from './welcome.js';
import { workspaceStatus } from './navigation.js';

export function renderGames() {
    if (!state.config?.counting) return;
    $('#lotteryChannel').innerHTML = channelOptions(state.config.games.lotteryChannelId,
      channel => channel.sendable === true && channel.kind !== 'forum', 'Use Games channel (automatic)');
    elements.countingChannel.innerHTML = channelOptions(
      state.config.counting.channelId,
      (channel) => channel.sendable === true && channel.kind !== 'forum',
      'Select a channel',
    );
    renderGameCommandSettings();
    refreshDirty();
  }

export function renderGameCommandSettings() {
    const settings = state.config?.games?.commandSettings || [];
    const commandOptions = [
      ['cs-work', 'Work (/cs-work and cswork)'],
      ['cs-beg', 'Beg (/cs-beg and csbeg)'],
      ['cs-balance', 'Silver & Bronze balance (/cs-balance and csbalance)'],
      ['cs-inventory', 'Inventory (/cs-inventory and csinventory)'],
      ['cs-achievements', 'Achievements (/cs-achievements and csachievements)'],
      ['cs-shop', 'Shop (/cs-shop and csshop)'],
      ['cs-trivia', 'Trivia (/cs-trivia and cstrivia)'],
    ];
    elements.gameCommandSettings.innerHTML = settings.length ? settings.map((setting, index) => `
      <article class="game-command-setting" data-game-setting="${index}">
        <label>Channels <small>Select one or more</small><select multiple data-game-setting-channels="${index}">${channelOptions(setting.channelIds, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose channels')}</select></label>
        <label>Commands <small>Select one or more</small><select multiple data-game-setting-commands="${index}">${commandOptions.map(([value, label]) => `<option value="${value}" ${setting.commands.includes(value) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button type="button" data-remove-game-setting="${index}">Remove</button>
      </article>`).join('') : '<div class="empty-state"><strong>No command settings</strong><span>Game commands are available in every channel.</span></div>';
  }

export function renderFeatureAccess() {
    if (!state.config) return;
    const levelingUnlocked = state.config.features?.leveling === true;
    elements.levelingNav.disabled = !levelingUnlocked;
    elements.levelingNav.classList.toggle('is-locked', !levelingUnlocked);
    const levelingLabel = elements.levelingNav.querySelector('small');
    if (levelingLabel) levelingLabel.textContent = levelingUnlocked ? 'XP & rewards' : 'Locked by owner';
    elements.levelingNav.title = levelingUnlocked ? '' : 'The bot owner must unlock Leveling for this server.';
    if (!levelingUnlocked && state.currentView === 'leveling') {
      setView('member-messages');
    }
  }

export function snapshot(config = state.config) {
    if (!config) return '';
    return JSON.stringify({
      leveling: config.leveling,
      memberMessages: config.memberMessages,
      counting: config.counting,
      games: config.games,
    });
  }

export function refreshDirty() {
    const templateMode = state.currentView === 'message-templates';
    const reactionMode = state.currentView === 'reaction-roles';
    const dirty = templateMode ? templateIsDirty() : reactionMode ? reactionRoleIsDirty() : snapshot() !== state.savedSnapshot;
    const saving = templateMode ? state.templateSaving : reactionMode ? state.reactionRoleSaving : state.saving;
    elements.saveDock.hidden = !dirty && !saving;
    elements.saveState.textContent = saving
      ? templateMode ? 'Saving template…' : reactionMode ? 'Saving Reaction Role…' : 'Applying changes…'
      : templateMode ? 'Unsaved template changes' : reactionMode ? 'Unsaved Reaction Role changes' : 'Unsaved changes';
    elements.saveButton.textContent = templateMode || reactionMode ? 'Save changes' : 'Apply changes';
    elements.saveButton.disabled = !dirty || saving || (templateMode && (!state.templateJsonValid || !state.templateControlsValid));
    elements.resetButton.disabled = !dirty || saving;
  }

export async function loadGuild(guildId) {
    if (!guildId) return;
    const deepLink = new URLSearchParams(location.search);
    const request = state.guildRequest = (state.guildRequest || 0) + 1;
    workspaceStatus('Loading server settings…', 'loading');
    state.config = null;
    state.guildId = guildId;
    elements.guildSelect.value = guildId;
    const guild = state.guilds.find((item) => item.id === guildId);
    elements.serverMeta.textContent = `${state.me?.owner ? 'Owner view' : 'Administrator access'} · ${guild ? guild.id : guildId}`;
    elements.saveButton.disabled = true;
    elements.saveDock.hidden = true;

    try {
      const [directoryPayload, configPayload, templatesPayload, reactionRolesPayload] = await Promise.all([
        api(`/api/guilds/${guildId}/directory`),
        api(`/api/guilds/${guildId}/config`),
        api(`/api/guilds/${guildId}/message-templates`),
        api(`/api/guilds/${guildId}/reaction-roles`),
      ]);
      if (state.guildRequest !== request) return;
      state.directory = { channels: [], roles: [], emojis: { bot: [], group: [], errors: {} }, ...directoryPayload.directory };
      directoryEmojiItemCache.clear();
      state.config = {
        ...configPayload.config,
        leveling: normalizeLevelingConfig(configPayload.config),
        memberMessages: normalizeMemberMessagesConfig(configPayload.config),
        counting: normalizeCountingConfig(configPayload.config),
        games: normalizeGamesConfig(configPayload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      state.messageTemplates = normalizeMessageTemplatesClient(templatesPayload.messageTemplates);
      state.templateFolderId = 'all';
      state.templateSelectedId = '';
      state.templateDraft = null;
      state.templateSavedSnapshot = '';
      state.reactionRoles = normalizeReactionRolesClient(reactionRolesPayload.reactionRoles);
      state.reactionRoleSelectedId = '';
      state.reactionRoleDraft = null;
      state.reactionRoleSavedSnapshot = '';
      renderFeatureAccess();
      renderLeveling();
      renderGames();
      renderWelcomeMessages();
      renderTemplateWorkspace();
      renderReactionRoles();
      workspaceStatus();
      const requestedTemplate = deepLink.get('template');
      const requestedFolder = deepLink.get('folder');
      if (requestedFolder && state.messageTemplates.folders.some((folder) => folder.id === requestedFolder)) state.templateFolderId = requestedFolder;
      if (requestedTemplate) await selectMessageTemplate(requestedTemplate, { force: true, reveal: !requestedFolder });
    } catch (error) {
      showToast(error.message, 'error');
      if (state.guildRequest !== request) return;
      workspaceStatus(`Could not load this server. ${error.message}`, 'error', true);
      elements.serverMeta.textContent = `Could not load this community: ${error.message}`;
    }
  }

export async function saveConfig() {
    if (!state.config || state.saving || snapshot() === state.savedSnapshot) return;
    state.saving = true;
    elements.saveButton.disabled = true;
    elements.resetButton.disabled = true;
    elements.saveState.textContent = 'Applying changes…';
    try {
      const leveling = clone(state.config.leveling);
      const memberMessages = clone(state.config.memberMessages);
      const counting = clone(state.config.counting);
      const games = clone(state.config.games);
      const body = { memberMessages, counting, games };
      if (state.config.features?.leveling === true) body.leveling = leveling;
      const payload = await api(`/api/guilds/${state.guildId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.config = {
        ...payload.config,
        leveling: normalizeLevelingConfig(payload.config),
        memberMessages: normalizeMemberMessagesConfig(payload.config),
        counting: normalizeCountingConfig(payload.config),
        games: normalizeGamesConfig(payload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderLeveling();
      renderGames();
      renderWelcomeMessages();
      showToast('Dashboard settings updated.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.saving = false;
      refreshDirty();
    }
  }

export function resetUnsavedChanges() {
    if (!state.savedConfig || state.saving) return;
    state.config = clone(state.savedConfig);
    renderFeatureAccess();
    renderLeveling();
    renderGames();
    renderWelcomeMessages();
    showToast('Unsaved changes reset.');
  }
