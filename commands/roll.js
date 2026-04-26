const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const ROLL_TABLE = [
  { letter: 'A', chance: 70, min: 1, max: 5 },
  { letter: 'B', chance: 20, min: 3, max: 10 },
  { letter: 'C', chance: 9, min: 5, max: 25 },
  { letter: 'D', chance: 1, min: 10, max: 50 },
  { letter: 'E+', chance: 0, min: 0, max: 0 },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollLetter() {
  const totalChance = ROLL_TABLE.reduce((sum, row) => sum + row.chance, 0);
  const rolled = Math.random() * totalChance;
  let cursor = 0;

  for (const row of ROLL_TABLE) {
    cursor += row.chance;
    if (rolled < cursor) {
      return row;
    }
  }

  return ROLL_TABLE[0];
}

module.exports = {
  data: new SlashCommandBuilder().setName('roll').setDescription('Roll a random letter and earn PRcoin'),

  async execute(interaction) {
    const result = rollLetter();
    const earned = result.max > 0 ? randomInt(result.min, result.max) : 0;
    addBalance(interaction.user.id, earned);

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      allowedMentions: { users: [] },
      components: [
        {
          type: 17,
          accent_color: 0xffffff,
          components: [
            {
              type: 10,
              content: [
                `${interaction.user} You have rolled`,
                `## **${result.letter}**`,
                '---',
                `-# You've earned ${earned}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
