const { RPS_STATES } = require('../config/rps');
const { MAX_BET, MIN_BET, resolveRps, validMove } = require('../services/rpsRules');
const { SQLITE_INTEGER_MAX } = require('./gameRepository');

const TERMINAL_STATES = new Set([RPS_STATES.FINISHED, RPS_STATES.CANCELED, RPS_STATES.EXPIRED]);

function participantModel(row) {
  return {
    userId: row.user_id,
    seat: Number(row.seat),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    accepted: Boolean(row.accepted),
    choice: row.choice || null,
    stakeDebited: Boolean(row.stake_debited),
    resultStatus: row.result_status || null,
  };
}

function gameModel(row, participants = []) {
  if (!row) return null;
  return {
    id: row.game_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostUserId: row.host_user_id,
    mode: row.mode || null,
    state: row.state,
    bet: row.bet,
    botChoice: row.bot_choice || null,
    currentTurn: Number(row.current_turn),
    escrowedTokens: row.escrowed_tokens,
    resultType: row.result_type || null,
    winnerUserId: row.winner_user_id || null,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    updatedAt: Number(row.updated_at),
    participants,
  };
}

function normalizedProfile(profile, seat) {
  return {
    userId: String(profile.userId),
    seat,
    displayName: String(profile.displayName || 'Player').replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) || 'Player',
    avatarUrl: String(profile.avatarUrl || '').slice(0, 2_000),
  };
}

class RpsRepository {
  constructor(db, gameRepository) {
    this.db = db;
    this.gameRepository = gameRepository;
    this.statements = {
      game: db.prepare('SELECT * FROM rng_rps_games WHERE game_id = ?'),
      participants: db.prepare('SELECT * FROM rng_rps_participants WHERE game_id = ? ORDER BY seat'),
      participant: db.prepare('SELECT * FROM rng_rps_participants WHERE game_id = ? AND user_id = ?'),
      active: db.prepare('SELECT game_id FROM rng_rps_active_players WHERE user_id = ?'),
      insertGame: db.prepare(`INSERT INTO rng_rps_games
        (game_id, guild_id, channel_id, host_user_id, state, created_at, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      insertParticipant: db.prepare(`INSERT INTO rng_rps_participants
        (game_id, user_id, seat, display_name, avatar_url) VALUES (?, ?, ?, ?, ?)`),
      insertActive: db.prepare('INSERT INTO rng_rps_active_players (user_id, game_id) VALUES (?, ?)'),
      deleteActiveForGame: db.prepare('DELETE FROM rng_rps_active_players WHERE game_id = ?'),
      deleteInvites: db.prepare('DELETE FROM rng_rps_participants WHERE game_id = ? AND seat > 0'),
      setMode: db.prepare('UPDATE rng_rps_games SET mode = ?, updated_at = ? WHERE game_id = ?'),
      setMessage: db.prepare('UPDATE rng_rps_games SET message_id = ?, updated_at = ? WHERE game_id = ?'),
      startLobby: db.prepare(`UPDATE rng_rps_games SET state = ?, bet = ?, current_turn = 0,
        result_type = NULL, winner_user_id = NULL, expires_at = ?, updated_at = ? WHERE game_id = ?`),
      resetAcceptances: db.prepare('UPDATE rng_rps_participants SET accepted = 0 WHERE game_id = ?'),
      accept: db.prepare('UPDATE rng_rps_participants SET accepted = 1 WHERE game_id = ? AND user_id = ?'),
      debitPlayer: db.prepare(`UPDATE rng_players SET token_balance = token_balance - ?, updated_at = ?
        WHERE user_id = ? AND token_balance >= ?`),
      creditPlayer: db.prepare('UPDATE rng_players SET token_balance = token_balance + ?, updated_at = ? WHERE user_id = ?'),
      markDebited: db.prepare('UPDATE rng_rps_participants SET stake_debited = 1 WHERE game_id = ? AND user_id = ?'),
      clearRoundParticipants: db.prepare(`UPDATE rng_rps_participants SET accepted = 0, choice = NULL,
        stake_debited = 0, result_status = NULL WHERE game_id = ?`),
      startRound: db.prepare(`UPDATE rng_rps_games SET mode = ?, state = ?, bet = ?, bot_choice = ?,
        current_turn = 0, escrowed_tokens = ?, result_type = NULL, winner_user_id = NULL,
        expires_at = ?, updated_at = ? WHERE game_id = ?`),
      startHumanRound: db.prepare(`UPDATE rng_rps_games SET state = ?, current_turn = 0,
        escrowed_tokens = ?, expires_at = ?, updated_at = ? WHERE game_id = ?`),
      setHigherBet: db.prepare('UPDATE rng_rps_games SET bet = ?, expires_at = ?, updated_at = ? WHERE game_id = ?'),
      commitChoice: db.prepare('UPDATE rng_rps_participants SET choice = ? WHERE game_id = ? AND user_id = ? AND choice IS NULL'),
      advanceTurn: db.prepare('UPDATE rng_rps_games SET state = ?, current_turn = ?, expires_at = ?, updated_at = ? WHERE game_id = ?'),
      setResultStatus: db.prepare('UPDATE rng_rps_participants SET result_status = ? WHERE game_id = ? AND user_id = ?'),
      finish: db.prepare(`UPDATE rng_rps_games SET state = ?, escrowed_tokens = 0, result_type = ?,
        winner_user_id = ?, expires_at = ?, updated_at = ? WHERE game_id = ?`),
      clearDebits: db.prepare('UPDATE rng_rps_participants SET stake_debited = 0 WHERE game_id = ?'),
      dueGames: db.prepare(`SELECT game_id FROM rng_rps_games
        WHERE state IN ('CHOOSING_MODE', 'LOBBY', 'IN_PROGRESS', 'READY_TO_REVEAL') AND expires_at <= ?
        ORDER BY expires_at, game_id`),
    };

    this.createTransaction = db.transaction((gameId, guildId, channelId, profile, now, expiresAt) => {
      this.gameRepository.ensurePlayer(profile.userId, now);
      const active = this.statements.active.get(profile.userId);
      if (active) return { status: 'already-active', gameId: active.game_id };
      this.statements.insertGame.run(
        gameId, guildId, channelId, profile.userId, RPS_STATES.CHOOSING_MODE,
        BigInt(now), BigInt(expiresAt), BigInt(now),
      );
      this.statements.insertParticipant.run(gameId, profile.userId, 0n, profile.displayName, profile.avatarUrl);
      this.statements.insertActive.run(profile.userId, gameId);
      return { status: 'ok' };
    }).immediate;

    this.setInvitesTransaction = db.transaction((gameId, hostUserId, profiles, now) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.state !== RPS_STATES.CHOOSING_MODE) return { status: 'stale' };
      this.statements.setMode.run('human', BigInt(now), gameId);
      this.statements.deleteInvites.run(gameId);
      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        this.gameRepository.ensurePlayer(profile.userId, now);
        this.statements.insertParticipant.run(gameId, profile.userId, BigInt(index + 1), profile.displayName, profile.avatarUrl);
      }
      return { status: 'ok' };
    }).immediate;

    this.startLobbyTransaction = db.transaction((gameId, hostUserId, bet, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || game.mode !== 'human' || game.state !== RPS_STATES.CHOOSING_MODE) {
        return { status: 'stale' };
      }
      if (game.participants.length < 2 || game.participants.length > 4) return { status: 'invalid-participants' };
      for (const participant of game.participants) {
        const active = this.statements.active.get(participant.userId);
        if (active && active.game_id !== gameId) return { status: 'participant-busy', userId: participant.userId };
      }
      for (const participant of game.participants) {
        if (!this.statements.active.get(participant.userId)) this.statements.insertActive.run(participant.userId, gameId);
      }
      this.statements.resetAcceptances.run(gameId);
      this.statements.startLobby.run(RPS_STATES.LOBBY, bet, BigInt(expiresAt), BigInt(now), gameId);
      return { status: 'ok' };
    }).immediate;

    this.startBotRoundTransaction = db.transaction((gameId, hostUserId, bet, botChoice, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.hostUserId !== hostUserId || ![RPS_STATES.CHOOSING_MODE, RPS_STATES.FINISHED].includes(game.state)) {
        return { status: 'stale' };
      }
      const active = this.statements.active.get(hostUserId);
      if (active && active.game_id !== gameId) return { status: 'already-active', gameId: active.game_id };
      const player = this.gameRepository.ensurePlayer(hostUserId, now);
      if (player.tokenBalance < bet) {
        return { status: 'insufficient', missing: bet - player.tokenBalance, tokenBalance: player.tokenBalance };
      }
      if (!active) this.statements.insertActive.run(hostUserId, gameId);
      const debit = this.statements.debitPlayer.run(bet, BigInt(now), hostUserId, bet);
      if (Number(debit.changes) !== 1) return { status: 'insufficient', missing: bet, tokenBalance: 0n };
      this.statements.clearRoundParticipants.run(gameId);
      this.statements.markDebited.run(gameId, hostUserId);
      this.statements.startRound.run(
        'bot', RPS_STATES.IN_PROGRESS, bet, botChoice, bet,
        BigInt(expiresAt), BigInt(now), gameId,
      );
      return { status: 'ok' };
    }).immediate;

    this.acceptTransaction = db.transaction((gameId, userId, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.mode !== 'human' || game.state !== RPS_STATES.LOBBY) return { status: 'stale' };
      if (!game.participants.some((participant) => participant.userId === userId)) return { status: 'unauthorized' };
      this.statements.accept.run(gameId, userId);
      const participants = this.participants(gameId);
      if (!participants.every((participant) => participant.accepted)) return { status: 'waiting' };
      const insufficient = participants.filter((participant) => (
        this.gameRepository.getPlayer(participant.userId, now).tokenBalance < game.bet
      ));
      if (insufficient.length) return { status: 'insufficient', userIds: insufficient.map((entry) => entry.userId) };
      for (const participant of participants) {
        const debit = this.statements.debitPlayer.run(game.bet, BigInt(now), participant.userId, game.bet);
        if (Number(debit.changes) !== 1) throw new Error('RPS participant balance changed during atomic escrow.');
        this.statements.markDebited.run(gameId, participant.userId);
      }
      this.statements.startHumanRound.run(
        RPS_STATES.IN_PROGRESS,
        game.bet * BigInt(participants.length),
        BigInt(expiresAt),
        BigInt(now),
        gameId,
      );
      return { status: 'started' };
    }).immediate;

    this.higherBetTransaction = db.transaction((gameId, userId, bet, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.mode !== 'human' || game.state !== RPS_STATES.LOBBY) return { status: 'stale' };
      if (!game.participants.some((participant) => participant.userId === userId)) return { status: 'unauthorized' };
      if (bet <= game.bet) return { status: 'not-higher', currentBet: game.bet };
      this.statements.setHigherBet.run(bet, BigInt(expiresAt), BigInt(now), gameId);
      this.statements.resetAcceptances.run(gameId);
      return { status: 'ok' };
    }).immediate;

    this.commitTransaction = db.transaction((gameId, userId, choice, now, expiresAt) => {
      const game = this.game(gameId);
      if (!game || game.state !== RPS_STATES.IN_PROGRESS) return { status: 'stale' };
      const participant = game.participants.find((entry) => entry.userId === userId);
      if (!participant) return { status: 'unauthorized' };
      const current = game.participants[game.currentTurn];
      if (!current || current.userId !== userId) return { status: 'not-turn', currentUserId: current?.userId || null };
      if (participant.choice) return { status: 'already-chosen' };
      const changed = this.statements.commitChoice.run(choice, gameId, userId);
      if (Number(changed.changes) !== 1) return { status: 'already-chosen' };
      const nextTurn = game.currentTurn + 1;
      const state = nextTurn >= game.participants.length ? RPS_STATES.READY_TO_REVEAL : RPS_STATES.IN_PROGRESS;
      this.statements.advanceTurn.run(state, BigInt(nextTurn), BigInt(expiresAt), BigInt(now), gameId);
      return { status: state === RPS_STATES.READY_TO_REVEAL ? 'ready' : 'ok' };
    }).immediate;

    this.finishTransaction = db.transaction((gameId, userId, now) => {
      const game = this.game(gameId);
      if (!game) return { status: 'missing' };
      if (game.state === RPS_STATES.FINISHED) return { status: 'ok', duplicate: true };
      if (game.state !== RPS_STATES.READY_TO_REVEAL) return { status: 'stale' };
      if (!game.participants.some((participant) => participant.userId === userId)) return { status: 'unauthorized' };
      const choices = game.participants.map((participant) => participant.choice);
      if (game.mode === 'bot') choices.push(game.botChoice);
      const result = resolveRps(choices);
      let winnerUserId = null;
      if (result.type === 'winner') {
        if (game.mode === 'bot' && result.winnerIndex === game.participants.length) {
          winnerUserId = 'bot';
        } else {
          winnerUserId = game.participants[result.winnerIndex].userId;
          const payout = game.mode === 'bot' ? game.bet * 2n : game.escrowedTokens;
          this.credit(winnerUserId, payout, now);
        }
      } else {
        for (const participant of game.participants.filter((entry) => entry.stakeDebited)) {
          this.credit(participant.userId, game.bet, now);
        }
      }
      for (const participant of game.participants) {
        const status = result.type === 'draw' ? 'DRAW' : (participant.userId === winnerUserId ? 'WIN' : 'LOSE');
        this.statements.setResultStatus.run(status, gameId, participant.userId);
      }
      this.statements.clearDebits.run(gameId);
      this.statements.finish.run(
        RPS_STATES.FINISHED,
        result.type,
        winnerUserId,
        BigInt(now),
        BigInt(now),
        gameId,
      );
      this.statements.deleteActiveForGame.run(gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;

    this.terminalTransaction = db.transaction((gameId, state, now) => {
      const game = this.game(gameId);
      if (!game) return { status: 'missing' };
      if (TERMINAL_STATES.has(game.state)) return { status: 'ok', duplicate: true };
      for (const participant of game.participants.filter((entry) => entry.stakeDebited)) {
        this.credit(participant.userId, game.bet, now);
      }
      this.statements.clearDebits.run(gameId);
      this.statements.finish.run(state, 'draw', null, BigInt(now), BigInt(now), gameId);
      this.statements.deleteActiveForGame.run(gameId);
      return { status: 'ok', duplicate: false };
    }).immediate;
  }

  credit(userId, amount, now) {
    const player = this.gameRepository.getPlayer(userId, now);
    if (player.tokenBalance + amount > SQLITE_INTEGER_MAX) {
      throw new RangeError('Token balance exceeds the SQLite signed 64-bit range.');
    }
    const result = this.statements.creditPlayer.run(amount, BigInt(now), userId);
    if (Number(result.changes) !== 1) throw new Error('RPS token credit target no longer exists.');
  }

  participants(gameId) {
    return this.statements.participants.all(String(gameId)).map(participantModel);
  }

  game(gameId) {
    const row = this.statements.game.get(String(gameId));
    return gameModel(row, row ? this.participants(gameId) : []);
  }

  activeGameForUser(userId) {
    const active = this.statements.active.get(String(userId));
    return active ? this.game(active.game_id) : null;
  }

  create(gameId, guildId, channelId, hostProfile, now, expiresAt) {
    const profile = normalizedProfile(hostProfile, 0);
    const result = this.createTransaction(String(gameId), String(guildId || ''), String(channelId || ''), profile, now, expiresAt);
    return result.status === 'ok' ? { ...result, game: this.game(gameId) } : result;
  }

  setMode(gameId, hostUserId, mode, now = Date.now()) {
    const game = this.game(gameId);
    if (!game || game.hostUserId !== String(hostUserId) || game.state !== RPS_STATES.CHOOSING_MODE) return { status: 'stale' };
    if (!['bot', 'human'].includes(mode)) return { status: 'invalid-mode' };
    this.statements.setMode.run(mode, BigInt(now), String(gameId));
    return { status: 'ok', game: this.game(gameId) };
  }

  setInvites(gameId, hostUserId, profiles, now = Date.now()) {
    const normalized = profiles.map((profile, index) => normalizedProfile(profile, index + 1));
    const ids = normalized.map((profile) => profile.userId);
    if (ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length || ids.includes(String(hostUserId))) {
      return { status: 'invalid-participants' };
    }
    const result = this.setInvitesTransaction(String(gameId), String(hostUserId), normalized, now);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  setMessage(gameId, messageId, now = Date.now()) {
    this.statements.setMessage.run(String(messageId || ''), BigInt(now), String(gameId));
    return this.game(gameId);
  }

  startHumanLobby(gameId, hostUserId, bet, now, expiresAt) {
    const stake = BigInt(bet);
    if (stake < MIN_BET || stake > MAX_BET) return { status: 'invalid-bet' };
    const result = this.startLobbyTransaction(String(gameId), String(hostUserId), stake, now, expiresAt);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  startBotRound(gameId, hostUserId, bet, botChoice, now, expiresAt) {
    const stake = BigInt(bet);
    if (stake < MIN_BET || stake > MAX_BET || !validMove(botChoice)) return { status: 'invalid-round' };
    const result = this.startBotRoundTransaction(String(gameId), String(hostUserId), stake, botChoice, now, expiresAt);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  accept(gameId, userId, now, expiresAt) {
    const result = this.acceptTransaction(String(gameId), String(userId), now, expiresAt);
    return { ...result, ...(['waiting', 'started', 'insufficient'].includes(result.status) ? { game: this.game(gameId) } : {}) };
  }

  proposeHigherBet(gameId, userId, bet, now, expiresAt) {
    const stake = BigInt(bet);
    if (stake < MIN_BET || stake > MAX_BET) return { status: 'invalid-bet' };
    const result = this.higherBetTransaction(String(gameId), String(userId), stake, now, expiresAt);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  commit(gameId, userId, choice, now, expiresAt) {
    if (!validMove(choice)) return { status: 'invalid-choice' };
    const result = this.commitTransaction(String(gameId), String(userId), choice, now, expiresAt);
    return { ...result, ...(['ok', 'ready'].includes(result.status) ? { game: this.game(gameId) } : {}) };
  }

  reveal(gameId, userId, now = Date.now()) {
    const result = this.finishTransaction(String(gameId), String(userId), now);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  cancel(gameId, now = Date.now()) {
    const result = this.terminalTransaction(String(gameId), RPS_STATES.CANCELED, now);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  expire(gameId, now = Date.now()) {
    const result = this.terminalTransaction(String(gameId), RPS_STATES.EXPIRED, now);
    return { ...result, ...(result.status === 'ok' ? { game: this.game(gameId) } : {}) };
  }

  expireDue(now = Date.now()) {
    return this.statements.dueGames.all(BigInt(now))
      .map((row) => this.expire(row.game_id, now))
      .filter((result) => result.status === 'ok' && !result.duplicate)
      .map((result) => result.game);
  }
}

module.exports = {
  RpsRepository,
  TERMINAL_STATES,
  gameModel,
  participantModel,
};
