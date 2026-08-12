const {
  canceledPayload,
  completePayload,
  expiredPayload,
  failedPayload,
  gamePayload,
  homePayload,
  statPayload,
  workError,
} = require('./builders');

const NOT_OWNER = "These aren't your work controls. Run /g-work to start your own shift.";
const EXPIRED = 'This work shift has expired. Run /g-work to start another.';

async function ephemeral(interaction, message) {
  const payload = workError(message);
  if (interaction.deferred || interaction.replied) return interaction.followUp?.(payload);
  return interaction.reply(payload);
}

function createWorkComponentHandler(context) {
  const { service, games, random, repository } = context;

  async function ownerCheck(interaction, ownerId) {
    if (String(interaction.user?.id) === String(ownerId)) return true;
    await ephemeral(interaction, NOT_OWNER);
    return false;
  }

  async function expireInteraction(interaction, session) {
    await interaction.message?.edit?.(expiredPayload(session.userId, session, { initial: false })).catch?.(() => null);
    await ephemeral(interaction, EXPIRED);
  }

  async function menuInteraction(interaction, ownerId) {
    if (!interaction.isStringSelectMenu?.() || !await ownerCheck(interaction, ownerId)) return true;
    const action = interaction.values?.[0];
    if (action === 'check-stat') {
      await interaction.update(statPayload(ownerId, service.profile(ownerId), games, { initial: false }));
      return true;
    }
    if (action !== 'work') {
      await ephemeral(interaction, 'That work action is no longer available.');
      return true;
    }
    const result = service.start(ownerId, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
    });
    if (result.status === 'already-active') {
      await ephemeral(interaction, 'You already have an active work shift. Finish or quit it first.');
      return true;
    }
    if (result.status === 'cooldown') {
      await ephemeral(interaction, `You can work again <t:${Math.ceil(result.availableAt / 1_000)}:R>.`);
      return true;
    }
    const customer = service.customer(result.session);
    await interaction.update(gamePayload(ownerId, result.session, customer, { initial: false }));
    if (interaction.message?.id && result.session.messageId !== interaction.message.id) {
      repository.setMessage(result.session.id, interaction.message.id, context.clock());
    }
    return true;
  }

  async function ingredientInteraction(interaction, sessionId, rawSlotIndex) {
    if (!interaction.isButton?.()) return true;
    const session = repository.session(sessionId);
    if (session && !await ownerCheck(interaction, session.userId)) return true;
    if (!session) {
      await ephemeral(interaction, 'This work shift is no longer available. Run /g-work to start another.');
      return true;
    }
    if (session.state === 'expired') {
      await expireInteraction(interaction, session);
      return true;
    }
    const slotIndex = Number(rawSlotIndex);
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      await ephemeral(interaction, 'That ingredient control is invalid.');
      return true;
    }
    const result = service.press(sessionId, interaction.user.id, slotIndex);
    if (result.status === 'expired') {
      await expireInteraction(interaction, result.session);
      return true;
    }
    if (result.status === 'advanced') {
      await interaction.update(gamePayload(
        result.session.userId,
        result.session,
        service.customer(result.session),
        { initial: false },
      ));
      return true;
    }
    if (result.status === 'failed') {
      await interaction.update(failedPayload(
        result.session.userId,
        result.session,
        result.expectedIngredient,
        result.selectedIngredient,
        { initial: false },
      ));
      return true;
    }
    if (result.status === 'completed') {
      await interaction.update(completePayload(result.session.userId, result, { initial: false }));
      return true;
    }
    const messages = {
      consumed: 'That ingredient was already used.',
      'invalid-slot': 'That ingredient control is invalid.',
      resolved: 'This work shift has already ended. Run /g-work to start another.',
      missing: 'This work shift is no longer available. Run /g-work to start another.',
    };
    await ephemeral(interaction, messages[result.status] || 'That ingredient could not be used.');
    return true;
  }

  async function quitInteraction(interaction, sessionId) {
    if (!interaction.isButton?.()) return true;
    const session = repository.session(sessionId);
    if (session && !await ownerCheck(interaction, session.userId)) return true;
    if (!session) {
      await ephemeral(interaction, 'This work shift is no longer available.');
      return true;
    }
    if (session.state === 'expired') {
      await expireInteraction(interaction, session);
      return true;
    }
    const result = service.cancel(sessionId, interaction.user.id);
    if (result.status === 'expired') {
      await expireInteraction(interaction, result.session);
      return true;
    }
    if (result.status !== 'canceled') {
      await ephemeral(interaction, 'This work shift has already ended.');
      return true;
    }
    await interaction.update(canceledPayload(result.session.userId, { initial: false }));
    return true;
  }

  return async function handleWorkComponent(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('work:')) return false;
    const [namespace, action, id, extra] = customId.split(':');
    if (namespace !== 'work') return false;
    if (action === 'menu') return menuInteraction(interaction, id);
    if (action === 'back') {
      if (!interaction.isButton?.() || !await ownerCheck(interaction, id)) return true;
      await interaction.update(homePayload(id, random, { initial: false }));
      return true;
    }
    if (action === 'ingredient') return ingredientInteraction(interaction, id, extra);
    if (action === 'quit') return quitInteraction(interaction, id);
    await ephemeral(interaction, 'That work control is no longer available.');
    return true;
  };
}

module.exports = { EXPIRED, NOT_OWNER, createWorkComponentHandler };
