const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const runtime = require('../src/giveawayRuntime');
const { buildSetupPayload } = require('../src/giveawayMessages');
const { createDraft, now } = require('../src/giveawayUtils');
const giveawayManager = require('../src/giveawayManager');

const START_DURATION_PREFIX = 'giveaway:modal:start-duration:';

if (!runtime.__giveawaySelectedPingRoleReady) {
  const createLiveGiveawayFromDraft = runtime.createLiveGiveawayFromDraft;
  runtime.createLiveGiveawayFromDraft = (draft) => {
    const giveaway = createLiveGiveawayFromDraft(draft);
    giveaway.startupPingRoleId = draft?.pingRoleId || '';
    giveaway.pingRoleId = '';
    return giveaway;
  };
  Object.defineProperty(runtime, '__giveawaySelectedPingRoleReady', { value: true });
}

async function sendSelectedRolePing(interaction, giveawayId, roleId) {
  const normalizedRoleId = String(roleId || '').trim();
  if (!/^\d{17,20}$/.test(normalizedRoleId)) return;

  const state = runtime.getState();
  const giveaway = state.giveaways?.[giveawayId];
  if (!giveaway?.messageId || giveaway.startupPingMessageId) return;

  const giveawayMessage = await runtime.fetchMessageById(
    giveaway.guildId,
    giveaway.channelId,
    giveaway.messageId,
  );
  if (!giveawayMessage) return;

  const pingMessage = await giveawayMessage.reply({
    content: `<@&${normalizedRoleId}>`,
    allowedMentions: { parse: [], roles: [normalizedRoleId] },
  }).catch(() => null);
  if (!pingMessage) return;

  giveaway.startupPingMessageId = pingMessage.id;
  giveaway.updatedAt = now();
  state.giveaways[giveawayId] = giveaway;
  runtime.persistState(state);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Create a giveaway setup panel.')
    .addRoleOption((option) =>
      option
        .setName('ping_role')
        .setDescription('Role to ping once when the giveaway starts.')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  disableActionTimeout: true,

  async init(client) {
    await giveawayManager.init(client);
  },

  async execute(interaction) {
    const pingRole = interaction.options.getRole('ping_role', false);
    const draftId = interaction.id;
    const state = runtime.getState();
    const draft = createDraft(draftId, interaction);
    draft.pingRoleId = pingRole?.id || '';
    state.drafts[draftId] = draft;
    runtime.persistState(state);

    await interaction.reply(buildSetupPayload(draft));
    const reply = await interaction.fetchReply().catch(() => null);
    if (!reply) return;

    draft.messageId = reply.id;
    draft.updatedAt = now();
    state.drafts[draftId] = draft;
    runtime.persistState(state);
  },

  async handleInteraction(interaction) {
    const customId = interaction.customId || '';
    const giveawayId = customId.startsWith(START_DURATION_PREFIX)
      ? customId.slice(START_DURATION_PREFIX.length)
      : '';
    const pingRoleId = giveawayId
      ? runtime.getDraft(runtime.getState(), giveawayId)?.pingRoleId || ''
      : '';

    const handled = await giveawayManager.handleInteraction(interaction);
    if (handled && giveawayId && pingRoleId) {
      await sendSelectedRolePing(interaction, giveawayId, pingRoleId);
    }
    return handled;
  },

  async handleMessageCreate(message) {
    await giveawayManager.handleMessageCreate(message);
  },

  async handleMessageDelete(message) {
    await giveawayManager.handleMessageDelete(message);
  },
};
