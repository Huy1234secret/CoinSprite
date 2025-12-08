const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');

const HUNT_BUTTON_PREFIX = 'hunt:';
const HUNT_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless';
const HEART_EMOJI = '<:SBHeart:1447532986378485882>';
const DEFENSE_EMOJI = '<:SBDefense:1447532983933472900>';

function buildProgressBar(current, total, width = 20) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function buildSeparatorRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(' ')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

function buildNavigationRow(userId, { active } = { active: 'home' }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${HUNT_BUTTON_PREFIX}home:${userId}`)
      .setLabel('HUNT')
      .setStyle(active === 'home' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(active === 'home'),
    new ButtonBuilder()
      .setCustomId(`${HUNT_BUTTON_PREFIX}stats:${userId}`)
      .setLabel('Hunt Stat')
      .setStyle(active === 'stats' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(active === 'stats'),
    new ButtonBuilder()
      .setCustomId(`${HUNT_BUTTON_PREFIX}equipment:${userId}`)
      .setLabel('Equipment')
      .setStyle(active === 'equipment' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(active === 'equipment'),
  );
}

function buildHuntHomeContent(userId) {
  const embed = {
    description: '## Hunting\n-# Hunting is currently WIP. Stay tuned!',
    color: 0xb2b2b2,
    thumbnail: { url: HUNT_THUMBNAIL },
  };

  return {
    embeds: [embed],
    components: [buildSeparatorRow(), buildNavigationRow(userId, { active: 'home' })],
  };
}

function buildHuntStatsContent(userId) {
  const level = 1;
  const xp = 0;
  const nextLevel = 100;
  const progressBar = buildProgressBar(xp, nextLevel);
  const percent = Math.min(100, Math.max(0, (xp / Math.max(nextLevel, 1)) * 100));

  const embed = {
    color: 0xb2b2b2,
    description: `## Hunting Stat\n### Hunt Level: ${level}\n-# ${progressBar} \`${xp} / ${nextLevel} - ${percent.toFixed(2)}%\`
\n* User Health: 100 ${HEART_EMOJI}\n* User Defense: 0 ${DEFENSE_EMOJI}`,
    thumbnail: { url: HUNT_THUMBNAIL },
  };

  return {
    embeds: [embed],
    components: [buildSeparatorRow(), buildNavigationRow(userId, { active: 'stats' })],
  };
}

function buildHuntEquipmentContent(userId) {
  const templateEmbed = {
    color: 0x2f3136,
    description: '## Hunt Equipment Template\n-# Fill your loadout using the selectors below.\n* Gear Slot: `None`\n* Misc Slot: `None`',
    thumbnail: { url: HUNT_THUMBNAIL },
  };

  const infoEmbed = {
    color: 0xb2b2b2,
    description: '## Hunting Equipment\n### * Gear equipped: None\n### * Misc equipped: None',
    thumbnail: { url: HUNT_THUMBNAIL },
  };

  const selectionEmbed = {
    color: 0x2f3136,
    description: 'Use the selectors below to choose your Hunting Gear and Misc equipment.',
    thumbnail: { url: HUNT_THUMBNAIL },
  };

  return {
    embeds: [templateEmbed, infoEmbed, selectionEmbed],
    components: [buildSeparatorRow(), buildNavigationRow(userId, { active: 'equipment' })],
  };
}

async function handleHuntButton(interaction) {
  const [, action, userId] = interaction.customId.split(':');

  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  if (action === 'home') {
    const content = buildHuntHomeContent(userId);
    await interaction.update(content);
    return true;
  }

  if (action === 'stats') {
    const content = buildHuntStatsContent(userId);
    await interaction.update(content);
    return true;
  }

  if (action === 'equipment') {
    const content = buildHuntEquipmentContent(userId);
    await interaction.update(content);
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
    await interaction.reply(content);
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(HUNT_BUTTON_PREFIX)) {
      return handleHuntButton(interaction);
    }
    return false;
  }
};
