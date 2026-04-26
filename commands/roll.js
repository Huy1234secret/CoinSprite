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
const CHANCE_DECAY = 0.43;
const SOFTCAP_START_LUCK = 30;
const SOFTCAP_FLOOR = 0.16;
const MAX_LUCK_TRANSFER = 55;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
    const cycle = Math.floor(index / ALPHABET.length);
    const cycleBoost = 1 + (cycle * 0.5);
    const rarityBoost = 1 + ((index / (LETTER_POOL_SIZE - 1)) ** 2 * 3.2);
    const base = Math.floor((2 + (Math.pow(1.33, index) * 2)) * cycleBoost * rarityBoost);
    const spread = Math.max(2, Math.floor(base * 0.82));
    return {
      letter: buildLetterName(index),
      min: base,
      max: base + spread,
    };
  });
}

const LETTER_REWARDS = buildLetterRewards();

function buildBaseChances() {
  const raw = LETTER_REWARDS.map((_, index) => Math.pow(CHANCE_DECAY, index));
  const totalRaw = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => (value / totalRaw) * 100);
}

const BASE_CHANCES = buildBaseChances();

function getLuckBoost(luckLevel) {
  if (luckLevel <= 0) {
    return 0;
  }

  const preSoftcapBoost = luckLevel <= SOFTCAP_START_LUCK
    ? luckLevel
    : SOFTCAP_START_LUCK;
  const postSoftcapLevels = Math.max(0, luckLevel - SOFTCAP_START_LUCK);
  const postSoftcapBoost = postSoftcapLevels > 0
    ? (Math.log2(postSoftcapLevels + 1) * 2.5)
    : 0;

  return Math.min(MAX_LUCK_TRANSFER, preSoftcapBoost + postSoftcapBoost);
}

function buildChances(luckLevel) {
  const chances = [...BASE_CHANCES];
  if (luckLevel <= 0) {
    return chances;
  }

  const boost = getLuckBoost(luckLevel);
  const transfer = Math.min(boost, chances[0] * (1 - SOFTCAP_FLOOR));
  chances[0] -= transfer;

  const weights = chances.slice(1).map((chance, idx) => Math.sqrt(chance) / Math.sqrt(idx + 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  for (let idx = 1; idx < chances.length; idx += 1) {
    const portion = totalWeight > 0 ? (transfer * (weights[idx - 1] / totalWeight)) : 0;
    chances[idx] += portion;
  }

  const total = chances.reduce((sum, chance) => sum + chance, 0);
  chances[0] += (100 - total);
  return chances;
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
  if (chancePercent < 0.001) {
    return CYAN_ACCENT;
  }
  if (chancePercent < 0.05) {
    return YELLOW_ACCENT;
  }
  if (chancePercent < 0.5) {
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
