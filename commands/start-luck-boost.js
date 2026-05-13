const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  colorForMultiplier,
  formatMoreLuckPercent,
  formatMultiplier,
  parseDuration,
  parseLuckPercent,
  startBoost,
} = require('../src/luckBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const LUCK_BOOST_CHANNEL_ID = '1493904589848576030';
const LUCK_BOOST_ROLE_ID = '1503735931574812762';

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components: [{ type: 10, content }] }],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-luck-boost')
    .setDescription('Start a server-wide RNG luck boost.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('time')
      .setDescription('How long the boost lasts. Example: 30m, 2h, 1d')
      .setRequired(true))
    .addNumberOption((option) => option
      .setName('multi')
      .setDescription('Luck percent to add. Example: 25 = 1.25x luck')
      .setMinValue(0.01)
      .setMaxValue(10000)
      .setRequired(true)),

  async execute(interaction, client) {
    const durationInput = interaction.options.getString('time', true);
    const percentInput = interaction.options.getNumber('multi', true);
    const durationMs = parseDuration(durationInput);
    const percent = parseLuckPercent(percentInput);

    if (!durationMs) {
      await interaction.reply({
        content: 'Invalid time. Use a duration from **1m** to **30d** like `30m`, `2h`, or `1d`.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    if (!percent) {
      await interaction.reply({
        content: 'Invalid multi. Type the added luck percent, for example `25` for **1.25x** luck.',
        flags: EPHEMERAL_FLAG,
      });
      return;
    }

    const boost = startBoost({ durationMs, percent, startedById: interaction.user.id });
    const channel = await client.channels.fetch(LUCK_BOOST_CHANNEL_ID).catch(() => null);
    if (!channel?.send) {
      await interaction.reply({ content: `Luck boost started, but I could not send the announcement to <#${LUCK_BOOST_CHANNEL_ID}>.`, flags: EPHEMERAL_FLAG });
      return;
    }

    const endsUnix = Math.floor(boost.endsAt / 1000);
    await channel.send({
      allowedMentions: { roles: [LUCK_BOOST_ROLE_ID] },
      ...container(colorForMultiplier(boost.multiplier), [
        `<@&${LUCK_BOOST_ROLE_ID}>`,
        `### <@${interaction.user.id}> has started LUCK BOOST🍀 for ${durationInput}!`,
        `-# All users earn ${formatMoreLuckPercent(percent)} more luck (${formatMultiplier(boost.multiplier)} total), ends <t:${endsUnix}:R>`,
      ].join('\n')),
    });

    await interaction.reply({ content: `Started a **${formatMultiplier(boost.multiplier)}** luck boost until <t:${endsUnix}:R>.`, flags: EPHEMERAL_FLAG });
  },
};
