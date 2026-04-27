const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getBalance,
  getRebirthTier,
  setRebirthTier,
  addRebirthBalance,
  hasDiscoveredLetter,
  resetProgressForRebirth,
} = require('../src/rngGameStore');
const {
  PRCOIN,
  RBCOIN,
  Y_MARK,
  N_MARK,
  LIGHT_PURPLE_ACCENT,
  GREEN_ACCENT,
  getRebirthInfo,
  formatNumber,
} = require('../src/rngConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const CUSTOM_ID_PREFIX = 'rebirth:do';

function buildPerkLines(info) {
  return [
    `-# x${info.coinMultiplier} coin earn`,
    `-# x${info.luckMultiplier} luck`,
    `-# +${info.rewardRebirthCoins} ${RBCOIN}`,
    ...info.unlocks.map((unlock) => `-# ${unlock}`),
  ];
}

function getRequirementState(userId, info) {
  const balance = getBalance(userId);
  const hasCoins = balance >= info.requiredCoins;
  const hasLetter = hasDiscoveredLetter(userId, info.requiredLetter);
  return {
    balance,
    hasCoins,
    hasLetter,
    met: hasCoins && hasLetter,
  };
}

function buildPayload(user, notice = null) {
  const currentTier = getRebirthTier(user.id);
  const nextTier = currentTier + 1;
  const info = getRebirthInfo(nextTier);

  if (!info) {
    return {
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: LIGHT_PURPLE_ACCENT,
          components: [
            {
              type: 10,
              content: [
                notice ? `-# ${notice}` : null,
                `## ${user.username}'s Rebirth`,
                '-# You already reached the current max rebirth tier.',
                `-# Current Rebirth: **${currentTier}**`,
              ].filter(Boolean).join('\n'),
            },
          ],
        },
      ],
    };
  }

  const req = getRequirementState(user.id, info);
  const content = [
    notice ? `-# ${notice}` : null,
    `## Rebirth #${info.tier}`,
    '',
    'Perk:',
    ...buildPerkLines(info),
  ].filter((line) => line !== null).join('\n');

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: LIGHT_PURPLE_ACCENT,
        components: [
          {
            type: 10,
            content,
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content: [
              `-# * ${formatNumber(info.requiredCoins)} ${PRCOIN} ${req.hasCoins ? Y_MARK : N_MARK}`,
              `-# * Discover ${info.requiredLetter} ${req.hasLetter ? Y_MARK : N_MARK}`,
              `-# Current balance: **${formatNumber(req.balance)}** ${PRCOIN}`,
            ].join('\n'),
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `${CUSTOM_ID_PREFIX}:${user.id}`,
                label: 'Rebirth',
                style: req.met ? 3 : 2,
                disabled: !req.met,
              },
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('rebirth').setDescription('Rebirth your RNG progress for permanent perks'),
  suppressCommandLog: true,

  async execute(interaction) {
    await interaction.reply(buildPayload(interaction.user));
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('rebirth:'));
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) {
      return false;
    }

    const [, , ownerId] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own rebirth button.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const nextTier = getRebirthTier(interaction.user.id) + 1;
    const info = getRebirthInfo(nextTier);
    if (!info) {
      await interaction.update(buildPayload(interaction.user));
      return true;
    }

    const req = getRequirementState(interaction.user.id, info);
    if (!req.met) {
      await interaction.update(buildPayload(interaction.user, 'You do not meet every rebirth requirement yet.'));
      return true;
    }

    resetProgressForRebirth(interaction.user.id);
    setRebirthTier(interaction.user.id, info.tier);
    addRebirthBalance(interaction.user.id, info.rewardRebirthCoins);

    await interaction.update(buildPayload(interaction.user, `✅ Rebirth #${info.tier} completed! Your PRcoin and coin upgrades were reset.`));
    return true;
  },
};
