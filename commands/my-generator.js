const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { addCoinsToUser, getAllUserStats } = require('../src/userStats');
const {
  GENERATOR_COOLDOWN_MS,
  MAX_GENERATE_MINUTES,
  MIN_GENERATE_MINUTES,
  getGeneratorProfile,
  getLocationMultiplier,
  getNotificationSetting,
  getRateForTier,
  setGeneratorProfile,
} = require('../src/generator');
const { CURRENCIES_BY_KEY } = require('../src/currencies');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const THUMBNAIL_URL = 'https://cdn.discordapp.com/emojis/1474305835474747515.png';
const COIN_EMOJI = CURRENCIES_BY_KEY.coins.emoji;

const SETUP_BUTTON = 'generator-setup:';
const STOP_BUTTON = 'generator-stop:';
const CLAIM_BUTTON = 'generator-claim:';
const SETUP_MODAL = 'generator-setup-modal:';
const STOP_YES = 'generator-stop-yes:';
const STOP_NO = 'generator-stop-no:';

let cachedClient = null;
const timers = new Map();

function formatHoursFromMinutes(minutes) {
  return (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);
}

function formatCountdown(endTs) {
  return `<t:${Math.ceil(endTs / 1000)}:R>`;
}

function formatSpecificTime(endTs) {
  return `<t:${Math.ceil(endTs / 1000)}:t>`;
}

function buildSelection(userId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`generator-select:${userId}`)
      .setPlaceholder('More generator soon')
      .setDisabled(true)
      .addOptions([{ label: 'More generator soon', value: 'soon' }])
  );
}

function buildHeader(user, lines) {
  return { type: 9, components: [{ type: 10, content: lines.join('\n') }], accessory: { type: 11, media: { url: THUMBNAIL_URL }, description: `${user.username} generator` } };
}

function buildHomeMessage(user, channelId, state) {
  const locationMulti = getLocationMultiplier(channelId);
  const rate = getRateForTier(state.tier);
  const lines = [
    `## ${user.username}'s Generators`,
    `### Tier ${state.tier} - ${COIN_EMOJI} Bronze Coin Generation:`,
    `* Generating ${rate} / m`,
    '* Cooldown: 1h',
    `* Time: ${state.run ? formatSpecificTime(state.run.endsAt) : '?'}`,
    `* Location: <#${channelId}> - ×${locationMulti}`,
  ];

  const onCooldown = Date.now() < state.cooldownEndsAt;
  const setupDisabled = Boolean(state.run) || onCooldown;

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: 0xcd7f32,
      components: [
        buildHeader(user, lines),
        { type: 14 },
        { type: 10, content: '### Ingredients need:\n* N/A' },
        { type: 14 },
        buildSelection(user.id).toJSON(),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${SETUP_BUTTON}${user.id}`).setStyle(ButtonStyle.Success).setLabel('Start').setDisabled(setupDisabled),
          new ButtonBuilder().setCustomId(`generator-upgrade:${user.id}`).setStyle(ButtonStyle.Secondary).setLabel('Upgrades').setDisabled(true)
        ).toJSON(),
      ],
    }],
  };
}

function buildRunningMessage(user, state) {
  const run = state.run;
  const lines = [
    `## ${user.username}'s Generators`,
    `### Tier ${state.tier} - ${COIN_EMOJI} Bronze Coin Generation:`,
    `* Generating ${getRateForTier(state.tier)} ${COIN_EMOJI} / m [×${run.totalMultiplier}]`,
    `* Location: <#${run.channelId}> - ×${state.locationMultiplier}`,
    `* Time left: ${formatCountdown(run.endsAt)}`,
    `* Ends at: ${formatSpecificTime(run.endsAt)}`,
  ];

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: 0xcd7f32,
      components: [
        buildHeader(user, lines),
        { type: 14 },
        buildSelection(user.id).toJSON(),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${STOP_BUTTON}${user.id}`).setStyle(ButtonStyle.Danger).setLabel('Stop generate'),
          new ButtonBuilder().setCustomId(`generator-upgrade:${user.id}`).setStyle(ButtonStyle.Secondary).setLabel('Upgrades').setDisabled(true)
        ).toJSON(),
      ],
    }],
  };
}

function buildDoneMessage(user, state) {
  const run = state.run;
  const lines = [
    `## ${user.username}'s Generators`,
    `### Tier ${state.tier} - ${COIN_EMOJI} Bronze Coin Generation:`,
    `* Your generators has generated ${run.generatedAmount} ${COIN_EMOJI} after ${formatHoursFromMinutes(run.durationMinutes)}h.`,
  ];

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: 0xcd7f32,
      components: [
        buildHeader(user, lines),
        { type: 14 },
        buildSelection(user.id).toJSON(),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CLAIM_BUTTON}${user.id}`).setStyle(ButtonStyle.Success).setLabel('CLAIM'),
          new ButtonBuilder().setCustomId(`generator-upgrade:${user.id}`).setStyle(ButtonStyle.Secondary).setLabel('Upgrades').setDisabled(true)
        ).toJSON(),
      ],
    }],
  };
}

function buildSetupModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${SETUP_MODAL}${userId}`)
    .setTitle('Bronze generator setup')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('How long you want to generate?')
          .setPlaceholder(`min: ${MIN_GENERATE_MINUTES}m, max: ${MAX_GENERATE_MINUTES}m [or ${Math.floor(MAX_GENERATE_MINUTES / 60)}h]`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function refreshMessageForState(userId) {
  const state = getGeneratorProfile(userId);
  if (!cachedClient || !state.run?.channelId || !state.run?.messageId) return;
  try {
    const channel = await cachedClient.channels.fetch(state.run.channelId);
    const message = await channel.messages.fetch(state.run.messageId);
    const user = await cachedClient.users.fetch(userId);
    await message.edit(state.run.status === 'running' ? buildRunningMessage(user, state) : buildDoneMessage(user, state));
  } catch (error) {
    console.warn('Failed to refresh generator message:', error);
  }
}

async function refreshHomeMessage(userId, channelId, messageId, stateOverride = null) {
  if (!cachedClient || !channelId || !messageId) return;
  try {
    const channel = await cachedClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const user = await cachedClient.users.fetch(userId);
    const state = stateOverride ?? getGeneratorProfile(userId);
    await message.edit(buildHomeMessage(user, channelId, state));
  } catch (error) {
    console.warn('Failed to refresh generator home message:', error);
  }
}

function scheduleCompletion(userId) {
  const state = getGeneratorProfile(userId);
  if (!state.run || state.run.status !== 'running') return;

  clearTimeout(timers.get(userId));
  const remaining = Math.max(0, state.run.endsAt - Date.now());
  timers.set(
    userId,
    setTimeout(async () => {
      const next = getGeneratorProfile(userId);
      if (!next.run || next.run.status !== 'running') return;
      const { channelId, messageId } = next.run;
      const generatedAmount = Math.floor(next.run.durationMinutes * getRateForTier(next.tier) * next.run.totalMultiplier);
      addCoinsToUser(userId, generatedAmount);
      next.run = null;
      next.pendingDurationMinutes = null;
      setGeneratorProfile(userId, next);
      await refreshHomeMessage(userId, channelId, messageId, next);

      if (getNotificationSetting(userId) && cachedClient) {
        try {
          const user = await cachedClient.users.fetch(userId);
          await user.send(`-# Hey ${user.username}, your Bronze Coin Generator is done!`);
        } catch (error) {
          console.warn('Failed DM:', error);
        }
      }
    }, remaining)
  );
}

async function openMain(interaction) {
  const state = getGeneratorProfile(interaction.user.id);
  if (state.run?.status === 'running') {
    await interaction.reply(buildRunningMessage(interaction.user, state));
    return;
  }

  const previousChannelId = state.homeChannelId;
  const previousMessageId = state.homeMessageId;
  if (previousChannelId && previousMessageId) {
    await refreshHomeMessage(interaction.user.id, previousChannelId, previousMessageId);
  }

  await interaction.reply(buildHomeMessage(interaction.user, interaction.channelId, state));
  const reply = await interaction.fetchReply();
  state.homeChannelId = interaction.channelId;
  state.homeMessageId = reply.id;
  setGeneratorProfile(interaction.user.id, state);
}

module.exports = {
  data: new SlashCommandBuilder().setName('my-generator').setDescription('Open the Bronze Coin Generator home.'),

  async init(client) {
    cachedClient = client;
    const all = getAllUserStats();
    for (const [userId, stats] of Object.entries(all)) {
      if (stats.generator?.run?.status === 'running') scheduleCompletion(userId);
    }
  },

  execute: openMain,

  async handleComponent(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('generator-select:')) {
      await interaction.reply({ content: 'More generator soon.', ephemeral: true });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(SETUP_BUTTON)) {
      const userId = interaction.customId.slice(SETUP_BUTTON.length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This button is not for you.', ephemeral: true });
        return true;
      }

      const state = getGeneratorProfile(userId);
      if (state.homeMessageId && interaction.message?.id !== state.homeMessageId) {
        await interaction.reply({ content: 'This panel is no longer active. Run /my-generator again.', ephemeral: true });
        return true;
      }

      await interaction.showModal(buildSetupModal(userId));
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(SETUP_MODAL)) {
      const userId = interaction.customId.slice(SETUP_MODAL.length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This form is not for you.', ephemeral: true });
        return true;
      }

      const input = interaction.fields.getTextInputValue('duration').trim().toLowerCase();
      const num = Number.parseFloat(input.replace('h', '').replace('m', ''));
      const minutes = input.endsWith('h') ? Math.round(num * 60) : Math.round(num);

      if (!Number.isFinite(minutes) || minutes < MIN_GENERATE_MINUTES || minutes > MAX_GENERATE_MINUTES) {
        await interaction.reply({ content: `You cannot put a time that is either below ${MIN_GENERATE_MINUTES}m or above ${MAX_GENERATE_MINUTES}m!`, ephemeral: true });
        return true;
      }

      const state = getGeneratorProfile(userId);
      if (state.run?.status === 'running') {
        await interaction.reply({ content: 'You already have a generator running. Stop it first before starting a new one.', ephemeral: true });
        return true;
      }
      const now = Date.now();
      const locationMultiplier = getLocationMultiplier(interaction.channelId);
      state.locationMultiplier = locationMultiplier;
      state.run = {
        startedAt: now,
        endsAt: now + minutes * 60000,
        durationMinutes: minutes,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        messageId: interaction.message.id,
        status: 'running',
        generatedAmount: 0,
        totalMultiplier: locationMultiplier,
      };
      state.pendingDurationMinutes = null;
      state.homeChannelId = interaction.channelId;
      state.homeMessageId = interaction.message?.id ?? state.homeMessageId;
      setGeneratorProfile(userId, state);
      scheduleCompletion(userId);

      if (interaction.message) {
        await interaction.message.edit(buildRunningMessage(interaction.user, state));
      }

      await interaction.reply({ content: `Generation started and will finish ${formatCountdown(state.run.endsAt)} (${formatSpecificTime(state.run.endsAt)}).`, ephemeral: true });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(STOP_BUTTON)) {
      const userId = interaction.customId.slice(STOP_BUTTON.length);
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${STOP_YES}${userId}`).setStyle(ButtonStyle.Danger).setLabel('yes'),
        new ButtonBuilder().setCustomId(`${STOP_NO}${userId}`).setStyle(ButtonStyle.Secondary).setLabel('no')
      );
      await interaction.reply({
        ephemeral: true,
        flags: COMPONENTS_V2_FLAG,
        components: [{
          type: 17,
          accent_color: 0xff0000,
          components: [
            { type: 10, content: 'Are you sure you wanna **STOP** generating?\n-# This will cause the cooldown to activate later, and you’ll only earn the base amount based on the time elapsed.' },
            { type: 14 },
            confirmRow.toJSON(),
          ],
        }],
      });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(STOP_NO)) {
      await interaction.update({ content: 'Cancelled.', components: [] });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(STOP_YES)) {
      const userId = interaction.customId.slice(STOP_YES.length);
      const state = getGeneratorProfile(userId);
      if (!state.run || state.run.status !== 'running') {
        await interaction.update({ content: 'No active generation.', components: [] });
        return true;
      }

      const elapsedMinutes = Math.max(0, Math.floor((Date.now() - state.run.startedAt) / 60000));
      const { channelId, messageId } = state.run;
      const generatedAmount = elapsedMinutes * getRateForTier(state.tier);
      addCoinsToUser(userId, generatedAmount);
      state.run = null;
      state.pendingDurationMinutes = null;
      state.cooldownEndsAt = Date.now() + GENERATOR_COOLDOWN_MS;
      clearTimeout(timers.get(userId));
      setGeneratorProfile(userId, state);
      await refreshHomeMessage(userId, channelId, messageId, state);
      await interaction.update({ content: `Generator stopped. ${generatedAmount} ${COIN_EMOJI} has been added to your balance.`, components: [] });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(CLAIM_BUTTON)) {
      const userId = interaction.customId.slice(CLAIM_BUTTON.length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This button is not for you.', ephemeral: true });
        return true;
      }
      const state = getGeneratorProfile(userId);
      if (!state.run || (state.run.status !== 'ready_claim' && state.run.status !== 'stopped')) {
        await interaction.reply({ content: 'Nothing to claim right now.', ephemeral: true });
        return true;
      }

      addCoinsToUser(userId, state.run.generatedAmount);
      state.run = null;
      state.pendingDurationMinutes = null;
      state.homeChannelId = interaction.channelId;
      state.homeMessageId = interaction.message?.id ?? state.homeMessageId;
      setGeneratorProfile(userId, state);
      await interaction.update(buildHomeMessage(interaction.user, interaction.channelId, state));
      return true;
    }

    return false;
  },
};
