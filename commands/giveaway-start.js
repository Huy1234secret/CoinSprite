const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags
} = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const CONFIG_PREFIX = 'giveaway-config:';
const EDIT_TEMPLATE_ID = 'giveaway-edit-template:';
const EDIT_SETTINGS_ID = 'giveaway-edit-settings:';
const START_BUTTON_ID = 'giveaway-start:';
const ENTER_BUTTON_ID = 'giveaway-enter:';
const CLAIM_BUTTON_ID = 'giveaway-claim:';

const DEFAULT_STATE = {
  title: 'Giveaway title',
  description: 'No description provided.',
  thumbnail: '',
  endTime: null,
  endTimeDisplay: 'Not set',
  claimTimeMs: 5 * 60 * 1000,
  claimTimeDisplay: '5m',
  winnerCount: null,
  requirements: 'None',
  templateComplete: false,
  settingsComplete: false
};

const giveawayStates = new Map();

function buildPreview(state) {
  const containerComponents = [
    {
      type: 10,
      content: `## \`${state.title}\`\n-# * Giveaway ends \`${state.endTimeDisplay}\`\n-# * Claim time \`${state.claimTimeDisplay}\`\n-# * Winner amount \`${state.winnerCount ?? 'Not set'}\`\n-# * Requirement: \`${state.requirements || 'None'}\``
    }
  ];

  if (state.thumbnail) {
    containerComponents.push({
      type: 12,
      items: [
        {
          media: { url: state.thumbnail }
        }
      ]
    });
  }

  containerComponents.push({
    type: 10,
    content: `\`${state.description || 'No description provided.'}\``
  });

  const container = {
    type: 17,
    accent_color: 0x00aa5b,
    components: containerComponents
  };

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${EDIT_TEMPLATE_ID}${state.id}`)
        .setLabel('Edit message template')
        .setStyle(state.templateComplete ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${EDIT_SETTINGS_ID}${state.id}`)
        .setLabel('Edit giveaway setting')
        .setStyle(state.settingsComplete ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${START_BUTTON_ID}${state.id}`)
        .setLabel('Start giveaway')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!(state.templateComplete && state.settingsComplete) || state.started)
    )
    .toJSON();

  return [container, buttons];
}

function parseEndTime(input) {
  const match = input
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+UTC([+-]\d{1,2})$/i);
  if (!match) {
    return null;
  }

  const [, day, month, year, hour, minute, offset] = match;
  const offsetHours = Number(offset);
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - offsetHours,
    Number(minute)
  );
  const parsed = new Date(utcMillis);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseDuration(input) {
  const match = input.trim().match(/^(\d+)([smhd])$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  const duration = value * multipliers[unit];
  if (duration > multipliers.d) {
    return multipliers.d;
  }
  return duration;
}

async function updatePreviewMessage(client, state) {
  const channel = await client.channels.fetch(state.channelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(state.configMessageId);
  await message.edit({ components: buildPreview(state), flags: COMPONENTS_V2_FLAG });
}

function buildEnterMessageComponents(state) {
  const containerComponents = [
    {
      type: 10,
      content: `## \`${state.title}\`\n-# * Giveaway ends \`${state.endTimeDisplay}\`\n-# * Claim time \`${state.claimTimeDisplay}\`\n-# * Winner amount \`${state.winnerCount}\`\n-# * Requirement: \`${state.requirements}\``
    }
  ];

  if (state.thumbnail) {
    containerComponents.push({
      type: 12,
      items: [{ media: { url: state.thumbnail } }]
    });
  }

  containerComponents.push({ type: 10, content: `\`${state.description}\`` });

  return [
    {
      type: 17,
      accent_color: 0x00aa5b,
      components: containerComponents
    },
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${ENTER_BUTTON_ID}${state.id}`)
          .setLabel('Enter')
          .setStyle(ButtonStyle.Success)
      )
      .toJSON()
  ];
}

async function validateThumbnail(url) {
  if (!url) {
    return '';
  }

  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      return '';
    }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      return '';
    }
    return url;
  } catch (error) {
    console.warn('Thumbnail validation failed:', error);
    return '';
  }
}

function pickWinners(state) {
  const entrants = Array.from(state.entries);
  for (let i = entrants.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
  }
  return entrants.slice(0, state.winnerCount);
}

async function handleClaim(interaction, state, winnerId) {
  if (!state.pendingClaim || state.pendingClaim.userId !== winnerId) {
    await safeErrorReply(interaction, 'This claim request is no longer active.');
    return true;
  }

  if (state.pendingClaim.claimed) {
    await safeErrorReply(interaction, 'This giveaway has already been claimed.');
    return true;
  }

  state.pendingClaim.claimed = true;
  clearTimeout(state.pendingClaim.timeout);

  try {
    const dmMessage = await interaction.message.fetch();
    const row = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(dmMessage.components[0].components[0])
        .setDisabled(true)
        .setStyle(ButtonStyle.Success)
        .setLabel('Claimed!')
    );
    await dmMessage.edit({ components: [row] });
  } catch (error) {
    console.warn('Failed to edit claim DM message:', error);
  }

  await interaction.reply({ content: 'You have claimed the giveaway prize!', ephemeral: true });
  await finalizeClaim(state, interaction.client);
  return true;
}

async function finalizeClaim(state, client) {
  const channel = await client.channels.fetch(state.channelId);
  const claimMessage = await channel.messages.fetch(state.pendingClaim.channelMessageId);
  const content = `### Congrat, **<@${state.pendingClaim.userId}>** you have won the ${state.title}'s Giveaway!\n-# Claimed! Giveaway ends!`;
  const container = { type: 17, accent_color: 0x00aa5b, components: [{ type: 10, content }] };
  await claimMessage.edit({ components: [container], flags: COMPONENTS_V2_FLAG });
  giveawayStates.delete(state.id);
}

async function handleClaimTimeout(state, client) {
  if (!state.pendingClaim || state.pendingClaim.claimed) {
    return;
  }

  try {
    const dmMessage = await state.pendingClaim.dmMessage.fetch();
    const row = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(dmMessage.components[0].components[0])
        .setDisabled(true)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Rerolled, late claim')
    );
    await dmMessage.edit({ components: [row] });
  } catch (error) {
    console.warn('Failed to update DM after claim timeout:', error);
  }

  const channel = await client.channels.fetch(state.channelId);
  const claimMessage = await channel.messages.fetch(state.pendingClaim.channelMessageId);
  const expiredContent = `### Congrat, **<@${state.pendingClaim.userId}>** you have won the ${state.title}'s Giveaway!\n-# Didn't claim, REROLLING...`;
  const expiredContainer = { type: 17, accent_color: 0xff0000, components: [{ type: 10, content: expiredContent }] };
  await claimMessage.edit({ components: [expiredContainer], flags: COMPONENTS_V2_FLAG });

  state.processedWinners.push(state.pendingClaim.userId);
  state.pendingClaim = null;
  await rollNextWinner(state, client);
}

async function rollNextWinner(state, client) {
  if (!state.remainingWinners || state.remainingWinners.length === 0) {
    const channel = await client.channels.fetch(state.channelId);
    const messageContent = '### No one claimed the giveaway, giveaway ends.';
    const container = { type: 17, accent_color: 0x000000, components: [{ type: 10, content: messageContent }] };
    await channel.send({ components: [container], flags: COMPONENTS_V2_FLAG });
    giveawayStates.delete(state.id);
    return;
  }

  const winnerId = state.remainingWinners.shift();
  state.pendingClaim = { userId: winnerId, claimed: false, channelMessageId: null, timeout: null, dmMessage: null };

  const channel = await client.channels.fetch(state.channelId);
  const claimContent = `### Congrat, **<@${winnerId}>** you have won the ${state.title}'s Giveaway!\n-# Claiming...`;
  const claimContainer = { type: 17, accent_color: 0x00aa5b, components: [{ type: 10, content: claimContent }] };
  const claimMessage = await channel.send({ components: [claimContainer], flags: COMPONENTS_V2_FLAG });
  state.pendingClaim.channelMessageId = claimMessage.id;

  const claimDeadline = Date.now() + state.claimTimeMs;
  const dmContent = `You have been selected as a winner for **${state.title}**!\n\nReroll <t:${Math.floor(claimDeadline / 1000)}:R>`;
  const dmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CLAIM_BUTTON_ID}${state.id}:${winnerId}`)
      .setLabel('Claim the prize')
      .setStyle(ButtonStyle.Success)
  );

  try {
    const dmMessage = await (await client.users.fetch(winnerId)).send({ content: dmContent, components: [dmRow] });
    state.pendingClaim.dmMessage = dmMessage;
  } catch (error) {
    console.warn('Failed to DM winner:', error);
  }

  state.pendingClaim.timeout = setTimeout(() => handleClaimTimeout(state, client), state.claimTimeMs);
}

async function startGiveaway(state, client) {
  const channel = await client.channels.fetch(state.channelId);
  const entryMessage = await channel.send({
    components: buildEnterMessageComponents(state),
    flags: COMPONENTS_V2_FLAG
  });
  state.entryMessageId = entryMessage.id;

  const delay = Math.max(state.endTime.getTime() - Date.now(), 0);
  state.endTimer = setTimeout(async () => {
    if (state.entries.size === 0) {
      const messageContent = '### No one claimed the giveaway, giveaway ends.';
      const container = { type: 17, accent_color: 0x000000, components: [{ type: 10, content: messageContent }] };
      await channel.send({ components: [container], flags: COMPONENTS_V2_FLAG });
      giveawayStates.delete(state.id);
      return;
    }

    state.remainingWinners = pickWinners(state);
    state.processedWinners = [];
    await rollNextWinner(state, client);
  }, delay);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Start configuring a giveaway in a channel.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to send the giveaway setup message to')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased()) {
      await safeErrorReply(interaction, 'Please choose a text channel for the giveaway.');
      return;
    }

    const state = { ...DEFAULT_STATE, id: `${Date.now()}-${interaction.id}`, channelId: targetChannel.id, creatorId: interaction.user.id };
    const preview = buildPreview(state);
    const message = await targetChannel.send({ components: preview, flags: COMPONENTS_V2_FLAG });

    state.configMessageId = message.id;
    giveawayStates.set(state.id, state);

    await interaction.reply({
      content: `Giveaway setup posted in ${targetChannel}.`,
      flags: 64
    });
  },

  async handleComponent(interaction) {
    if (!interaction.isButton() && !interaction.isModalSubmit()) {
      return false;
    }

    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith(EDIT_TEMPLATE_ID) || customId.startsWith(EDIT_SETTINGS_ID) || customId.startsWith(START_BUTTON_ID)) {
        const stateId = customId.split(':')[1];
        const state = giveawayStates.get(stateId);
        if (!state) {
          await safeErrorReply(interaction, 'This giveaway is no longer active.');
          return true;
        }

        if (interaction.user.id !== state.creatorId) {
          await safeErrorReply(interaction, 'Only the giveaway creator can modify it.');
          return true;
        }

        if (customId.startsWith(EDIT_TEMPLATE_ID)) {
          const modal = new ModalBuilder()
            .setCustomId(`${CONFIG_PREFIX}${state.id}:template`)
            .setTitle('Giveaway Template')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('title')
                  .setLabel('What is Giveaway Title?')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(state.templateComplete ? state.title : '')
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('description')
                  .setLabel('What is Giveaway description?')
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setValue(state.description || '')
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('thumbnail')
                  .setLabel('Add thumbnail?')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(state.thumbnail)
              )
            );

          await interaction.showModal(modal);
          return true;
        }

        if (customId.startsWith(EDIT_SETTINGS_ID)) {
          const modal = new ModalBuilder()
            .setCustomId(`${CONFIG_PREFIX}${state.id}:settings`)
            .setTitle('Giveaway Settings')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('end')
                  .setLabel('Time giveaway ends (DD/MM/YYYY HH:MM UTC+n)')
                  .setPlaceholder('Example: 05/11/2026 10:10 UTC+7')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(state.endTimeDisplay !== 'Not set' ? state.endTimeDisplay : '')
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('claim')
                  .setLabel('Claim time (you can use s, m, h or d ; max 1d)')
                  .setPlaceholder('Example: 5m')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(state.claimTimeDisplay)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('winners')
                  .setLabel('Amount of winners')
                  .setPlaceholder('1 - 5')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(state.winnerCount ? String(state.winnerCount) : '')
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('requirements')
                  .setLabel('Requirements?')
                  .setPlaceholder(
                    'not required, if wanted you can add any of these: HuntLv - {reqlv} ; CoinReq/DiamondReq - {amount}. Any besides will be ignored.'
                  )
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setValue(state.requirements)
              )
            );

          await interaction.showModal(modal);
          return true;
        }

        if (customId.startsWith(START_BUTTON_ID)) {
          if (!(state.templateComplete && state.settingsComplete)) {
            await safeErrorReply(interaction, 'Please finish configuring the giveaway first.');
            return true;
          }

          if (state.started) {
            await safeErrorReply(interaction, 'Giveaway already started.');
            return true;
          }

          state.started = true;
          await interaction.update({ components: buildPreview(state), flags: COMPONENTS_V2_FLAG });
          await startGiveaway(state, interaction.client);
          return true;
        }
      }

      if (customId.startsWith(ENTER_BUTTON_ID)) {
        const stateId = customId.split(':')[1];
        const state = giveawayStates.get(stateId);
        if (!state) {
          await safeErrorReply(interaction, 'This giveaway is no longer active.');
          return true;
        }

        if (state.entries.has(interaction.user.id)) {
          try {
            await interaction.user.send('You have already entered this giveaway.');
          } catch (error) {
            console.warn('Unable to DM user who already entered:', error);
          }
          await safeErrorReply(interaction, 'You have already entered this giveaway.');
          return true;
        }

        state.entries.add(interaction.user.id);
        try {
          await interaction.user.send('You have entered the giveaway.');
        } catch (error) {
          console.warn('Unable to DM user entry confirmation:', error);
        }
        await interaction.reply({ content: 'You have entered the giveaway!', ephemeral: true });
        return true;
      }

      if (customId.startsWith(CLAIM_BUTTON_ID)) {
        const [, stateId, winnerId] = customId.split(':');
        const state = giveawayStates.get(stateId);
        if (!state) {
          await safeErrorReply(interaction, 'This giveaway is no longer active.');
          return true;
        }

        return handleClaim(interaction, state, winnerId);
      }
    }

    if (interaction.isModalSubmit()) {
      const [prefix, stateId, modalType] = interaction.customId.split(':');
      if (prefix !== CONFIG_PREFIX.slice(0, -1)) {
        return false;
      }
      const state = giveawayStates.get(stateId);
      if (!state) {
        await safeErrorReply(interaction, 'This giveaway is no longer active.');
        return true;
      }

      if (interaction.user.id !== state.creatorId) {
        await safeErrorReply(interaction, 'Only the giveaway creator can modify it.');
        return true;
      }

      if (modalType === 'template') {
        const title = interaction.fields.getTextInputValue('title');
        const description = interaction.fields.getTextInputValue('description');
        const thumbnailInput = interaction.fields.getTextInputValue('thumbnail');

        state.title = title;
        state.description = description || 'No description provided.';
        const validatedThumbnail = await validateThumbnail(thumbnailInput.trim());
        state.thumbnail = validatedThumbnail;
        state.templateComplete = Boolean(title);

        const notices = [];
        if (thumbnailInput && !validatedThumbnail) {
          notices.push('Thumbnail URL is invalid or unreachable and was ignored.');
        }

        await updatePreviewMessage(interaction.client, state);
        await interaction.reply({ content: notices.join('\n') || 'Template updated.', ephemeral: true });
        return true;
      }

      if (modalType === 'settings') {
        const endInput = interaction.fields.getTextInputValue('end');
        const claimInput = interaction.fields.getTextInputValue('claim') || state.claimTimeDisplay;
        const winnersInput = interaction.fields.getTextInputValue('winners');
        const requirementsInput = interaction.fields.getTextInputValue('requirements') || 'None';

        const parsedEnd = parseEndTime(endInput);
        if (!parsedEnd || parsedEnd.getTime() <= Date.now()) {
          await safeErrorReply(interaction, 'Please provide a future end time in the format DD/MM/YYYY HH:MM UTC+n.');
          return true;
        }

        const parsedWinners = Math.max(1, Math.min(5, Number(winnersInput)));
        if (!Number.isInteger(parsedWinners)) {
          await safeErrorReply(interaction, 'Amount of winners must be a number between 1 and 5.');
          return true;
        }

        const parsedClaim = parseDuration(claimInput) ?? state.claimTimeMs;

        state.endTime = parsedEnd;
        state.endTimeDisplay = endInput;
        state.claimTimeMs = parsedClaim;
        state.claimTimeDisplay = claimInput;
        state.winnerCount = parsedWinners;
        state.requirements = requirementsInput.trim() || 'None';
        state.settingsComplete = Boolean(state.endTime && state.winnerCount);

        await updatePreviewMessage(interaction.client, state);
        await interaction.reply({ content: 'Settings updated.', ephemeral: true });
        return true;
      }
    }

    return false;
  }
};
