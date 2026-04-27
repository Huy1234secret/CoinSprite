const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  addBalance,
  getUpgrades,
  getRebirthTier,
  getRebirthUpgrades,
  recordDiscoveredLetter,
  getRollStats,
  setRollStats,
} = require('../src/rngGameStore');
const {
  PRCOIN,
  RED_ACCENT,
  WHITE_ACCENT,
  LETTER_REWARDS,
  buildChances,
  getCritChancePercent,
  getCritPowerPercent,
  getFortuneChargePercent,
  getGlyphGrowthMultiplier,
  getRarityJackpotMultiplier,
  getRebirthCoinMultiplier,
  formatChance,
  getRareRollAccent,
  formatNumber,
} = require('../src/rngConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const RARE_ROLL_CHANNEL_ID = '1498006999726555197';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollLetter(luckLevel, rebirthTier, fortunePercent) {
  const chances = buildChances(luckLevel, rebirthTier, fortunePercent);
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

function updateFortuneProgress(userId, rebirthUpgrades) {
  const stats = getRollStats(userId);
  const fortuneChargePercent = getFortuneChargePercent(rebirthUpgrades);
  const fortunePercentForThisRoll = stats.fortuneReady ? fortuneChargePercent : 0;

  const nextStats = {
    totalRolls: stats.totalRolls + 1,
    fortuneReady: false,
  };

  if (fortuneChargePercent > 0 && nextStats.totalRolls % 25 === 0) {
    nextStats.fortuneReady = true;
  }

  setRollStats(userId, nextStats);
  return {
    fortunePercentForThisRoll,
    storedFortuneForNextRoll: nextStats.fortuneReady,
    rollNumber: nextStats.totalRolls,
  };
}

async function executeRoll(target, user) {
  const upgrades = getUpgrades(user.id);
  const rebirthTier = getRebirthTier(user.id);
  const rebirthUpgrades = getRebirthUpgrades(user.id);
  const fortune = updateFortuneProgress(user.id, rebirthUpgrades);

  const result = rollLetter(upgrades.luckLevel, rebirthTier, fortune.fortunePercentForThisRoll);
  const discoveryResult = recordDiscoveredLetter(user.id, result.letter);
  const baseEarned = randomInt(result.min, result.max);

  const rarityMultiplier = getRarityJackpotMultiplier(rebirthUpgrades, result.chance);
  const critChance = getCritChancePercent(upgrades.critChanceLevel);
  const critPower = getCritPowerPercent(upgrades.critPowerLevel);
  const didCrit = Math.random() * 100 < critChance;
  const rebirthMultiplier = getRebirthCoinMultiplier(rebirthTier);
  const glyphMultiplier = getGlyphGrowthMultiplier(rebirthUpgrades, discoveryResult.discoveries.length);

  let finalEarned = baseEarned;
  finalEarned = Math.floor(finalEarned * rarityMultiplier);
  if (didCrit) {
    finalEarned = Math.floor(finalEarned * (1 + (critPower / 100)));
  }
  finalEarned = Math.floor(finalEarned * rebirthMultiplier * glyphMultiplier);

  addBalance(user.id, finalEarned);

  const multiplierLines = [];
  if (rarityMultiplier > 1) multiplierLines.push(`💎 Rarity Jackpot: **x${formatNumber(rarityMultiplier)}**`);
  if (rebirthMultiplier > 1) multiplierLines.push(`♻️ Rebirth: **x${formatNumber(rebirthMultiplier)}**`);
  if (glyphMultiplier > 1) multiplierLines.push(`✨ Glyph Growth: **x${glyphMultiplier.toFixed(3)}**`);
  if (fortune.fortunePercentForThisRoll > 0) multiplierLines.push(`⚡ Fortune Charge used: **+${fortune.fortunePercentForThisRoll}% Luck**`);
  if (fortune.storedFortuneForNextRoll) multiplierLines.push('⚡ Fortune Charge stored for your next roll.');
  if (discoveryResult.wasNew) multiplierLines.push(`🆕 New alphabet discovered: **${result.letter}**`);

  const earnLine = didCrit
    ? `-# You've earned ~~${formatNumber(baseEarned)}~~ **${formatNumber(finalEarned)}** ${PRCOIN}`
    : `-# You've earned **${formatNumber(finalEarned)}** ${PRCOIN}`;

  const titleLines = [`${user} You have rolled`];
  if (didCrit) {
    titleLines.push(`-# 💥 crit roll!!! [ +${formatNumber(critPower)}% ]`);
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
            content: [earnLine, ...multiplierLines.map((line) => `-# ${line}`)].join('\n'),
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
