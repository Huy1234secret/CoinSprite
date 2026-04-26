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

const STARTING_CHANCES = [70, 20, 9, 1];
const FIRST_UNLOCK_INDEX = 4; // E
const MIN_UNLOCK_CHANCE = 0.1;
const FIRST_UNLOCK_LUCK = 8;
const UNLOCK_SPACING = 12;
const RISE_PHASE_STEPS = 1.5;
const FALL_PHASE_STEPS = 1.5;
const FADE_OUT_STEPS = 0.2;

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

function getLetterPeakChance(index) {
  const offset = Math.max(0, index - FIRST_UNLOCK_INDEX);
  return Math.max(50, 70 - (offset * 0.8));
}

function buildUnlockedLetterChance(index, luckPercent) {
  const unlockAt = FIRST_UNLOCK_LUCK + ((index - FIRST_UNLOCK_INDEX) * UNLOCK_SPACING);
  if (luckPercent < unlockAt) {
    return 0;
  }

  const peakChance = getLetterPeakChance(index);
  const progress = (luckPercent - unlockAt) / UNLOCK_SPACING;
  const activeSteps = RISE_PHASE_STEPS + FALL_PHASE_STEPS + FADE_OUT_STEPS;

  if (progress > activeSteps) {
    return 0;
  }

  if (progress <= RISE_PHASE_STEPS) {
    const riseRatio = progress / RISE_PHASE_STEPS;
    return roundToThree(MIN_UNLOCK_CHANCE + ((peakChance - MIN_UNLOCK_CHANCE) * riseRatio));
  }

  if (progress <= RISE_PHASE_STEPS + FALL_PHASE_STEPS) {
    const fallRatio = (progress - RISE_PHASE_STEPS) / FALL_PHASE_STEPS;
    return roundToThree(MIN_UNLOCK_CHANCE + ((peakChance - MIN_UNLOCK_CHANCE) * (1 - fallRatio)));
  }

  const fadeRatio = (progress - RISE_PHASE_STEPS - FALL_PHASE_STEPS) / FADE_OUT_STEPS;
  return roundToThree(MIN_UNLOCK_CHANCE * Math.max(0, 1 - fadeRatio));
}

function buildChances(luckLevel) {
  const chances = Array.from({ length: LETTER_REWARDS.length }, () => 0);
  for (let i = 0; i < STARTING_CHANCES.length; i += 1) {
    chances[i] = STARTING_CHANCES[i];
  }

  const luckPercent = getLuckBonusPercent(luckLevel);
  let unlockedTotal = 0;

  for (let idx = FIRST_UNLOCK_INDEX; idx < LETTER_REWARDS.length; idx += 1) {
    const chance = buildUnlockedLetterChance(idx, luckPercent);
    chances[idx] = chance;
    unlockedTotal += chance;
  }

  if (unlockedTotal >= 100) {
    const scale = 100 / unlockedTotal;
    for (let idx = FIRST_UNLOCK_INDEX; idx < LETTER_REWARDS.length; idx += 1) {
      chances[idx] = roundToThree(chances[idx] * scale);
    }
    for (let idx = 0; idx < STARTING_CHANCES.length; idx += 1) {
      chances[idx] = 0;
    }
    return chances;
  }

  const remainingForBase = 100 - unlockedTotal;
  const baseTotal = STARTING_CHANCES.reduce((sum, value) => sum + value, 0);

  for (let idx = 0; idx < STARTING_CHANCES.length; idx += 1) {
    const ratio = STARTING_CHANCES[idx] / baseTotal;
    chances[idx] = roundToThree(remainingForBase * ratio);
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
        accent_color: RED_ACCENT,
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
