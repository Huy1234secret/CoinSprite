const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, recordGamblingEarnings, getIncomeClaim, setIncomeClaim } = require('../src/gamblingStore');
const { getUserProgress } = require('../src/levelingManager');
const { PRCOIN, formatNumber } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const COOLDOWN_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_STACK_MINUTES = 24 * 60;
const MAX_INCOME = 5000;
const BASE_INCOME = 10;
const GROWTH = 1.05;

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }

function levelIncome(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  return BASE_INCOME * (GROWTH ** safeLevel);
}

module.exports = {
  bypassGlobalCooldown: true,
  data: new SlashCommandBuilder().setName('collect-incomes').setDescription('Collect your stacked passive income (1 min cooldown).'),

  async execute(interaction) {
    const now = Date.now();
    const claim = getIncomeClaim(interaction.user.id);
    const lastClaimAt = Math.max(0, Math.floor(Number(claim.lastClaimAt) || 0));
    const nextAt = lastClaimAt + COOLDOWN_MS;

    if (lastClaimAt > 0 && now < nextAt) {
      await interaction.reply({
        content: `You can collect income again <t:${Math.floor(nextAt / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const progress = interaction.guildId ? getUserProgress(interaction.guildId, interaction.user.id) : { level: 1 };
    const level = Math.max(0, (Math.floor(Number(progress.level) || 1) - 1));
    const startedAt = Math.max(0, Math.floor(Number(claim.startedAt) || 0)) || now;
    const elapsedMinutes = Math.max(0, Math.floor((now - startedAt) / MINUTE_MS));
    const stackedMinutes = Math.min(MAX_STACK_MINUTES, elapsedMinutes);
    const perMinute = levelIncome(level);
    const total = Math.max(0, Math.min(MAX_INCOME, Math.floor(perMinute * stackedMinutes)));

    if (total > 0) {
      addBalance(interaction.user.id, total);
      recordGamblingEarnings(interaction.user.id, total);
    }

    setIncomeClaim(interaction.user.id, { lastClaimAt: now, startedAt: now });

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [{
        type: 17,
        accent_color: 0x57f287,
        components: [
          text(`${interaction.user} You have collected ${formatNumber(total)} ${PRCOIN}!`),
          separator(),
          text(`-# ${formatNumber(stackedMinutes)}m income`),
        ],
      }],
    });
  },
};
