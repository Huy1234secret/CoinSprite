const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance, recordGamblingEarnings, recordTriviaRun, getTriviaXpMultiplier } = require('../src/gamblingStore');
const { PRCOIN, WHITE_ACCENT, GREEN_ACCENT, YELLOW_ACCENT, RED_ACCENT, formatNumber } = require('../src/gamblingConfig');
const BASE_TRIVIA_QUESTIONS = require('../src/triviaQuestions');
const EXTRA_TRIVIA_QUESTIONS = require('../src/triviaExtraQuestions');
const TRIVIA_QUESTIONS = {
  easy: [...BASE_TRIVIA_QUESTIONS.easy, ...EXTRA_TRIVIA_QUESTIONS.easy],
  medium: [...BASE_TRIVIA_QUESTIONS.medium, ...EXTRA_TRIVIA_QUESTIONS.medium],
  hard: [...BASE_TRIVIA_QUESTIONS.hard, ...EXTRA_TRIVIA_QUESTIONS.hard],
};
const { startUserSession, endUserSession, getCommandBlockReason } = require('../src/gameSessionLock');
const leveling = require('../src/levelingManager');
const {
  unlockTriviaAchievements,
  getTriviaMasterPerkMultiplier,
  resetTriviaMasterPerkMultiplier,
} = require('../src/achievementSystem');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const START_TIME_MS = 30_000;
const MAX_TIME_MS = 60_000;
const CORRECT_BONUS_MS = 10_000;
const WRONG_DELAY_MS = 5_000;
const NEXT_DELAY_MS = 2_000;
const TRIVIA_COOLDOWN_MS = 5 * 60_000;
const triviaCooldowns = new Map();

const activeGames = new Map();

const DIFFICULTY_CONFIG = {
  easy: { label: 'Easy', accent: GREEN_ACCENT, reward: 10, chatXp: 0.1 },
  medium: { label: 'Medium', accent: YELLOW_ACCENT, reward: 100, chatXp: 1 },
  hard: { label: 'Hard', accent: RED_ACCENT, reward: 1000, chatXp: 10 },
};
const START_DIFFICULTY_OPTIONS = [
  { value: 'random', label: 'Random', emoji: '🎲', footer: 'Trivia difficulty is randomized.' },
  { value: 'easy', label: 'Easy', emoji: '🟢', footer: 'Trivia difficulty is set to Easy.' },
  { value: 'medium', label: 'Medium', emoji: '🟡', footer: 'Trivia difficulty is set to Medium.' },
  { value: 'hard', label: 'Hard', emoji: '🔴', footer: 'Trivia difficulty is set to Hard.' },
];

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function pickDifficulty(game) {
  if (game.selectedDifficulty && game.selectedDifficulty !== 'random') {
    return game.selectedDifficulty;
  }
  const roll = Math.random();
  if (roll < (1 / 3)) return 'easy';
  if (roll < (2 / 3)) return 'medium';
  return 'hard';
}

function pickQuestion(game, difficulty) {
  const questions = TRIVIA_QUESTIONS[difficulty] || TRIVIA_QUESTIONS.easy;
  const usedForDifficulty = game.usedQuestions[difficulty] || new Set();

  if (usedForDifficulty.size >= questions.length) {
    usedForDifficulty.clear();
  }

  let index = Math.floor(Math.random() * questions.length);
  let guard = 0;
  while (usedForDifficulty.has(index) && guard < 500) {
    index = Math.floor(Math.random() * questions.length);
    guard += 1;
  }

  usedForDifficulty.add(index);
  game.usedQuestions[difficulty] = usedForDifficulty;
  return { ...questions[index], difficulty };
}

function normalizeQuestion(question) {
  if (!question || !Array.isArray(question.answers) || question.answers.length === 0) return null;
  const correctIndex = Number(question.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= question.answers.length) return null;
  return {
    ...question,
    correctIndex,
    displayOrder: createShuffledOrder(question.answers.length),
  };
}

function getQuestionValue(game, difficulty) {
  const base = DIFFICULTY_CONFIG[difficulty]?.reward ?? 10;
  return Math.max(1, Math.floor(base * (game.currentRewardMultiplier || 1)));
}

function createShuffledOrder(length) {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function getStartDifficultyOption(value) {
  return START_DIFFICULTY_OPTIONS.find((entry) => entry.value === value) || START_DIFFICULTY_OPTIONS[0];
}

function buildWelcomePayload(user, selectedDifficulty = 'random') {
  const selected = getStartDifficultyOption(selectedDifficulty);
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: [
              `## Welcome ${user} to Trivia Game!`,
              '* Rules:',
              '-# * You have a total of **30 seconds** to answer as much trivia as you can! Every correct answer increases the timer by **10s** (up to **60s** max), but wrong answers delay you by **5s**.',
              '-# * Once time runs out, you earn PRcoin based on how many trivia questions you answered correctly.',
              '-# * Reward per correct answer: Easy **10**, Medium **100**, Hard **1,000**.',
              `-# * ${selected.footer}`,
              '-# * Press **PLAY** to start with your selected difficulty.',
            ].join('\n'),
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `trivia:config:${user.id}`,
                placeholder: 'Choose a difficulty',
                min_values: 1,
                max_values: 1,
                options: START_DIFFICULTY_OPTIONS.map((option) => ({
                  label: option.label,
                  value: option.value,
                  emoji: { name: option.emoji },
                  description: option.footer.slice(0, 100),
                  default: option.value === selected.value,
                })),
              },
            ],
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `trivia:play:${user.id}:${selected.value}`,
                label: 'PLAY',
                style: 2,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildAnswerRows(game, selectedIndex = null) {
  const question = game.currentQuestion;
  const final = selectedIndex !== null;
  const displayOrder = question.displayOrder || createShuffledOrder(question.answers.length);
  const correctDisplayIndex = displayOrder.indexOf(question.correctIndex);
  const buttons = displayOrder.map((answerIndex, index) => {
    const answer = question.answers[answerIndex];
    let style = 2;
    if (final && index === correctDisplayIndex) style = 3;
    if (final && index === selectedIndex && index !== correctDisplayIndex) style = 4;

    return {
      type: 2,
      custom_id: `trivia:answer:${game.userId}:${game.id}:${index}`,
      label: answer.slice(0, 80),
      style,
      disabled: final || game.locked,
    };
  });

  return [
    { type: 1, components: buttons.slice(0, 2) },
    { type: 1, components: buttons.slice(2, 4) },
  ];
}

function buildGamePayload(game, selectedIndex = null, notice = null) {
  const question = game.currentQuestion;
  const config = DIFFICULTY_CONFIG[question.difficulty] || DIFFICULTY_CONFIG.easy;
  const endUnix = Math.floor(game.endsAt / 1000);
  const content = [
    notice ? `-# ${notice}` : null,
    `-# Trivia ${game.questionNumber}# • ${config.label}`,
    `### ${question.question}`,
    `* Trivia ends <t:${endUnix}:R>`,
    `* Prize pool: ${formatNumber(game.prizePool)} ${PRCOIN}`,
    `-# This question is worth **${formatNumber(game.currentQuestionValue)}** ${PRCOIN}.`,
  ].filter(Boolean).join('\n');

  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: config.accent,
        components: [
          { type: 10, content },
          { type: 14, divider: true, spacing: 1 },
          ...buildAnswerRows(game, selectedIndex),
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `trivia:stop:${game.userId}:${game.id}`,
                label: 'Stop',
                style: 4,
                disabled: Boolean(selectedIndex !== null || game.locked),
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildFinishedPayload(game, reason = null) {
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: [
              reason === 'stopped' ? '### Trivia stopped.' : '### Time is up!',
              `* You earned **${formatNumber(game.prizePool)}** ${PRCOIN}!`,
              `-# You answered **${formatNumber(game.correctCount)}** trivia questions correctly.`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

async function finishGame(game, interaction = null, reason = null) {
  if (!game || game.finished) return;
  game.finished = true;
  activeGames.delete(game.userId);
  endUserSession(game.userId, 'trivia');
  triviaCooldowns.set(game.userId, Date.now() + TRIVIA_COOLDOWN_MS);

  if (game.timeout) clearTimeout(game.timeout);
  if (game.nextTimeout) clearTimeout(game.nextTimeout);

  if (game.prizePool > 0) {
    addBalance(game.userId, game.prizePool);
    recordGamblingEarnings(game.userId, game.prizePool);
  }
  recordTriviaRun(game.userId, game.correctByDifficulty, game.selectedDifficulty === 'random');
  if (game.channel) {
    await unlockTriviaAchievements(game.channel, { id: game.userId });
  }

  const payload = buildFinishedPayload(game, reason);
  if (interaction) {
    await interaction.update(payload).catch(() => null);
    return;
  }

  if (game.message?.editable) {
    await game.message.edit(payload).catch(() => null);
  }
}

function resetFinishTimer(game) {
  if (game.timeout) clearTimeout(game.timeout);
  const delay = Math.max(1, game.endsAt - Date.now());
  game.timeout = setTimeout(() => finishGame(game).catch(() => null), delay);
}

async function askNextQuestion(game) {
  if (!game || game.finished) return;
  if (Date.now() >= game.endsAt) {
    await finishGame(game);
    return;
  }

  const difficulty = pickDifficulty(game);
  const question = normalizeQuestion(pickQuestion(game, difficulty));
  if (!question) {
    await finishGame(game, null, 'missing-question');
    return;
  }
  game.questionNumber += 1;
  game.currentQuestion = question;
  game.currentQuestionValue = getQuestionValue(game, difficulty);
  game.locked = false;

  await game.message.edit(buildGamePayload(game)).catch(() => null);
  resetFinishTimer(game);
}

module.exports = {
  data: new SlashCommandBuilder().setName('trivia').setDescription('Play a timed trivia gambling game for PRcoin'),
  suppressCommandLog: true,

  async execute(interaction) {
    const blockReason = getCommandBlockReason(interaction.user.id, 'trivia');
    if (blockReason) {
      await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
      return;
    }

    const active = activeGames.get(interaction.user.id);
    if (active && !active.finished) {
      await interaction.reply({ content: 'You already have an active Trivia game. Finish it first.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply(buildWelcomePayload(interaction.user));
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('trivia:'));
  },

  async handleInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith('trivia:')) {
      return false;
    }

    const parts = interaction.customId.split(':');
    const action = parts[1];
    const ownerId = parts[2];

    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own Trivia game buttons.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.isStringSelectMenu() && action === 'config') {
      const selectedDifficulty = interaction.values?.[0] || 'random';
      await interaction.update(buildWelcomePayload(interaction.user, selectedDifficulty));
      return true;
    }

    if (!interaction.isButton()) return true;

    if (action === 'play') {
      const cooldownUntil = triviaCooldowns.get(interaction.user.id) || 0;
      if (cooldownUntil > Date.now()) {
        await interaction.reply({ content: `You can play Trivia again <t:${Math.floor(cooldownUntil / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
        return true;
      }
      if (activeGames.has(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an active Trivia game. Finish it first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const game = {
        id: createGameId(),
        userId: interaction.user.id,
        guildId: interaction.guildId || null,
        message: interaction.message,
        startedAt: Date.now(),
        endsAt: Date.now() + START_TIME_MS,
        prizePool: 0,
        correctCount: 0,
        questionNumber: 0,
        currentQuestion: null,
        currentQuestionValue: 10,
        lastQuestionValue: 10,
        usedQuestions: { easy: new Set(), medium: new Set(), hard: new Set() },
        correctByDifficulty: { easy: 0, medium: 0, hard: 0 },
        locked: false,
        finished: false,
        timeout: null,
        nextTimeout: null,
        channel: interaction.channel || null,
        hasMasterPerk: getTriviaMasterPerkMultiplier(interaction.user.id) > 1,
        currentRewardMultiplier: 1,
        selectedDifficulty: ['random', 'easy', 'medium', 'hard'].includes(parts[3]) ? parts[3] : 'random',
      };

      game.questionNumber = 1;
      const openingDifficulty = pickDifficulty(game);
      const openingQuestion = normalizeQuestion(pickQuestion(game, openingDifficulty));
      if (!openingQuestion) {
        await interaction.reply({ content: 'Trivia questions are temporarily unavailable. Please try again shortly.', flags: MessageFlags.Ephemeral });
        return true;
      }
      game.currentQuestion = openingQuestion;
      game.currentQuestionValue = getQuestionValue(game, openingDifficulty);

      activeGames.set(interaction.user.id, game);
      startUserSession(interaction.user.id, {
        type: 'trivia',
        label: 'Trivia',
        lockedCommand: 'trivia',
        lockToCommand: true,
      });
      await interaction.update(buildGamePayload(game));
      resetFinishTimer(game);
      return true;
    }

    if (action === 'stop') {
      const gameId = parts[3];
      const game = activeGames.get(interaction.user.id);

      if (!game || game.id !== gameId || game.finished) {
        await interaction.reply({ content: 'This Trivia game is no longer active.', flags: MessageFlags.Ephemeral });
        return true;
      }

      await finishGame(game, interaction, 'stopped');
      return true;
    }

    if (action !== 'answer') {
      return true;
    }

    const gameId = parts[3];
    const selectedIndex = Number(parts[4]);
    const game = activeGames.get(interaction.user.id);

    if (!game || game.id !== gameId || game.finished) {
      await interaction.reply({ content: 'This Trivia game is no longer active.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (game.locked) {
      await interaction.reply({ content: 'Please wait for the next trivia question.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (Date.now() >= game.endsAt) {
      await finishGame(game, interaction);
      return true;
    }

    game.locked = true;
    const displayOrder = game.currentQuestion.displayOrder || createShuffledOrder(game.currentQuestion.answers.length);
    const selectedAnswerIndex = displayOrder[selectedIndex];
    const correct = selectedAnswerIndex === game.currentQuestion.correctIndex;

    if (correct) {
      const difficulty = game.currentQuestion.difficulty;
      const difficultyConfig = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.easy;
      game.correctCount += 1;
      game.correctByDifficulty[difficulty] += 1;
      game.prizePool += game.currentQuestionValue;
      game.lastQuestionValue = game.currentQuestionValue;
      if (game.guildId) {
        const triviaXpMultiplier = getTriviaXpMultiplier(game.userId);
        leveling.addUserXp(game.guildId, game.userId, difficultyConfig.chatXp * triviaXpMultiplier);
      }
      if (game.hasMasterPerk) {
        game.currentRewardMultiplier = Math.max(1, game.currentRewardMultiplier * getTriviaMasterPerkMultiplier(game.userId));
      }
      const previousEnd = game.endsAt;
      const boostedEnd = previousEnd + CORRECT_BONUS_MS;
      const absoluteMaxEnd = game.startedAt + MAX_TIME_MS;
      game.endsAt = Math.min(boostedEnd, absoluteMaxEnd);
      const addedMs = Math.max(0, game.endsAt - previousEnd);
      const bonusNotice = addedMs > 0
        ? `Correct! +${Math.round(addedMs / 1000)}s added to your timer.`
        : 'Correct! Timer is already at the 60s cap.';
      await interaction.update(buildGamePayload(game, selectedIndex, bonusNotice));
      resetFinishTimer(game);
      game.nextTimeout = setTimeout(() => askNextQuestion(game).catch(() => null), NEXT_DELAY_MS);
      return true;
    }

    await interaction.update(buildGamePayload(game, selectedIndex, 'Wrong answer. Please wait 5s for the next question.'));
    if (game.hasMasterPerk) {
      game.currentRewardMultiplier = resetTriviaMasterPerkMultiplier(game.userId);
    }
    game.nextTimeout = setTimeout(() => askNextQuestion(game).catch(() => null), WRONG_DELAY_MS);
    return true;
  },
};
