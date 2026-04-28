const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, recordGamblingEarnings, getWorkCooldown, setWorkCooldown } = require('../src/gamblingStore');
const { getUserProgress } = require('../src/levelingManager');
const { PRCOIN, formatAbbreviated } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const WORK_COOLDOWN_MS = 5 * 60 * 1000;
const BASE_MIN = 100;
const BASE_MAX = 1000;
const MIN_CAP = 2500;
const MAX_CAP = 25000;
const LEVEL_SCALE = 1.035;

function getWorkRange(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const multiplier = LEVEL_SCALE ** (safeLevel - 1);
  const min = Math.min(MIN_CAP, Math.floor(BASE_MIN * multiplier));
  const max = Math.min(MAX_CAP, Math.floor(BASE_MAX * multiplier));
  return {
    min,
    max: Math.max(min, max),
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work to earn PRcoin. Cooldown: 5 minutes.'),

  async execute(interaction) {
    const now = Date.now();
    const cooldownUntil = getWorkCooldown(interaction.user.id);

    if (cooldownUntil > now) {
      const remainingMs = cooldownUntil - now;
      const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      await interaction.reply({
        content: `${interaction.user} You can work again <t:${Math.floor(cooldownUntil / 1000)}:R> (\`${remainingSeconds}s\` left).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const level = interaction.guildId ? getUserProgress(interaction.guildId, interaction.user.id).level : 1;
    const { min, max } = getWorkRange(level);
    const earnings = randomInt(min, max);

    addBalance(interaction.user.id, earnings);
    recordGamblingEarnings(interaction.user.id, earnings);
    setWorkCooldown(interaction.user.id, now + WORK_COOLDOWN_MS);

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0xffffff,
          components: [
            {
              type: 10,
              content: `${interaction.user} You have worked and earned ${formatAbbreviated(earnings)} ${PRCOIN}`,
            },
          ],
        },
      ],
    });
  },
};
