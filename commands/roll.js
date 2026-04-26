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

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTER_POOL_SIZE = 130;
const BASE_CHANCE_DECAY = 0.74;
const MAX_CHANCE_DECAY = 0.84;
const MAX_LUCK_PERCENT = 75;
const LUCK_GROWTH_RATE = 0.145;
const REWARD_SPREAD_PERCENT = 0.35;
const BASE_CRIT_POWER_PERCENT = 25;
const CRIT_CHANCE_PER_LEVEL = 5;
const CRIT_POWER_PER_LEVEL = 5;
const MAX_CRIT_CHANCE_PERCENT = 25;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function buildLetterName(index) {
  const alphabetIndex = index % ALPHABET.length;
  const cycle = Math.floor(index / ALPHABET.length);
  const letter = ALPHABET[alphabetIndex];
  return cycle === 0 ? letter : `${cycle}${letter}`;
}

function buildLetterRewards() {
  return Array.from({ length: LETTER_POOL_SIZE }, (_, index) => {
    const base = Math.floor(
      4
      + (index * 1.2)
      + (Math.pow(index, 1.38) * 0.35)
      + (Math.pow(1.08, index) * 2.5),
    );
    const spread = Math.max(3, Math.floor(base * REWARD_SPREAD_PERCENT));
    return {
      letter: buildLetterName(index),
      min: base,
      max: base + spread,
    };
  });
}

const LETTER_REWARDS = buildLetterRewards();

function getLuckPercent(luckLevel) {
  if (luckLevel <= 0) {
    return 0;
  }

  return roundToOne(MAX_LUCK_PERCENT * (1 - Math.pow(1 - LUCK_GROWTH_RATE, luckLevel)));
}

function getEffectiveChanceDecay(luckLevel) {
  const luckPercent = getLuckPercent(luckLevel);
  const luckRatio = Math.min(1, luckPercent / MAX_LUCK_PERCENT);
  return BASE_CHANCE_DECAY + ((MAX_CHANCE_DECAY - BASE_CHANCE_DECAY) * luckRatio);
}

function buildChances(luckLevel) {
  const chanceDecay = getEffectiveChanceDecay(luckLevel);
  const raw = LETTER_REWARDS.map((_, index) => Math.pow(chanceDecay, index));
  const totalRaw = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => (value / totalRaw) * 100);
}

function getCritChancePercent(level) {
  return Math.min(MAX_CRIT_CHANCE_PERCENT, level * CRIT_CHANCE_PER_LEVEL);
}

function getCritPowerPercent(level) {
  return BASE_CRIT_POWER_PERCENT + (level * CRIT_POWER_PER_LEVEL);
}

function formatChance(chancePercent) {
  if (chancePercent >= 1) {
    return `${roundToThree(chancePercent)}%`;
  }
  if (chancePercent >= 0.01) {
    return `${chancePercent.toFixed(4)}%`;
  }
  return `${chancePercent.toExponential(2)}%`;
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
  if (chancePercent < 0.005) {
    return CYAN_ACCENT;
  }
  if (chancePercent < 0.03) {
    return YELLOW_ACCENT;
  }
  if (chancePercent < 0.2) {
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
            content: `🎲 ${user} rolled **${result.letter}** \`(${formatChance(result.chance)})\``,
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

  const critChance = getCritChancePercent(upgrades.critChanceLevel);
  const critPower = getCritPowerPercent(upgrades.critPowerLevel);
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
    titleLines.push(`-# 💥 crit roll!!! [ +${critPower}% ]`);
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
            content: [...titleLines, `## ${result.letter} \`(${formatChance(result.chance)})\``].join('\n'),
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
