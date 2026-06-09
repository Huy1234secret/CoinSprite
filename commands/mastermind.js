const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const { endUserSession, startUserSession } = require('../src/gameSessionLock');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const GREEN_ACCENT = 0x57F287;
const RED_ACCENT = 0xED4245;
const BUTTON_STYLE_SECONDARY = 2;
const BUTTON_STYLE_SUCCESS = 3;
const BUTTON_STYLE_DANGER = 4;
const CODE_LENGTH = 4;
const WIN_XP = 100;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const EMPTY_SLOT = '🔳';
const EMPTY_HINT = '〇';
const COLOR_BUTTON_PREFIX = 'mastermind:color:';
const SUBMIT_PREFIX = 'mastermind:submit:';
const CLEAR_PREFIX = 'mastermind:clear:';
const RULE_PREFIX = 'mastermind:rule:';

const COLORS = [
  '🟥',
  '🟨',
  '🟦',
  '🟩',
  '⬜',
  '⬛',
  '🟪',
  '🟧',
  '🟫',
];

const DIFFICULTIES = {
  easy: { label: 'Easy', attempts: 7 },
  normal: { label: 'Normal', attempts: 5 },
  hard: { label: 'Hard', attempts: 4 },
};

const activeGames = new Map();
const activeUserGames = new Map();

function gameContainer(accent, components, flags = COMPONENTS_V2_FLAG) {
  return {
    flags,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: accent,
        components,
      },
    ],
  };
}

function createGameId(userId) {
  return `${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickSecret() {
  const pool = [...COLORS];
  const secret = [];
  while (secret.length < CODE_LENGTH) {
    const index = Math.floor(Math.random() * pool.length);
    secret.push(pool.splice(index, 1)[0]);
  }
  return secret;
}

function getUserGame(userId) {
  const gameId = activeUserGames.get(userId);
  if (!gameId) return null;
  const game = activeGames.get(gameId);
  if (!game || game.ended) {
    activeUserGames.delete(userId);
    return null;
  }
  return game;
}

function endGame(game) {
  game.ended = true;
  activeGames.delete(game.id);
  if (activeUserGames.get(game.userId) === game.id) activeUserGames.delete(game.userId);
  endUserSession(game.userId, 'mastermind');
}

function boardLine(guess, feedback) {
  const slots = [...guess, ...Array(CODE_LENGTH - guess.length).fill(EMPTY_SLOT)].join('');
  const hints = feedback || EMPTY_HINT.repeat(CODE_LENGTH);
  return `${slots}┆ ${hints}`;
}

function scoreGuess(guess, secret) {
  let green = 0;
  const remainingSecret = [];
  const remainingGuess = [];

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    if (guess[i] === secret[i]) {
      green += 1;
    } else {
      remainingSecret.push(secret[i]);
      remainingGuess.push(guess[i]);
    }
  }

  let red = 0;
  for (const color of remainingGuess) {
    const index = remainingSecret.indexOf(color);
    if (index === -1) continue;
    red += 1;
    remainingSecret.splice(index, 1);
  }

  return {
    green,
    red,
    feedback: `${'🟢'.repeat(green)}${'🔴'.repeat(red)}${EMPTY_HINT.repeat(CODE_LENGTH - green - red)}`,
  };
}

function formatBoard(game) {
  const rows = game.attempts.map((attempt) => boardLine(attempt.guess, attempt.feedback));
  if (!game.ended) rows.push(boardLine(game.currentGuess, null));
  while (rows.length < game.maxAttempts) rows.push(boardLine([], null));
  return rows.slice(0, game.maxAttempts).join('\n');
}

function statusLine(game) {
  if (game.result === 'won') {
    return `\nYou solved the code and earned **${WIN_XP} chat EXP**.\nCorrect color: ${game.secret.join('')}`;
  }
  if (game.result === 'lost') {
    return `\nYou used all slots. No EXP earned.\nCorrect color: ${game.secret.join('')}`;
  }
  return `\n-# Difficulty: ${game.difficultyLabel} • Attempt ${Math.min(game.attempts.length + 1, game.maxAttempts)} / ${game.maxAttempts}`;
}

function button(customId, emoji, style, disabled = false, label = null) {
  return {
    type: 2,
    custom_id: customId,
    style,
    disabled,
    ...(emoji ? { emoji: { name: emoji } } : {}),
    ...(label ? { label } : {}),
  };
}

function colorRows(game) {
  const currentColors = new Set(game.currentGuess);
  const disabled = game.ended || game.currentGuess.length >= CODE_LENGTH;
  const colorButtons = COLORS.map((color, index) => button(
    `${COLOR_BUTTON_PREFIX}${game.id}:${index}`,
    color,
    BUTTON_STYLE_SECONDARY,
    disabled || currentColors.has(color),
  ));

  return [
    { type: 1, components: colorButtons.slice(0, 5) },
    { type: 1, components: colorButtons.slice(5) },
  ];
}

function controlRow(game) {
  return {
    type: 1,
    components: [
      button(`${SUBMIT_PREFIX}${game.id}`, null, BUTTON_STYLE_SUCCESS, game.ended || game.currentGuess.length !== CODE_LENGTH, 'Submit'),
      button(`${CLEAR_PREFIX}${game.id}`, null, BUTTON_STYLE_DANGER, game.ended || game.currentGuess.length === 0, 'Clear'),
      button(`${RULE_PREFIX}${game.id}`, null, BUTTON_STYLE_SECONDARY, false, 'Rule'),
    ],
  };
}

function gamePayload(game) {
  const accent = game.result === 'won' ? GREEN_ACCENT : game.result === 'lost' ? RED_ACCENT : WHITE_ACCENT;
  return gameContainer(accent, [
    {
      type: 10,
      content: [
        '## Welcome to Mastermind game',
        "-# If don't know the rules, click the rule button below.",
      ].join('\n'),
    },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `${formatBoard(game)}${statusLine(game)}` },
    { type: 14, divider: true, spacing: 1 },
    ...colorRows(game),
    controlRow(game),
  ]);
}

function rulePayload() {
  return gameContainer(WHITE_ACCENT, [
    {
      type: 10,
      content: [
        '## Mastermind rules',
        `The bot secretly picks **${CODE_LENGTH} different colors**.`,
        'Press color buttons to build your guess, then press **Submit** when all 4 slots are filled.',
        '',
        '**Hints after each submit:**',
        '🟢 = correct color in the correct place',
        '🔴 = correct color in the wrong place',
        '〇 = no matching color for that hint slot',
        '',
        'Hints are always shown with green first, then red. Solve the full code before all slots are used to earn 100 chat EXP.',
      ].join('\n'),
    },
  ], COMPONENTS_V2_FLAG | EPHEMERAL_FLAG);
}

async function rejectNonOwner(interaction, game) {
  if (interaction.user.id === game.userId) return false;
  await interaction.reply({ content: 'Only the player who started this Mastermind game can use these controls.', flags: EPHEMERAL_FLAG });
  return true;
}

function awardWinXp(interaction) {
  const result = levelingManager.addUserXp(interaction.guildId, interaction.user.id, WIN_XP, {
    source: 'mastermind win',
    channelId: interaction.channelId,
    command: '/mastermind',
  });

  const member = interaction.member;
  if (member) {
    syncMemberLevelRoles(interaction.guild, member).catch(() => null);
  } else {
    interaction.guild.members.fetch(interaction.user.id)
      .then((fetchedMember) => syncMemberLevelRoles(interaction.guild, fetchedMember))
      .catch(() => null);
  }

  return result;
}

async function handleColor(interaction, gameId, colorIndex) {
  const game = activeGames.get(gameId);
  if (!game) {
    await interaction.reply({ content: 'This Mastermind game is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (await rejectNonOwner(interaction, game)) return true;
  if (game.ended || game.currentGuess.length >= CODE_LENGTH) {
    await interaction.update(gamePayload(game));
    return true;
  }

  const color = COLORS[colorIndex];
  if (!color || game.currentGuess.includes(color)) {
    await interaction.update(gamePayload(game));
    return true;
  }

  game.currentGuess.push(color);
  await interaction.update(gamePayload(game));
  return true;
}

async function handleClear(interaction, gameId) {
  const game = activeGames.get(gameId);
  if (!game) {
    await interaction.reply({ content: 'This Mastermind game is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (await rejectNonOwner(interaction, game)) return true;
  if (!game.ended) game.currentGuess = [];
  await interaction.update(gamePayload(game));
  return true;
}

async function handleSubmit(interaction, gameId) {
  const game = activeGames.get(gameId);
  if (!game) {
    await interaction.reply({ content: 'This Mastermind game is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (await rejectNonOwner(interaction, game)) return true;

  if (game.ended || game.currentGuess.length !== CODE_LENGTH) {
    await interaction.update(gamePayload(game));
    return true;
  }

  const score = scoreGuess(game.currentGuess, game.secret);
  game.attempts.push({ guess: [...game.currentGuess], feedback: score.feedback });
  game.currentGuess = [];

  if (score.green === CODE_LENGTH) {
    game.result = 'won';
    awardWinXp(interaction);
    endGame(game);
  } else if (game.attempts.length >= game.maxAttempts) {
    game.result = 'lost';
    endGame(game);
  }

  await interaction.update(gamePayload(game));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mastermind')
    .setDescription('Play a Mastermind color code game.')
    .addStringOption((option) => option
      .setName('difficulty')
      .setDescription('How many slots you get before losing.')
      .setRequired(false)
      .addChoices(
        { name: 'Easy - 7 slots', value: 'easy' },
        { name: 'Normal - 5 slots', value: 'normal' },
        { name: 'Hard - 4 slots', value: 'hard' },
      )),
  disableActionTimeout: true,

  async execute(interaction) {
    const existing = getUserGame(interaction.user.id);
    if (existing) {
      await interaction.reply({ content: 'You already have an active Mastermind game. Finish it before starting another one.', flags: EPHEMERAL_FLAG });
      return;
    }

    const difficultyKey = interaction.options.getString('difficulty') || 'normal';
    const difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    const game = {
      id: createGameId(interaction.user.id),
      userId: interaction.user.id,
      secret: pickSecret(),
      difficultyLabel: difficulty.label,
      maxAttempts: difficulty.attempts,
      attempts: [],
      currentGuess: [],
      result: null,
      ended: false,
    };

    activeGames.set(game.id, game);
    activeUserGames.set(interaction.user.id, game.id);
    startUserSession(interaction.user.id, {
      type: 'mastermind',
      label: 'Mastermind',
      lockedCommand: 'mastermind',
      lockToCommand: true,
      maxAgeMs: SESSION_MAX_AGE_MS,
      lockMessage: 'You have an active Mastermind game. Finish it before using another command.',
    });

    try {
      await interaction.reply(gamePayload(game));
    } catch (error) {
      endGame(game);
      throw error;
    }
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton?.()) return false;

    if (interaction.customId.startsWith(RULE_PREFIX)) {
      await interaction.reply(rulePayload());
      return true;
    }

    if (interaction.customId.startsWith(COLOR_BUTTON_PREFIX)) {
      const [, colorIndexRaw] = interaction.customId.slice(COLOR_BUTTON_PREFIX.length).split(':');
      const gameId = interaction.customId.slice(COLOR_BUTTON_PREFIX.length, interaction.customId.lastIndexOf(':'));
      return handleColor(interaction, gameId, Number(colorIndexRaw));
    }

    if (interaction.customId.startsWith(SUBMIT_PREFIX)) {
      return handleSubmit(interaction, interaction.customId.slice(SUBMIT_PREFIX.length));
    }

    if (interaction.customId.startsWith(CLEAR_PREFIX)) {
      return handleClear(interaction, interaction.customId.slice(CLEAR_PREFIX.length));
    }

    return false;
  },
};
