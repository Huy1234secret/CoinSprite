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
const FIRST_UNLOCK_LUCK = 8;
const UNLOCK_SPACING = 12;
const BASE_SHARE_FLOOR = 30;
const UNLOCKED_SHARE_PER_LUCK = 0.45;
const FAST_TIER_MULTIPLIER = 1.2;
const SLOW_TIER_MULTIPLIER = 0.8;

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

function getUnlockProgress(index, luckPercent) {
  const unlockAt = FIRST_UNLOCK_LUCK + ((index - FIRST_UNLOCK_INDEX) * UNLOCK_SPACING);
  return clamp((luckPercent - unlockAt) / UNLOCK_SPACING, 0, 1);
}

function getTierWeight(index) {
  const offset = index - FIRST_UNLOCK_INDEX;
  return offset % 2 === 0 ? FAST_TIER_MULTIPLIER : SLOW_TIER_MULTIPLIER;
}

function buildChances(luckLevel) {
  const chances = Array.from({ length: LETTER_REWARDS.length }, () => 0);
  const luckPercent = getLuckBonusPercent(luckLevel);
  const baseTotal = STARTING_CHANCES.reduce((sum, value) => sum + value, 0);

  const unlockedShareTarget = clamp(
    luckPercent * UNLOCKED_SHARE_PER_LUCK,
    0,
    100 - BASE_SHARE_FLOOR,
  );

  const unlockedWeights = [];
  let totalUnlockedWeight = 0;

  for (let idx = FIRST_UNLOCK_INDEX; idx < LETTER_REWARDS.length; idx += 1) {
    const progress = getUnlockProgress(idx, luckPercent);
    if (progress <= 0) {
      unlockedWeights.push(0);
      continue;
    }

    const weight = roundToThree(progress * getTierWeight(idx));
    unlockedWeights.push(weight);
    totalUnlockedWeight += weight;
  }

  const unlockedShare = totalUnlockedWeight > 0 ? unlockedShareTarget : 0;
  const remainingForBase = 100 - unlockedShare;

  for (let idx = 0; idx < STARTING_CHANCES.length; idx += 1) {
    const ratio = STARTING_CHANCES[idx] / baseTotal;
    chances[idx] = roundToThree(remainingForBase * ratio);
  }

  for (let idx = FIRST_UNLOCK_INDEX; idx < LETTER_REWARDS.length; idx += 1) {
    const weight = unlockedWeights[idx - FIRST_UNLOCK_INDEX];
    if (!weight || totalUnlockedWeight <= 0) {
      chances[idx] = 0;
      continue;
    }
    chances[idx] = roundToThree(unlockedShare * (weight / totalUnlockedWeight));
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
