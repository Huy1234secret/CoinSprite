const { randomUUID } = require('crypto');
const { ROULETTE_BET_OPTIONS, ROULETTE_STATES } = require('../config/roulette');
const { rouletteBetModal } = require('../modals/rouletteBuilders');
const { acknowledgeUpdate, sendEphemeral } = require('../../shared/interactionResponses');
const { errorPayload } = require('./builders');
const {
  rouletteBettingPayload,
  rouletteLobbyPayload,
  rouletteOpponentPickerPayload,
  rouletteRenderFailurePayload,
  rouletteResultPayload,
  rouletteRulesPayload,
  rouletteSpinningPayload,
  rouletteTerminalPayload,
} = require('./rouletteBuilders');
const { loadRouletteStateImage } = require('../services/rouletteMedia');

function modalText(interaction, customId) {
  try { return interaction.fields.getTextInputValue(customId) || ''; } catch { return ''; }
}

function collectionGet(collection, id) { return collection?.get?.(id) || collection?.cache?.get?.(id) || null; }

function rouletteUserProfile(user, member) {
  const avatarOwner = member && typeof member.displayAvatarURL === 'function' ? member : user;
  return {
    userId: String(user.id),
    displayName: String(member?.displayName || user.globalName || user.username || 'Player'),
    avatarUrl: typeof avatarOwner?.displayAvatarURL === 'function' ? avatarOwner.displayAvatarURL({ extension: 'png', size: 256 }) : '',
  };
}

async function ephemeralError(interaction, title, message) {
  await sendEphemeral(interaction, errorPayload(`${title}\n${message}`, { ephemeral: true }));
}

function createRouletteComponentHandler(context) {
  const { reportError, rouletteQueueEdit, rouletteRenderer, rouletteService } = context;

  function acknowledge(interaction) { return acknowledgeUpdate(interaction, { reportError, startedAt: Date.now() }); }
  function operationKey(interaction, action) { return `roulette:${action}:${interaction.id || randomUUID()}`; }

  async function hostOnly(interaction, game) {
    if (game?.hostUserId === String(interaction.user.id)) return true;
    await ephemeralError(interaction, 'Not your Roulette controls', 'Only the command invoker can use this control.');
    return false;
  }

  async function participantOnly(interaction, game) {
    if (game?.participants.some((participant) => participant.userId === String(interaction.user.id))) return true;
    await ephemeralError(interaction, 'Not at this table', 'Only table participants can use this control.');
    return false;
  }

  async function payloadFor(game) {
    if ([ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)) return rouletteTerminalPayload(game, { initial: false });
    if (game.state === ROULETTE_STATES.LOBBY) return rouletteLobbyPayload(game, { initial: false });
    if ([ROULETTE_STATES.SPINNING, ROULETTE_STATES.FINISHED].includes(game.state)) {
      const media = await loadRouletteStateImage(game, rouletteRenderer, reportError);
      return game.state === ROULETTE_STATES.SPINNING
        ? rouletteSpinningPayload(game, media.image, { initial: false, extension: media.extension })
        : rouletteResultPayload(game, media.image, { initial: false });
    }
    return rouletteBettingPayload(game, await rouletteRenderer.render(game), { initial: false });
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
        await interaction.editReply(payload);
        return true;
      } catch (error) {
        reportError?.(error, { kind: 'roulette-render', gameId, revision: authoritative.revision });
        const latest = rouletteService.game(gameId);
        if (latest?.revision === authoritative.revision) await interaction.editReply(rouletteRenderFailurePayload(authoritative, { initial: false }));
        return false;
      }
    });
  }

  async function modeInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await hostOnly(interaction, game)) return true;
    if (game.state !== ROULETTE_STATES.CHOOSING_MODE) {
      await ephemeralError(interaction, 'Stale Roulette controls', 'This table has already moved past mode selection.');
      return true;
    }
    const mode = interaction.values?.[0];
    if (!['bot', 'human'].includes(mode)) {
      await ephemeralError(interaction, 'Invalid mode', 'Choose Bot or Player.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.chooseMode(game.id, interaction.user.id, mode);
    if (result.status !== 'ok') return ephemeralError(interaction, 'Roulette unavailable', 'This table can no longer change mode.');
    if (mode === 'human') await interaction.editReply(rouletteOpponentPickerPayload(result.game, { initial: false }));
    else await editRendered(interaction, result.game);
    return true;
  }

  async function opponentsInteraction(interaction, game) {
    if (!interaction.isUserSelectMenu?.() || !await hostOnly(interaction, game)) return true;
    if (game.state !== ROULETTE_STATES.CHOOSING_OPPONENTS || game.mode !== 'human') {
      await ephemeralError(interaction, 'Stale Roulette controls', 'This table can no longer change opponents.');
      return true;
    }
    const ids = (interaction.values || []).map(String);
    if (ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length || ids.includes(game.hostUserId)) {
      await ephemeralError(interaction, 'Invalid opponents', 'Choose one to three unique people other than yourself.');
      return true;
    }
    const profiles = [];
    for (const id of ids) {
      const user = collectionGet(interaction.users, id);
      if (!user || user.bot) {
        await ephemeralError(interaction, 'Invalid opponent', 'Bot accounts cannot join a human Roulette table.');
        return true;
      }
      const active = rouletteService.repository.activeGameForUser(id);
      if (active && active.id !== game.id) {
        await ephemeralError(interaction, 'Opponent is busy', `<@${id}> is already participating in another active casino game.`);
        return true;
      }
      profiles.push(rouletteUserProfile(user, collectionGet(interaction.members, id)));
    }
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.invite(game.id, interaction.user.id, profiles);
    if (result.status !== 'ok') {
      const message = result.status === 'participant-busy' ? `<@${result.userId}> is already at another casino table.` : 'The opponent list could not be saved.';
      await ephemeralError(interaction, 'Roulette unavailable', message);
      return true;
    }
    await interaction.editReply(rouletteLobbyPayload(result.game, { initial: false }));
    return true;
  }

  async function joinInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.accept(game.id, interaction.user.id);
    if (result.status !== 'ok') await ephemeralError(interaction, 'Join unavailable', 'This invitation is stale.');
    else await interaction.editReply(rouletteLobbyPayload(result.game, { initial: false }));
    return true;
  }

  async function declineInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.decline(game.id, interaction.user.id);
    if (result.status === 'canceled') await interaction.editReply(rouletteTerminalPayload(result.game, { initial: false }));
    else if (result.status === 'declined') await interaction.editReply(rouletteLobbyPayload(result.game, { initial: false }));
    else await ephemeralError(interaction, 'Decline unavailable', 'This invitation is stale.');
    return true;
  }

  async function startInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.start(game.id, interaction.user.id);
    if (result.status !== 'started') await ephemeralError(interaction, 'Start unavailable', 'At least two accepted players are required.');
    else await editRendered(interaction, result.game);
    return true;
  }

  async function betInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await participantOnly(interaction, game)) return true;
    if (game.state !== ROULETTE_STATES.BETTING) return ephemeralError(interaction, 'Bet unavailable', 'This betting control is stale.');
    const type = interaction.values?.[0];
    if (!ROULETTE_BET_OPTIONS.some((entry) => entry.value === type)) return ephemeralError(interaction, 'Invalid bet', 'Choose a supported roulette bet.');
    await interaction.showModal(rouletteBetModal(game.id, type));
    return true;
  }

  async function betSubmitInteraction(interaction, game, type) {
    if (!interaction.isModalSubmit?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    try {
      result = rouletteService.place(game.id, interaction.user.id, type, modalText(interaction, 'target'), modalText(interaction, 'amount'), operationKey(interaction, 'place'));
    } catch (error) {
      await ephemeralError(interaction, 'Invalid roulette bet', error.message);
      return true;
    }
    if (result.status !== 'ok') {
      const messages = {
        insufficient: `You need ${result.missing} more token value.`,
        'position-limit': 'You already have the maximum 12 distinct positions.',
        'total-limit': 'This bet would exceed your 1000 token total escrow limit.',
      };
      await ephemeralError(interaction, 'Bet rejected', messages[result.status] || 'The table is no longer accepting this bet.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function mutationButton(interaction, game, action) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    if (action === 'undo') result = rouletteService.undo(game.id, interaction.user.id, operationKey(interaction, action));
    else if (action === 'clear') result = rouletteService.clear(game.id, interaction.user.id, operationKey(interaction, action));
    else if (action === 'leave') result = rouletteService.leave(game.id, interaction.user.id, operationKey(interaction, action));
    else result = rouletteService.setReady(game.id, interaction.user.id, action === 'ready', operationKey(interaction, action));
    if (result.status === 'canceled') await interaction.editReply(rouletteTerminalPayload(result.game, { initial: false }));
    else if (result.status === 'empty') await ephemeralError(interaction, 'Nothing to undo', 'Place a bet first.');
    else if (result.status === 'no-bets') await ephemeralError(interaction, 'Ready unavailable', 'Place at least one bet before becoming ready.');
    else if (result.status !== 'ok') await ephemeralError(interaction, 'Control unavailable', 'The table changed before this control was processed.');
    else await editRendered(interaction, result.game);
    return true;
  }

  async function spinInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    // Discord acknowledgement must succeed before the outcome is selected and persisted.
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.beginSpin(game.id, interaction.user.id);
    if (result.status !== 'ok') await ephemeralError(interaction, 'Spin unavailable', 'Every remaining player needs at least one bet and must be Ready.');
    else await editRendered(interaction, result.game);
    return true;
  }

  async function cancelInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if ([ROULETTE_STATES.SPINNING, ROULETTE_STATES.FINISHED, ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)) {
      await ephemeralError(interaction, 'Stale table', 'This Roulette table has already ended.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.cancel(game.id);
    await interaction.editReply(rouletteTerminalPayload(result.game, { initial: false }));
    return true;
  }

  async function replayInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rouletteService.replay(game.id, interaction.user.id);
    if (result.status !== 'ok') await ephemeralError(interaction, 'Replay unavailable', result.userId ? `<@${result.userId}> is at another casino table.` : 'This result control is stale.');
    else await editRendered(interaction, result.game);
    return true;
  }

  return async function handleRouletteComponent(interaction, parts) {
    if (parts[1] !== 'roulette') return false;
    const action = parts[2];
    const gameId = parts[3];
    let game = rouletteService.game(gameId);
    if (!game) { await ephemeralError(interaction, 'Unknown Roulette game', 'This table no longer exists.'); return true; }
    if (![ROULETTE_STATES.SPINNING, ROULETTE_STATES.FINISHED, ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)
      && game.expiresAt <= rouletteService.now()) {
      if (!await acknowledge(interaction)) return true;
      game = rouletteService.repository.refundAll(game.id, ROULETTE_STATES.EXPIRED, rouletteService.now()).game;
      await interaction.editReply(rouletteTerminalPayload(game, { initial: false }));
      return true;
    }
    if (action === 'rules') { await sendEphemeral(interaction, rouletteRulesPayload()); return true; }
    if (game.state === ROULETTE_STATES.SPINNING) {
      await ephemeralError(interaction, 'Roulette is spinning', 'No controls can change this table until the persisted result is revealed.');
      return true;
    }
    if (game.state === ROULETTE_STATES.EXPIRED) { await ephemeralError(interaction, 'Roulette game expired', 'All unresolved bets were refunded exactly once.'); return true; }
    if (action === 'mode') return modeInteraction(interaction, game);
    if (action === 'opponents') return opponentsInteraction(interaction, game);
    if (action === 'join') return joinInteraction(interaction, game);
    if (action === 'decline') return declineInteraction(interaction, game);
    if (action === 'start') return startInteraction(interaction, game);
    if (action === 'bet') return betInteraction(interaction, game);
    if (action === 'bet-submit') return betSubmitInteraction(interaction, game, parts[4]);
    if (['undo', 'clear', 'ready', 'unready', 'leave'].includes(action)) return mutationButton(interaction, game, action);
    if (action === 'spin') return spinInteraction(interaction, game);
    if (action === 'cancel') return cancelInteraction(interaction, game);
    if (['replay', 'new-bets'].includes(action)) return replayInteraction(interaction, game);
    if (action === 'retry') {
      if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
      if (!await acknowledge(interaction)) return true;
      await editRendered(interaction, rouletteService.game(game.id));
      return true;
    }
    return false;
  };
}

module.exports = { createRouletteComponentHandler, modalText, rouletteUserProfile };
