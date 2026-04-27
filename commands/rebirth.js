const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getRebirthTier, hasDiscoveredLetter, completeRebirth } = require('../src/rngGameStore');
const { PRCOIN, RBCOIN, YES_MARK, NO_MARK, LIGHT_PURPLE_ACCENT, formatAbbreviated, formatNumber, getNextRebirthTierInfo } = require('../src/rngGameEconomy');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const CUSTOM_ID_PREFIX = 'rebirth:do';
function toOwnedCustomId(ownerId) { return `${CUSTOM_ID_PREFIX}:${ownerId}`; }
function getRebirthSnapshot(userId) {
  const rebirthTier = getRebirthTier(userId);
  const nextTier = getNextRebirthTierInfo(rebirthTier);
  const balance = getBalance(userId);
  const hasRequiredCoins = nextTier ? balance >= nextTier.cost : false;
  const hasRequiredLetter = nextTier ? hasDiscoveredLetter(userId, nextTier.requiredLetter) : false;
  return { rebirthTier, nextTier, balance, hasRequiredCoins, hasRequiredLetter, canRebirth: Boolean(nextTier && hasRequiredCoins && hasRequiredLetter) };
}
function buildPayload(user, snapshot, notice = null) {
  if (!snapshot.nextTier) {
    return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: LIGHT_PURPLE_ACCENT, components: [{ type: 10, content: [notice, `## Rebirth #${snapshot.rebirthTier}`, '* You have reached the current max rebirth tier.', `-# Balance: **${formatNumber(snapshot.balance)}** ${PRCOIN}`].filter(Boolean).join('\n') }] }] };
  }
  const tier = snapshot.nextTier;
  const unlockLines = tier.unlocks.map((unlock) => `-# Unlock **${unlock}**`);
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: LIGHT_PURPLE_ACCENT, components: [
    { type: 10, content: [notice, `## Rebirth #${tier.tier}`, '* Perk:', `-# x${tier.coinMultiplier} coin earn`, `-# x${tier.luckMultiplier} luck`, `-# +1 ${RBCOIN}`, ...unlockLines].filter(Boolean).join('\n') },
    { type: 14, divider: true, spacing: 2 },
    { type: 9, components: [{ type: 10, content: ['* Req', `-# * ${formatAbbreviated(tier.cost)} ${PRCOIN} ${snapshot.hasRequiredCoins ? YES_MARK : NO_MARK}`, `-# * Discover **${tier.requiredLetter}** ${snapshot.hasRequiredLetter ? YES_MARK : NO_MARK}`, `-# Current balance: **${formatNumber(snapshot.balance)}** ${PRCOIN}`].join('\n') }], accessory: { type: 2, custom_id: toOwnedCustomId(user.id), label: 'Rebirth', style: snapshot.canRebirth ? 3 : 2, disabled: !snapshot.canRebirth } },
  ] }] };
}
async function render(target, user, notice = null) {
  const payload = buildPayload(user, getRebirthSnapshot(user.id), notice);
  if (typeof target.update === 'function') return target.update(payload);
  if (typeof target.reply === 'function') return target.reply(payload);
  return null;
}
module.exports = {
  data: new SlashCommandBuilder().setName('rebirth').setDescription('View and claim your next RNG rebirth'),
  suppressCommandLog: true,
  async execute(interaction) { await render(interaction, interaction.user); },
  shouldLogInteraction(interaction) { return !(interaction?.customId && interaction.customId.startsWith(CUSTOM_ID_PREFIX)); },
  async handleInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) return false;
    const ownerId = interaction.customId.split(':').slice(2).join(':');
    if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own rebirth button.', flags: MessageFlags.Ephemeral }); return true; }
    const snapshot = getRebirthSnapshot(interaction.user.id);
    if (!snapshot.canRebirth) { await render(interaction, interaction.user, '-# You no longer meet the rebirth requirements.'); return true; }
    const result = completeRebirth(interaction.user.id, snapshot.nextTier.cost);
    if (!result) { await render(interaction, interaction.user, '-# Rebirth failed because your balance changed.'); return true; }
    await render(interaction, interaction.user, `-# Rebirth complete! You reached **Rebirth #${result.rebirthTier}** and gained **+1 ${RBCOIN}**.`);
    return true;
  },
};
