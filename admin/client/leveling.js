// leveling: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { MAX_ADDITIONAL_MESSAGE_CONTAINERS, MEMBER_MESSAGE_DEFAULTS, MEMBER_MESSAGE_META, XP_DROP_VARIABLES, elements, state } from './state.js';
import { clampNumber, clone, escapeHtml, showToast } from './session.js';
import { inlineTemplateEditor, previewMediaUrl, renderMessagePreview, syncInlineEditorVisual, validMediaTemplate } from './composer.js';
import { normalizeTemplateLayoutClient } from './templates.js';
import { formatNumber } from './owner.js';
import { refreshDirty } from './workspace.js';
import { currentMemberMessage, renderWelcomeMessagePreview, renderWelcomeMessages } from './welcome.js';

export function normalizeDurationInput(value, fallback = '30m', optional = false) {
    const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (optional && (!text || text === '0')) return '';
    return /^\d+(?:\.\d+)?[smhd]$/.test(text) && Number.parseFloat(text) > 0 ? text : fallback;
  }

export function newAdditionalContainer(accentColor = '#b9f547') {
    return {
      content: '',
      layout: {
        container: true,
        accentColor: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor.toLowerCase() : '#b9f547',
        thumbnailEnabled: false,
        thumbnailUrl: '',
        galleryUrls: [],
      },
    };
  }

export function normalizeAdditionalContainersClient(value, normalizeLayout, maximumContent = 3000) {
    return (Array.isArray(value) ? value : []).slice(0, MAX_ADDITIONAL_MESSAGE_CONTAINERS).map((container) => ({
      content: String(container?.content || '').slice(0, maximumContent),
      layout: { ...normalizeLayout(container?.layout), container: true },
    }));
  }

export function normalizeLevelingConfig(config) {
    const source = clone(config?.leveling || {});
    source.enabled = source.enabled === true;
    source.xp ||= {};
    source.xp.min = Math.round(clampNumber(source.xp.min, 1, 1000, 15));
    source.xp.max = Math.round(clampNumber(source.xp.max, source.xp.min, 2000, 25));
    source.xp.cooldownSeconds = Math.round(clampNumber(source.xp.cooldownSeconds, 0, 3600, 60));
    source.curve ||= {};
    source.curve.baseXp = Math.round(clampNumber(source.curve.baseXp, 25, 100000, 100));
    source.curve.growth = clampNumber(source.curve.growth, 1, 3, 1.5);
    source.curve.maxLevel = Math.round(clampNumber(source.curve.maxLevel, 1, 1000, 100));
    source.announcements ||= {};
    source.announcements.enabled = source.announcements.enabled === true;
    source.announcements.channelId = String(source.announcements.channelId || '');
    const legacyTemplate = `## ${String(source.announcements.title || '✦ Level {level} reached')}\n${String(source.announcements.message || 'GG {user}! You reached level {level}.')}\n\n${String(source.announcements.progress || '`{bar}` {progress_xp} / {needed_xp} XP toward level {next_level}')}`;
    source.announcements.template = String(source.announcements.template || legacyTemplate).slice(0, 3000);
    delete source.announcements.title;
    delete source.announcements.message;
    delete source.announcements.progress;
    source.announcements.layout ||= {};
    source.announcements.layout.container = source.announcements.layout.container !== false;
    source.announcements.layout.accentColor = /^#[0-9a-f]{6}$/i.test(source.announcements.layout.accentColor || '')
      ? source.announcements.layout.accentColor.toLowerCase() : '#b9f547';
    source.announcements.layout.thumbnailEnabled = source.announcements.layout.thumbnailEnabled === true;
    source.announcements.layout.thumbnailUrl = String(source.announcements.layout.thumbnailUrl || '').slice(0, 2000);
    source.announcements.layout.galleryUrls = (source.announcements.layout.galleryUrls || []).map(String).slice(0, 10);
    source.announcements.additionalContainers = normalizeAdditionalContainersClient(source.announcements.additionalContainers, (layout) => {
      const normalized = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
      return {
        container: true,
        accentColor: /^#[0-9a-f]{6}$/i.test(normalized.accentColor || '') ? normalized.accentColor.toLowerCase() : source.announcements.layout.accentColor,
        thumbnailEnabled: normalized.thumbnailEnabled === true,
        thumbnailUrl: validMediaTemplate(normalized.thumbnailUrl) ? String(normalized.thumbnailUrl).trim() : '',
        galleryUrls: [...new Set((Array.isArray(normalized.galleryUrls) ? normalized.galleryUrls : [])
          .map((url) => String(url).trim()).filter(validMediaTemplate))].slice(0, 10),
      };
    });
    source.channelMultipliers = Object.fromEntries(Object.entries(source.channelMultipliers || {}).map(([id, multiplier]) => [
      String(id), Math.round(clampNumber(multiplier, 0, 10, 1)),
    ]));
    source.roleRewards = (source.roleRewards || []).map((reward) => ({
      level: Math.round(clampNumber(reward.level, 1, source.curve.maxLevel, 1)),
      roleId: String(reward.roleId || ''),
    })).filter((reward) => reward.roleId).sort((a, b) => a.level - b.level).slice(0, 100);
    source.roleBoosts = (source.roleBoosts || []).map((boost) => ({
      roleId: String(boost.roleId || ''),
      multiplier: Math.round(clampNumber(boost.multiplier, 0, 10, 1)),
    })).filter((boost) => boost.roleId).slice(0, 100);
    source.stackRoleRewards = source.stackRoleRewards !== false;
    source.xpDrops ||= {};
    source.xpDrops.enabled = source.xpDrops.enabled === true;
    source.xpDrops.channelId = String(source.xpDrops.channelId || '');
    source.xpDrops.dropTemplate = String(source.xpDrops.dropTemplate || '## 🎁 {crate_name} appeared!\nBe one of the first **{claim_limit}** members to claim **{xp_min}–{xp_max} XP**.\n-# {claims_left} claim(s) remaining · disappears {despawn_time}').slice(0, 3000);
    source.xpDrops.claimTemplate = String(source.xpDrops.claimTemplate || '## ✦ {crate_name} claimed\n{user} found **{xp} XP** and is now level **{level}**.\n-# {claims_left} claim(s) remaining').slice(0, 3000);
    const usedCrateIds = new Set();
    source.xpDrops.crates = (source.xpDrops.crates || []).map((crate, index) => {
      let id = String(crate.id || `crate-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || `crate-${index + 1}`;
      while (usedCrateIds.has(id)) id = `${id.slice(0, 34)}-${index + 1}`;
      usedCrateIds.add(id);
      const minimum = Math.round(clampNumber(crate.xp?.min ?? crate.xpMin, 1, 1_000_000, 50));
      return {
        id,
        enabled: crate.enabled !== false,
        name: String(crate.name || `Crate ${index + 1}`).trim().slice(0, 80) || `Crate ${index + 1}`,
        imageUrl: String(crate.imageUrl || '').slice(0, 2000),
        xp: { min: minimum, max: Math.round(clampNumber(crate.xp?.max ?? crate.xpMax, minimum, 1_000_000, Math.max(100, minimum))) },
        channelId: String(crate.channelId || ''),
        dropEvery: normalizeDurationInput(crate.dropEvery, '30m'),
        chancePercent: clampNumber(crate.chancePercent, 0, 100, 100),
        claimLimit: Math.round(clampNumber(crate.claimLimit, 1, 1000, 1)),
        despawnAfter: normalizeDurationInput(crate.despawnAfter, '', true),
        allowMultipleClaims: crate.allowMultipleClaims === true,
        containerColor: /^#[0-9a-f]{6}$/i.test(crate.containerColor || '') ? crate.containerColor.toLowerCase() : '#b9f547',
      };
    }).slice(0, 100);
    return source;
  }

export function normalizeCountingConfig(config) {
    return { channelId: String(config?.counting?.channelId || '') };
  }

export function normalizeGamesConfig(config) {
    return {
      lotteryChannelId: String(config?.games?.lotteryChannelId || ''),
      commandSettings: (Array.isArray(config?.games?.commandSettings) ? config.games.commandSettings : []).map((setting, index) => ({
        id: String(setting?.id || `setting-${index + 1}`),
        channelIds: [...new Set((Array.isArray(setting?.channelIds) ? setting.channelIds : []).map(String).filter(Boolean))],
        commands: [...new Set((Array.isArray(setting?.commands) ? setting.commands : []).map(String).filter((command) => ['cs-work', 'cs-beg', 'cs-balance', 'cs-inventory', 'cs-achievements', 'cs-shop', 'cs-trivia'].includes(command)))],
      })),
    };
  }

export function validMemberMediaTemplate(value) {
    const text = String(value || '').trim();
    if (['{user_avatar}', '{server_icon}'].includes(text.toLowerCase())) return true;
    try { return ['http:', 'https:'].includes(new URL(text).protocol); } catch { return false; }
  }

export function normalizeMemberMessagesConfig(config) {
    const source = clone(config?.memberMessages || {});
    source.enabled = source.enabled !== false;
    for (const type of ['join', 'leave', 'boost']) {
      const defaults = MEMBER_MESSAGE_DEFAULTS[type];
      const event = source[type] && typeof source[type] === 'object' && !Array.isArray(source[type]) ? source[type] : {};
      event.enabled = event.enabled === true;
      event.channelId = String(event.channelId || '');
      event.template = String(event.template || defaults.template).trim().slice(0, 3000) || defaults.template;
      event.layout = event.layout && typeof event.layout === 'object' && !Array.isArray(event.layout) ? event.layout : {};
      event.layout.container = event.layout.container !== false;
      event.layout.accentColor = /^#[0-9a-f]{6}$/i.test(event.layout.accentColor || '') ? event.layout.accentColor.toLowerCase() : defaults.layout.accentColor;
      event.layout.thumbnailEnabled = event.layout.thumbnailEnabled === true;
      event.layout.thumbnailUrl = validMemberMediaTemplate(event.layout.thumbnailUrl) ? String(event.layout.thumbnailUrl).trim() : '';
      event.layout.galleryUrls = [...new Set((Array.isArray(event.layout.galleryUrls) ? event.layout.galleryUrls : [])
        .map((url) => String(url).trim()).filter(validMemberMediaTemplate))].slice(0, 10);
      event.additionalContainers = normalizeAdditionalContainersClient(event.additionalContainers, (layout) => {
        const normalized = normalizeTemplateLayoutClient(layout);
        normalized.accentColor = /^#[0-9a-f]{6}$/i.test(layout?.accentColor || '') ? normalized.accentColor : event.layout.accentColor;
        return normalized;
      });
      source[type] = event;
    }
    return source;
  }

export function channelOptions(selected, include = () => true, emptyLabel = 'Not routed') {
    const multiple = Array.isArray(selected);
    const selectedIds = new Set((multiple ? selected : [selected]).map(String).filter(Boolean));
    const listedIds = new Set();
    const options = [`<option value="" ${multiple ? 'disabled' : ''}>${escapeHtml(emptyLabel)}</option>`];
    let lastParent = null;
    for (const channel of state.directory.channels.filter((item) => !item.archived && include(item))) {
      if (channel.parentName && channel.parentName !== lastParent) {
        options.push(`<option disabled>── ${escapeHtml(channel.parentName)} ──</option>`);
        lastParent = channel.parentName;
      }
      const prefix = channel.kind === 'thread' ? '⌁' : channel.kind === 'forum' ? '▦' : '#';
      listedIds.add(channel.id);
      options.push(`<option value="${channel.id}" ${selectedIds.has(channel.id) ? 'selected' : ''}>${prefix} ${escapeHtml(channel.name)}</option>`);
    }
    for (const id of selectedIds) {
      if (!listedIds.has(id)) options.push(`<option value="${escapeHtml(id)}" selected disabled>Unavailable channel (${escapeHtml(id)})</option>`);
    }
    return options.join('');
  }

export function xpThreshold(level) {
    const curve = state.config.leveling.curve;
    return Math.floor(curve.baseXp * Math.pow(Math.max(0, level), curve.growth));
  }

export function renderCurvePreview() {
    const maximum = state.config.leveling.curve.maxLevel;
    const levels = [...new Set([1, 5, 10, 25, maximum].filter((level) => level <= maximum))];
    elements.levelingCurvePreview.innerHTML = levels.map(level => `<article><small>LEVEL ${level}</small><strong>${formatNumber(xpThreshold(level))} XP</strong></article>`).join('');
  }

export function roleOptions(selected) {
    const roles = state.directory.roles || [];
    return ['<option value="">Choose a Discord role</option>', ...roles.map((role) => {
      const unavailable = role.editable === false || role.managed === true || role.administrator === true;
      const reason = role.administrator ? ' (Administrator blocked)' : role.managed ? ' (managed role)' : role.editable === false ? ' (above CoinSprite)' : '';
      return `<option value="${role.id}" style="color:${roleColor(role.id)}" ${role.id === selected ? 'selected' : ''} ${unavailable ? 'disabled' : ''}>\u25cf @${escapeHtml(role.name)}${reason}</option>`;
    })].join('');
  }

export function roleColor(roleId) {
    const color = (state.directory.roles || []).find((role) => role.id === roleId)?.color;
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#99a1a6';
  }

export function renderLevelingChannels() {
    const multipliers = state.config.leveling.channelMultipliers || {};
    const channels = (state.directory.channels || []).filter((channel) => !channel.archived && channel.kind !== 'category');
    elements.levelingChannels.innerHTML = channels.length ? channels.map((channel) => {
      const active = Object.prototype.hasOwnProperty.call(multipliers, channel.id);
      const multiplier = active ? multipliers[channel.id] : 1;
      return `<article class="xp-channel-option${active ? ' selected' : ''}">
        <label class="xp-channel-toggle"><input type="checkbox" data-leveling-channel value="${channel.id}" ${active ? 'checked' : ''}><span><b>#</b><strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(channel.parentName || 'No category')}</small></span><i aria-hidden="true">${active ? '&#x2713;' : '+'}</i></label>
        <label class="channel-multiplier" ${active ? '' : 'hidden'}><span>Multi:</span><input type="number" min="0" max="10" step="1" value="${multiplier}" data-leveling-channel-multiplier="${channel.id}" aria-label="${escapeHtml(channel.name)} XP multiplier"><b>&times;</b></label>
      </article>`;
    }).join('') : '<p class="empty-state">No eligible text channels found.</p>';
  }

export function renderLevelingRewards() {
    const rewards = state.config.leveling.roleRewards || [];
    elements.levelingRewards.innerHTML = rewards.length ? rewards.map((reward, index) => `<article class="reward-row" style="--role-color:${roleColor(reward.roleId)}">
      <span class="reward-level-mark">LV</span>
      <label><small>Level</small><input type="number" min="1" max="${state.config.leveling.curve.maxLevel}" value="${reward.level}" data-level-reward-level="${index}"></label>
      <label class="reward-role-field"><small><i class="role-color-dot"></i>Discord role</small><select data-level-reward-role="${index}">${roleOptions(reward.roleId)}</select></label>
      <button type="button" class="reward-remove" data-remove-level-reward="${index}" aria-label="Remove level ${reward.level} reward">Remove</button>
    </article>`).join('') : '<div class="empty-state reward-empty"><strong>No role rewards yet</strong><span>Add milestones such as Level 5, 10, and 25.</span></div>';
  }

export function renderLevelingBoosts() {
    const boosts = state.config.leveling.roleBoosts || [];
    elements.levelingBoosts.innerHTML = boosts.length ? boosts.map((boost, index) => `<article class="reward-row boost-row" style="--role-color:${roleColor(boost.roleId)}">
      <span class="reward-level-mark boost-mark">XP</span>
      <label class="reward-role-field"><small><i class="role-color-dot"></i>Discord role</small><select data-level-boost-role="${index}">${roleOptions(boost.roleId)}</select></label>
      <label><small>Multiplier</small><span class="multiplier-input"><b>&times;</b><input type="number" min="0" max="10" step="1" value="${boost.multiplier}" data-level-boost-multiplier="${index}"></span></label>
      <button type="button" class="reward-remove" data-remove-level-boost="${index}" aria-label="Remove role XP boost">Remove</button>
    </article>`).join('') : '<div class="empty-state reward-empty"><strong>No role boosts yet</strong><span>Add a role and choose an XP multiplier from ×0 to ×10.</span></div>';
  }

export function xpDropDurationEditor(value, index, field, label, optional = false) {
    const match = String(value || '').match(/^(\d+(?:\.\d+)?)([smhd])$/i);
    const amount = match?.[1] || (optional ? '' : '30');
    const unit = match?.[2]?.toLowerCase() || 'm';
    const units = [['s', 'Seconds'], ['m', 'Minutes'], ['h', 'Hours'], ['d', 'Days']];
    return `<span class="xp-drop-duration" role="group" aria-label="${escapeHtml(label)}">
      <input type="number" min="0" max="31536000" step="any" inputmode="decimal" value="${escapeHtml(amount)}" placeholder="${optional ? 'Never' : '30'}" data-xp-drop-field="${field}" data-xp-drop-duration-part="amount" data-xp-drop-index="${index}" aria-label="${escapeHtml(label)} amount">
      <select data-xp-drop-field="${field}" data-xp-drop-duration-part="unit" data-xp-drop-index="${index}" aria-label="${escapeHtml(label)} unit">${units.map(([key, name]) => `<option value="${key}" ${key === unit ? 'selected' : ''}>${name}</option>`).join('')}</select>
    </span>`;
  }

export function renderXpDropMessagePreviews() {
    const xpDrops = state.config.leveling.xpDrops;
    const selectedId = elements.xpDropTestCrate.value;
    const crate = xpDrops.crates.find((item) => item.id === selectedId) || xpDrops.crates[0] || {
      name: 'Common Crate', imageUrl: '', containerColor: '#b9f547', claimLimit: 3,
    };
    const color = /^#[0-9a-f]{6}$/i.test(crate.containerColor || '') ? crate.containerColor : '#b9f547';
    const image = previewMediaUrl(crate.imageUrl);
    elements.xpDropMessagePreview.style.setProperty('--accent-color', color);
    elements.xpDropClaimPreview.style.setProperty('--accent-color', color);
    elements.xpDropMessagePreview.innerHTML = `<div class="discord-section"><div>${inlineTemplateEditor(xpDrops.dropTemplate, 'dropTemplate', 'xpDrops', 'XP drop message')}</div>${image ? `<img class="discord-thumbnail" src="${escapeHtml(image)}" alt="${escapeHtml(crate.name)}">` : '<div class="discord-thumbnail placeholder">CRATE</div>'}</div><div class="discord-separator"></div><button class="xp-drop-fake-claim" type="button" disabled>Claim ${escapeHtml(crate.name)}</button>`;
    elements.xpDropClaimPreview.innerHTML = inlineTemplateEditor(xpDrops.claimTemplate, 'claimTemplate', 'xpDrops', 'XP claim message');
  }

export function renderXpDropList() {
    const crates = state.config.leveling.xpDrops.crates;
    elements.xpDropList.innerHTML = crates.length ? crates.map((crate, index) => {
      const image = previewMediaUrl(crate.imageUrl);
      return `<article class="xp-drop-card" style="--crate-color:${crate.containerColor}" data-xp-drop-card="${index}">
        <header><div><span class="crate-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(crate.name)}</strong><small>${crate.enabled ? 'Scheduled' : 'Paused'} · ${escapeHtml(crate.dropEvery)} · ${crate.chancePercent}% chance</small></div></div><div><label class="crate-enabled"><input type="checkbox" data-xp-drop-field="enabled" data-xp-drop-index="${index}" ${crate.enabled ? 'checked' : ''}><span>Enabled</span></label><button type="button" class="reward-remove" data-remove-xp-drop="${index}">Remove</button></div></header>
        <div class="xp-drop-card-body">
          <div class="xp-drop-art">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(crate.name)} image">` : '<span>NO IMAGE</span>'}<label class="media-upload">Upload image<input type="file" accept="image/*" data-xp-drop-media="${index}"></label><small>Any decodable image or GIF, up to 10 MB</small></div>
          <div class="xp-drop-fields">
            <label class="wide"><span>Crate name</span><input type="text" maxlength="80" value="${escapeHtml(crate.name)}" data-xp-drop-field="name" data-xp-drop-index="${index}"></label>
            <label><span>Minimum XP</span><input type="number" min="1" max="1000000" value="${crate.xp.min}" data-xp-drop-field="xpMin" data-xp-drop-index="${index}"></label>
            <label><span>Maximum XP</span><input type="number" min="1" max="1000000" value="${crate.xp.max}" data-xp-drop-field="xpMax" data-xp-drop-index="${index}"></label>
            <label class="wide"><span>Fallback channel</span><select data-xp-drop-field="channelId" data-xp-drop-index="${index}">${channelOptions(crate.channelId, (channel) => channel.kind !== 'forum', 'Use global crate channel')}</select><small>Used only when no global crate channel is selected</small></label>
            <label><span>Drop every</span>${xpDropDurationEditor(crate.dropEvery, index, 'dropEvery', 'Drop every')}<small>Choose an amount and time unit</small></label>
            <label><span>Chance (%)</span><input type="number" min="0" max="100" step="0.01" value="${crate.chancePercent}" data-xp-drop-field="chancePercent" data-xp-drop-index="${index}"></label>
            <label><span>Claim limit</span><input type="number" min="1" max="1000" value="${crate.claimLimit}" data-xp-drop-field="claimLimit" data-xp-drop-index="${index}"></label>
            <label><span>Despawn after</span>${xpDropDurationEditor(crate.despawnAfter, index, 'despawnAfter', 'Despawn after', true)}<small>Leave the amount empty for no despawn</small></label>
            <label><span>Container color</span><span class="crate-color-input"><input type="color" value="${crate.containerColor}" data-xp-drop-field="containerColor" data-xp-drop-index="${index}"><code>${crate.containerColor}</code></span></label>
            <label class="wide crate-multi-claim"><input type="checkbox" data-xp-drop-field="allowMultipleClaims" data-xp-drop-index="${index}" ${crate.allowMultipleClaims ? 'checked' : ''}><span><strong>Allow a person to claim multiple times</strong><small>Off by default. When on, one member can consume more than one claim slot.</small></span></label>
          </div>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state reward-empty"><strong>No XP crates yet</strong><span>Add a crate to configure scheduled drops and test claims.</span></div>';
  }

export function renderXpDrops() {
    const xpDrops = state.config.leveling.xpDrops;
    const selectedCrate = elements.xpDropTestCrate.value;
    const selectedChannel = elements.xpDropTestChannel.value;
    elements.xpDropsEnabled.checked = xpDrops.enabled;
    elements.xpDropChannel.innerHTML = channelOptions(xpDrops.channelId, (channel) => channel.kind !== 'forum', 'Choose a drop channel');
    elements.xpDropVariables.innerHTML = XP_DROP_VARIABLES.map(([token, meaning]) => `<button type="button" data-copy-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('');
    renderXpDropList();
    elements.xpDropTestCrate.innerHTML = xpDrops.crates.length
      ? xpDrops.crates.map((crate) => `<option value="${escapeHtml(crate.id)}" ${crate.id === selectedCrate ? 'selected' : ''}>${escapeHtml(crate.name)}</option>`).join('')
      : '<option value="">Add a crate first</option>';
    elements.xpDropTestChannel.innerHTML = channelOptions(selectedChannel, (channel) => channel.kind !== 'forum');
    elements.xpDropTestChannel.options[0].textContent = 'Use configured crate drop channel';
    elements.xpDropTestButton.disabled = state.xpDropTesting || !xpDrops.crates.length;
    elements.xpDropTestButton.textContent = state.xpDropTesting ? 'Sending…' : 'Send test';
    renderXpDropMessagePreviews();
  }

export function addXpDrop() {
    const crates = state.config?.leveling?.xpDrops?.crates;
    if (!crates || crates.length >= 100) return;
    const id = `crate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 40);
    crates.push({
      id, enabled: true, name: `Crate ${crates.length + 1}`, imageUrl: '', xp: { min: 50, max: 100 },
      channelId: '', dropEvery: '30m', chancePercent: 100, claimLimit: 1,
      despawnAfter: '', allowMultipleClaims: false, containerColor: '#b9f547',
    });
    renderXpDrops();
    refreshDirty();
    elements.xpDropList.lastElementChild?.querySelector('[data-xp-drop-field="name"]')?.focus();
  }

export function validHttpUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(String(value || '')).protocol); } catch { return false; }
  }

export function updateLevelingFromControl(target) {
    if (!state.config) return;
    const leveling = state.config.leveling;
    if (target.matches('[data-inline-message-input]')) {
      const field = target.dataset.inlineTemplateField;
      const limits = { template: 3000 };
      if (target.dataset.inlineTemplateScope === 'xpDrops') {
        if (['dropTemplate', 'claimTemplate'].includes(field)) leveling.xpDrops[field] = target.value.slice(0, 3000);
      } else {
        const containerIndex = Number(target.dataset.additionalContainerIndex);
        if (Number.isInteger(containerIndex) && leveling.announcements.additionalContainers[containerIndex]) {
          leveling.announcements.additionalContainers[containerIndex].content = target.value.slice(0, 3000);
        } else if (limits[field]) leveling.announcements[field] = target.value.slice(0, limits[field]);
      }
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.levelingEnabled) leveling.enabled = target.checked;
    if (target === elements.xpDropsEnabled) leveling.xpDrops.enabled = target.checked;
    if (target === elements.xpDropChannel) leveling.xpDrops.channelId = target.value;
    if (target === elements.levelingXpMin) {
      leveling.xp.min = Math.round(clampNumber(target.value, 1, 1000, 15));
      leveling.xp.max = Math.max(leveling.xp.min, leveling.xp.max);
      elements.levelingXpMax.value = leveling.xp.max;
    }
    if (target === elements.levelingXpMax) leveling.xp.max = Math.round(clampNumber(target.value, leveling.xp.min, 2000, 25));
    if (target === elements.levelingCooldown) leveling.xp.cooldownSeconds = Math.round(clampNumber(target.value, 0, 3600, 60));
    if (target === elements.levelingBaseXp) leveling.curve.baseXp = Math.round(clampNumber(target.value, 25, 100000, 100));
    if (target === elements.levelingGrowth) leveling.curve.growth = clampNumber(target.value, 1, 3, 1.5);
    if (target === elements.levelingMaxLevel) {
      leveling.curve.maxLevel = Math.round(clampNumber(target.value, 1, 1000, 100));
      for (const reward of leveling.roleRewards) reward.level = Math.min(reward.level, leveling.curve.maxLevel);
      renderLevelingRewards();
    }
    if ([elements.levelingBaseXp, elements.levelingGrowth, elements.levelingMaxLevel].includes(target)) renderCurvePreview();
    if (target === elements.levelingAnnounceEnabled) leveling.announcements.enabled = target.checked;
    if (target === elements.levelingAnnounceChannel) leveling.announcements.channelId = target.value;
    if (target.matches('[data-leveling-thumbnail-url]')) {
      leveling.announcements.layout.thumbnailUrl = target.value.slice(0, 2000);
      leveling.announcements.layout.thumbnailEnabled = validMediaTemplate(target.value);
      renderMessagePreview(false);
    }
    if (target === elements.levelingAccentColor) {
      leveling.announcements.layout.accentColor = target.value;
      renderMessagePreview();
    }
    if (target.matches('[data-leveling-additional-accent]')) {
      const container = leveling.announcements.additionalContainers[Number(target.dataset.levelingAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderMessagePreview();
    }
    if (target.matches('[data-leveling-additional-thumbnail-url]')) {
      const container = leveling.announcements.additionalContainers[Number(target.dataset.levelingAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validMediaTemplate(target.value);
      }
      renderMessagePreview(false);
    }
    if (target === elements.levelingStackRewards) leveling.stackRoleRewards = target.checked;
    if (target.matches('[data-leveling-channel]')) {
      if (target.checked) leveling.channelMultipliers[target.value] = 1;
      else delete leveling.channelMultipliers[target.value];
      renderLevelingChannels();
    }
    if (target.matches('[data-leveling-channel-multiplier]')) {
      leveling.channelMultipliers[target.dataset.levelingChannelMultiplier] = Math.round(clampNumber(target.value, 0, 10, 1));
    }
    if (target.matches('[data-leveling-gallery-url]')) {
      leveling.announcements.layout.galleryUrls[Number(target.dataset.levelingGalleryUrl)] = target.value.slice(0, 2000);
      renderMessagePreview(false);
    }
    if (target.matches('[data-leveling-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.levelingAdditionalGalleryUrl.split(':').map(Number);
      const container = leveling.announcements.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
      renderMessagePreview(false);
    }
    if (target.matches('[data-level-reward-level]')) {
      const reward = leveling.roleRewards[Number(target.dataset.levelRewardLevel)];
      if (reward) reward.level = Math.round(clampNumber(target.value, 1, leveling.curve.maxLevel, reward.level));
    }
    if (target.matches('[data-level-reward-role]')) {
      const reward = leveling.roleRewards[Number(target.dataset.levelRewardRole)];
      if (reward) reward.roleId = target.value;
      target.closest('.reward-row')?.style.setProperty('--role-color', roleColor(target.value));
    }
    if (target.matches('[data-level-boost-role]')) {
      const boost = leveling.roleBoosts[Number(target.dataset.levelBoostRole)];
      if (boost) boost.roleId = target.value;
      target.closest('.reward-row')?.style.setProperty('--role-color', roleColor(target.value));
    }
    if (target.matches('[data-level-boost-multiplier]')) {
      const boost = leveling.roleBoosts[Number(target.dataset.levelBoostMultiplier)];
      if (boost) boost.multiplier = Math.round(clampNumber(target.value, 0, 10, 1));
    }
    if (target.matches('[data-xp-drop-field]')) {
      const index = Number(target.dataset.xpDropIndex);
      const crate = leveling.xpDrops.crates[index];
      const field = target.dataset.xpDropField;
      if (crate) {
        if (field === 'enabled' || field === 'allowMultipleClaims') crate[field] = target.checked;
        else if (field === 'name') crate.name = target.value.slice(0, 80);
        else if (field === 'channelId') crate.channelId = target.value;
        else if (field === 'xpMin') {
          crate.xp.min = Math.round(clampNumber(target.value, 1, 1_000_000, crate.xp.min));
          crate.xp.max = Math.max(crate.xp.min, crate.xp.max);
        } else if (field === 'xpMax') crate.xp.max = Math.round(clampNumber(target.value, crate.xp.min, 1_000_000, crate.xp.max));
        else if (field === 'dropEvery' || field === 'despawnAfter') {
          const duration = target.closest('.xp-drop-duration');
          if (duration) {
            const amount = duration.querySelector('[data-xp-drop-duration-part="amount"]')?.value.trim() || '';
            const unit = duration.querySelector('[data-xp-drop-duration-part="unit"]')?.value || 'm';
            crate[field] = amount && Number(amount) > 0 ? `${amount}${unit}`.slice(0, 16) : '';
          } else crate[field] = target.value.slice(0, 16);
        }
        else if (field === 'chancePercent') crate.chancePercent = clampNumber(target.value, 0, 100, crate.chancePercent);
        else if (field === 'claimLimit') crate.claimLimit = Math.round(clampNumber(target.value, 1, 1000, crate.claimLimit));
        else if (field === 'containerColor') {
          crate.containerColor = target.value;
          target.closest('.xp-drop-card')?.style.setProperty('--crate-color', target.value);
          const code = target.closest('.crate-color-input')?.querySelector('code');
          if (code) code.textContent = target.value;
        }
        const card = target.closest('.xp-drop-card');
        const heading = card?.querySelector('header strong');
        const summary = card?.querySelector('header small');
        if (heading) heading.textContent = crate.name || 'Unnamed crate';
        if (summary) summary.textContent = `${crate.enabled ? 'Scheduled' : 'Paused'} · ${crate.dropEvery || 'invalid interval'} · ${crate.chancePercent}% chance`;
        const testOption = [...elements.xpDropTestCrate.options].find((option) => option.value === crate.id);
        if (testOption) testOption.textContent = crate.name || 'Unnamed crate';
        renderXpDropMessagePreviews();
      }
    }
    refreshDirty();
  }

export function updateMemberMessagesFromControl(target) {
    if (!state.config?.memberMessages) return;
    const config = state.config.memberMessages;
    const event = currentMemberMessage();
    if (!event) return;
    if (target.matches('[data-inline-message-input]')) {
      const containerIndex = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(containerIndex) && event.additionalContainers[containerIndex]) event.additionalContainers[containerIndex].content = target.value.slice(0, 3000);
      else event.template = target.value.slice(0, 3000);
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.welcomeMessagesEnabled) config.enabled = target.checked;
    if (target === elements.welcomeEventEnabled) event.enabled = target.checked;
    if (target === elements.welcomeEventChannel) event.channelId = target.value;
    if (target.matches('[data-welcome-thumbnail-url]')) {
      event.layout.thumbnailUrl = target.value.slice(0, 2000);
      event.layout.thumbnailEnabled = Boolean(target.value.trim());
      renderWelcomeMessagePreview(false);
    }
    if (target.matches('[data-welcome-gallery-url]')) {
      event.layout.galleryUrls[Number(target.dataset.welcomeGalleryUrl)] = target.value.slice(0, 2000);
      renderWelcomeMessagePreview(false);
    }
    if (target === elements.welcomeAccentColor) {
      event.layout.accentColor = target.value;
      renderWelcomeMessagePreview();
    }
    if (target.matches('[data-welcome-additional-accent]')) {
      const container = event.additionalContainers[Number(target.dataset.welcomeAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderWelcomeMessagePreview();
    }
    if (target.matches('[data-welcome-additional-thumbnail-url]')) {
      const container = event.additionalContainers[Number(target.dataset.welcomeAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validMemberMediaTemplate(target.value);
      }
      renderWelcomeMessagePreview(false);
    }
    if (target.matches('[data-welcome-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.welcomeAdditionalGalleryUrl.split(':').map(Number);
      const container = event.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
      renderWelcomeMessagePreview(false);
    }
    refreshDirty();
  }

export function addLevelReward() {
    if (!state.config || state.config.leveling.roleRewards.length >= 100) return;
    const rewards = state.config.leveling.roleRewards;
    const lastLevel = rewards.length ? Math.max(...rewards.map((reward) => reward.level)) : 0;
    const firstRole = (state.directory.roles || []).find((role) => role.editable !== false);
    rewards.push({ level: Math.min(state.config.leveling.curve.maxLevel, lastLevel + 5 || 5), roleId: firstRole?.id || '' });
    renderLevelingRewards();
    refreshDirty();
    elements.levelingRewards.lastElementChild?.querySelector('input')?.focus();
  }

export function addLevelBoost() {
    if (!state.config || state.config.leveling.roleBoosts.length >= 100) return;
    const firstUnused = (state.directory.roles || []).find((role) => role.editable !== false
      && !state.config.leveling.roleBoosts.some((boost) => boost.roleId === role.id));
    state.config.leveling.roleBoosts.push({ roleId: firstUnused?.id || '', multiplier: 2 });
    renderLevelingBoosts();
    refreshDirty();
  }

export function resetCurrentMemberMessage() {
    if (!state.config?.memberMessages) return;
    state.config.memberMessages[state.memberMessageEvent] = clone(MEMBER_MESSAGE_DEFAULTS[state.memberMessageEvent]);
    state.memberMessageComposerPanel = '';
    renderWelcomeMessages();
    showToast(`${MEMBER_MESSAGE_META[state.memberMessageEvent].title} reset to its default.`);
  }
