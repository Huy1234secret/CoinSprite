const { WORK_COMMANDS, parseWorkCommand } = require('./commands');
const {
  activeSessionPayload, cooldownPayload, ownershipDeniedPayload, settledPayload, unavailablePayload,
} = require('./components/builders');
const { openDatabase } = require('./repositories/database');
const { WorkRepository } = require('./repositories/workRepository');
const { WorkService } = require('./services/workService');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');
const { jobsPayload, firedPayload } = require('./components/careers');

function createWorkFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new WorkRepository(db, { clock: options.clock });
  const editRecovered = options.editRecovered || (async () => {});
  const service = options.service || new WorkService(repository, {
    ...options,
    async onTimeout(result) {
      try { await editRecovered(result.session, settledPayload(result.session, result)); }
      catch (error) { options.reportError?.(error, { kind: 'timeout-message-edit', session: result.session }); }
    },
  });

  async function start(source, ephemeralStatus, startOptions = {}) {
    const userId = String(source.user?.id || source.author?.id || '');
    if (!options.isCommandAllowed?.(source.guildId, source.channelId, 'cs-work') && options.isCommandAllowed) {
      await source.reply(unavailablePayload({ ephemeral: ephemeralStatus }));
      return true;
    }
    const result = await service.start({
      guildId: source.guildId, channelId: source.channelId, userId,
      bypassCooldown: startOptions.bypassCooldown === true,
    }, async (payload) => {
      const sent = await source.reply(payload);
      // InteractionResponse.id is the interaction ID, not the posted message ID.
      const message = source.isChatInputCommand?.() ? await source.fetchReply() : sent;
      if (!message?.id) throw new Error('Discord did not return the Work message ID.');
      return message.id;
    });
    if (result.status === 'fired') {
      await source.reply(firedPayload(userId, result.profile, { ephemeral: ephemeralStatus }));
    } else if (result.status === 'cooldown') {
      await source.reply(cooldownPayload(userId, result.nextWorkAt, result.profile, { ephemeral: ephemeralStatus }));
    } else if (result.status === 'active') {
      await source.reply(activeSessionPayload(userId, result.session, result.profile, { ephemeral: ephemeralStatus }));
    }
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-work') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return start(interaction, true);
    }
    if ((!interaction.isButton?.() && !interaction.isModalSubmit?.()) || !String(interaction.customId || '').startsWith('cswork:')) return false;
    const parts = String(interaction.customId).split(':');
    if (parts.length !== 3) return false;
    const [, sessionId, requestedAction] = parts;
    if (/^(jobs-\d+|apply-\d+|home)$/.test(requestedAction)) {
      if (sessionId !== String(interaction.user?.id)) {
        await sendEphemeral(interaction, ownershipDeniedPayload({ ephemeral: true }));
        return true;
      }
      if (options.isCommandAllowed && !options.isCommandAllowed(interaction.guildId, interaction.channelId, 'cs-work')) {
        await sendEphemeral(interaction, unavailablePayload({ ephemeral: true }));
        return true;
      }
      if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
      let profile = repository.employment(sessionId), notice = '';
      const applying = requestedAction.startsWith('apply-');
      const value = Number(requestedAction.split('-')[1]);
      if (applying) {
        const result = repository.applyCareer(sessionId, value);
        profile = result.profile;
        if (result.status === 'cooldown') {
          await sendEphemeral(interaction, {
            content: `You still have a job application cooldown. Try again <t:${Math.floor(profile.jobChangeUntil / 1000)}:R>.`,
            flags: 64,
          });
          return true;
        }
        notice = { applied: 'Your application is accepted.', active: 'Finish your active work before changing jobs.',
          requirements: 'You do not meet this job’s requirements.' }[result.status];
      }
      await interaction.message.edit(requestedAction === 'home'
        ? cooldownPayload(sessionId, profile.cooldownUntil, profile, { initial: false })
        : jobsPayload(sessionId, profile, applying ? Math.floor((value - 1) / 5) : value, notice, { initial: false }));
      return true;
    }
    let action = requestedAction;
    const session = repository.get(sessionId);
    if (!session) {
      await sendEphemeral(interaction, unavailablePayload({ ephemeral: true }));
      return true;
    }
    const ownershipOk = session.userId === String(interaction.user?.id)
      && session.guildId === String(interaction.guildId)
      && session.channelId === String(interaction.channelId)
      && session.messageId === String(interaction.message?.id);
    if (!ownershipOk) {
      await sendEphemeral(interaction, ownershipDeniedPayload({ ephemeral: true }));
      return true;
    }
    if (requestedAction === 'submit' && interaction.isButton?.() && ['cashier', 'captcha'].includes(session.job)
      && session.status === 'active' && Number(options.clock?.() ?? Date.now()) < session.deadline) {
      await interaction.showModal({ custom_id: `cswork:${sessionId}:answer`, title: session.job === 'cashier' ? 'Change due' : 'Solve CAPTCHA',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'answer', label: session.job === 'cashier' ? 'Change (e.g. 12.50 or 0)' : 'Characters in the image', style: 1, required: true, max_length: 16 }] }] });
      return true;
    }
    if (interaction.isModalSubmit?.()) {
      if (requestedAction !== 'answer' || !['cashier', 'captcha'].includes(session.job)) return false;
      action = `answer:${interaction.fields.getTextInputValue('answer')}`;
    } else if (requestedAction === 'answer') return false;
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    if (action === 'back') {
      const profile = repository.profile(session.userId);
      await interaction.message.edit(cooldownPayload(session.userId, profile.cooldownUntil, profile, { initial: false }));
      return true;
    }
    if (session.status !== 'active') {
      const result = { changed: false, session, profile: repository.profile(session.userId), reason: session.failureReason };
      await interaction.message.edit(settledPayload(session, result));
      return true;
    }
    const result = await service.handleAction({
      sessionId, action, userId: interaction.user.id, guildId: interaction.guildId,
      channelId: interaction.channelId, messageId: interaction.message?.id,
    });
    if (result.payload) await interaction.message.edit(result.payload);
    return true;
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || !parseWorkCommand(message.content)) return false;
    return start(message, false);
  }

  async function handleOwnerTestMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || !parseWorkCommand(message.content)) return false;
    return start(message, false, { bypassCooldown: true });
  }

  return {
    commands: WORK_COMMANDS, db, repository, service, handleInteraction, handleMessage, handleOwnerTestMessage,
    recover: () => service.recover(),
    close() { service.close(); if (!options.db && db.open) db.close(); },
  };
}

module.exports = { WORK_COMMANDS, createWorkFeature, parseWorkCommand };
