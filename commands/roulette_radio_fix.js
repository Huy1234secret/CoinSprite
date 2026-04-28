const { MessageFlags } = require('discord.js');
const roulette = require('./roulette');
const { formatNumber } = require('../src/gamblingConfig');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const MIN_BET = 100;
const MAX_BET = 100_000;

// Discord modal label-wrapped components currently allow type 21 for radio groups, not type 20.
const RADIO_GROUP_COMPONENT_TYPE = 21;

const RADIO_BET_OPTIONS = {
  color: {
    title: 'Color Bet',
    options: [
      { label: 'Red', value: 'red' },
      { label: 'Black', value: 'black' },
    ],
  },
  parity: {
    title: 'Odd / Even Bet',
    options: [
      { label: 'Odd', value: 'odd' },
      { label: 'Even', value: 'even' },
    ],
  },
  range: {
    title: 'Low / High Bet',
    options: [
      { label: 'Low (1-18)', value: 'low' },
      { label: 'High (19-36)', value: 'high' },
    ],
  },
};

function makeRadioBetModal(betType, userId, gameId) {
  const config = RADIO_BET_OPTIONS[betType];
  return {
    custom_id: `roulette:modal:${userId}:${gameId}:${betType}`,
    title: config.title,
    components: [
      {
        type: 18,
        label: 'Question 1: Choose one',
        component: {
          type: RADIO_GROUP_COMPONENT_TYPE,
          custom_id: 'choice',
          required: true,
          options: config.options,
        },
      },
      {
        type: 18,
        label: `Question 2: What's your bet amount? (${formatNumber(MIN_BET)} - ${formatNumber(MAX_BET)})`,
        component: {
          type: 4,
          custom_id: 'bet',
          style: 1,
          required: true,
          min_length: 1,
          max_length: 12,
          placeholder: 'Enter your bet amount',
        },
      },
    ],
  };
}

async function replyError(interaction, message) {
  if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: message, flags: EPHEMERAL_FLAG }).catch(() => null);
  }
}

module.exports = {
  ...roulette,
  suppressCommandLog: true,

  async handleInteraction(interaction, client) {
    const customId = interaction.customId;

    if (interaction.isStringSelectMenu?.() && typeof customId === 'string' && customId.startsWith('roulette:select:')) {
      const [, , ownerId, gameId] = customId.split(':');

      if (ownerId !== interaction.user.id) {
        await replyError(interaction, 'You can only play your own Roulette game.');
        return true;
      }

      const betType = interaction.values?.[0];
      if (RADIO_BET_OPTIONS[betType]) {
        await interaction.showModal(makeRadioBetModal(betType, interaction.user.id, gameId));
        return true;
      }
    }

    return roulette.handleInteraction(interaction, client);
  },
};
