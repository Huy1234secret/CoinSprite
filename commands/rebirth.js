const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addRebirthBalance, getBalance, getDiscoveredLetters, getRebirthTier, setRebirthTier, spendBalance } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PURPLE_ACCENT = 0xB784FF;
const PRCOIN = '<:PRcoin:1497972406030176356>';
const RBCOIN = '<:Rbcoin:1498172292511825950>';
const MARK_YES = '<:Y_:1498173245981986869>';
const MARK_NO = '<:N_:1498173244031631400>';

const REBIRTHS = [
  { tier: 1, coins: 25000, letter: 'Z', coinBoost: 'x2', luckBoost: 'x1.05', extra: ['Unlock **Rebirth Upgrades**'] },
  { tier: 2, coins: 475000, letter: '1Z', coinBoost: 'x4', luckBoost: 'x1.1', extra: [] },
  { tier: 3, coins: 2000000, letter: '3H', coinBoost: 'x8', luckBoost: 'x1.15', extra: [] },
  { tier: 4, coins: 125000000, letter: '5Z', coinBoost: 'x16', luckBoost: 'x1.2', extra: [] },
  { tier: 5, coins: 1000000000, letter: '7Z', coinBoost: 'x32', luckBoost: 'x1.25', extra: ['Unlock **Challenges**'] },
];

function formatNumber(value) { return Number(Math.floor(value)).toLocaleString('en-US'); }
function nextRebirth(userId) { return REBIRTHS.find((r) => r.tier === getRebirthTier(userId) + 1) ?? null; }
function hasLetter(userId, letter) { return getDiscoveredLetters(userId).includes(letter.toUpperCase()); }

function buildPayload(user, rebirth, balance, metCoins, metLetter, maxed = false) {
  if (maxed) {
    return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: PURPLE_ACCENT, components: [{ type: 10, content: `## ${user.username}'s Rebirth\n-# You already reached the current max rebirth tier.\n-# Balance: **${formatNumber(balance)}** ${PRCOIN}` }] }] };
  }

  const canRebirth = metCoins && metLetter;
  const perks = [`-# ${rebirth.coinBoost} coin earn`, `-# ${rebirth.luckBoost} luck`, `-# +1 ${RBCOIN}`, ...rebirth.extra.map((perk) => `-# ${perk}`)];
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: PURPLE_ACCENT,
      components: [
        { type: 10, content: [`## Rebirth #${rebirth.tier}`, '', '- Perk:', ...perks, '', '- Req:', `-# * ${formatNumber(rebirth.coins)} ${PRCOIN} ${metCoins ? MARK_YES : MARK_NO}`, `-# * Discover **${rebirth.letter}** ${metLetter ? MARK_YES : MARK_NO}`].join('\n') },
        { type: 14, divider: true, spacing: 2 },
        { type: 1, components: [{ type: 2, custom_id: `rebirth:claim:${user.id}`, label: 'Rebirth', style: canRebirth ? 3 : 2, disabled: !canRebirth }] },
      ],
    }],
  };
}

async function render(interaction, useUpdate = false) {
  const userId = interaction.user.id;
  const rebirth = nextRebirth(userId);
  const balance = getBalance(userId);
  const payload = rebirth
    ? buildPayload(interaction.user, rebirth, balance, balance >= rebirth.coins, hasLetter(userId, rebirth.letter))
    : buildPayload(interaction.user, null, balance, false, false, true);
  if (useUpdate) await interaction.update(payload); else await interaction.reply(payload);
}

module.exports = {
  data: new SlashCommandBuilder().setName('rebirth').setDescription('View and claim your next RNG rebirth'),
  suppressCommandLog: true,
  async execute(interaction) { await render(interaction); },
  shouldLogInteraction(interaction) { return !(interaction?.isButton?.() && interaction.customId?.startsWith('rebirth:')); },
  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('rebirth:claim:')) return false;
    const ownerId = interaction.customId.split(':')[2];
    if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own rebirth button.', flags: MessageFlags.Ephemeral }); return true; }
    const rebirth = nextRebirth(interaction.user.id);
    if (!rebirth) { await render(interaction, true); return true; }
    if (getBalance(interaction.user.id) < rebirth.coins || !hasLetter(interaction.user.id, rebirth.letter)) { await render(interaction, true); return true; }
    if (!spendBalance(interaction.user.id, rebirth.coins)) { await render(interaction, true); return true; }
    setRebirthTier(interaction.user.id, rebirth.tier);
    addRebirthBalance(interaction.user.id, 1);
    await interaction.update({ flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: PURPLE_ACCENT, components: [{ type: 10, content: [`## Rebirth #${rebirth.tier} Complete!`, `-# ${rebirth.coinBoost} coin earn`, `-# ${rebirth.luckBoost} luck`, `-# +1 ${RBCOIN}`, ...rebirth.extra.map((perk) => `-# ${perk}`)].join('\n') }] }] });
    return true;
  },
};
