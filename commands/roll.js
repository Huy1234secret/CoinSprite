const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, getUpgrades } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PRCOIN = '<:PRcoin:1497972406030176356>';
const RED_ACCENT = 0xED4245;
const WHITE_ACCENT = 0xFFFFFF;
const RARE_ROLL_CHANNEL_ID = '1498006999726555197';
const GREEN_ACCENT = 0x57F287;
const YELLOW_ACCENT = 0xFEE75C;
const CYAN_ACCENT = 0x3BFFFF;

const LETTER_REWARDS = [
  { letter: 'A', min: 1, max: 5 },
  { letter: 'B', min: 10, max: 25 },
  { letter: 'C', min: 40, max: 80 },
  { letter: 'D', min: 100, max: 200 },
  { letter: 'E', min: 225, max: 350 },
  { letter: 'F', min: 400, max: 650 },
  { letter: 'G', min: 750, max: 1000 },
  { letter: 'H', min: 1250, max: 1800 },
  { letter: 'I', min: 2200, max: 4000 },
  { letter: 'J', min: 5000, max: 9000 },
  { letter: 'K', min: 11500, max: 14000 },
  { letter: 'L', min: 15000, max: 25000 },
  { letter: 'M', min: 30000, max: 50000 },
  { letter: 'N', min: 65000, max: 100000 },
  { letter: 'O', min: 112000, max: 180000 },
  { letter: 'P', min: 200000, max: 300000 },
  { letter: 'Q', min: 350000, max: 500000 },
  { letter: 'R', min: 600000, max: 800000 },
  { letter: 'S', min: 1000000, max: 1500000 },
  { letter: 'T', min: 2000000, max: 3000000 },
  { letter: 'U', min: 3500000, max: 5000000 },
  { letter: 'V', min: 6000000, max: 10000000 },
  { letter: 'W', min: 11000000, max: 12000000 },
  { letter: 'X', min: 13000000, max: 18000000 },
  { letter: 'Y', min: 20000000, max: 50000000 },
  { letter: 'Z', min: 50000000, max: 100000000 },
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

function getRareRollAccent(chancePercent) {
  if (chancePercent < 0.0001) {
    return CYAN_ACCENT;
  }
  if (chancePercent < 0.01) {
    return YELLOW_ACCENT;
  }
  if (chancePercent < 1) {
    return GREEN_ACCENT;
  }
  return null;
}

async function sendRareRollLog(target, user, result) {
  const accent = getRareRollAccent(result.chance);
  if (!accent) {
    return;
  }

  const guild = target.guild;
  if (!guild) {
    return;
  }

  const channel = guild.channels.cache.get(RARE_ROLL_CHANNEL_ID)
    || await guild.channels.fetch(RARE_ROLL_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: accent,
        components: [
          {
            type: 10,
            content: `🎲 ${user} rolled **${result.letter}** \`(${result.chance}%)\``,
          },
        ],
      },
    ],
  });
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

  await sendRareRollLog(target, user, result);
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
