const { MessageFlags } = require('discord.js');
const roulette = require('./roulette');
const { getBalance, addBalance } = require('../src/gamblingStore');
const { PRCOIN, formatNumber } = require('../src/gamblingConfig');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const MIN_BET = 100;
const COOLDOWN_MS = 30_000;
const INACTIVE_MS = 30_000;
const SPIN_MS = 7_000;
const sessions = new Map();

function text(content) { return { type: 10, content }; }
function findCustomId(components, prefix) {
  const stack = [...(components || [])];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    const raw = item.toJSON ? item.toJSON() : item;
    if (typeof raw.custom_id === 'string' && raw.custom_id.startsWith(prefix)) return raw.custom_id;
    if (Array.isArray(raw.components)) stack.push(...raw.components);
    if (Array.isArray(raw.options)) {
      for (const option of raw.options) if (Array.isArray(option.components)) stack.push(...option.components);
    }
  }
  return null;
}
function submittedComponents(interaction) {
  return Array.isArray(interaction.components ?? interaction?.data?.components) ? (interaction.components ?? interaction.data.components) : [];
}
function findSubmitted(interaction, customId) {
  const stack = [...submittedComponents(interaction)];
  while (stack.length) {
    const item = stack.shift();
    const component = item?.component ?? item;
    if (component?.custom_id === customId || component?.customId === customId) return component;
    if (Array.isArray(item?.components)) stack.push(...item.components);
    if (Array.isArray(component?.components)) stack.push(...component.components);
  }
  return null;
}
function submittedValue(interaction, customId) {
  const component = findSubmitted(interaction, customId);
  if (component?.value !== undefined) return component.value;
  try { return interaction.fields.getTextInputValue(customId); } catch { return null; }
}
function parseBet(raw) {
  const amount = Math.floor(Number(String(raw || '').replace(/,/g, '').replace(/\s+/g, '')));
  return Number.isFinite(amount) ? amount : NaN;
}
function timeoutPayload(session, refund) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: refund > 0 ? 0x57f287 : 0xed4245,
      components: [text([
        '### Roulette Ended',
        `* <@${session.userId}> was inactive for 30 seconds.`,
        refund > 0 ? `-# Returned bet: **${formatNumber(refund)}** ${PRCOIN}` : '-# No active prize pool was available to return.',
      ].join('\n'))],
    }],
    files: [],
    attachments: [],
  };
}
function clearTimer(session) {
  if (session?.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}
function resetTimer(session) {
  clearTimer(session);
  session.timer = setTimeout(async () => {
    if (session.expired) return;
    session.expired = true;
    const refund = session.status === 'bet_placed' && session.bet > 0 ? session.bet : 0;
    if (refund > 0) addBalance(session.userId, refund);
    await session.message?.edit(timeoutPayload(session, refund)).catch(() => null);
  }, INACTIVE_MS);
  if (typeof session.timer.unref === 'function') session.timer.unref();
}
function sessionFromMessage(message, userId, cooldownUntil) {
  const customId = findCustomId(message?.components, `roulette:select:${userId}:`);
  const [, , , gameId] = String(customId || '').split(':');
  if (!gameId) return null;
  const session = { gameId, userId, message, status: 'waiting', bet: 0, timer: null, expired: false, cooldownUntil };
  sessions.set(gameId, session);
  resetTimer(session);
  return session;
}

module.exports = {
  ...roulette,
  async execute(interaction) {
    const until = rouletteCooldowns.get(interaction.user.id) || 0;
    if (until > Date.now()) {
      await interaction.reply({ content: `You can start Roulette again <t:${Math.floor(until / 1000)}:R>.`, flags: EPHEMERAL_FLAG });
      return;
    }
    const cooldownUntil = Date.now() + COOLDOWN_MS;
    rouletteCooldowns.set(interaction.user.id, cooldownUntil);
    await roulette.execute(interaction);
    const message = await interaction.fetchReply().catch(() => null);
    sessionFromMessage(message, interaction.user.id, cooldownUntil);
  },
  async handleInteraction(interaction) {
    const customId = interaction.customId;
    if (typeof customId !== 'string' || !customId.startsWith('roulette:')) return false;
    const [, action, ownerId, gameId] = customId.split(':');
    const session = sessions.get(gameId);
    if (session?.expired) {
      await interaction.reply({ content: 'This Roulette game ended after 30 seconds of inactivity. Use /roulette to start a new one.', flags: EPHEMERAL_FLAG }).catch(() => null);
      return true;
    }
    if (session) {
      session.message = interaction.message || session.message;
      resetTimer(session);
    }
    if (action === 'modal') {
      const bet = parseBet(submittedValue(interaction, 'bet'));
      if (!Number.isFinite(bet) || bet < MIN_BET) {
        await interaction.reply({ content: `Bet must be at least **${formatNumber(MIN_BET)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
        return true;
      }
      const available = getBalance(ownerId) + (session?.status === 'bet_placed' ? session.bet : 0);
      if (available < bet) {
        await interaction.reply({ content: `You need **${formatNumber(bet)}** ${PRCOIN} to place that bet.`, flags: EPHEMERAL_FLAG });
        return true;
      }
      const handled = await roulette.handleInteraction(interaction);
      if (session && !interaction.replied) {
        session.status = 'bet_placed';
        session.bet = bet;
        resetTimer(session);
      }
      return handled;
    }
    if (action === 'start') {
      if (session) {
        clearTimer(session);
        session.status = 'spinning';
        session.bet = 0;
        setTimeout(() => {
          rouletteCooldowns.set(session.userId, session.cooldownUntil);
          if (!session.expired) resetTimer(session);
        }, SPIN_MS + 1_000);
      }
      return roulette.handleInteraction(interaction);
    }
    return roulette.handleInteraction(interaction);
  },
};
