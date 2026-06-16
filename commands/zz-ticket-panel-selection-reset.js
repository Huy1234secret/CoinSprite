'use strict';

const ticketSystem = require('./ticket-system');
const { getGuildConfig } = require('../src/serverConfig');
const { buildTicketMessagePayload, discordEmoji } = require('../src/ticketConfig');

const PANEL_TYPE_SELECT = 'ticket:type-select';
const PANEL_TYPE_BUTTON_PREFIX = 'ticket:type-button:';

function buttonStyleValue(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}

function panelTypeControls(ticketConfig) {
  if (!ticketConfig?.enabled) return [];
  const types = Array.isArray(ticketConfig.types) ? ticketConfig.types : [];
  if (!types.length) return [];

  if (ticketConfig.launcherStyle === 'buttons') {
    const rows = [];
    for (let index = 0; index < types.length; index += 5) {
      rows.push({
        type: 1,
        components: types.slice(index, index + 5).map((ticketType) => ({
          type: 2,
          custom_id: `${PANEL_TYPE_BUTTON_PREFIX}${ticketType.id}`,
          label: ticketType.name,
          style: buttonStyleValue(ticketType.buttonStyle),
          ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
        })),
      });
    }
    return rows;
  }

  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: PANEL_TYPE_SELECT,
      placeholder: 'Choose a ticket type',
      options: types.map((ticketType) => ({
        label: ticketType.name,
        value: ticketType.id,
        ...(ticketType.description ? { description: ticketType.description } : {}),
        ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
      })),
    }],
  }];
}

function isPanelSelectInteraction(interaction) {
  return Boolean(interaction?.isStringSelectMenu?.() && interaction.customId === PANEL_TYPE_SELECT);
}

async function resetTicketPanelSelection(interaction) {
  if (!isPanelSelectInteraction(interaction) || !interaction.message?.editable || !interaction.guild) return;
  const ticketConfig = getGuildConfig(interaction.guild.id)?.tickets;
  if (!ticketConfig?.enabled) return;

  await interaction.message.edit(buildTicketMessagePayload(
    ticketConfig.launcherMessage,
    { server: interaction.guild.name },
    panelTypeControls(ticketConfig),
  )).catch(() => null);
}

if (ticketSystem.handleInteraction && !ticketSystem.__ticketPanelSelectionResetPatch) {
  const nativeHandleInteraction = ticketSystem.handleInteraction.bind(ticketSystem);
  ticketSystem.handleInteraction = async (interaction, client) => {
    const handled = await nativeHandleInteraction(interaction, client);
    if (handled && isPanelSelectInteraction(interaction)) {
      await resetTicketPanelSelection(interaction);
      setTimeout(() => resetTicketPanelSelection(interaction), 400);
    }
    return handled;
  };
  ticketSystem.__ticketPanelSelectionResetPatch = true;
}

module.exports = {};
