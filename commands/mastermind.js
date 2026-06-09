const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const { endUserSession, startUserSession } = require('../src/gameSessionLock');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');
const { replyIfOnCooldown, setCommandCooldown } = require('../src/commandCooldowns');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const GREEN_ACCENT = 0x57F287;
const RED_ACCENT = 0xED4245;
const BUTTON_STYLE_SECONDARY = 2;
const BUTTON_STYLE_SUCCESS = 3;
const BUTTON_STYLE_DANGER = 4;
const DEFAULT_CODE_LENGTH = 4;
const GAME_DURATION_MS = 300 * 1000;
const WIN_COOLDOWN_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = GAME_DURATION_MS;
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
  easy: { label: 'Easy', attempts: 7, codeLength: 4, rewardXp: 50, mode: 'colors' },
  medium: { label: 'Medium', attempts: 5, codeLength: 4, rewardXp: 100, mode: 'colors' },
  hard: { label: 'Hard', attempts: 4, codeLength: 4, rewardXp: 200, mode: 'colors' },
  impossible: { label: 'Impossible', attempts: 10, codeLength: 8, rewardXp: 1000, mode: 'animals' },
};

const ANIMALS = [
  '🐒', '🦍', '🦧', '🐕', '🐺', '🦊', '🦝', '🐈', '🦁', '🐅',
  '🐆', '🐎', '🫎', '🫏', '🦓', '🦌', '🦬', '🐄', '🐃', '🐖',
  '🐗', '🐑', '🐐', '🐫', '🦙', '🦒', '🐘', '🦣', '🦏', '🦛',
  '🐁', '🐀', '🐹', '🐇', '🐿️', '🦫', '🦔', '🦇', '🐻', '🐨',
  '🐼', '🦥', '🦦', '🦨', '🦘', '🦡', '🦭', '🐋', '🐬', '🦃',
  '🐔', '🐧', '🐦', '🕊️', '🦅', '🦆', '🦢', '🦉', '🦤', '🦩',
  '🦚', '🦜', '🪿', '🐸', '🐊', '🐢', '🦎', '🐍', '🦕', '🦖',
  '🐟', '🐡', '🦈', '🐙', '🦀', '🦞', '🦐', '🦑', '🦪', '🪼',
  '🪸', '🐌', '🦋', '🐛', '🐜', '🐝', '🪲', '🐞', '🦗', '🪳',
  '🕷️', '🦂', '🦟', '🪰', '🪱', '🦄', '🐉', '🐦‍🔥',
];

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

function sampleItems(items, count) {
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function pickSecret(inputs, codeLength) {
  const pool = [...inputs];
  const secret = [];
  while (secret.length < codeLength) {
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

function clearGameTimer(game) {
  if (game?.timer) clearTimeout(game.timer);
  if (game) game.timer = null;
}

async function expireGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game || game.ended) return;
  game.result = 'timeout';
  game.currentGuess = [];
  endGame(game);
  if (game.message?.editable) {
    await game.message.edit(gamePayload(game)).catch(() => null);
  }
}

function startGameTimer(game) {
  clearGameTimer(game);
  if (!game.expiresAt) game.expiresAt = Date.now() + GAME_DURATION_MS;
  game.timer = setTimeout(() => {
    expireGame(game.id).catch(() => null);
  }, GAME_DURATION_MS);
  if (typeof game.timer.unref === 'function') game.timer.unref();
}

function endGame(game) {
  game.ended = true;
  clearGameTimer(game);
  activeGames.delete(game.id);
  if (activeUserGames.get(game.userId) === game.id) activeUserGames.delete(game.userId);
  endUserSession(game.userId, 'mastermind');
}

function boardLine(guess, feedback) {
  const emptySlot = feedback?.emptySlot || EMPTY_SLOT;
  const codeLength = feedback?.codeLength || DEFAULT_CODE_LENGTH;
  const slots = [...guess, ...Array(codeLength - guess.length).fill(emptySlot)].join(' ');
  const hints = feedback?.text || Array(codeLength).fill(EMPTY_HINT).join(' ');
  return `${slots}┆ ${hints}`;
}

function scoreGuess(guess, secret) {
  let green = 0;
  const remainingSecret = [];
  const remainingGuess = [];

  for (let i = 0; i < secret.length; i += 1) {
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
    feedback: { green, red },
  };
}

function formatBoard(game) {
  const rows = game.attempts.map((attempt) => boardLine(attempt.guess, {
    text: formatFeedback(game, attempt.feedback),
    codeLength: game.codeLength,
    emptySlot: game.emptySlot,
  }));
  if (!game.ended) {
    rows.push(boardLine(game.currentGuess, {
      text: game.mode === 'animals' ? 'x0🟢 x0🔴' : null,
      codeLength: game.codeLength,
      emptySlot: game.emptySlot,
    }));
  }
  while (rows.length < game.maxAttempts) {
    rows.push(boardLine([], {
      text: game.mode === 'animals' ? 'x0🟢 x0🔴' : null,
      codeLength: game.codeLength,
      emptySlot: game.emptySlot,
    }));
  }
  return rows.slice(0, game.maxAttempts).join('\n\n');
}

function formatFeedback(game, feedback) {
  const green = Number(feedback?.green) || 0;
  const red = Number(feedback?.red) || 0;
  if (game.mode === 'animals') return `x${green}🟢 x${red}🔴`;
  return [
    ...Array(green).fill('🟢'),
    ...Array(red).fill('🔴'),
    ...Array(game.codeLength - green - red).fill(EMPTY_HINT),
  ].join(' ');
}

function statusLine(game) {
  if (game.result === 'won') {
    return `\nYou solved the code and earned **${game.rewardXp} chat EXP**.\nCorrect answer: ${game.secret.join(' ')}`;
  }
  if (game.result === 'lost') {
    return `\nYou used all slots. No EXP earned.\nCorrect answer: ${game.secret.join(' ')}`;
  }
  if (game.result === 'timeout') {
    return `\nTime is up. No EXP earned.\nCorrect answer: ${game.secret.join(' ')}`;
  }
  return [
    `\n-# Difficulty: ${game.difficultyLabel} • Reward: ${game.rewardXp} EXP • Attempt ${Math.min(game.attempts.length + 1, game.maxAttempts)} / ${game.maxAttempts}`,
    game.expiresAt ? `-# Ends <t:${Math.floor(game.expiresAt / 1000)}:R>` : null,
  ].filter(Boolean).join('\n');
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
  const disabled = game.ended || game.currentGuess.length >= game.codeLength;
  const colorButtons = game.inputs.map((color, index) => button(
    `${COLOR_BUTTON_PREFIX}${game.id}:${index}`,
    color,
    BUTTON_STYLE_SECONDARY,
    disabled || currentColors.has(color),
  ));
  const rows = [];
  for (let i = 0; i < colorButtons.length; i += 5) rows.push({ type: 1, components: colorButtons.slice(i, i + 5) });
  return rows;
}

function controlRow(game) {
  return {
    type: 1,
    components: [
      button(`${SUBMIT_PREFIX}${game.id}`, null, BUTTON_STYLE_SUCCESS, game.ended || game.currentGuess.length !== game.codeLength, 'Submit'),
      button(`${CLEAR_PREFIX}${game.id}`, null, BUTTON_STYLE_DANGER, game.ended || game.currentGuess.length === 0, 'Clear'),
      button(`${RULE_PREFIX}${game.id}`, null, BUTTON_STYLE_SECONDARY, game.ended, 'Rule'),
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
        'The bot secretly picks a code from the buttons shown on your game.',
        'Press buttons to build your guess, then press **Submit** when every slot is filled.',
        '',
        '**Hints after each submit:**',
        '🟢 = correct item in the correct place',
        '🔴 = correct item in the wrong place',
        '〇 = no matching color for that hint slot',
        '',
        '**Impossible mode:** uses 20 random animal buttons, 8 slots, and shows hints as xN🟢 xN🔴.',
        '',
        '**Rewards:** Easy 50 EXP, Medium 100 EXP, Hard 200 EXP, Impossible 1000 EXP.',
        'Each game lasts 300 seconds. Win once and /mastermind goes on cooldown for 10 minutes.',
      ].join('\n'),
    },
  ], COMPONENTS_V2_FLAG | EPHEMERAL_FLAG);
}

async function rejectNonOwner(interaction, game) {
  if (interaction.user.id === game.userId) return false;
  await interaction.reply({ content: 'Only the player who started this Mastermind game can use these controls.', flags: EPHEMERAL_FLAG });
  return true;
}

function awardWinXp(interaction, game) {
  const amount = game?.rewardXp || 0;
  const result = levelingManager.addUserXp(interaction.guildId, interaction.user.id, amount, {
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
  if (game.ended || game.currentGuess.length >= game.codeLength) {
    await interaction.update(gamePayload(game));
    return true;
  }

  if (interaction.message) game.message = interaction.message;
  const color = game.inputs[colorIndex];
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
  if (interaction.message) game.message = interaction.message;
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

  if (interaction.message) game.message = interaction.message;
  if (game.ended || game.currentGuess.length !== game.codeLength) {
    await interaction.update(gamePayload(game));
    return true;
  }

  const score = scoreGuess(game.currentGuess, game.secret);
  game.attempts.push({ guess: [...game.currentGuess], feedback: score.feedback });
  game.currentGuess = [];

  if (score.green === game.codeLength) {
    game.result = 'won';
    awardWinXp(interaction, game);
    setCommandCooldown(interaction.user.id, 'mastermind', WIN_COOLDOWN_MS);
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
        { name: 'Easy - 50 EXP', value: 'easy' },
        { name: 'Medium - 100 EXP', value: 'medium' },
        { name: 'Hard - 200 EXP', value: 'hard' },
        { name: 'Impossible - 1000 EXP', value: 'impossible' },
      )),
  disableActionTimeout: true,

  async execute(interaction) {
    if (await replyIfOnCooldown(interaction, 'mastermind', WIN_COOLDOWN_MS, EPHEMERAL_FLAG)) return;

    const existing = getUserGame(interaction.user.id);
    if (existing) {
      await interaction.reply({ content: 'You already have an active Mastermind game. Finish it before starting another one.', flags: EPHEMERAL_FLAG });
      return;
    }

    const difficultyKey = interaction.options.getString('difficulty') || 'medium';
    const difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.medium;
    const inputs = difficulty.mode === 'animals' ? sampleItems(ANIMALS, 20) : COLORS;
    const game = {
      id: createGameId(interaction.user.id),
      userId: interaction.user.id,
      secret: pickSecret(inputs, difficulty.codeLength),
      inputs,
      mode: difficulty.mode,
      difficultyLabel: difficulty.label,
      maxAttempts: difficulty.attempts,
      codeLength: difficulty.codeLength,
      rewardXp: difficulty.rewardXp,
      emptySlot: EMPTY_SLOT,
      attempts: [],
      currentGuess: [],
      result: null,
      ended: false,
      expiresAt: Date.now() + GAME_DURATION_MS,
      message: null,
      timer: null,
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
      game.message = await interaction.fetchReply?.().catch(() => null);
      startGameTimer(game);
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
