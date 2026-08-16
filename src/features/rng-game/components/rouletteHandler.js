const { randomUUID } = require('crypto');
const { ROULETTE_BET_OPTIONS, ROULETTE_STATES } = require('../config/roulette');
const { rouletteBetModal } = require('../modals/rouletteBuilders');
const { acknowledgeUpdate, sendEphemeral } = require('../../shared/interactionResponses');
const { errorPayload } = require('./builders');
const {
  rouletteBetSelectorPayload,
  rouletteBettingPayload,
  rouletteRenderFailurePayload,
  rouletteResultPayload,
  rouletteRulesPayload,
  rouletteSpinningPayload,
  rouletteTerminalPayload,
} = require('./rouletteBuilders');
const { loadRouletteStateImage } = require('../services/rouletteMedia');

const LEGACY_PRE_BETTING_STATES = new Set([
  ROULETTE_STATES.CHOOSING_MODE,
  ROULETTE_STATES.CHOOSING_OPPONENTS,
  ROULETTE_STATES.LOBBY,
]);

function modalText(interaction, customId) {
  try { return interaction.fields.getTextInputValue(customId) || ''; } catch { return ''; }
}

function rouletteUserProfile(user, member) {
  const avatarOwner = member && typeof member.displayAvatarURL === 'function' ? member : user;
  return {
    userId: String(user.id),
    displayName: String(member?.displayName || user.globalName || user.username || 'Player'),
    avatarUrl: typeof avatarOwner?.displayAvatarURL === 'function' ? avatarOwner.displayAvatarURL({ extension: 'png', size: 256 }) : '',
    bot: user.bot === true,
  };
}

async function ephemeralError(interaction, title, message) {
  await sendEphemeral(interaction, errorPayload(`${title}\n${message}`, { ephemeral: true }));
}

function createRouletteComponentHandler(context) {
  const {
    getClient,
    reportError,
    rouletteQueueEdit,
    rouletteRenderer,
    rouletteService,
  } = context;

  function acknowledge(interaction) { return acknowledgeUpdate(interaction, { reportError, startedAt: Date.now() }); }
  function operationKey(interaction, action) { return `roulette:${action}:${interaction.id || randomUUID()}`; }

  async function hostOnly(interaction, game) {
    if (game?.hostUserId === String(interaction.user.id)) return true;
    await ephemeralError(interaction, 'Host-only Roulette action', 'Only the command invoker can use this action.');
    return false;
  }

  async function participantOnly(interaction, game) {
    if (game?.participants.some((participant) => participant.userId === String(interaction.user.id))) return true;
    await ephemeralError(interaction, 'Join Table first', 'Press **Join Table** before using this action.');
    return false;
  }

  async function payloadFor(game) {
    if ([ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)) {
      return rouletteTerminalPayload(game, { initial: false });
    }
    const tableImage = await rouletteRenderer.render(game);
    if (game.state === ROULETTE_STATES.SPINNING) {
      const media = await loadRouletteStateImage(game, rouletteRenderer, reportError);
      return rouletteSpinningPayload(game, tableImage, media.image, { initial: false, extension: media.extension });
    }
    if (game.state === ROULETTE_STATES.FINISHED) {
      const media = await loadRouletteStateImage(game, rouletteRenderer, reportError);
      return rouletteResultPayload(game, tableImage, media.image, { initial: false });
    }
    return rouletteBettingPayload(game, tableImage, { initial: false });
  }

  async function editPublicMessage(interaction, game, payload) {
    if (game.messageId && interaction.message?.id !== game.messageId) {
      const client = getClient?.();
      const channel = await client?.channels?.fetch?.(game.channelId);
      const message = await channel?.messages?.fetch?.(game.messageId);
      if (message?.edit) return message.edit(payload);
    }
    return interaction.editReply(payload);
  }

  async function editRendered(interaction, requestedGame) {
    const gameId = requestedGame.id;
    return rouletteQueueEdit(gameId, async () => {
      const authoritative = rouletteService.game(gameId);
      if (!authoritative || authoritative.revision !== requestedGame.revision) return false;
      try {
        const payload = await payloadFor(authoritative);
        const latest = rouletteService.game(gameId);
        if (!latest || latest.revision !== authoritative.revision) return false;
        await editPublicMessage(interaction, authoritative, payload);
        return true;
      } catch (error) {
        reportError?.(error, { kind: 'roulette-render', gameId, revision: authoritative.revision });
        const latest = rouletteService.game(gameId);
        if (latest?.revision === authoritative.revision) {
          await editPublicMessage(interaction, authoritative, rouletteRenderFailurePayload(authoritative, { initial: false }));
        }
        return false;
      }
    });
  }

  async function joinInteraction(interaction, game) {
    if (!interaction.isButton?.()) return true;
    if (interaction.user.bot) {
      await ephemeralError(interaction, 'Join unavailable', 'Bot accounts cannot join a Roulette table.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.join(game.id, rouletteUserProfile(interaction.user, interaction.member));
    if (result.status !== 'ok') {
      const messages = {
        'already-joined': 'You are already joined at this table.',
        full: 'This Roulette table already has four players.',
        stale: 'This table is no longer accepting players.',
        bot: 'Bot accounts cannot join a Roulette table.',
        'participant-busy': 'Finish your other active casino game before joining this table.',
      };
      await ephemeralError(interaction, 'Join unavailable', messages[result.status] || 'This table could not accept you.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function betInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await participantOnly(interaction, game)) return true;
    if (game.state !== ROULETTE_STATES.BETTING) {
      await ephemeralError(interaction, 'Bet unavailable', 'This betting control is stale.');
      return true;
    }
    const type = interaction.values?.[0];
    if (!ROULETTE_BET_OPTIONS.some((entry) => entry.value === type)) {
      await ephemeralError(interaction, 'Invalid bet', 'Choose a supported European Roulette bet.');
      return true;
    }
    await interaction.showModal(rouletteBetModal(game.id, type));
    return true;
  }

  async function betSubmitInteraction(interaction, game, type) {
    if (!interaction.isModalSubmit?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    try {
      result = rouletteService.place(
        game.id,
        interaction.user.id,
        type,
        modalText(interaction, 'target'),
        modalText(interaction, 'amount'),
        operationKey(interaction, 'place'),
      );
    } catch (error) {
      await ephemeralError(interaction, 'Invalid roulette bet', error.message);
      return true;
    }
    if (result.status !== 'ok') {
      const messages = {
        insufficient: `You need ${result.missing} more token value.`,
        'position-limit': 'You already have the maximum 12 distinct positions.',
        'total-limit': 'This bet would exceed your 1,000-token total escrow limit.',
      };
      await ephemeralError(interaction, 'Bet rejected', messages[result.status] || 'The table is no longer accepting this bet.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function clearAction(interaction, game) {
    if (!await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.clear(game.id, interaction.user.id, operationKey(interaction, 'clear'));
    if (result.status !== 'ok') {
      await ephemeralError(interaction, 'Clear unavailable', 'The table changed before your bets could be cleared.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function toggleReadyInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.toggleReady(game.id, interaction.user.id, operationKey(interaction, 'ready'));
    if (result.status === 'no-bets') {
      await ephemeralError(interaction, 'Ready unavailable', 'Place at least one bet before becoming Ready.');
    } else if (result.status !== 'ok') {
      await ephemeralError(interaction, 'Ready unavailable', 'This table is no longer accepting readiness changes.');
    } else {
      await editRendered(interaction, result.game);
    }
    return true;
  }

  async function spinAction(interaction, game) {
    if (!await hostOnly(interaction, game)) return true;
    // Acknowledge before the winning number is generated and persisted.
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.beginSpin(game.id, interaction.user.id);
    if (result.status !== 'ok') {
      const message = result.status === 'no-wagers'
        ? 'At least one wager must be placed before spinning.'
        : 'Every player with a wager must be Ready.';
      await ephemeralError(interaction, 'Spin unavailable', message);
    } else {
      await editRendered(interaction, result.game);
    }
    return true;
  }

  async function cancelAction(interaction, game) {
    if (!await hostOnly(interaction, game)) return true;
    if (game.state !== ROULETTE_STATES.BETTING) {
      await ephemeralError(interaction, 'Stale table', 'This Roulette table can no longer be canceled.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.cancel(game.id);
    await editPublicMessage(interaction, result.game, rouletteTerminalPayload(result.game, { initial: false }));
    return true;
  }

  async function actionInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.()) return true;
    const action = interaction.values?.[0];
    if (action === 'place-bet') {
      if (!await participantOnly(interaction, game)) return true;
      if (game.state !== ROULETTE_STATES.BETTING) {
        await ephemeralError(interaction, 'Bet unavailable', 'This table is no longer accepting bets.');
        return true;
      }
      await sendEphemeral(interaction, rouletteBetSelectorPayload(game));
      return true;
    }
    if (action === 'clear-bets') return clearAction(interaction, game);
    if (action === 'spin') return spinAction(interaction, game);
    if (action === 'cancel') return cancelAction(interaction, game);
    await ephemeralError(interaction, 'Unknown Roulette action', 'Choose one of the four table actions.');
    return true;
  }

  async function replayInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.replay(game.id, interaction.user.id);
    if (result.status !== 'ok') {
      await ephemeralError(interaction, 'Replay unavailable', result.userId ? `<@${result.userId}> is at another casino table.` : 'This result control is stale.');
    } else {
      await editRendered(interaction, result.game);
    }
    return true;
  }

  async function compatibilityButton(interaction, game, action) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    if (action === 'undo') result = rouletteService.undo(game.id, interaction.user.id, operationKey(interaction, action));
    else if (action === 'leave') result = rouletteService.leave(game.id, interaction.user.id, operationKey(interaction, action));
    else result = rouletteService.setReady(game.id, interaction.user.id, action === 'ready', operationKey(interaction, action));
    if (result.status === 'canceled') {
      await editPublicMessage(interaction, result.game, rouletteTerminalPayload(result.game, { initial: false }));
    } else if (result.status !== 'ok') {
      await ephemeralError(interaction, 'Old control unavailable', 'Use the current public-table controls.');
    } else {
      await editRendered(interaction, result.game);
    }
    return true;
  }

  return async function handleRouletteComponent(interaction, parts) {
    if (parts[1] !== 'roulette') return false;
    const action = parts[2];
    const gameId = parts[3];
    let game = rouletteService.game(gameId);
    if (!game) {
      await ephemeralError(interaction, 'Unknown Roulette game', 'This table no longer exists.');
      return true;
    }
    if (![ROULETTE_STATES.SPINNING, ROULETTE_STATES.FINISHED, ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)
      && game.expiresAt <= rouletteService.now()) {
      if (!await acknowledge(interaction)) return true;
      game = rouletteService.repository.refundAll(game.id, ROULETTE_STATES.EXPIRED, rouletteService.now()).game;
      await editPublicMessage(interaction, game, rouletteTerminalPayload(game, { initial: false }));
      return true;
    }
    if (LEGACY_PRE_BETTING_STATES.has(game.state)) {
      if (!await acknowledge(interaction)) return true;
      game = rouletteService.repository.refundAll(game.id, ROULETTE_STATES.EXPIRED, rouletteService.now()).game;
      await editPublicMessage(interaction, game, rouletteTerminalPayload(game, { initial: false }));
      return true;
    }
    if (action === 'rules') {
      await sendEphemeral(interaction, rouletteRulesPayload());
      return true;
    }
    if (game.state === ROULETTE_STATES.SPINNING) {
      await ephemeralError(interaction, 'Roulette is spinning', 'This table is locked until the persisted result is revealed.');
      return true;
    }
    if (game.state === ROULETTE_STATES.EXPIRED) {
      await ephemeralError(interaction, 'Roulette game expired', 'All unresolved bets were refunded exactly once.');
      return true;
    }
    if (action === 'action') return actionInteraction(interaction, game);
    if (action === 'join') return joinInteraction(interaction, game);
    if (action === 'toggle-ready') return toggleReadyInteraction(interaction, game);
    if (action === 'bet') return betInteraction(interaction, game);
    if (action === 'bet-submit') return betSubmitInteraction(interaction, game, parts[4]);
    if (action === 'replay') return replayInteraction(interaction, game);
    if (action === 'new-bets') {
      await ephemeralError(interaction, 'Old control unavailable', 'Use **Play Again** on the current result message.');
      return true;
    }
    if (action === 'retry') {
      if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
      if (!await acknowledge(interaction)) return true;
      await editRendered(interaction, rouletteService.game(game.id));
      return true;
    }
    // Existing messages from the pre-public-table release can still be settled or refunded safely.
    if (action === 'spin') return spinAction(interaction, game);
    if (action === 'cancel') return cancelAction(interaction, game);
    if (action === 'clear') return clearAction(interaction, game);
    if (['undo', 'ready', 'unready', 'leave'].includes(action)) return compatibilityButton(interaction, game, action);
    return false;
  };
}

module.exports = { createRouletteComponentHandler, modalText, rouletteUserProfile };
