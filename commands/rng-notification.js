const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const notificationStore = require('../src/rngNotificationStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const BUTTON_PREFIX = 'rngnotif:set:';
const MODAL_PREFIX = 'rngnotif:modal:';
const INPUT_ID = 'rng_notification_threshold';

function container(accent, components) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components }],
  };
}

function text(content) {
  return { type: 10, content };
}

function actionRow(...components) {
  return { type: 1, components };
}

function button(customId, label) {
  return { type: 2, custom_id: customId, label, style: 2 };
}

function buildNotificationPayload(userId, threshold = notificationStore.getThreshold(userId)) {
  return container(0xFFFFFF, [
    text('### Chance notification:\n-# Bot will ping you when you rolled a rarity has chance lower or equal!'),
    actionRow(button(`${BUTTON_PREFIX}${userId}`, notificationStore.formatThresholdLabel(threshold))),
  ]);
}

function buildNotificationModal(userId) {
  return {
    custom_id: `${MODAL_PREFIX}${userId}`,
    title: 'Chance notification',
    components: [
      {
        type: 18,
        label: 'Notify for 1 in ___ or rarer rolls',
        component: {
          type: 4,
          custom_id: INPUT_ID,
          style: 1,
          required: false,
          min_length: 0,
          max_length: 24,
          placeholder: 'You can type like 1k, 1m, 1b or 1t, leave empty to notify all',
        },
      },
    ],
  };
}

function assertOwner(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  interaction.reply({ content: 'Only the user who ran this command can change this notification setting.', flags: EPHEMERAL_FLAG }).catch(() => null);
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rng-notification')
    .setDescription('Choose when RNG rare-roll announcements should ping you'),

  async execute(interaction) {
    await interaction.reply(buildNotificationPayload(interaction.user.id));
  },

  async handleInteraction(interaction) {
    if (interaction.isButton?.() && interaction.customId?.startsWith(BUTTON_PREFIX)) {
      const ownerId = interaction.customId.slice(BUTTON_PREFIX.length);
      if (!assertOwner(interaction, ownerId)) return true;
      await interaction.showModal(buildNotificationModal(ownerId));
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith(MODAL_PREFIX)) {
      const ownerId = interaction.customId.slice(MODAL_PREFIX.length);
      if (!assertOwner(interaction, ownerId)) return true;
      const rawInput = interaction.fields.getTextInputValue(INPUT_ID);
      const parsed = notificationStore.parseThresholdInput(rawInput);
      if (!parsed.ok) {
        await interaction.reply({ content: parsed.error, flags: EPHEMERAL_FLAG });
        return true;
      }

      const threshold = notificationStore.setThreshold(ownerId, parsed.threshold);
      const payload = buildNotificationPayload(ownerId, threshold);
      if (interaction.message?.editable) {
        await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(() => null);
        await interaction.message.edit(payload).catch(() => null);
        await interaction.editReply({ content: `Chance notification set to **${notificationStore.formatThresholdLabel(threshold)}**.` }).catch(() => null);
      } else {
        await interaction.reply({ content: `Chance notification set to **${notificationStore.formatThresholdLabel(threshold)}**.`, flags: EPHEMERAL_FLAG });
      }
      return true;
    }

    return false;
  },
};
