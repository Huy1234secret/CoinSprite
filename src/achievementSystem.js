const { MessageFlags } = require('discord.js');
const {
  getGamblingStats,
  unlockAchievement,
  hasAchievement,
  getUserAchievements,
} = require('./gamblingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const ACHIEVEMENTS = [
  {
    id: 'trivia_learner',
    name: 'Trivia Learner',
    emoji: '<:ACTriviaLearner:1498695440118579260>',
    footer: 'Answer correctly 100 trivia in one run!',
    funMessage: 'Your brain has officially warmed up. Keep cooking! 🧠',
  },
  {
    id: 'trivia_thinker',
    name: 'Trivia Thinker',
    emoji: '<:ACTriviaThinker:1498695445487030333>',
    footer: 'Answer correctly 250 trivia in one run!',
    funMessage: 'You are no longer guessing… probably. 🤔',
  },
  {
    id: 'trivia_expert',
    name: 'Trivia Expert',
    emoji: '<:ACTriviaExpert:1498695438197461072>',
    footer: 'Answer correctly 500 trivia in one run!',
    funMessage: 'At this point, the questions are scared of you. 📚',
  },
  {
    id: 'trivia_master',
    name: 'Trivia Master',
    emoji: '<:ACTriviaMaster:1498695442794283028>',
    footer: 'Answer correctly 1000 trivia in one run!',
    funMessage: '1,000 correct answers in one run?... please go touch grass respectfully 🌱',
    perk: 'Every 1 trivia answered correctly the prize pool get multiplied by 1.01x, answering wrong once reset prize pool to normal. Also x1.2 XP from correct answer.',
  },
  {
    id: 'easy_field_farmer',
    name: 'Easy Field Farmer',
    emoji: '<:ACEasyFieldFarmer:1498695424419303524>',
    footer: 'Complete minefield game on Easy once!',
    funMessage: 'You survived the tutorial field. The mines were being nice today. 🌱',
  },
  {
    id: 'danger_walker',
    name: 'Danger Walker',
    emoji: '<:ACDangerWalker:1498695428223533157>',
    footer: 'Complete minefield game on Medium once!',
    funMessage: 'Every step was a bad idea… but somehow it worked. 💣',
  },
  {
    id: 'risk_taker',
    name: 'Risk Taker',
    emoji: '<:ACRiskTaker:1498695419843317933>',
    footer: 'Complete minefield game on Hard once!',
    funMessage: 'You walked through danger like you had plot armor. 😎',
  },
  {
    id: 'no_fear_gambler',
    name: 'No-Fear Gambler',
    emoji: '<:ACNoFearGambler:1498695422305374471>',
    footer: 'Complete minefield game on **Hardcore** once!',
    funMessage: 'At this point, the mines are filing a complaint. 🧨',
  },
  {
    id: 'bullseye_bet',
    name: 'Bullseye Bet',
    emoji: '<:ACBullseyeBet:1498695415313469600>',
    footer: 'Win a **Straight** bet in roulette once.',
    funMessage: 'One number. One bet. One clean win. 🔥',
  },
  {
    id: 'are_we_serious',
    name: 'Are we SERIOUS',
    emoji: '<:AC67:1498695412738031727>',
    footer: '6......7.......?',
    perk: '`discover the SECRET achievement first`',
  },
  {
    id: 'one_step_forward',
    name: 'One step forward',
    emoji: '<:ACFinalStep:1498695416944787626>',
    footer: '...and BOOOOOOOOOOOOM!!!!',
    perk: '`discover the SECRET achievement first`',
  },
];

const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((item) => [item.id, item]));

function buildAchievementLines(achievement, obtained) {
  const lines = [
    `### ${achievement.emoji} ${achievement.name}`,
    `-# ${achievement.footer}`,
  ];

  if (achievement.perk) {
    lines.push(`-# * Perk: ${achievement.perk}`);
  }

  const status = obtained ? 'Obtained' : 'Not obtained';
  const statusEmoji = obtained ? '✅' : '❌';
  lines.push(`* Obtained: ${status} ${statusEmoji}`);
  return lines.join('\n');
}

function buildAchievementsPage(user, page = 1, pageSize = 5) {
  const unlocked = getUserAchievements(user.id);
  const maxPage = Math.max(1, Math.ceil(ACHIEVEMENTS.length / pageSize));
  const safePage = Math.max(1, Math.min(maxPage, Math.floor(Number(page) || 1)));
  const start = (safePage - 1) * pageSize;
  const items = ACHIEVEMENTS.slice(start, start + pageSize);

  const content = [
    `## ${user.username}'s Achievements`,
    ...items.map((achievement) => buildAchievementLines(achievement, Boolean(unlocked[achievement.id]?.unlockedAt))),
  ].join('\n\n');

  const payload = {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `achievements:switch:${user.id}:${safePage}:${maxPage}`,
                label: 'Switch page',
                style: 2,
              },
            ],
          },
        ],
      },
    ],
  };

  return { payload, page: safePage, maxPage };
}

async function sendAchievementUnlockMessage(channel, user, achievement) {
  if (!channel || !user || !achievement) return;

  const content = [
    `${user} You have unlocked an achievement!`,
    `## ${achievement.name}`,
    `-# ${achievement.funMessage || 'Achievement unlocked!'}`,
  ].join('\n');

  const emojiIdMatch = achievement.emoji.match(/:(\d+)>$/);
  const thumbnailUrl = emojiIdMatch ? `https://cdn.discordapp.com/emojis/${emojiIdMatch[1]}.png?size=128&quality=lossless` : null;

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [typeof user === 'string' ? user.replace(/[<@!>]/g, '') : user.id] },
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          thumbnailUrl
            ? {
              type: 9,
              components: [{ type: 10, content }],
              accessory: {
                type: 11,
                media: { url: thumbnailUrl },
              },
            }
            : { type: 10, content },
        ],
      },
    ],
  }).catch(() => null);
}

async function unlockAndAnnounce(channel, user, achievementId) {
  const achievement = ACHIEVEMENT_BY_ID[achievementId];
  if (!achievement) return false;

  const unlocked = unlockAchievement(user.id, achievementId);
  if (!unlocked) return false;

  await sendAchievementUnlockMessage(channel, `<@${user.id}>`, achievement);
  return true;
}

async function unlockTriviaAchievements(channel, user) {
  const stats = getGamblingStats(user.id);
  const best = Number(stats?.triviaBestRun?.all || 0);
  const ids = [];

  if (best >= 100) ids.push('trivia_learner');
  if (best >= 250) ids.push('trivia_thinker');
  if (best >= 500) ids.push('trivia_expert');
  if (best >= 1000) ids.push('trivia_master');

  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await unlockAndAnnounce(channel, user, id);
  }
}

async function unlockMinefieldAchievements(channel, user) {
  const stats = getGamblingStats(user.id);
  const completed = stats?.minefieldCompleted || {};
  const ids = [];

  if ((completed.easy || 0) >= 1) ids.push('easy_field_farmer');
  if ((completed.medium || 0) >= 1) ids.push('danger_walker');
  if ((completed.hard || 0) >= 1) ids.push('risk_taker');
  if ((completed.hardcore || 0) >= 1) ids.push('no_fear_gambler');

  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await unlockAndAnnounce(channel, user, id);
  }
}

async function unlockBullseyeAchievement(channel, user) {
  await unlockAndAnnounce(channel, user, 'bullseye_bet');
}

function getTriviaMasterPerkMultiplier(userId) {
  return hasAchievement(userId, 'trivia_master') ? 1.01 : 1;
}

function resetTriviaMasterPerkMultiplier(userId) {
  return hasAchievement(userId, 'trivia_master') ? 1 : 1;
}

module.exports = {
  ACHIEVEMENTS,
  buildAchievementsPage,
  unlockTriviaAchievements,
  unlockMinefieldAchievements,
  unlockBullseyeAchievement,
  getTriviaMasterPerkMultiplier,
  resetTriviaMasterPerkMultiplier,
};
