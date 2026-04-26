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
  { letter: 'A', min: 1, max: 4 },
  { letter: 'B', min: 6, max: 13 },
  { letter: 'C', min: 20, max: 42 },
  { letter: 'D', min: 55, max: 105 },
  { letter: 'E', min: 170, max: 320 },
  { letter: 'F', min: 600, max: 1200 },
  { letter: 'G', min: 2400, max: 4500 },
];

const BASE_CHANCES = [70, 20, 9, 0.99, 0.0095, 0.00049, 0.00001];
const SOFTCAP_START_LUCK = 30;
const SOFTCAP_FLOOR = 0.18;
const MAX_LUCK_TRANSFER = 20;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildChances(luckLevel) {
  const chances = [...BASE_CHANCES];
  if (luckLevel <= 0) {
    return chances;
  }

  const preSoftcapBoost = luckLevel <= SOFTCAP_START_LUCK
    ? luckLevel
    : SOFTCAP_START_LUCK;
  const postSoftcapLevels = Math.max(0, luckLevel - SOFTCAP_START_LUCK);
  const postSoftcapBoost = postSoftcapLevels > 0
    ? (Math.log2(postSoftcapLevels + 1) * 2.8)
    : 0;
  const boost = Math.min(MAX_LUCK_TRANSFER, preSoftcapBoost + postSoftcapBoost);

  const transfer = Math.min(boost, chances[0] * (1 - SOFTCAP_FLOOR));
  chances[0] = roundToThree(chances[0] - transfer);

  const weights = [0.58, 0.3, 0.11, 0.009, 0.0009, 0.0001];
  for (let idx = 1; idx < chances.length; idx += 1) {
    chances[idx] = roundToThree(chances[idx] + (transfer * weights[idx - 1]));
  }

  const total = chances.reduce((sum, chance) => sum + chance, 0);
  chances[0] = roundToThree(chances[0] + (100 - total));
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

  const critChance = Math.min(25, upgrades.critChanceLevel * 5);
  const critPower = upgrades.critPowerLevel * 4;
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
