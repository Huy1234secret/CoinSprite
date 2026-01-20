const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

const EFFECTS = [
  'Wither',
  'Wind Charged',
  'Raid Omen',
  'Levitation',
  'Mining Fatigue',
  'Darkness',
  'Instant Damage',
  'Weaving',
  'Oozing',
  'Luck',
  'Infested',
  'Jump Boost',
  'Haste',
  'Instant Health',
  'Nausea',
  'Speed',
  'Fire Resistance',
  'Trial Omen',
  'Resistance',
  'Absorption',
  'Slow Falling',
  'Strength',
  'Night Vision',
  'Invisibility',
  'Glowing',
  'Weakness',
  'Regeneration',
  'Conduit Power',
  'Dolphin’s Grace',
  'Health Boost',
  'Hero of the Village',
  'Water Breathing',
  'Slowness',
  'Hunger',
  'Blindness',
  'Poison',
  'Saturation',
  'Bad Luck (Unluck)',
  'Bad Omen',
];

const EFFECT_DURATIONS = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildMessage(effect, durationSeconds) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x8e44ad,
        components: [
          {
            type: 10,
            content: [
              '## 🎲 Random Effect Roll',
              `Effect: **${effect}**`,
              `Duration: **${durationSeconds}s**`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll-effect')
    .setDescription('Roll a random effect with a random duration.'),

  async execute(interaction) {
    const effect = pickRandom(EFFECTS);
    const durationSeconds = pickRandom(EFFECT_DURATIONS);
    await interaction.reply(buildMessage(effect, durationSeconds));
  },
};
