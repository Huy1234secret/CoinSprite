const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags, Partials, PermissionFlagsBits } = require('discord.js');
const { config } = require('dotenv');
const { logCommandUse, logCommandSystem, setLogClient } = require('./src/commandLogger');
const { getCommandBlockReason } = require('./src/gameSessionLock');
const { rememberCommandReply, rejectIfExpired, resetActionTimer, refreshMessageAfterAction } = require('./src/actionTimeouts');
const { loadState, saveState } = require('./src/ticketSystemStore');
const inviteRewardsManager = require('./src/inviteRewardsManager');
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const ALLOWED_GUILD_ID = '1493901002519347290';
const TRANSCRIPT_CHANNEL_ID = '1495788766600757418';
const STAFF_ROLE_ID = '1494993523064443065';
const TICKET_ACTION_SELECT_PREFIX = 'ticket:actions:';
const GIVEAWAY_CLOSE_PROOF_MODAL_PREFIX = 'ticket:giveaway-close-proof:';
const GIVEAWAY_CLOSE_PROOF_UPLOAD = 'giveaway_winners_claimed_prize_evidence';
const SIMPLE_PREFIX_COMMANDS = new Set(['!ping', '!level', '!rank']);

function getPrefixCommandLabel(message) {
  const content = message.content?.trim();
  if (!content) return null;
  const normalized = content.toLowerCase();
  const [firstToken = ''] = normalized.split(/\s+/);
  if (SIMPLE_PREFIX_COMMANDS.has(firstToken)) return firstToken;
  if (!content.startsWith('!')) return null;

  const commandBody = content.slice(1).trim().toLowerCase();
  if (!commandBody) return null;
  if (commandBody.startsWith('dm ')) return content;
  if (commandBody.startsWith('blacklist add ') || commandBody.startsWith('blacklist remove ')) return content;
  return null;
}

function shouldSkipActionTimeout(interaction) {
  if (interaction?.commandName === 'ticket-panel') return true;

  const customId = interaction?.customId || '';
  if (!customId) return false;

  if (customId.startsWith('pvpbjp:') || customId.startsWith('pvpmine:')) return true;

  // Ticket controls must remain usable indefinitely: the main panel, all three
  // ticket type flows, staff ticket actions, review controls, and ticket modals.
  return customId.startsWith('ticket:') || customId.startsWith('giveaway:') || customId.startsWith('level:') || customId.startsWith('rngnotif:');
}

function canUseStaffActions(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.roles?.cache?.has(STAFF_ROLE_ID));
}

function sanitizeAttachmentName(filename, fallbackIndex = 0) {
  const base = String(filename || `upload-${fallbackIndex + 1}`).trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || `upload-${fallbackIndex + 1}`;
}

function getFilenameFromUrl(url) {
  if (!url) return 'file.unknown';
  const clean = String(url).split('?')[0];
  return clean.split('/').pop() || 'file.unknown';
}

function normalizeUploadedAttachment(attachment) {
  if (!attachment) return null;
  const url = attachment.url || attachment.attachment || '';
  return {
    id: attachment.id,
    url,
    contentType: attachment.contentType || attachment.content_type || '',
    filename: attachment.name || attachment.filename || getFilenameFromUrl(url),
  };
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [value];
}

function getCollectionItem(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === 'function') return collection.get(id) ?? null;
  return collection[id] ?? null;
}

function getModalComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  const stack = [...getModalComponents(interaction)];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    const component = item.component ?? item;
    if (component?.custom_id === customId || component?.customId === customId) return component;
    if (Array.isArray(item.components)) stack.push(...item.components);
    if (Array.isArray(component.components)) stack.push(...component.components);
  }
  return null;
}

function getResolvedAttachment(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments
    ?? interaction?.resolved?.attachments
    ?? interaction?.fields?.resolved?.attachments
    ?? null;
  return getCollectionItem(resolved, id);
}

function getUploadedProofFiles(interaction) {
  if (typeof interaction?.fields?.getUploadedFiles === 'function') {
    const fromFields = collectionToArray(interaction.fields.getUploadedFiles(GIVEAWAY_CLOSE_PROOF_UPLOAD))
      .map(normalizeUploadedAttachment)
      .filter((attachment) => attachment?.url);
    if (fromFields.length > 0) return fromFields;
  }

  const component = findSubmittedComponent(interaction, GIVEAWAY_CLOSE_PROOF_UPLOAD);
  const fromComponent = collectionToArray(component?.attachments)
    .map(normalizeUploadedAttachment)
    .filter((attachment) => attachment?.url);
  if (fromComponent.length > 0) return fromComponent;

  const ids = component?.values ?? component?.value ?? [];
  const attachmentIds = Array.isArray(ids) ? ids : [ids];
  const fromResolved = attachmentIds
    .map((id) => normalizeUploadedAttachment(getResolvedAttachment(interaction, id)))
    .filter((attachment) => attachment?.url);
  if (fromResolved.length > 0) return fromResolved;

  return Array.from(interaction?.attachments?.values?.() ?? []).map(normalizeUploadedAttachment).filter((attachment) => attachment?.url);
}

function isGiveawayTicket(ticketRecord, channel) {
  const text = `${ticketRecord?.ticketType || ''} ${channel?.name || ''}`.toLowerCase();
  return text.includes('giveaway');
}

function getGiveawayCloseProofModal(channelId) {
  return {
    custom_id: `${GIVEAWAY_CLOSE_PROOF_MODAL_PREFIX}${channelId}`,
    title: 'Close giveaway request ticket',
    components: [
      {
        type: 18,
        label: 'Upload winner claim proof',
        description: 'Upload screenshots or receipts confirming winners claimed their prizes.',
        component: {
          type: 19,
          custom_id: GIVEAWAY_CLOSE_PROOF_UPLOAD,
          min_values: 1,
          max_values: 10,
          required: true,
        },
      },
    ],
  };
}

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: accent,
        components: [{ type: 10, content }],
      },
    ],
  };
}

function formatTranscriptTimestamp(dateInput) {
  const dt = new Date(dateInput);
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const year = dt.getFullYear();
  const hours = String(dt.getHours()).padStart(2, '0');
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  return `${month}-${day}-${year}_${hours}-${minutes}`;
}

function getAttachmentTranscriptValue(attachment) {
  if (!attachment?.url) return '';
  const contentType = String(attachment.contentType || '').toLowerCase();
  const fileName = String(attachment.name || attachment.filename || '').toLowerCase();
  if (contentType.includes('gif') || fileName.endsWith('.gif')) return `GIF: ${attachment.url}`;
  if (contentType.startsWith('image/')) return `Image attachment: ${attachment.url}`;
  if (contentType.startsWith('video/')) return `Video attachment: ${attachment.url}`;
  return attachment.url;
}

async function saveTicketTranscript(channel, options = {}) {
  const transcriptDir = path.join(__dirname, 'transcripts');
  fs.mkdirSync(transcriptDir, { recursive: true });

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const sorted = messages ? [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
  const lines = sorted.map((message) => {
    const ts = new Date(message.createdTimestamp);
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const time = `${hh}:${mm}`;
    const attachments = [...message.attachments.values()].map(getAttachmentTranscriptValue).filter(Boolean).join(' ');
    const content = `${message.content || ''} ${attachments}`.trim() || '[no content]';
    return `${time} // [${message.author.username}] - [${message.author.id}] : ${content}`;
  });

  const ticketType = options.ticketType || 'Giveaway Request Ticket';
  const timestamp = formatTranscriptTimestamp(new Date());
  const fileName = `${ticketType} - ${timestamp}.txt`;
  const filePath = path.join(transcriptDir, fileName);
  const headerLines = [
    `Ticket Channel: ${channel.name} (${channel.id})`,
    `Closed By: ${options.closedBy || 'Unknown'}`,
    'Close Action: close',
  ];
  fs.writeFileSync(filePath, `${headerLines.join('\n')}\n\n${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

async function maybeShowGiveawayCloseProofModal(interaction) {
  if (!interaction?.isStringSelectMenu?.()) return false;
  if (!interaction.customId?.startsWith(TICKET_ACTION_SELECT_PREFIX)) return false;
  if (interaction.values?.[0] !== 'close_ticket') return false;

  const state = loadState();
  const ticketRecord = state.tickets?.[interaction.channelId];
  if (!ticketRecord || !isGiveawayTicket(ticketRecord, interaction.channel)) return false;
  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can use ticket actions.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await interaction.showModal(getGiveawayCloseProofModal(interaction.channelId));
  return true;
}

async function handleGiveawayCloseProofSubmit(interaction) {
  if (!interaction?.isModalSubmit?.()) return false;
  if (!interaction.customId?.startsWith(GIVEAWAY_CLOSE_PROOF_MODAL_PREFIX)) return false;

  const channelId = interaction.customId.slice(GIVEAWAY_CLOSE_PROOF_MODAL_PREFIX.length);
  const state = loadState();
  const ticketRecord = state.tickets?.[channelId];
  if (!ticketRecord) {
    await interaction.reply({ content: 'This ticket record is missing.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can close giveaway request tickets.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const proofFiles = getUploadedProofFiles(interaction);
  if (proofFiles.length === 0) {
    await interaction.reply({ content: 'Please upload at least one evidence file before closing this giveaway request ticket.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(() => null);

  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply({ content: 'Invalid ticket channel.' }).catch(() => null);
    return true;
  }

  const ticketOwner = await interaction.guild.members.fetch(ticketRecord.userId).catch(() => null);
  if (ticketOwner) await channel.permissionOverwrites.edit(ticketOwner.id, { SendMessages: false }).catch(() => null);

  ticketRecord.closed = true;
  state.tickets[channelId] = ticketRecord;
  saveState(state);

  await interaction.editReply({ content: 'Closing giveaway request ticket...' }).catch(() => null);
  await channel.send(container(0xfff200, 'Transcript saving!...'));
  const transcriptPath = await saveTicketTranscript(channel, {
    ticketType: ticketRecord.ticketType || 'Giveaway Request Ticket',
    closedBy: interaction.user.id,
  });

  const transcriptChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    const proofList = proofFiles.map((item, index) => `- ${sanitizeAttachmentName(item.filename, index)}`).join('\n');
    await transcriptChannel.send({
      content:
        `Transcript for #${channel.name} (${channel.id})\n` +
        `**Winner claim evidence attached:**\n${proofList}`,
      files: [
        transcriptPath,
        ...proofFiles.map((item, index) => ({ attachment: item.url, name: sanitizeAttachmentName(item.filename, index) })),
      ],
    }).catch(() => null);
  }

  await channel.send(container(0x00ff00, 'Transcript saved with winner claim evidence attached to the transcript message!'));
  await channel.send(container(0xff0000, 'Deleting ticket...'));
  setTimeout(() => {
    channel.delete('Giveaway request ticket closed').catch(() => null);
  }, 3000);

  return true;
}

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
setLogClient(client);

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js')).sort();
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) client.commands.set(command.data.name, command);
}

async function initCommandModules() {
  for (const command of client.commands.values()) {
    if (typeof command.init !== 'function') continue;
    try {
      await command.init(client);
    } catch (error) {
      console.error(`Command init failed for ${command.data?.name ?? 'unknown'}:`, error);
      logCommandSystem(`Command init failed for ${command.data?.name ?? 'unknown'}: ${error?.message ?? 'unknown error'}`);
    }
  }
}

async function registerSlashCommands() {
  const slashCommands = client.commands.map((command) => command.data.toJSON());
  try {
    const guild = await client.guilds.fetch(ALLOWED_GUILD_ID);
    await guild.commands.set(slashCommands);
    await client.application.commands.set([]);
    logCommandSystem(`Registered ${slashCommands.length} slash commands for guild ${ALLOWED_GUILD_ID}.`);
  } catch (error) {
    console.error('Slash command registration failed:', error);
    logCommandSystem(`Slash command registration failed: ${error?.message ?? 'unknown error'}`);
  }
}

client.once(Events.ClientReady, async () => {
  console.info(`Ready as ${client.user.tag}`);
  logCommandSystem(`Bot ready as ${client.user.tag}`);
  await initCommandModules();
  await inviteRewardsManager.init(client).catch((error) => {
    console.error('Invite rewards init failed:', error);
    logCommandSystem(`Invite rewards init failed: ${error?.message ?? 'unknown error'}`);
  });
  await registerSlashCommands();
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild?.id !== ALLOWED_GUILD_ID) return;
  await inviteRewardsManager.onGuildMemberAdd(member).catch(() => null);
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberAdd === 'function') await command.handleGuildMemberAdd(member, client);
});
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild?.id !== ALLOWED_GUILD_ID) return;
  await inviteRewardsManager.onGuildMemberUpdate(oldMember, newMember).catch(() => null);
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberUpdate === 'function') await command.handleGuildMemberUpdate(oldMember, newMember, client);
});
client.on(Events.InviteCreate, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;
  await inviteRewardsManager.onInviteCreateOrDelete(invite).catch(() => null);
  for (const command of client.commands.values()) if (typeof command.handleInviteCreate === 'function') await command.handleInviteCreate(invite, client);
});
client.on(Events.InviteDelete, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;
  await inviteRewardsManager.onInviteCreateOrDelete(invite).catch(() => null);
  for (const command of client.commands.values()) if (typeof command.handleInviteDelete === 'function') await command.handleInviteDelete(invite, client);
});
client.on(Events.MessageCreate, async (message) => {
  if (message.guildId !== ALLOWED_GUILD_ID) return;
  const prefixCommand = message.author?.bot ? null : getPrefixCommandLabel(message);
  if (prefixCommand) {
    logCommandUse({ userId: message.author.id, command: prefixCommand, channelId: message.channelId ?? 'unknown' });
  }
  await inviteRewardsManager.onMessageCreate(message).catch(() => null);
  for (const command of client.commands.values()) if (typeof command.handleMessageCreate === 'function') await command.handleMessageCreate(message, client);
});
client.on(Events.MessageDelete, async (message) => {
  if (message.guildId !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleMessageDelete === 'function') await command.handleMessageDelete(message, client);
});
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.message?.guildId !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleMessageReactionAdd === 'function') await command.handleMessageReactionAdd(reaction, user, client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.guildId !== ALLOWED_GUILD_ID) {
      if (interaction.isRepliable()) await interaction.reply({ content: 'This bot only works in the configured server.', flags: EPHEMERAL_FLAG }).catch(() => null);
      return;
    }

    if (await handleGiveawayCloseProofSubmit(interaction)) return;
    if (await maybeShowGiveawayCloseProofModal(interaction)) return;

    if (interaction.isAutocomplete?.()) {
      const command = client.commands.get(interaction.commandName);
      if (command && typeof command.handleInteraction === 'function') await command.handleInteraction(interaction, client);
      return;
    }

    const skipActionTimeout = shouldSkipActionTimeout(interaction);
    if (!interaction.isChatInputCommand?.() && !skipActionTimeout && await rejectIfExpired(interaction)) return;
    if (!interaction.isChatInputCommand?.() && !skipActionTimeout) await resetActionTimer(interaction);

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) {
        const blockReason = getCommandBlockReason(interaction.user.id, interaction.commandName);
        if (blockReason) {
          await interaction.reply({ content: blockReason, flags: EPHEMERAL_FLAG });
          return;
        }
        if (!command.suppressCommandLog) {
          logCommandUse({ userId: interaction.user.id, command: `/${interaction.commandName}`, channelId: interaction.channelId ?? 'unknown' });
        }
        await command.execute(interaction, client);
        if (!command.disableActionTimeout) await rememberCommandReply(interaction);
      }
      return;
    }

    for (const command of client.commands.values()) {
      if (typeof command.handleInteraction !== 'function') continue;
      const handled = await command.handleInteraction(interaction, client);
        if (handled || interaction.replied || interaction.deferred) {
          if (!skipActionTimeout) await refreshMessageAfterAction(interaction);
          return;
        }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    logCommandSystem(`Interaction error: ${error?.message ?? 'unknown error'}`);
    if (error?.code === 10062) return;
    if (error?.code === 'InteractionAlreadyReplied') return;
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error happened while handling this interaction.', flags: EPHEMERAL_FLAG }).catch((replyError) => {
        console.error('Interaction fallback reply failed:', replyError);
        logCommandSystem(`Interaction fallback reply failed: ${replyError?.message ?? 'unknown error'}`);
      });
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logCommandSystem('Startup failed: DISCORD_TOKEN environment variable is not set.');
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
