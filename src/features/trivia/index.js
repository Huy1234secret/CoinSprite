const { SlashCommandBuilder } = require('discord.js');
const { openDatabase } = require('../work/repositories/database');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');
const { errorPayload } = require('../shared/components');
const { TriviaRepository } = require('./repository');
const { menu, game } = require('./components');
const TRIVIA_COMMANDS = [{ data: new SlashCommandBuilder().setName('cs-trivia').setDescription('Play Trivia and earn coins and Trivia XP.') }];
const parseTriviaCommand = content => /^\s*(?:cstrivia|\/cs-trivia)\s*$/i.test(String(content || ''));

function createTriviaFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath });
  const repository = options.repository || new TriviaRepository(db, options);
  const timers = new Map();
  const editors = new Map();
  const report = error => options.reportError?.(error, { kind: 'trivia' });
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  let closed = false;
  async function edit(s) {
    const payload = game(s, { initial: false });
    if (editors.has(s.id)) await editors.get(s.id)(payload);
    else if (options.editRecovered) await options.editRecovered(s, payload);
  }
  function schedule(s) {
    if (closed) return;
    clearTimer(timers.get(s.id)); timers.delete(s.id);
    if (!['question', 'feedback'].includes(s.status)) { editors.delete(s.id); return; }
    const due = s.status === 'question' ? s.deadline : s.revealUntil;
    const timer = setTimer(async () => {
      timers.delete(s.id);
      try {
        const next = s.status === 'question'
          ? repository.answer(s.id, s.userId, s.number, null) : repository.advance(s.id);
        if (next) {
          try { await edit(next); } finally { schedule(next); }
        } else {
          const current = repository.get(s.id);
          if (current) schedule(current);
        }
      } catch (error) { report(error); }
    }, Math.max(1, due - repository.clock()));
    timer?.unref?.(); timers.set(s.id, timer);
  }
  const allowed = source => !options.isCommandAllowed || options.isCommandAllowed(source.guildId, source.channelId, 'cs-trivia');
  async function deny(interaction, message) {
    await sendEphemeral(interaction, errorPayload(message, { ephemeral: true })); return true;
  }
  async function show(source) {
    if (!allowed(source)) {
      await source.reply(errorPayload('This game command is not enabled in this channel.', { ephemeral: Boolean(source.isChatInputCommand?.()) }));
      return true;
    }
    const userId = String(source.user?.id || source.author.id);
    const active = repository.active(userId);
    if (active) {
      await source.reply(errorPayload(`Finish your current Trivia game: https://discord.com/channels/${active.guildId}/${active.channelId}/${active.messageId}`, { ephemeral: Boolean(source.isChatInputCommand?.()) }));
      return true;
    }
    await source.reply(menu(userId, repository.profile(userId))); return true;
  }
  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-trivia') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return show(interaction);
    }
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('cstrivia:')) return false;
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const userId = String(interaction.user?.id);
    if (!interaction.guildId || !allowed(interaction)) return deny(interaction, 'This game command is not enabled in this channel.');
    if (action === 'start' || action === 'back') {
      if (parts[2] !== userId) return deny(interaction, `This Trivia menu belongs to <@${parts[2]}>.`);
      if (repository.active(userId)) return deny(interaction, 'Finish your current Trivia game first.');
      if (action === 'back') {
        const previous = repository.get(parts[3]);
        if (!previous || previous.userId !== userId || previous.status !== 'ended' || previous.messageId !== interaction.message.id) return deny(interaction, 'This Trivia game is no longer available.');
      }
      if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
      if (action === 'back') {
        await interaction.editReply(menu(userId, repository.profile(userId), { initial: false })); return true;
      }
      let s;
      try {
        s = repository.start(userId, parts[3], { guildId: interaction.guildId, channelId: interaction.channelId, messageId: interaction.message.id });
      } catch (error) { return deny(interaction, error.message); }
      editors.set(s.id, payload => interaction.message.edit(payload));
      try { await interaction.editReply(game(s, { initial: false })); } finally { schedule(s); }
      return true;
    }
    if (action !== 'answer' || parts.length !== 5) return deny(interaction, 'This Trivia control has expired.');
    const s = repository.get(parts[2]);
    if (!s || s.userId !== userId) return deny(interaction, 'This Trivia game belongs to another player or has expired.');
    if (s.messageId !== interaction.message.id || s.channelId !== interaction.channelId || s.guildId !== interaction.guildId) return deny(interaction, 'This Trivia control has expired.');
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    const next = repository.answer(s.id, userId, Number(parts[3]), Number(parts[4]));
    if (!next) return true;
    editors.set(s.id, payload => interaction.message.edit(payload));
    try { await interaction.editReply(game(next, { initial: false })); } finally { schedule(next); }
    return true;
  }
  async function handleMessage(message) {
    if (!message.guildId || message.author?.bot || message.webhookId || message.system || !parseTriviaCommand(message.content)) return false;
    return show(message);
  }
  async function recover() {
    for (const s of repository.pending()) {
      try { await edit(s); } catch (error) { report(error); }
      schedule(s);
    }
  }
  function close() {
    closed = true;
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear(); editors.clear();
    if (!options.db && db.open) db.close();
  }
  return { commands: TRIVIA_COMMANDS, db, repository, handleMessage, handleInteraction, recover, close };
}
module.exports = { createTriviaFeature, TRIVIA_COMMANDS, parseTriviaCommand };
