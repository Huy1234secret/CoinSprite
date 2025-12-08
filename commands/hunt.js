const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');

const HUNT_BUTTON_PREFIX = 'hunt:';

function buildProgressBar(current, total, width = 20) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function buildHuntHomeContent(userId) {
  const embed = {
    description: "## Hunting\n-# Hunting is currently WIP. Stay tuned!",
    color: 0xb2b2b2,
    thumbnail: { url: 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless' }
  };

  const actionRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}home:${userId}`)
        .setLabel('HUNT')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}stats:${userId}`)
        .setLabel('Hunt Stat')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}equipment:${userId}`)
        .setLabel('Equipment')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [actionRow] };
}

function buildHuntStatsContent(userId) {
  const level = 1;
  const xp = 0;
  const nextLevel = 100;
  const progressBar = buildProgressBar(xp, nextLevel);
  const percent = Math.min(100, Math.max(0, (xp / Math.max(nextLevel, 1)) * 100));

  const embed = {
    color: 0xb2b2b2,
    description: `## Hunting Stat\n### Hunt Level: ${level}\n-# ${progressBar} \`${xp} / ${nextLevel} - ${percent.toFixed(2)}%\`\n* User Health: 100 ❤️\n* User Defense: 0 🛡️`,
    thumbnail: { url: 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless' }
  };

  const actionRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}home:${userId}`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}stats:${userId}`)
        .setLabel('Hunt Stat')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}equipment:${userId}`)
        .setLabel('Equipment')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [actionRow] };
}

function buildHuntEquipmentContent(userId) {
  const embed = {
    color: 0x808080,
    description: '## Hunting Equipment\n-# Equipment selection is coming soon.'
  };

  const actionRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}home:${userId}`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}stats:${userId}`)
        .setLabel('Hunt Stat')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${HUNT_BUTTON_PREFIX}equipment:${userId}`)
        .setLabel('Equipment')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

  return { embeds: [embed], components: [actionRow] };
}

async function handleHuntButton(interaction) {
  const [, action, userId] = interaction.customId.split(':');

  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  if (action === 'home') {
    const content = buildHuntHomeContent(userId);
    await interaction.update({ ...content, ephemeral: true });
    return true;
  }

  if (action === 'stats') {
    const content = buildHuntStatsContent(userId);
    await interaction.update({ ...content, ephemeral: true });
    return true;
  }

  if (action === 'equipment') {
    const content = buildHuntEquipmentContent(userId);
    await interaction.update({ ...content, ephemeral: true });
    return true;
  }

  await safeErrorReply(interaction, 'Unknown hunting action.');
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hunt')
    .setDescription('Open the hunting menu.'),

  async execute(interaction) {
    const content = buildHuntHomeContent(interaction.user.id);
    await interaction.reply({ ...content, ephemeral: true });
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(HUNT_BUTTON_PREFIX)) {
      return handleHuntButton(interaction);
    }
    return false;
  }
};
