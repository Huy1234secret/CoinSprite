const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addBalance } = require('../src/gamblingStore');
const { PRCOIN, WHITE_ACCENT, GREEN_ACCENT, YELLOW_ACCENT, RED_ACCENT, formatNumber } = require('../src/gamblingConfig');
const TRIVIA_QUESTIONS = require('../src/triviaQuestions');
const { startUserSession, endUserSession, getCommandBlockReason } = require('../src/gameSessionLock');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const START_TIME_MS = 30_000;
const CORRECT_BONUS_MS = 5_000;
const WRONG_DELAY_MS = 5_000;
const NEXT_DELAY_MS = 2_000;
const COOLDOWN_MS = 10 * 60_000;

const activeGames = new Map();
const userCooldowns = new Map();

const DIFFICULTY_CONFIG = {
  easy: { label: 'Easy', accent: GREEN_ACCENT, reward: 10 },
  medium: { label: 'Medium', accent: YELLOW_ACCENT, reward: 100 },
  hard: { label: 'Hard', accent: RED_ACCENT, reward: 1000 },
};

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function pickDifficulty(game) {
  if (game.questionNumber === 0) {
    return 'easy';
  }

  const roll = Math.random();
  if (roll < 0.50) return 'easy';
  if (roll < 0.85) return 'medium';
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

function getQuestionValue(game, difficulty) {
  return DIFFICULTY_CONFIG[difficulty]?.reward ?? 10;
}

function formatCooldownMessage(cooldownLeft) {
  const unlockUnix = Math.floor((Date.now() + cooldownLeft) / 1000);
  return `Trivia is on cooldown. You can play again <t:${unlockUnix}:R>.`;
}

function buildWelcomePayload(user) {
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
              '-# You have a total of **30 seconds** to answer as much trivia as you can.',
              '-# Every correct answer increases your timer by **5s**. A wrong answer delays you by **5s**.',
              '-# Once the timer is over, you earn PRcoin based on how many questions you answered correctly.',
              '-# Reward per correct answer: Easy **10**, Medium **100**, Hard **1,000**.',
              '-# Once you are ready, press the **PLAY** button below.',
            ].join('\n'),
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `trivia:play:${user.id}:${createGameId()}`,
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
  const buttons = question.answers.map((answer, index) => {
    let style = 2;
    if (final && index === question.correctIndex) style = 3;
    if (final && index === selectedIndex && index !== question.correctIndex) style = 4;

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
        ],
      },
    ],
  };
}

function buildFinishedPayload(game) {
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
              '### Time is up!',
              `* You earned **${formatNumber(game.prizePool)}** ${PRCOIN}!`,
              `-# You answered **${formatNumber(game.correctCount)}** trivia questions correctly.`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

async function finishGame(game, interaction = null) {
  if (!game || game.finished) return;
  game.finished = true;
  activeGames.delete(game.userId);
  endUserSession(game.userId, 'trivia');

  if (game.timeout) clearTimeout(game.timeout);
  if (game.nextTimeout) clearTimeout(game.nextTimeout);

  if (game.prizePool > 0) {
    addBalance(game.userId, game.prizePool);
  }

  const payload = buildFinishedPayload(game);
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
  const question = pickQuestion(game, difficulty);
  game.questionNumber += 1;
  game.currentQuestion = question;
  game.currentQuestionValue = getQuestionValue(game, difficulty);
  game.locked = false;

  await game.message.edit(buildGamePayload(game)).catch(() => null);
  resetFinishTimer(game);
}

function getCooldownLeft(userId) {
  const expiresAt = userCooldowns.get(userId) || 0;
  return Math.max(0, expiresAt - Date.now());
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

    const cooldownLeft = getCooldownLeft(interaction.user.id);
    if (cooldownLeft > 0) {
      await interaction.reply({
        content: formatCooldownMessage(cooldownLeft),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(buildWelcomePayload(interaction.user));
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('trivia:'));
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('trivia:')) {
      return false;
    }

    const parts = interaction.customId.split(':');
    const action = parts[1];
    const ownerId = parts[2];

    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own Trivia game buttons.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'play') {
      const cooldownLeft = getCooldownLeft(interaction.user.id);
      if (cooldownLeft > 0) {
        await interaction.reply({
          content: formatCooldownMessage(cooldownLeft),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (activeGames.has(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an active Trivia game. Finish it first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const game = {
        id: createGameId(),
        userId: interaction.user.id,
        message: interaction.message,
        endsAt: Date.now() + START_TIME_MS,
        prizePool: 0,
        correctCount: 0,
        questionNumber: 0,
        currentQuestion: null,
        currentQuestionValue: 10,
        lastQuestionValue: 10,
        usedQuestions: { easy: new Set(), medium: new Set(), hard: new Set() },
        locked: false,
        finished: false,
        timeout: null,
        nextTimeout: null,
      };

      game.questionNumber = 1;
      game.currentQuestion = pickQuestion(game, 'easy');
      game.currentQuestionValue = 10;

      activeGames.set(interaction.user.id, game);
      startUserSession(interaction.user.id, {
        type: 'trivia',
        label: 'Trivia',
        lockedCommand: 'trivia',
        blockedCommands: ['minefield'],
      });
      userCooldowns.set(interaction.user.id, Date.now() + COOLDOWN_MS);
      await interaction.update(buildGamePayload(game));
      resetFinishTimer(game);
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
    const correct = selectedIndex === game.currentQuestion.correctIndex;

    if (correct) {
      game.correctCount += 1;
      game.prizePool += game.currentQuestionValue;
      game.lastQuestionValue = game.currentQuestionValue;
      game.endsAt += CORRECT_BONUS_MS;
      await interaction.update(buildGamePayload(game, selectedIndex, 'Correct! +5s added to your timer.'));
      resetFinishTimer(game);
      game.nextTimeout = setTimeout(() => askNextQuestion(game).catch(() => null), NEXT_DELAY_MS);
      return true;
    }

    await interaction.update(buildGamePayload(game, selectedIndex, 'Wrong answer. Please wait 5s for the next question.'));
    game.nextTimeout = setTimeout(() => askNextQuestion(game).catch(() => null), WRONG_DELAY_MS);
    return true;
  },
};
