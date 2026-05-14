const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  colorForMultiplier,
  formatMoreLuckPercent,
  formatMultiplier,
  formatRollCount,
  parseAmountRolls,
  parseDuration,
  parseLuckPercent,
  startBoost,
} = require('../src/luckBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const LUCK_BOOST_CHANNEL_ID = '1493904589848576030';

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components: [{ type: 10, content }] }],
  };
}

function getBoostDurationText(boost, durationInput, amountRolls) {
  if (Number.isFinite(Number(boost.endsAt))) return `${durationInput}`;
  return formatRollCount(amountRolls);
}

function getBoostStatusText(boost, amountRolls) {
  if (Number.isFinite(Number(boost.endsAt))) {
    return `ends <t:${Math.floor(boost.endsAt / 1000)}:R>`;
  }
  return `${formatRollCount(amountRolls)} available`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-luck-boost')
    .setDescription('Start a server-wide RNG luck boost.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addNumberOption((option) => option
      .setName('boost')
      .setDescription('Luck percent to add. Example: 100 = 2x luck')
      .setMinValue(0.01)
      .setMaxValue(100000)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('How long the boost lasts. Example: 30m, 2h, 1d')
      .setRequired(false))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many rolls receive this luck boost')
      .setMinValue(1)
      .setMaxValue(1000000)
      .setRequired(false)),

  async execute(interaction, client) {
    const percentInput = interaction.options.getNumber('boost', true);
    const durationInput = interaction.options.getString('time', false);
    const amountInput = interaction.options.getInteger('amount', false);
    const hasTime = Boolean(durationInput?.trim());
    const hasAmount = amountInput !== null;
    const percent = parseLuckPercent(percentInput);

    if (!percent) {
      await interaction.reply({
        content: 'Invalid boost. Type the added luck percent, for example `100` for **2x** luck.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    if (hasTime === hasAmount) {
      await interaction.reply({
        content: 'Set exactly one limit: either `time` (example `30m`) or `amount` (example `10` rolls), but not both.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    const durationMs = hasTime ? parseDuration(durationInput) : null;
    const amountRolls = hasAmount ? parseAmountRolls(amountInput) : null;

    if (hasTime && !durationMs) {
      await interaction.reply({
        content: 'Invalid time. Use a duration from **1m** to **30d** like `30m`, `2h`, or `1d`.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    if (hasAmount && !amountRolls) {
      await interaction.reply({
        content: 'Invalid amount. Type a whole number of rolls from **1** to **1,000,000**.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    const boost = startBoost({ durationMs, amountRolls, percent, startedById: interaction.user.id });
    const channel = await client.channels.fetch(LUCK_BOOST_CHANNEL_ID).catch(() => null);
    if (!channel?.send) {
      await interaction.reply({ content: `Luck boost started, but I could not send the announcement to <#${LUCK_BOOST_CHANNEL_ID}>.`, flags: EPHEMERAL_FLAG });
      return;
    }

    const durationText = getBoostDurationText(boost, durationInput, amountRolls);
    const statusText = getBoostStatusText(boost, amountRolls);
    await channel.send({
      allowedMentions: { parse: [] },
      ...container(colorForMultiplier(boost.multiplier), [
        `### <@${interaction.user.id}> has started LUCK BOOST🍀 for ${durationText}!`,
        `-# All users earn ${formatMoreLuckPercent(percent)} more luck (${formatMultiplier(boost.multiplier)} total), ${statusText}`,
      ].join('\n')),
    });

    await interaction.reply({ content: `Started a **${formatMultiplier(boost.multiplier)}** luck boost for ${durationText}.`, flags: EPHEMERAL_FLAG });
  },
};
