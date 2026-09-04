const { RPS_STATES } = require('../config/rps');
const { higherBetModal, rpsBetModal } = require('../modals/rpsBuilders');
const { errorPayload } = require('./builders');
const {
  acknowledgeUpdate,
  sendEphemeral,
} = require('../../shared/interactionResponses');
const {
  canceledPayload,
  exchangeSuccessPayload,
  lobbyPayload,
  opponentPickerPayload,
  renderFailurePayload,
  roundPayload,
} = require('./rpsBuilders');

function modalText(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) || '';
  } catch {
    return '';
  }
}

function collectionGet(collection, id) {
  return collection?.get?.(id) || collection?.cache?.get?.(id) || null;
}

function userProfile(user, member) {
  const avatarOwner = member && typeof member.displayAvatarURL === 'function' ? member : user;
  return {
    userId: String(user.id),
    displayName: String(member?.displayName || user.globalName || user.username || 'Player'),
    avatarUrl: typeof avatarOwner?.displayAvatarURL === 'function'
      ? avatarOwner.displayAvatarURL({ extension: 'png', size: 256 })
      : '',
  };
}

async function ephemeralError(interaction, title, message) {
  const payload = errorPayload(`${title}\n${message}`, { ephemeral: true });
  await sendEphemeral(interaction, payload);
}

function createRpsComponentHandler(context) {
  const {
    actions,
    getBotUser,
    reportError,
    rpsRenderer,
    rpsService,
    tokenRepository,
  } = context;

  function botProfile() {
    const user = getBotUser?.();
    return {
      displayName: user?.globalName || user?.username || 'Bot',
      avatarUrl: typeof user?.displayAvatarURL === 'function'
        ? user.displayAvatarURL({ extension: 'png', size: 256 })
        : '',
    };
  }

  function acknowledge(interaction) {
    return acknowledgeUpdate(interaction, { reportError, startedAt: Date.now() });
  }

  async function payloadFor(game) {
    if ([RPS_STATES.CANCELED, RPS_STATES.EXPIRED].includes(game.state)) {
      return canceledPayload(game, { initial: false });
    }
    const image = await rpsRenderer.render(game, { botProfile: botProfile() });
    if (game.state === RPS_STATES.LOBBY) return lobbyPayload(game, image, { initial: false });
    return roundPayload(game, image, { initial: false });
  }

  async function editRendered(interaction, game) {
    if (!await acknowledge(interaction)) return false;
    try {
      await interaction.editReply(await payloadFor(game));
      return true;
    } catch (error) {
      reportError?.(error);
      await interaction.editReply(renderFailurePayload(game, { initial: false }));
      return false;
    }
  }

  function freshGame(gameId) {
    return rpsService.game(gameId);
  }

  async function hostOnly(interaction, game) {
    if (game?.hostUserId === String(interaction.user.id)) return true;
    await ephemeralError(interaction, 'Not your RPS controls', 'Only the table host can use this control.');
    return false;
  }

  async function participantOnly(interaction, game) {
    if (game?.participants.some((participant) => participant.userId === String(interaction.user.id))) return true;
    await ephemeralError(interaction, 'Not at this table', 'Only invited table participants can use this control.');
    return false;
  }

  async function handleExchange(interaction, parts) {
    if (parts[2] !== 'confirm' || !interaction.isButton?.()) return false;
    if (!await acknowledge(interaction)) return true;
    const action = actions.claim(parts[3], interaction.user.id);
    if (!action || action.kind !== 'token-exchange') {
      await ephemeralError(interaction, 'Expired exchange', 'This exchange confirmation is no longer available.');
      return true;
    }
    const result = tokenRepository.exchange(
      interaction.user.id,
      action.tokenAmount,
      `token-exchange:${action.id}`,
    );
    if (result.status !== 'ok') {
      const message = result.status === 'rate-limited'
        ? `Your rolling four-hour allowance has only **${result.remaining}** token value remaining.`
        : `You need **${result.missing?.toLocaleString?.('en-US') || 'more'}** additional Sheckles.`;
      await interaction.editReply(errorPayload(`Exchange unavailable\n${message}`, { initial: false }));
      return true;
    }
    await interaction.editReply(exchangeSuccessPayload(interaction.user.id, result, { initial: false }));
    return true;
  }

  async function modeInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await hostOnly(interaction, game)) return true;
    if (game.state !== RPS_STATES.CHOOSING_MODE) {
      await ephemeralError(interaction, 'Stale RPS controls', 'This game has already moved past mode selection.');
      return true;
    }
    const mode = interaction.values?.[0];
    if (mode === 'bot') await interaction.showModal(rpsBetModal(game.id, 'bot-bet'));
    else if (!await acknowledge(interaction)) return true;
    const selected = rpsService.chooseMode(game.id, interaction.user.id, mode);
    if (selected.status !== 'ok') {
      await ephemeralError(interaction, 'RPS unavailable', 'This game can no longer change mode.');
      return true;
    }
    if (mode !== 'bot') await interaction.editReply(opponentPickerPayload(selected.game, { initial: false }));
    return true;
  }

  async function opponentsInteraction(interaction, game) {
    if (!interaction.isUserSelectMenu?.() || !await hostOnly(interaction, game)) return true;
    if (game.state !== RPS_STATES.CHOOSING_MODE || game.mode !== 'human') {
      await ephemeralError(interaction, 'Stale RPS controls', 'This table can no longer change opponents.');
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
        await ephemeralError(interaction, 'Invalid opponent', 'Bot accounts cannot join a human RPS table.');
        return true;
      }
      const active = rpsService.repository.activeGameForUser(id);
      if (active && active.id !== game.id) {
        await ephemeralError(interaction, 'Opponent is busy', `<@${id}> is already participating in another active RPS game.`);
        return true;
      }
      profiles.push(userProfile(user, collectionGet(interaction.members, id)));
    }
    await interaction.showModal(rpsBetModal(game.id, 'human-bet'));
    const result = rpsService.chooseOpponents(game.id, interaction.user.id, profiles);
    if (result.status !== 'ok') {
      await ephemeralError(interaction, 'RPS unavailable', 'The opponent list could not be saved.');
      return true;
    }
    return true;
  }

  async function betModalInteraction(interaction, game, action) {
    if (!interaction.isModalSubmit?.() || !await hostOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    try {
      result = action === 'human-bet'
        ? rpsService.startHumanLobby(game.id, interaction.user.id, modalText(interaction, 'bet'))
        : action === 'human-replay-bet'
          ? rpsService.replayHuman(game.id, interaction.user.id, modalText(interaction, 'bet'))
          : rpsService.startBotRound(game.id, interaction.user.id, modalText(interaction, 'bet'));
    } catch (error) {
      await ephemeralError(interaction, 'Invalid bet', error.message);
      return true;
    }
    if (result.status !== 'ok') {
      const message = result.status === 'insufficient'
        ? `You need **${result.missing}** more token value.`
        : result.status === 'participant-busy'
          ? `<@${result.userId}> is already at another active table.`
          : 'This game can no longer start.';
      await ephemeralError(interaction, 'RPS unavailable', message);
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function acceptInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.accept(game.id, interaction.user.id);
    if (result.status === 'unauthorized' || result.status === 'stale') {
      await ephemeralError(interaction, 'Stale lobby', 'This lobby is no longer accepting responses.');
      return true;
    }
    if (result.status === 'insufficient') {
      await editRendered(interaction, result.game);
      await interaction.followUp?.(errorPayload(
        `Insufficient token balance\nNo one was charged. Missing funds: ${result.userIds.map((id) => `<@${id}>`).join(', ')}`,
        { ephemeral: true },
      ));
      return true;
    }
    if (['waiting', 'started'].includes(result.status)) await editRendered(interaction, result.game);
    return true;
  }

  async function cancelInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if (![RPS_STATES.CHOOSING_MODE, RPS_STATES.LOBBY].includes(game.state)) {
      await ephemeralError(interaction, 'Stale table', 'A table cannot be canceled after its round starts.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.cancel(game.id);
    await interaction.editReply(canceledPayload(result.game, { initial: false }));
    return true;
  }

  async function declineInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (game.state !== RPS_STATES.LOBBY) {
      await ephemeralError(interaction, 'Stale lobby', 'This table is no longer accepting responses.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.decline(game.id, interaction.user.id);
    if (result.status === 'canceled') {
      await interaction.editReply(canceledPayload(result.game, { initial: false }));
      return true;
    }
    if (result.status !== 'declined') {
      await ephemeralError(interaction, 'Response unavailable', 'You can no longer leave this lobby.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function hostStartInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await hostOnly(interaction, game)) return true;
    if (game.state !== RPS_STATES.LOBBY) {
      await ephemeralError(interaction, 'Stale lobby', 'This round has already started or ended.');
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.hostStart(game.id, interaction.user.id);
    if (result.status === 'not-enough-players') {
      await ephemeralError(interaction, 'Not enough players', 'At least two accepted players are required to start.');
      return true;
    }
    if (result.status === 'insufficient') {
      await interaction.followUp?.(errorPayload(
        `Insufficient token balance\nNo one was charged. Missing funds: ${result.userIds.map((id) => `<@${id}>`).join(', ')}`,
        { ephemeral: true },
      ));
      return true;
    }
    if (result.status !== 'started') {
      await ephemeralError(interaction, 'Start unavailable', 'This lobby can no longer start.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function higherInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    if (game.state !== RPS_STATES.LOBBY) {
      await ephemeralError(interaction, 'Stale lobby', 'This table is no longer accepting higher bets.');
      return true;
    }
    await interaction.showModal(higherBetModal(game.id, game.bet));
    return true;
  }

  async function higherSubmitInteraction(interaction, game) {
    if (!interaction.isModalSubmit?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    let result;
    try {
      result = rpsService.proposeHigherBet(game.id, interaction.user.id, modalText(interaction, 'bet'));
    } catch (error) {
      await ephemeralError(interaction, 'Invalid higher bet', error.message);
      return true;
    }
    if (result.status !== 'ok') {
      const message = result.status === 'not-higher'
        ? `Enter more than the current **${result.currentBet}** token bet.`
        : 'This lobby is no longer accepting higher bets.';
      await ephemeralError(interaction, 'Higher bet rejected', message);
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function pickInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await participantOnly(interaction, game)) return true;
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.commit(game.id, interaction.user.id, interaction.values?.[0]);
    if (!['ok', 'ready'].includes(result.status)) {
      const message = result.status === 'not-turn'
        ? `It is <@${result.currentUserId}>'s turn.`
        : result.status === 'already-chosen'
          ? 'Your card is already committed.'
          : 'This round is no longer accepting cards.';
      await ephemeralError(interaction, 'Card not accepted', message);
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function revealInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    // Acknowledge before the atomic result/payout transition. This prevents a busy
    // database or event loop from consuming Discord's interaction deadline after
    // gameplay state has already changed.
    if (!await acknowledge(interaction)) return true;
    const result = rpsService.reveal(game.id, interaction.user.id);
    if (result.status !== 'ok') {
      await ephemeralError(interaction, 'Result unavailable', 'Every player must commit before the result can be shown.');
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function replayInteraction(interaction, game) {
    if (!interaction.isStringSelectMenu?.() || !await hostOnly(interaction, game)) return true;
    if (!['bot', 'human'].includes(game.mode) || game.state !== RPS_STATES.FINISHED) {
      await ephemeralError(interaction, 'Replay unavailable', 'This replay control is stale.');
      return true;
    }
    const selection = interaction.values?.[0];
    if (selection === 'change') {
      const action = game.mode === 'human' ? 'human-replay-bet' : 'replay-bet';
      await interaction.showModal(rpsBetModal(game.id, action));
      return true;
    }
    if (!await acknowledge(interaction)) return true;
    let result;
    try {
      result = game.mode === 'human'
        ? rpsService.replayHuman(game.id, interaction.user.id, game.bet)
        : rpsService.replay(game.id, interaction.user.id, selection);
    } catch (error) {
      await ephemeralError(interaction, 'Replay bet unavailable', error.message);
      return true;
    }
    if (result.status !== 'ok') {
      const message = result.status === 'insufficient'
        ? `You need **${result.missing}** more token value.`
        : result.status === 'participant-busy'
          ? `<@${result.userId}> is already at another active table.`
          : 'You are already participating in another active game.';
      await ephemeralError(interaction, 'Replay unavailable', message);
      return true;
    }
    await editRendered(interaction, result.game);
    return true;
  }

  async function retryInteraction(interaction, game) {
    if (!interaction.isButton?.() || !await participantOnly(interaction, game)) return true;
    await editRendered(interaction, game);
    return true;
  }

  return async function handleRpsComponent(interaction, parts) {
    if (parts[1] === 'exchange') return handleExchange(interaction, parts);
    if (parts[1] !== 'rps') return false;
    const action = parts[2];
    const gameId = parts[3];
    let game = freshGame(gameId);
    if (!game) {
      await ephemeralError(interaction, 'Unknown RPS game', 'This game no longer exists.');
      return true;
    }
    if (![RPS_STATES.FINISHED, RPS_STATES.CANCELED, RPS_STATES.EXPIRED].includes(game.state)
      && game.expiresAt <= rpsService.now()) {
      if (!await acknowledge(interaction)) return true;
      game = rpsService.repository.expire(gameId, rpsService.now()).game;
    }
    if (game.state === RPS_STATES.EXPIRED) {
      await ephemeralError(interaction, 'RPS game expired', 'Any escrowed tokens were refunded exactly once.');
      return true;
    }
    if (action === 'mode') return modeInteraction(interaction, game);
    if (action === 'opponents') return opponentsInteraction(interaction, game);
    if (['bot-bet', 'human-bet', 'replay-bet', 'human-replay-bet'].includes(action)) {
      return betModalInteraction(interaction, game, action);
    }
    if (action === 'accept') return acceptInteraction(interaction, game);
    if (action === 'decline') return declineInteraction(interaction, game);
    if (action === 'start') return hostStartInteraction(interaction, game);
    if (action === 'cancel') return cancelInteraction(interaction, game);
    if (action === 'higher') return higherInteraction(interaction, game);
    if (action === 'higher-submit') return higherSubmitInteraction(interaction, game);
    if (action === 'pick') return pickInteraction(interaction, game);
    if (action === 'reveal') return revealInteraction(interaction, game);
    if (action === 'replay') return replayInteraction(interaction, game);
    if (action === 'retry') return retryInteraction(interaction, game);
    return false;
  };
}

module.exports = { createRpsComponentHandler, modalText, userProfile };
