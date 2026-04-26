const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, getUpgrades } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PRCOIN = '<:PRcoin:1497972406030176356>';
const RED_ACCENT = 0xED4245;

const LETTER_REWARDS = [
  { letter: 'A', min: 1, max: 5 },
  { letter: 'B', min: 3, max: 10 },
  { letter: 'C', min: 5, max: 25 },
  { letter: 'D', min: 10, max: 50 },
  { letter: 'E', min: 25, max: 100 },
  { letter: 'F', min: 50, max: 250 },
  { letter: 'G', min: 100, max: 500 },
  { letter: 'H', min: 250, max: 1000 },
  { letter: 'I', min: 500, max: 2500 },
  { letter: 'J', min: 1000, max: 5000 },
  { letter: 'K', min: 2500, max: 10000 },
  { letter: 'L', min: 5000, max: 25000 },
  { letter: 'M', min: 10000, max: 50000 },
  { letter: 'N', min: 25000, max: 100000 },
  { letter: 'O', min: 50000, max: 250000 },
  { letter: 'P', min: 100000, max: 500000 },
  { letter: 'Q', min: 250000, max: 1000000 },
  { letter: 'R', min: 500000, max: 2500000 },
  { letter: 'S', min: 1000000, max: 5000000 },
  { letter: 'T', min: 2500000, max: 10000000 },
  { letter: 'U', min: 5000000, max: 25000000 },
  { letter: 'V', min: 10000000, max: 50000000 },
  { letter: 'W', min: 25000000, max: 100000000 },
  { letter: 'X', min: 50000000, max: 250000000 },
  { letter: 'Y', min: 100000000, max: 500000000 },
  { letter: 'Z', min: 250000000, max: 1000000000 },
];

const BASE_WEIGHTS = [38, 24, 14, 8, 5, 3, 2, 1.4, 1, 0.7, 0.5, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02, 0.015, 0.01];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function getLuckBonusPercent(luckLevel) {
  return roundToOne(100 * (1 - (0.9 ** luckLevel)));
}

function getUnlockedLetterIndex(luckLevel) {
  const luckPct = getLuckBonusPercent(luckLevel);
  return Math.min(LETTER_REWARDS.length - 1, Math.floor(luckPct / 4));
}

function buildWeights(luckLevel) {
  const unlockedIndex = getUnlockedLetterIndex(luckLevel);
  const weights = BASE_WEIGHTS.map((weight, idx) => (idx <= unlockedIndex ? weight : 0));

  for (let idx = 1; idx <= unlockedIndex; idx += 1) {
    const shift = 0.35 + (idx * 0.05);
    let remaining = shift;

    for (let low = 0; low < idx && remaining > 0; low += 1) {
      if (weights[low] <= 0) {
        continue;
      }
      const take = Math.min(weights[low], remaining);
      weights[low] -= take;
      remaining -= take;
    }

    weights[idx] += shift - remaining;
  }

  return weights;
}

function rollLetter(luckLevel) {
  const weights = buildWeights(luckLevel);
  const totalChance = weights.reduce((sum, weight) => sum + weight, 0);
  const rolled = Math.random() * totalChance;
  let cursor = 0;

  for (let i = 0; i < LETTER_REWARDS.length; i += 1) {
    cursor += weights[i];
    if (rolled < cursor) {
      return LETTER_REWARDS[i];
    }
  }

  return LETTER_REWARDS[0];
}

async function executeRoll(target, user) {
  const upgrades = getUpgrades(user.id);
  const result = rollLetter(upgrades.luckLevel);
  const baseEarned = randomInt(result.min, result.max);

  const critChance = Math.min(50, upgrades.critChanceLevel * 10);
  const critPower = upgrades.critPowerLevel * 5;
  const didCrit = Math.random() * 100 < critChance;

  const finalEarned = didCrit
    ? Math.floor(baseEarned * (1 + (critPower / 100)))
    : baseEarned;

  addBalance(user.id, finalEarned);

  const earnLine = didCrit
    ? `-# You've earned ~~${baseEarned}~~ **${finalEarned}** ${PRCOIN}`
    : `-# You've earned **${finalEarned}** ${PRCOIN}`;

  const titleLines = [`${user} You have rolled`];
  if (didCrit) {
    titleLines.push(`-# 💥 rolled crit!!! [ +${critPower}% ]`);
  }

  const payload = {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: RED_ACCENT,
        components: [
          {
            type: 10,
            content: [...titleLines, `## ${result.letter}`].join('\n'),
          },
          {
            type: 14,
            divider: true,
            spacing: 2,
          },
          {
            type: 10,
            content: earnLine,
          },
        ],
      },
    ],
  };

  if (typeof target.reply === 'function') {
    await target.reply(payload);
  } else {
    await target.channel.send(payload);
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('roll').setDescription('Roll a random letter and earn PRcoin'),

  async execute(interaction) {
    await executeRoll(interaction, interaction.user);
  },

  async handleMessageCreate(message) {
    if (!message || message.author?.bot || !message.content) {
      return;
    }

    const content = message.content.trim().toLowerCase();
    if (content === '!roll') {
      await executeRoll(message, message.author);
    }
  },
};
