const { SQLITE_INTEGER_MAX } = require('./gameRepository');
const {
  ROULETTE_LIMITS,
  ROULETTE_MAX_PLAYERS,
  ROULETTE_STATES,
} = require('../config/roulette');
const { canonicalBet, rouletteColor, totalReturn } = require('../services/rouletteRules');

function participantModel(row) {
  return {
    userId: row.user_id,
    seat: Number(row.seat),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    accepted: Boolean(row.accepted),
    ready: Boolean(row.ready),
    escrowedTotal: row.escrowed_total,
    resultStake: row.result_stake,
    resultReturn: row.result_return,
    resultNet: row.result_net,
  };
}

function betModel(row) {
  return {
    id: String(row.bet_id),
    userId: row.user_id,
    type: row.canonical_type,
    target: row.canonical_target,
    anchorKey: row.anchor_key,
    amount: row.amount,
    state: row.state,
    createdSequence: Number(row.created_sequence),
  };
}

function gameModel(row, participants = [], bets = []) {
  if (!row) return null;
  return {
    id: row.game_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostUserId: row.host_user_id,
    mode: row.mode,
    state: row.state,
    winningNumber: row.winning_number == null ? null : Number(row.winning_number),
    winningColor: row.winning_color,
    spinStartedAt: row.spin_started_at == null ? null : Number(row.spin_started_at),
    revealAt: row.reveal_at == null ? null : Number(row.reveal_at),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
    participants,
    bets,
  };
}

function safeCredit(balance, amount) {
  const next = BigInt(balance) + BigInt(amount);
  if (next > SQLITE_INTEGER_MAX) throw new RangeError('Token balance exceeds the SQLite signed 64-bit range.');
  return next;
}

class RouletteRepository {
  constructor(db, gameRepository) {
    this.db = db;
    this.gameRepository = gameRepository;
    this.statements = {
      game: db.prepare('SELECT * FROM rng_roulette_games WHERE game_id = ?'),
      participants: db.prepare('SELECT * FROM rng_roulette_participants WHERE game_id = ? ORDER BY seat'),
      bets: db.prepare('SELECT * FROM rng_roulette_bets WHERE game_id = ? ORDER BY created_sequence, bet_id'),
      openBets: db.prepare("SELECT * FROM rng_roulette_bets WHERE game_id = ? AND state = 'OPEN' ORDER BY created_sequence, bet_id"),
      active: db.prepare('SELECT game_type, game_id FROM rng_casino_active_players WHERE user_id = ?'),
      insertActive: db.prepare("INSERT INTO rng_casino_active_players (user_id, game_type, game_id) VALUES (?, 'roulette', ?)"),
      deleteActiveGame: db.prepare("DELETE FROM rng_casino_active_players WHERE game_type = 'roulette' AND game_id = ?"),
      deleteActiveUser: db.prepare("DELETE FROM rng_casino_active_players WHERE user_id = ? AND game_type = 'roulette' AND game_id = ?"),
      insertGame: db.prepare(`INSERT INTO rng_roulette_games
        (game_id, guild_id, channel_id, host_user_id, state, created_at, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      insertParticipant: db.prepare(`INSERT INTO rng_roulette_participants
        (game_id, user_id, seat, display_name, avatar_url, accepted)
        VALUES (?, ?, ?, ?, ?, ?)`),
      deleteGuestParticipants: db.prepare('DELETE FROM rng_roulette_participants WHERE game_id = ? AND seat > 0'),
      deleteParticipant: db.prepare('DELETE FROM rng_roulette_participants WHERE game_id = ? AND user_id = ?'),
      setMessage: db.prepare('UPDATE rng_roulette_games SET message_id = ?, updated_at = ? WHERE game_id = ?'),
      setMode: db.prepare(`UPDATE rng_roulette_games SET mode = ?, state = ?, revision = revision + 1,
        expires_at = ?, updated_at = ? WHERE game_id = ?`),
      accept: db.prepare('UPDATE rng_roulette_participants SET accepted = 1 WHERE game_id = ? AND user_id = ? AND accepted = 0'),
      startBetting: db.prepare(`UPDATE rng_roulette_games SET state = ?, revision = revision + 1,
        expires_at = ?, updated_at = ? WHERE game_id = ?`),
      removeWaiting: db.prepare('DELETE FROM rng_roulette_participants WHERE game_id = ? AND accepted = 0'),
      operation: db.prepare('SELECT * FROM rng_roulette_bet_operations WHERE operation_key = ?'),
      bet: db.prepare(`SELECT * FROM rng_roulette_bets WHERE game_id = ? AND user_id = ?
        AND canonical_type = ? AND canonical_target = ?`),
      betById: db.prepare('SELECT * FROM rng_roulette_bets WHERE bet_id = ?'),
      positionCount: db.prepare("SELECT COUNT(*) AS count FROM rng_roulette_bets WHERE game_id = ? AND user_id = ? AND state = 'OPEN'"),
      nextSequence: db.prepare('SELECT COALESCE(MAX(created_sequence), 0) + 1 AS sequence FROM rng_roulette_bets WHERE game_id = ?'),
      insertBet: db.prepare(`INSERT INTO rng_roulette_bets
        (game_id, user_id, canonical_type, canonical_target, anchor_key, amount, created_sequence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      increaseBet: db.prepare('UPDATE rng_roulette_bets SET amount = amount + ?, updated_at = ? WHERE bet_id = ?'),
      reopenBet: db.prepare(`UPDATE rng_roulette_bets SET amount = ?, state = 'OPEN', created_sequence = ?, updated_at = ?
        WHERE bet_id = ?`),
      decreaseBet: db.prepare('UPDATE rng_roulette_bets SET amount = amount - ?, updated_at = ? WHERE bet_id = ?'),
      deleteBet: db.prepare('DELETE FROM rng_roulette_bets WHERE bet_id = ?'),
      insertOperation: db.prepare(`INSERT INTO rng_roulette_bet_operations
        (operation_key, game_id, user_id, bet_id, operation_type, delta_amount, reversed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      lastPlace: db.prepare(`SELECT * FROM rng_roulette_bet_operations
        WHERE game_id = ? AND user_id = ? AND operation_type = 'PLACE' AND reversed = 0
        ORDER BY operation_id DESC LIMIT 1`),
      reverseOperation: db.prepare('UPDATE rng_roulette_bet_operations SET reversed = 1 WHERE operation_id = ? AND reversed = 0'),
      reversePlaces: db.prepare(`UPDATE rng_roulette_bet_operations SET reversed = 1
        WHERE game_id = ? AND user_id = ? AND operation_type = 'PLACE' AND reversed = 0`),
      debit: db.prepare(`UPDATE rng_players SET token_balance = token_balance - ?, updated_at = ?
        WHERE user_id = ? AND token_balance >= ?`),
      setBalance: db.prepare('UPDATE rng_players SET token_balance = ?, updated_at = ? WHERE user_id = ?'),
      participant: db.prepare('SELECT * FROM rng_roulette_participants WHERE game_id = ? AND user_id = ?'),
      updateEscrow: db.prepare(`UPDATE rng_roulette_participants SET escrowed_total = ?, ready = 0
        WHERE game_id = ? AND user_id = ?`),
      setReady: db.prepare('UPDATE rng_roulette_participants SET ready = ? WHERE game_id = ? AND user_id = ?'),
      touch: db.prepare(`UPDATE rng_roulette_games SET revision = revision + 1, expires_at = ?, updated_at = ?
        WHERE game_id = ?`),
      refundUserBets: db.prepare("UPDATE rng_roulette_bets SET state = 'REFUNDED', updated_at = ? WHERE game_id = ? AND user_id = ? AND state = 'OPEN'"),
      settleBets: db.prepare("UPDATE rng_roulette_bets SET state = 'SETTLED', updated_at = ? WHERE game_id = ? AND state = 'OPEN'"),
      beginSpin: db.prepare(`UPDATE rng_roulette_games SET state = ?, winning_number = ?, winning_color = ?,
        spin_started_at = ?, reveal_at = ?, revision = revision + 1, expires_at = ?, updated_at = ?
        WHERE game_id = ? AND state = ?`),
      resetParticipantResults: db.prepare(`UPDATE rng_roulette_participants SET ready = 0, escrowed_total = 0,
        result_stake = 0, result_return = 0, result_net = 0 WHERE game_id = ?`),
      setParticipantResult: db.prepare(`UPDATE rng_roulette_participants SET ready = 0, escrowed_total = 0,
        result_stake = ?, result_return = ?, result_net = ? WHERE game_id = ? AND user_id = ?`),
      finishSpin: db.prepare(`UPDATE rng_roulette_games SET state = ?, revision = revision + 1,
        expires_at = ?, updated_at = ? WHERE game_id = ? AND state = ?`),
      terminal: db.prepare(`UPDATE rng_roulette_games SET state = ?, revision = revision + 1,
        expires_at = ?, updated_at = ? WHERE game_id = ?`),
      replay: db.prepare(`UPDATE rng_roulette_games SET state = ?, winning_number = NULL, winning_color = NULL,
        spin_started_at = NULL, reveal_at = NULL, revision = revision + 1, expires_at = ?, updated_at = ?
        WHERE game_id = ?`),
      deleteBets: db.prepare('DELETE FROM rng_roulette_bets WHERE game_id = ?'),
      due: db.prepare(`SELECT game_id FROM rng_roulette_games
        WHERE state NOT IN ('SPINNING', 'FINISHED', 'CANCELED', 'EXPIRED')
        AND expires_at <= ? ORDER BY expires_at LIMIT ?`),
      spinning: db.prepare(`SELECT game_id FROM rng_roulette_games
        WHERE state = 'SPINNING' ORDER BY reveal_at, game_id LIMIT ?`),
    };

    this.createTransaction = db.transaction((id, guildId, channelId, profile, now, expiresAt) => {
      this.gameRepository.ensurePlayer(profile.userId, now);
      const active = this.statements.active.get(profile.userId);
      if (active) return { status: 'already-active', gameId: active.game_id, gameType: active.game_type };
      this.statements.insertGame.run(id, guildId, channelId, profile.userId, ROULETTE_STATES.BETTING, BigInt(now), BigInt(expiresAt), BigInt(now));
      this.statements.insertParticipant.run(id, profile.userId, 0n, profile.displayName, profile.avatarUrl, 1n);
      this.statements.insertActive.run(profile.userId, id);
      return { status: 'ok' };
    }).immediate;

    this.joinTransaction = db.transaction((gameId, profile, now, expiresAt) => {
      if (profile.bot === true) return { status: 'bot' };
      this.gameRepository.ensurePlayer(profile.userId, now);
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING || game.expiresAt <= now) return { status: 'stale' };
      if (game.participants.some((participant) => participant.userId === profile.userId)) return { status: 'already-joined' };
      if (game.participants.length >= ROULETTE_MAX_PLAYERS) return { status: 'full' };
      const active = this.statements.active.get(profile.userId);
      if (active) return { status: 'participant-busy', gameId: active.game_id, gameType: active.game_type };
      const occupied = new Set(game.participants.map((participant) => participant.seat));
      const seat = Array.from({ length: ROULETTE_MAX_PLAYERS }, (_, index) => index).find((index) => !occupied.has(index));
      if (seat === undefined) return { status: 'full' };
      this.statements.insertParticipant.run(gameId, profile.userId, BigInt(seat), profile.displayName, profile.avatarUrl, 1n);
      this.statements.insertActive.run(profile.userId, gameId);
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', seat };
    }).immediate;

    this.chooseModeTransaction = db.transaction((gameId, hostUserId, mode, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.state !== ROULETTE_STATES.CHOOSING_MODE || !['bot', 'human'].includes(mode)) return { status: 'stale' };
      const state = mode === 'bot' ? ROULETTE_STATES.BETTING : ROULETTE_STATES.CHOOSING_OPPONENTS;
      this.statements.setMode.run(mode, state, BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok' };
    }).immediate;

    this.inviteTransaction = db.transaction((gameId, hostUserId, profiles, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.mode !== 'human' || game.state !== ROULETTE_STATES.CHOOSING_OPPONENTS) return { status: 'stale' };
      const profileIds = profiles.map((profile) => String(profile.userId));
      if (profiles.length < 1 || profiles.length > 3 || new Set(profileIds).size !== profileIds.length
        || profileIds.includes(hostUserId) || profiles.some((profile) => profile.bot === true)) {
        return { status: 'invalid-participants' };
      }
      for (const profile of profiles) {
        this.gameRepository.ensurePlayer(profile.userId, now);
        const active = this.statements.active.get(profile.userId);
        if (active && active.game_id !== gameId) return { status: 'participant-busy', userId: profile.userId, gameType: active.game_type };
      }
      this.statements.deleteGuestParticipants.run(gameId);
      profiles.forEach((profile, index) => {
        this.statements.insertParticipant.run(gameId, profile.userId, BigInt(index + 1), profile.displayName, profile.avatarUrl, 0n);
        this.statements.insertActive.run(profile.userId, gameId);
      });
      this.statements.startBetting.run(ROULETTE_STATES.LOBBY, BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok' };
    }).immediate;

    this.declineTransaction = db.transaction((gameId, userId, now) => {
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.LOBBY || game.hostUserId === userId || !game.participants.some((entry) => entry.userId === userId)) return { status: 'unauthorized' };
      this.statements.deleteActiveUser.run(userId, gameId);
      this.statements.deleteParticipant.run(gameId, userId);
      if (this.participants(gameId).length < 2) {
        this.statements.terminal.run(ROULETTE_STATES.CANCELED, BigInt(now), BigInt(now), gameId);
        this.statements.deleteActiveGame.run(gameId);
        return { status: 'canceled' };
      }
      this.statements.touch.run(BigInt(game.expiresAt), BigInt(now), gameId);
      return { status: 'declined' };
    }).immediate;

    this.startTransaction = db.transaction((gameId, hostUserId, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.state !== ROULETTE_STATES.LOBBY) return { status: 'stale' };
      const accepted = game.participants.filter((participant) => participant.accepted);
      if (accepted.length < 2) return { status: 'not-enough-players' };
      for (const waiting of game.participants.filter((participant) => !participant.accepted)) this.statements.deleteActiveUser.run(waiting.userId, gameId);
      this.statements.removeWaiting.run(gameId);
      this.statements.startBetting.run(ROULETTE_STATES.BETTING, BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'started' };
    }).immediate;

    this.placeTransaction = db.transaction((gameId, userId, type, target, amount, operationKey, now, expiresAt) => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'PLACE'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING) return { status: 'stale', duplicate: false };
      const participant = this.statements.participant.get(gameId, userId);
      if (!participant || !participant.accepted) return { status: 'unauthorized', duplicate: false };
      const canonical = canonicalBet(type, target);
      const stake = BigInt(amount);
      if (stake < ROULETTE_LIMITS.minimumBet || stake > ROULETTE_LIMITS.maximumBet) return { status: 'invalid-amount', duplicate: false };
      const existing = this.statements.bet.get(gameId, userId, canonical.type, canonical.target);
      if (!existing && Number(this.statements.positionCount.get(gameId, userId).count) >= ROULETTE_LIMITS.maximumPositions) return { status: 'position-limit', duplicate: false };
      if (participant.escrowed_total + stake > ROULETTE_LIMITS.maximumTotal) return { status: 'total-limit', duplicate: false };
      const player = this.gameRepository.ensurePlayer(userId, now);
      if (player.tokenBalance < stake) return { status: 'insufficient', missing: stake - player.tokenBalance, duplicate: false };
      const debit = this.statements.debit.run(stake, BigInt(now), userId, stake);
      if (Number(debit.changes) !== 1) return { status: 'insufficient', missing: stake, duplicate: false };
      let betId;
      if (existing?.state === 'OPEN') {
        this.statements.increaseBet.run(stake, BigInt(now), existing.bet_id);
        betId = existing.bet_id;
      } else if (existing) {
        const sequence = this.statements.nextSequence.get(gameId).sequence;
        this.statements.reopenBet.run(stake, sequence, BigInt(now), existing.bet_id);
        betId = existing.bet_id;
      } else {
        const sequence = this.statements.nextSequence.get(gameId).sequence;
        betId = this.statements.insertBet.run(gameId, userId, canonical.type, canonical.target, canonical.anchorKey, stake, sequence, BigInt(now), BigInt(now)).lastInsertRowid;
      }
      this.statements.insertOperation.run(operationKey, gameId, userId, betId, 'PLACE', stake, 0n, BigInt(now));
      this.statements.updateEscrow.run(participant.escrowed_total + stake, gameId, userId);
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', duplicate: false, betId: String(betId) };
    }).immediate;

    this.undoTransaction = db.transaction((gameId, userId, operationKey, now, expiresAt) => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'UNDO'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING) return { status: 'stale', duplicate: false };
      const participant = this.statements.participant.get(gameId, userId);
      if (!participant) return { status: 'unauthorized', duplicate: false };
      const operation = this.statements.lastPlace.get(gameId, userId);
      if (!operation) return { status: 'empty', duplicate: false };
      const bet = this.statements.betById.get(operation.bet_id);
      if (!bet || bet.state !== 'OPEN' || bet.amount < operation.delta_amount) throw new Error('Roulette bet history is inconsistent.');
      const player = this.gameRepository.ensurePlayer(userId, now);
      this.statements.setBalance.run(safeCredit(player.tokenBalance, operation.delta_amount), BigInt(now), userId);
      if (bet.amount === operation.delta_amount) this.statements.deleteBet.run(bet.bet_id);
      else this.statements.decreaseBet.run(operation.delta_amount, BigInt(now), bet.bet_id);
      this.statements.reverseOperation.run(operation.operation_id);
      this.statements.insertOperation.run(operationKey, gameId, userId, null, 'UNDO', operation.delta_amount, 0n, BigInt(now));
      this.statements.updateEscrow.run(participant.escrowed_total - operation.delta_amount, gameId, userId);
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', amount: operation.delta_amount, duplicate: false };
    }).immediate;

    this.clearTransaction = db.transaction((gameId, userId, operationKey, now, expiresAt) => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'CLEAR'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING) return { status: 'stale', duplicate: false };
      const participant = this.statements.participant.get(gameId, userId);
      if (!participant) return { status: 'unauthorized', duplicate: false };
      const refund = participant.escrowed_total;
      if (refund > 0n) {
        const player = this.gameRepository.ensurePlayer(userId, now);
        this.statements.setBalance.run(safeCredit(player.tokenBalance, refund), BigInt(now), userId);
        this.statements.refundUserBets.run(BigInt(now), gameId, userId);
        this.statements.reversePlaces.run(gameId, userId);
      }
      this.statements.insertOperation.run(operationKey, gameId, userId, null, 'CLEAR', refund, 0n, BigInt(now));
      this.statements.updateEscrow.run(0n, gameId, userId);
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', amount: refund, duplicate: false };
    }).immediate;

    this.readyTransaction = db.transaction((gameId, userId, ready, operationKey, now, expiresAt) => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'READY'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING) return { status: 'stale' };
      const participant = this.statements.participant.get(gameId, userId);
      if (!participant) return { status: 'unauthorized' };
      if (ready && participant.escrowed_total < 1n) return { status: 'no-bets' };
      this.statements.setReady.run(ready ? 1n : 0n, gameId, userId);
      this.statements.insertOperation.run(operationKey, gameId, userId, null, 'READY', 0n, 0n, BigInt(now));
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;

    this.toggleReadyTransaction = db.transaction((gameId, userId, operationKey, now, expiresAt) => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'READY'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING) return { status: 'stale', duplicate: false };
      const participant = this.statements.participant.get(gameId, userId);
      if (!participant || !participant.accepted) return { status: 'unauthorized', duplicate: false };
      const ready = !Boolean(participant.ready);
      if (ready && participant.escrowed_total < 1n) return { status: 'no-bets', duplicate: false };
      this.statements.setReady.run(ready ? 1n : 0n, gameId, userId);
      this.statements.insertOperation.run(operationKey, gameId, userId, null, 'READY', 0n, 0n, BigInt(now));
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', ready, duplicate: false };
    }).immediate;

    this.beginSpinTransaction = db.transaction((gameId, hostUserId, chooseResult, now, revealAt) => {
      const game = this.game(gameId);
      if (!game) return { status: 'missing' };
      if (game.hostUserId !== hostUserId) return { status: 'unauthorized', duplicate: false };
      if ([ROULETTE_STATES.SPINNING, ROULETTE_STATES.FINISHED].includes(game.state)) return { status: 'ok', duplicate: true };
      if (game.state !== ROULETTE_STATES.BETTING) return { status: 'stale', duplicate: false };
      const openBettors = new Set(game.bets.filter((bet) => bet.state === 'OPEN' && bet.amount > 0n).map((bet) => bet.userId));
      if (!openBettors.size) return { status: 'no-wagers', duplicate: false };
      const bettors = game.participants.filter((participant) => participant.escrowedTotal > 0n);
      if (bettors.some((participant) => !participant.ready || !openBettors.has(participant.userId))) {
        return { status: 'not-ready', duplicate: false };
      }
      const result = Number(chooseResult());
      if (!Number.isInteger(result) || result < 0 || result > 36) throw new RangeError('Roulette RNG must return an integer from 0 to 36.');
      const spinning = this.statements.beginSpin.run(
        ROULETTE_STATES.SPINNING,
        BigInt(result),
        rouletteColor(result),
        BigInt(now),
        BigInt(revealAt),
        BigInt(revealAt),
        BigInt(now),
        gameId,
        ROULETTE_STATES.BETTING,
      );
      if (Number(spinning.changes) !== 1) return { status: 'stale', duplicate: false };
      return { status: 'ok', duplicate: false };
    }).immediate;

    this.finishSpinTransaction = db.transaction((gameId, now) => {
      const game = this.game(gameId);
      if (!game) return { status: 'missing' };
      if (game.state === ROULETTE_STATES.FINISHED) return { status: 'ok', duplicate: true };
      if (game.state !== ROULETTE_STATES.SPINNING) return { status: 'stale', duplicate: false };
      if (game.revealAt == null || now < game.revealAt) return { status: 'not-due', duplicate: false };
      const result = game.winningNumber;
      if (!Number.isInteger(result) || result < 0 || result > 36) throw new Error('Persisted Roulette spin is missing its winning number.');
      const returns = new Map(game.participants.map((participant) => [participant.userId, 0n]));
      for (const bet of game.bets.filter((entry) => entry.state === 'OPEN')) returns.set(bet.userId, returns.get(bet.userId) + totalReturn(bet, result));
      for (const participant of game.participants) {
        const returned = returns.get(participant.userId) || 0n;
        const player = this.gameRepository.ensurePlayer(participant.userId, now);
        if (returned) this.statements.setBalance.run(safeCredit(player.tokenBalance, returned), BigInt(now), participant.userId);
        this.statements.setParticipantResult.run(participant.escrowedTotal, returned, returned - participant.escrowedTotal, gameId, participant.userId);
      }
      this.statements.settleBets.run(BigInt(now), gameId);
      const finished = this.statements.finishSpin.run(
        ROULETTE_STATES.FINISHED,
        BigInt(now),
        BigInt(now),
        gameId,
        ROULETTE_STATES.SPINNING,
      );
      if (Number(finished.changes) !== 1) throw new Error('Roulette spin changed state during settlement.');
      this.statements.deleteActiveGame.run(gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;
  }

  participants(gameId) { return this.statements.participants.all(String(gameId)).map(participantModel); }
  bets(gameId) { return this.statements.bets.all(String(gameId)).map(betModel); }
  game(gameId) {
    const row = this.statements.game.get(String(gameId));
    return gameModel(row, row ? this.participants(gameId) : [], row ? this.bets(gameId) : []);
  }
  activeGameForUser(userId) {
    const row = this.statements.active.get(String(userId));
    if (!row) return null;
    return row.game_type === 'roulette' ? this.game(row.game_id) : { id: row.game_id, gameType: row.game_type };
  }
  create(id, guildId, channelId, profile, now, expiresAt) {
    const result = this.createTransaction(String(id), String(guildId || ''), String(channelId || ''), profile, now, expiresAt);
    return { ...result, game: result.status === 'ok' ? this.game(id) : null };
  }
  join(gameId, profile, now, expiresAt) {
    const normalized = {
      userId: String(profile.userId),
      displayName: String(profile.displayName || 'Player'),
      avatarUrl: String(profile.avatarUrl || ''),
      bot: profile.bot === true,
    };
    const result = this.joinTransaction(String(gameId), normalized, now, expiresAt);
    return { ...result, game: this.game(gameId) };
  }
  setMessage(gameId, messageId, now) { this.statements.setMessage.run(String(messageId), BigInt(now), String(gameId)); return this.game(gameId); }
  chooseMode(gameId, hostUserId, mode, now, expiresAt) { const result = this.chooseModeTransaction(String(gameId), String(hostUserId), String(mode), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  invite(gameId, hostUserId, profiles, now, expiresAt) { const result = this.inviteTransaction(String(gameId), String(hostUserId), profiles, now, expiresAt); return { ...result, game: this.game(gameId) }; }
  accept(gameId, userId, now) {
    const game = this.game(gameId);
    if (!game || game.state !== ROULETTE_STATES.LOBBY || !game.participants.some((entry) => entry.userId === String(userId))) return { status: 'unauthorized', game };
    const accepted = this.statements.accept.run(String(gameId), String(userId));
    if (Number(accepted.changes) === 0) return { status: 'ok', duplicate: true, game };
    this.statements.touch.run(BigInt(game.expiresAt), BigInt(now), String(gameId));
    return { status: 'ok', duplicate: false, game: this.game(gameId) };
  }
  decline(gameId, userId, now) { const result = this.declineTransaction(String(gameId), String(userId), now); return { ...result, game: this.game(gameId) }; }
  start(gameId, hostUserId, now, expiresAt) { const result = this.startTransaction(String(gameId), String(hostUserId), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  place(gameId, userId, type, target, amount, operationKey, now, expiresAt) { const result = this.placeTransaction(String(gameId), String(userId), type, target, BigInt(amount), String(operationKey), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  undo(gameId, userId, operationKey, now, expiresAt) { const result = this.undoTransaction(String(gameId), String(userId), String(operationKey), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  clear(gameId, userId, operationKey, now, expiresAt) { const result = this.clearTransaction(String(gameId), String(userId), String(operationKey), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  ready(gameId, userId, ready, operationKey, now, expiresAt) { const result = this.readyTransaction(String(gameId), String(userId), Boolean(ready), String(operationKey), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  toggleReady(gameId, userId, operationKey, now, expiresAt) { const result = this.toggleReadyTransaction(String(gameId), String(userId), String(operationKey), now, expiresAt); return { ...result, game: this.game(gameId) }; }
  beginSpin(gameId, hostUserId, chooseResult, now, revealAt) { const result = this.beginSpinTransaction(String(gameId), String(hostUserId), chooseResult, now, revealAt); return { ...result, game: this.game(gameId) }; }
  finishSpin(gameId, now) { const result = this.finishSpinTransaction(String(gameId), now); return { ...result, game: this.game(gameId) }; }

  refundAll(gameId, state, now) {
    const transaction = this.db.transaction(() => {
      const game = this.game(gameId);
      if (!game) return { status: 'missing' };
      if ([ROULETTE_STATES.FINISHED, ROULETTE_STATES.CANCELED, ROULETTE_STATES.EXPIRED].includes(game.state)) return { status: 'ok', duplicate: true };
      if (game.state === ROULETTE_STATES.SPINNING) return { status: 'stale', duplicate: false };
      for (const participant of game.participants) {
        if (participant.escrowedTotal > 0n) {
          const player = this.gameRepository.ensurePlayer(participant.userId, now);
          this.statements.setBalance.run(safeCredit(player.tokenBalance, participant.escrowedTotal), BigInt(now), participant.userId);
          this.statements.refundUserBets.run(BigInt(now), gameId, participant.userId);
          this.statements.reversePlaces.run(gameId, participant.userId);
          this.statements.updateEscrow.run(0n, gameId, participant.userId);
        }
      }
      this.statements.terminal.run(state, BigInt(now), BigInt(now), gameId);
      this.statements.deleteActiveGame.run(gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;
    const result = transaction();
    return { ...result, game: this.game(gameId) };
  }

  leave(gameId, userId, operationKey, now, expiresAt) {
    const transaction = this.db.transaction(() => {
      const prior = this.statements.operation.get(operationKey);
      if (prior) return prior.game_id === gameId && prior.user_id === userId && prior.operation_type === 'LEAVE'
        ? { status: 'ok', duplicate: true }
        : { status: 'operation-conflict', duplicate: true };
      const game = this.game(gameId);
      if (!game || game.state !== ROULETTE_STATES.BETTING || game.mode !== 'human') return { status: 'stale', duplicate: false };
      const participant = game.participants.find((entry) => entry.userId === userId);
      if (!participant) return { status: 'unauthorized', duplicate: false };
      if (game.hostUserId === userId) {
        this.statements.insertOperation.run(operationKey, gameId, userId, null, 'LEAVE', participant.escrowedTotal, 0n, BigInt(now));
        for (const member of game.participants) {
          if (member.escrowedTotal < 1n) continue;
          const player = this.gameRepository.ensurePlayer(member.userId, now);
          this.statements.setBalance.run(safeCredit(player.tokenBalance, member.escrowedTotal), BigInt(now), member.userId);
          this.statements.refundUserBets.run(BigInt(now), gameId, member.userId);
          this.statements.reversePlaces.run(gameId, member.userId);
          this.statements.updateEscrow.run(0n, gameId, member.userId);
        }
        this.statements.terminal.run(ROULETTE_STATES.CANCELED, BigInt(now), BigInt(now), gameId);
        this.statements.deleteActiveGame.run(gameId);
        return { status: 'canceled', duplicate: false };
      }
      if (participant.escrowedTotal > 0n) {
        const player = this.gameRepository.ensurePlayer(userId, now);
        this.statements.setBalance.run(safeCredit(player.tokenBalance, participant.escrowedTotal), BigInt(now), userId);
        this.statements.refundUserBets.run(BigInt(now), gameId, userId);
        this.statements.reversePlaces.run(gameId, userId);
      }
      this.statements.insertOperation.run(operationKey, gameId, userId, null, 'LEAVE', participant.escrowedTotal, 0n, BigInt(now));
      this.statements.deleteActiveUser.run(userId, gameId);
      this.statements.deleteParticipant.run(gameId, userId);
      const remaining = this.participants(gameId);
      if (remaining.length < 2) {
        for (const member of remaining) {
          if (member.escrowedTotal < 1n) continue;
          const player = this.gameRepository.ensurePlayer(member.userId, now);
          this.statements.setBalance.run(safeCredit(player.tokenBalance, member.escrowedTotal), BigInt(now), member.userId);
          this.statements.refundUserBets.run(BigInt(now), gameId, member.userId);
          this.statements.reversePlaces.run(gameId, member.userId);
          this.statements.updateEscrow.run(0n, gameId, member.userId);
        }
        this.statements.terminal.run(ROULETTE_STATES.CANCELED, BigInt(now), BigInt(now), gameId);
        this.statements.deleteActiveGame.run(gameId);
        return { status: 'canceled', duplicate: false };
      }
      this.statements.touch.run(BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;
    const result = transaction();
    return { ...result, game: this.game(gameId) };
  }

  replay(gameId, hostUserId, now, expiresAt) {
    const transaction = this.db.transaction(() => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.state !== ROULETTE_STATES.FINISHED) return { status: 'stale' };
      for (const participant of game.participants) {
        const active = this.statements.active.get(participant.userId);
        if (active && active.game_id !== gameId) return { status: 'participant-busy', userId: participant.userId, gameType: active.game_type };
      }
      for (const participant of game.participants) if (!this.statements.active.get(participant.userId)) this.statements.insertActive.run(participant.userId, gameId);
      this.statements.deleteBets.run(gameId);
      this.statements.resetParticipantResults.run(gameId);
      this.statements.replay.run(ROULETTE_STATES.BETTING, BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok' };
    }).immediate;
    const result = transaction();
    return { ...result, game: this.game(gameId) };
  }

  due(now, limit = 100) { return this.statements.due.all(BigInt(now), BigInt(limit)).map((row) => row.game_id); }
  spinning(limit = 100) { return this.statements.spinning.all(BigInt(limit)).map((row) => this.game(row.game_id)); }
}

module.exports = { RouletteRepository, betModel, gameModel, participantModel, safeCredit };
