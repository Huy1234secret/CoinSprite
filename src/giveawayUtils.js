const { MessageFlags } = require('discord.js');
const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ANNOUNCEMENT_TARGET_ID = DEFAULT_GUILD_CONFIG.channels.giveawayAnnouncement;
const BLACKLIST_ROLE_ID = DEFAULT_GUILD_CONFIG.roles.giveawayBlacklist;
const WHITE_ACCENT = 0xffffff;
const GREEN_ACCENT = 0x57f287;
const YELLOW_ACCENT = 0xfee75c;
const ORANGE_ACCENT = 0xfaa61a;
const BLACK_ACCENT = 0x2b2d31;
const PARTY_POPPER = '\u{1F389}';
const MAX_TIMEOUT_MS = 2_147_000_000;
const MIN_CLAIM_MS = DEFAULT_GUILD_CONFIG.giveaway.minClaimMs;
const MAX_CLAIM_MS = DEFAULT_GUILD_CONFIG.giveaway.maxClaimMs;
const MIN_DURATION_MS = DEFAULT_GUILD_CONFIG.giveaway.minDurationMs;
const MAX_DURATION_MS = DEFAULT_GUILD_CONFIG.giveaway.maxDurationMs;

const CUSTOM_IDS = {
  editMessagePrefix: 'giveaway:setup:message:',
  editRequirementPrefix: 'giveaway:setup:requirement:',
  startPrefix: 'giveaway:setup:start:',
  requirementTypePrefix: 'giveaway:setup:reqtype:',
  setupModalPrefix: 'giveaway:modal:setup:',
  startDurationModalPrefix: 'giveaway:modal:start-duration:',
  requirementModalPrefix: 'giveaway:modal:req:',
  joinPrefix: 'giveaway:join:',
  claimPrefix: 'giveaway:claim:',
};

const FIELD_IDS = {
  prize: 'giveaway_setup_prize',
  description: 'giveaway_setup_description',
  duration: 'giveaway_start_duration',
  claimTime: 'giveaway_setup_claim_time',
  winnerAmount: 'giveaway_setup_winner_amount',
  hoster: 'giveaway_setup_hoster',
  requirementLevel: 'giveaway_requirement_level',
  requirementMessage: 'giveaway_requirement_message',
  requirementOther: 'giveaway_requirement_other',
};

function text(content) {
  return { type: 10, content };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function actionRow(components) {
  return { type: 1, components };
}

function button(customId, label, style, disabled = false) {
  return {
    type: 2,
    custom_id: customId,
    label,
    style,
    disabled,
  };
}

function container(accent, components) {
  return {
    type: 17,
    accent_color: accent,
    components,
  };
}

function withoutComponentEmojis(value) {
  if (Array.isArray(value)) return value.map(withoutComponentEmojis);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'emoji')
      .map(([key, child]) => [key, withoutComponentEmojis(child)]),
  );
}

function toV2Payload(components, extra = {}) {
  return {
    ...extra,
    flags: ('flags' in extra ? extra.flags : 0) | COMPONENTS_V2_FLAG,
    components: withoutComponentEmojis(components),
  };
}

function now() {
  return Date.now();
}

function getGiveawayConfig(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).giveaway;
}

function getGiveawayAnnouncementTargetId(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).channels.giveawayAnnouncement;
}

function getGiveawayBlacklistRoleId(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).roles.giveawayBlacklist;
}

function formatDiscordRelative(timestampMs) {
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

function normalizeWhitespace(value) {
  return String(value || '').trim();
}

function extractMessageId(value) {
  const matches = normalizeWhitespace(value).match(/\d{17,20}/g) || [];
  return matches[matches.length - 1] || null;
}

function joinMentions(userIds) {
  return userIds.length ? userIds.map((userId) => `<@${userId}>`).join(', ') : 'None';
}

function parseDurationInput(input) {
  const source = normalizeWhitespace(input).toLowerCase();
  if (!source) return null;

  const matches = [...source.matchAll(/(\d+)\s*(d|h|m|s)/g)];
  if (matches.length === 0) return null;

  const matchedText = matches.map((match) => match[0]).join('').replace(/\s+/g, '');
  if (matchedText !== source.replace(/\s+/g, '')) return null;

  let totalMs = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) return null;

    if (unit === 'd') totalMs += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') totalMs += amount * 60 * 60 * 1000;
    if (unit === 'm') totalMs += amount * 60 * 1000;
    if (unit === 's') totalMs += amount * 1000;
  }

  return totalMs > 0 ? totalMs : null;
}

function formatDurationCompact(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function isSetupComplete(draft) {
  return Boolean(
    draft
    && draft.prize
    && draft.claimDurationMs
    && draft.winnerCount
    && draft.hostId,
  );
}

function getRequirementLevel(requirement) {
  if (!requirement) return null;
  if (requirement.type === 'level' || requirement.type === 'level_message') return requirement.level || null;
  return null;
}

function getRequirementMessageCount(requirement) {
  if (!requirement) return null;
  if (requirement.type === 'message' || requirement.type === 'level_message') return requirement.messageCount || null;
  return null;
}

function getRequirementLabel(requirement) {
  if (!requirement || requirement.type === 'none') return null;
  if (requirement.type === 'level') return `Level ${requirement.level}+`;
  if (requirement.type === 'message') return `${requirement.messageCount} messages after giveaway start`;
  if (requirement.type === 'level_message') {
    return `Level ${requirement.level}+ and ${requirement.messageCount} messages after giveaway start`;
  }
  if (requirement.type === 'other') return requirement.text;
  return null;
}

function createDraft(draftId, interaction) {
  return {
    id: draftId,
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: null,
    prize: '',
    description: '',
    claimDurationMs: null,
    claimDurationLabel: '',
    winnerCount: null,
    hostId: '',
    durationMs: null,
    durationLabel: '',
    requirement: { type: 'none' },
    createdAt: now(),
    updatedAt: now(),
  };
}

function draftPrizeText(draft) {
  return draft.prize || 'Giveaway prize';
}

function draftDescriptionText(draft) {
  return draft.description || 'Giveaway description, notes';
}

function draftHostText(draft) {
  return draft.hostId ? `<@${draft.hostId}>` : 'Not set';
}

function draftClaimTimeText(draft) {
  return draft.claimDurationLabel || 'Not set';
}

function draftWinnerCountText(draft) {
  return draft.winnerCount ? String(draft.winnerCount) : 'Not set';
}

function getWinnerAmountFromInput(input) {
  const value = Number.parseInt(normalizeWhitespace(input), 10);
  if (!Number.isFinite(value) || value < 1 || value > 10) return null;
  return value;
}

function getLevelRequirementFromInput(input) {
  const value = Number.parseInt(normalizeWhitespace(input), 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

function getMessageRequirementFromInput(input) {
  const value = Number.parseInt(normalizeWhitespace(input), 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

function getModalComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  const stack = [...getModalComponents(interaction)];
  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) continue;

    const component = item.component ?? item;
    if (component?.custom_id === customId || component?.customId === customId) return component;
    if (Array.isArray(item.components)) stack.push(...item.components);
    if (Array.isArray(component.components)) stack.push(...component.components);
  }
  return null;
}

function getSubmittedValues(interaction, customId) {
  const component = findSubmittedComponent(interaction, customId);
  if (!component) return [];
  if (Array.isArray(component.values)) return component.values.filter(Boolean);
  if (component.value) return [component.value];
  return [];
}

module.exports = {
  ANNOUNCEMENT_TARGET_ID,
  BLACKLIST_ROLE_ID,
  BLACK_ACCENT,
  COMPONENTS_V2_FLAG,
  CUSTOM_IDS,
  EPHEMERAL_FLAG,
  FIELD_IDS,
  GREEN_ACCENT,
  MAX_CLAIM_MS,
  MAX_DURATION_MS,
  MAX_TIMEOUT_MS,
  MIN_CLAIM_MS,
  MIN_DURATION_MS,
  ORANGE_ACCENT,
  PARTY_POPPER,
  WHITE_ACCENT,
  YELLOW_ACCENT,
  actionRow,
  button,
  container,
  createDraft,
  draftClaimTimeText,
  draftDescriptionText,
  draftHostText,
  draftPrizeText,
  draftWinnerCountText,
  extractMessageId,
  findSubmittedComponent,
  formatDiscordRelative,
  formatDurationCompact,
  getLevelRequirementFromInput,
  getMessageRequirementFromInput,
  getModalComponents,
  getGiveawayAnnouncementTargetId,
  getGiveawayBlacklistRoleId,
  getGiveawayConfig,
  getRequirementLabel,
  getRequirementLevel,
  getRequirementMessageCount,
  getSubmittedValues,
  getWinnerAmountFromInput,
  isSetupComplete,
  joinMentions,
  normalizeWhitespace,
  now,
  parseDurationInput,
  separator,
  text,
  toV2Payload,
  withoutComponentEmojis,
};
