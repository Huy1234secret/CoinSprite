const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, getUpgrades } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PRCOIN = '<:PRcoin:1497972406030176356>';
const RED_ACCENT = 0xED4245;
const WHITE_ACCENT = 0xFFFFFF;

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

const STARTING_CHANCES = [70, 20, 9, 1];
const FIRST_UNLOCK_INDEX = 4; // E
const FIRST_UNLOCK_LUCK = 8;
const HIGH_TIER_START_LUCK = 60;
const HIGH_TIER_CAP = 8;
const E_CAP = 1.5;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function getLuckBonusPercent(luckLevel) {
  if (luckLevel <= 0) {
    return 0;
  }

  return roundToOne(10 * (luckLevel ** 1.1));
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildChances(luckLevel) {
  const chances = Array.from({ length: LETTER_REWARDS.length }, () => 0);
  const luckPercent = getLuckBonusPercent(luckLevel);

  // Move chance mostly from A into B/C/D first, then introduce a very small E chance.
  const luckRatio = clamp(luckPercent / 100, 0, 1);
  const movedFromA = clamp(luckPercent * 0.62, 0, 68);
  const eChance = luckPercent >= FIRST_UNLOCK_LUCK
    ? clamp((luckPercent - FIRST_UNLOCK_LUCK) * 0.05, 0, E_CAP)
    : 0;

  const distributable = Math.max(0, movedFromA - eChance);
  const bWeight = 0.62 - (0.25 * luckRatio);
  const cWeight = 0.24 + (0.07 * luckRatio);
  const dWeight = 0.14 + (0.14 * luckRatio);
  const weightTotal = bWeight + cWeight + dWeight;

  chances[0] = roundToThree(STARTING_CHANCES[0] - movedFromA);
  chances[1] = roundToThree(STARTING_CHANCES[1] + (distributable * (bWeight / weightTotal)));
  chances[2] = roundToThree(STARTING_CHANCES[2] + (distributable * (cWeight / weightTotal)));
  chances[3] = roundToThree(STARTING_CHANCES[3] + (distributable * (dWeight / weightTotal)));
  chances[4] = roundToThree(eChance);

  // Keep higher tiers slow and late so progression stays balanced.
  const highTierShare = clamp((luckPercent - HIGH_TIER_START_LUCK) * 0.06, 0, HIGH_TIER_CAP);
  if (highTierShare > 0) {
    const sourcePool = Math.min(chances[0], highTierShare);
    chances[0] = roundToThree(chances[0] - sourcePool);

    let totalWeight = 0;
    const weights = [];
    for (let idx = FIRST_UNLOCK_INDEX + 1; idx < LETTER_REWARDS.length; idx += 1) {
      const distance = idx - FIRST_UNLOCK_INDEX;
      const weight = 1 / (distance ** 1.35);
      weights.push(weight);
      totalWeight += weight;
    }

    for (let idx = FIRST_UNLOCK_INDEX + 1; idx < LETTER_REWARDS.length; idx += 1) {
      const weight = weights[idx - (FIRST_UNLOCK_INDEX + 1)];
      chances[idx] = roundToThree(sourcePool * (weight / totalWeight));
    }
  }

  const total = chances.reduce((sum, chance) => sum + chance, 0);
  if (total !== 100) {
    chances[0] = roundToThree(chances[0] + (100 - total));
  }

  return chances;
}

function rollLetter(luckLevel) {
  const chances = buildChances(luckLevel);
  const totalChance = chances.reduce((sum, chance) => sum + chance, 0);
  const rolled = Math.random() * totalChance;
  let cursor = 0;

  for (let i = 0; i < LETTER_REWARDS.length; i += 1) {
    cursor += chances[i];
    if (rolled < cursor) {
      return {
        ...LETTER_REWARDS[i],
        chance: chances[i],
      };
    }
  }

  return {
    ...LETTER_REWARDS[0],
    chance: chances[0],
  };
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
        accent_color: didCrit ? RED_ACCENT : WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: [...titleLines, `## ${result.letter} \`(${result.chance}%)\``].join('\n'),
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
  suppressCommandLog: true,

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
