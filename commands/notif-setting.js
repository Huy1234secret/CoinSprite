const { ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getNotificationSetting, setNotificationSetting } = require('../src/generator');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const TOGGLE_PREFIX = 'notif-toggle:';

function buildMessage(user, enabled) {
  const button = new ButtonBuilder()
    .setCustomId(`${TOGGLE_PREFIX}${user.id}`)
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setLabel(enabled ? 'YES' : 'NO');

  const lines = [`## ${user.username}'s Settings.`, '* Send DM when generator done'];
  if (enabled) {
    lines.push('-# This may interrupt your work. Use with caution.');
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 9, components: [{ type: 10, content: lines.join('\n') }], accessory: button.toJSON() },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('notif-setting').setDescription('Toggle generator DM notifications.'),

  async execute(interaction) {
    const enabled = getNotificationSetting(interaction.user.id);
    await interaction.reply(buildMessage(interaction.user, enabled));
  },

  async handleComponent(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith(TOGGLE_PREFIX)) {
      return false;
    }

    const ownerId = interaction.customId.slice(TOGGLE_PREFIX.length);
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'This button is not for you.', ephemeral: true });
      return true;
    }

    const next = !getNotificationSetting(ownerId);
    setNotificationSetting(ownerId, next);
    await interaction.update(buildMessage(interaction.user, next));
    return true;
  },
};
