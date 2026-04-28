const { MessageFlags } = require('discord.js');
const { unlockAchievement, getUnlockedAchievements, hasAchievement } = require('./gamblingStore');
const { WHITE_ACCENT } = require('./gamblingConfig');

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
    perk: 'Every 1 trivia answered correctly multiplies prize pool values by 1.01x. A wrong answer resets the multiplier to normal. Also grants x1.2 XP from correct answers.',
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
  },
  {
    id: 'one_step_forward',
    name: 'One step forward',
    emoji: '<:ACFinalStep:1498695416944787626>',
    footer: '...and BOOOOOOOOOOOOM!!!!',
  },
];

const TRIVIA_MILESTONES = [
  { score: 1000, id: 'trivia_master' },
  { score: 500, id: 'trivia_expert' },
  { score: 250, id: 'trivia_thinker' },
  { score: 100, id: 'trivia_learner' },
];

const MINEFIELD_ACHIEVEMENTS = {
  easy: 'easy_field_farmer',
  medium: 'danger_walker',
  hard: 'risk_taker',
  hardcore: 'no_fear_gambler',
};

function getAchievementById(id) {
  return ACHIEVEMENTS.find((entry) => entry.id === id) || null;
}

async function sendAchievementUnlockMessage(channel, userMention, achievement) {
  if (!channel || !achievement) return;

  const lines = [
    `${userMention} You have unlocked an achievement!`,
    `## ${achievement.emoji} ${achievement.name}`,
  ];

  if (achievement.funMessage) {
    lines.push(`-# ${achievement.funMessage}`);
  }

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: lines.join('\n'),
          },
        ],
      },
    ],
  }).catch(() => null);
}

async function unlockAndAnnounce(channel, userId, userMention, achievementId) {
  const achievement = getAchievementById(achievementId);
  if (!achievement) return false;
  const unlocked = unlockAchievement(userId, achievementId);
  if (!unlocked) return false;
  await sendAchievementUnlockMessage(channel, userMention, achievement);
  return true;
}

async function unlockTriviaMilestones(channel, userId, userMention, score) {
  for (const milestone of TRIVIA_MILESTONES) {
    if (score >= milestone.score) {
      await unlockAndAnnounce(channel, userId, userMention, milestone.id);
    }
  }
}

async function unlockMinefieldAchievement(channel, userId, userMention, difficulty) {
  const achievementId = MINEFIELD_ACHIEVEMENTS[difficulty];
  if (!achievementId) return;
  await unlockAndAnnounce(channel, userId, userMention, achievementId);
}

async function unlockRouletteStraightAchievement(channel, userId, userMention, didWinStraight) {
  if (!didWinStraight) return;
  await unlockAndAnnounce(channel, userId, userMention, 'bullseye_bet');
}

function formatAchievementStatus(achievement, unlockedSet) {
  const obtained = unlockedSet.has(achievement.id);
  const status = obtained ? 'Obtained' : 'Not obtained';
  const statusEmoji = obtained ? '✅' : '❌';

  const lines = [
    `### ${achievement.emoji} ${achievement.name}`,
    `-# ${achievement.footer}`,
  ];

  if (achievement.perk) {
    lines.push(`-# * Perk: ${achievement.perk}`);
  }

  lines.push(`* Obtained: ${status} ${statusEmoji}`);
  return lines.join('\n');
}

function buildAchievementsMessage(username, userId) {
  const unlocked = new Set(getUnlockedAchievements(userId));
  const body = ACHIEVEMENTS.map((entry) => formatAchievementStatus(entry, unlocked)).join('\n\n');

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: `## ${username}'s Achievements\n${body}`,
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `achievements:switch:${userId}`,
                label: 'Switch page',
                style: 2,
                disabled: false,
              },
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  ACHIEVEMENTS,
  getAchievementById,
  hasAchievement,
  buildAchievementsMessage,
  unlockTriviaMilestones,
  unlockMinefieldAchievement,
  unlockRouletteStraightAchievement,
};
