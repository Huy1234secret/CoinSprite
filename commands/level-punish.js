const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PUNISH_LOG_CHANNEL_ID = '1495043455423086733';

function punishmentText(tier) {
  if (tier === 1) {
    return '-500% XP gain for 24 hours';
  }
  if (tier === 2) {
    return '-1000% XP gain for 3 days';
  }
  if (tier === 3) {
    return 'XP blacklist for 1 week';
  }
  if (tier === 4) {
    return '50% of their current XP has been removed';
  }
  if (tier === 5) {
    return 'All leveling data has been reset';
  }
  return 'No punishment';
}

function punishmentEndLine(endsAt) {
  if (!endsAt) {
    return '-# punishment will end immediately';
  }
  return `-# punishment will end <t:${Math.floor(endsAt / 1000)}:R>`;
}

async function sendTierDm(guild, userId, tier) {
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  const target = member?.user || await guild.client.users.fetch(userId).catch(() => null);
  if (!target) {
    return;
  }

  if (tier === 4) {
    await target.send({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0x8B0000,
          components: [
            { type: 10, content: '### Your level data has been halved\n-# Reason: leveling punishment reached `tier 4`' },
          ],
        },
      ],
    }).catch(() => null);
  }

  if (tier === 5) {
    await target.send({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0x000000,
          components: [
            { type: 10, content: '### Your level data has been wiped\n-# Reason: leveling punishment reached `tier 5`' },
          ],
        },
      ],
    }).catch(() => null);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level-punish')
    .setDescription('Increase leveling punishment tier for a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to punish')
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const result = manager.applyLevelPunishment(interaction.guildId, user.id);
    const punishment = punishmentText(result.newTier);

    const publicMessage = `## ${interaction.user.username} applied punishment tier ${result.newTier} on <@${user.id}>\n* ${user.username} will get ${punishment}`;

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0xED4245,
          components: [
            { type: 10, content: publicMessage },
          ],
        },
      ],
    });

    const logChannel = interaction.guild.channels.cache.get(PUNISH_LOG_CHANNEL_ID)
      || await interaction.guild.channels.fetch(PUNISH_LOG_CHANNEL_ID).catch(() => null);

    if (logChannel?.isTextBased()) {
      await logChannel.send({
        flags: COMPONENTS_V2_FLAG,
        components: [
          {
            type: 17,
            accent_color: 0xED4245,
            components: [
              { type: 10, content: publicMessage },
              { type: 14, divider: true, spacing: 1 },
              { type: 10, content: `${punishmentEndLine(result.endsAt)}\n-# UserID: ${user.id}` },
            ],
          },
        ],
      }).catch(() => null);
    }

    await sendTierDm(interaction.guild, user.id, result.newTier);
  },
};
