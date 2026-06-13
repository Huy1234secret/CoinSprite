const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const runtime = require('../src/giveawayRuntime');
const { buildSetupPayload } = require('../src/giveawayMessages');
const { createDraft, now } = require('../src/giveawayUtils');
const giveawayManager = require('../src/giveawayManager');

if (!runtime.__giveawaySelectedPingRoleReady) {
  const createLiveGiveawayFromDraft = runtime.createLiveGiveawayFromDraft;
  runtime.createLiveGiveawayFromDraft = (draft) => {
    const giveaway = createLiveGiveawayFromDraft(draft);
    giveaway.pingRoleId = draft?.pingRoleId || '';
    return giveaway;
  };
  Object.defineProperty(runtime, '__giveawaySelectedPingRoleReady', { value: true });
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
    return giveawayManager.handleInteraction(interaction);
  },

  async handleMessageCreate(message) {
    await giveawayManager.handleMessageCreate(message);
  },

  async handleMessageDelete(message) {
    await giveawayManager.handleMessageDelete(message);
  },
};
