const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags, Partials, PermissionFlagsBits } = require('discord.js');
const { config } = require('dotenv');
config();

const { logCommandUse, logCommandSystem, setLogClient } = require('./src/commandLogger');
const dailyMessageStats = require('./src/dailyMessageStats');
const { getCommandBlockReason } = require('./src/gameSessionLock');
const { rememberCommandReply, rejectIfExpired, resetActionTimer, refreshMessageAfterAction } = require('./src/actionTimeouts');
const { loadState, saveState } = require('./src/ticketSystemStore');
const inviteRewardsManager = require('./src/inviteRewardsManager');
const { deleteGuildConfig, ensureGuildConfig, getEnabledGuildIds, getGuildConfig, isGuildEnabled } = require('./src/serverConfig');
const { registerConsolidatedAdminCommands, startAdminServer } = require('./src/adminServer');
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
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
  if (commandBody.startsWith('role remove ') || commandBody.startsWith('role add ')) return content;
  if (commandBody.startsWith('blacklist add ') || commandBody.startsWith('blacklist remove ')) return content;
  return null;
}

function shouldSkipActionTimeout(interaction) {
  if (interaction?.commandName === 'ticket-panel') return true;

  const customId = interaction?.customId || '';
  if (!customId) return false;

  // Ticket controls must remain usable indefinitely: the main panel, all three
  // ticket type flows, staff ticket actions, review controls, and ticket modals.
  return customId.startsWith('ticket:')
    || customId.startsWith('giveaway:')
    || customId.startsWith('level:')
    || customId.startsWith('mastermind:')
    || customId.startsWith('program-trivia:');
}

function canUseStaffActions(member) {
  const staffRoleId = getGuildConfig(member?.guild?.id)?.roles?.staff;
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || (staffRoleId && member?.roles?.cache?.has(staffRoleId)));
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

  const transcriptChannelId = getGuildConfig(interaction.guildId)?.channels?.transcript;
  const transcriptChannel = transcriptChannelId ? await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null) : null;
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.commands = new Collection();
setLogClient(client);

const commandsPath = path.join(__dirname, 'commands');

// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["00-invalid-emoji-send-fallback.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const {
  ButtonInteraction,
  Message,
  StringSelectMenuInteraction,
  TextChannel,
} = require('discord.js');

const originalSend = TextChannel.prototype.send;

function validationDetails(error) {
  try {
    return JSON.stringify(error?.rawError?.errors || {}, null, 2);
  } catch {
    return '{}';
  }
}

function hasInvalidEmojiError(error) {
  return Number(error?.code) === 50035
    && validationDetails(error).includes('COMPONENT_INVALID_EMOJI');
}

function withoutComponentEmojis(value) {
  if (Array.isArray(value)) return value.map(withoutComponentEmojis);
  if (!value || typeof value !== 'object') return value;

  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => key !== 'emoji')
      .map(([key, child]) => [key, withoutComponentEmojis(child)]),
  );
}

function emojiFreePayload(options) {
  return {
    ...options,
    components: withoutComponentEmojis(options.components || []),
  };
}

function patchComponentPayloadMethod(prototype, methodName, logLabel) {
  if (!prototype?.[methodName]) return;
  const original = prototype[methodName];
  if (original.__componentEmojiFallbackPatched) return;

  async function patchedComponentPayloadMethod(options, ...rest) {
    try {
      return await original.call(this, options, ...rest);
    } catch (error) {
      if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') {
        if (Number(error?.code) === 50035) {
          console.error('Discord component validation details:', validationDetails(error));
        }
        throw error;
      }
      console.warn(`${logLabel(this)} without invalid component emojis.`);
      return original.call(this, emojiFreePayload(options), ...rest);
    }
  }

  patchedComponentPayloadMethod.__componentEmojiFallbackPatched = true;
  prototype[methodName] = patchedComponentPayloadMethod;
}

TextChannel.prototype.send = async function sendWithInvalidEmojiFallback(options, ...rest) {
  try {
    return await originalSend.call(this, options, ...rest);
  } catch (error) {
    if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') throw error;
    console.warn(`Retrying message in channel ${this.id} without invalid component emojis.`);
    return originalSend.call(this, emojiFreePayload(options), ...rest);
  }
};

patchComponentPayloadMethod(
  ButtonInteraction?.prototype,
  'update',
  (interaction) => `Retrying button interaction ${interaction.customId || interaction.id}`,
);

patchComponentPayloadMethod(
  StringSelectMenuInteraction?.prototype,
  'update',
  (interaction) => `Retrying select-menu interaction ${interaction.customId || interaction.id}`,
);

patchComponentPayloadMethod(
  Message?.prototype,
  'edit',
  (message) => `Retrying message edit ${message.id || ''}`.trim(),
);

module.exports = {};
    }],
    ["000-message-content-filter.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const discord = require('discord.js');
const dailyMessageStats = require('../src/dailyMessageStats');
const inviteRewardsManager = require('../src/inviteRewardsManager');
const { shouldIgnoreTextlessMessage } = require('../src/messageContentFilter');

function guarded(handler) {
  if (typeof handler !== 'function' || handler.__coinSpriteTextlessGuard) return handler;
  const next = function messageHookWithTextGuard(message, ...args) {
    if (shouldIgnoreTextlessMessage(message)) return Promise.resolve(); // Ignored hooks still satisfy Promise-based callers.
    return handler.call(this, message, ...args);
  };
  Object.defineProperty(next, '__coinSpriteTextlessGuard', { value: true });
  return next;
}

function patchCommands() {
  const proto = discord.Collection && discord.Collection.prototype;
  if (!proto || proto.set.__coinSpriteTextlessGuard) return;
  const nativeSet = proto.set;
  const nextSet = function setCommandWithTextGuard(key, command) {
    if (command && typeof command.handleMessageCreate === 'function' && !command.allowTextlessMessages) {
      command.handleMessageCreate = guarded(command.handleMessageCreate); // ADDED: later-loaded commands inherit the text payload filter.
    }
    return nativeSet.call(this, key, command);
  };
  Object.defineProperty(nextSet, '__coinSpriteTextlessGuard', { value: true });
  proto.set = nextSet;
}

function patchMethod(target, key) {
  if (!target || typeof target[key] !== 'function' || target[key].__coinSpriteTextlessGuard) return;
  target[key] = guarded(target[key].bind(target)); // ADDED: stats and invite hooks use the same filter as commands.
}

patchCommands();
patchMethod(dailyMessageStats, 'recordMessage');
patchMethod(inviteRewardsManager, 'onMessageCreate');

module.exports = {};
    }],
  ];
  for (const [name, factory] of fixes) {
    const filename = require('path').join(__dirname, 'commands', name);
    const fixModule = new ConsolidatedFixModule(filename, module);
    fixModule.filename = filename;
    fixModule.paths = ConsolidatedFixModule._nodeModulePaths(require('path').dirname(filename));
    require.cache[filename] = fixModule;
    factory.call(fixModule.exports, fixModule, fixModule.exports, fixModule.require.bind(fixModule), filename, require('path').dirname(filename));
    fixModule.loaded = true;
  }
})();

const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js')).sort();
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) client.commands.set(command.data.name, command);
}
registerConsolidatedAdminCommands(client);

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

async function registerGuildSlashCommands(guild) {
  const slashCommands = client.commands.map((command) => command.data.toJSON());
  await guild.commands.set(slashCommands);
  logCommandSystem(`Registered ${slashCommands.length} slash commands for guild ${guild.id}.`);
}

async function registerSlashCommands() {
  for (const guildId of getEnabledGuildIds()) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await registerGuildSlashCommands(guild);
    } catch (error) {
      console.error(`Slash command registration failed for guild ${guildId}:`, error);
      logCommandSystem(`Slash command registration failed for guild ${guildId}: ${error?.message ?? 'unknown error'}`);
    }
  }

  try {
    await client.application.commands.set([]);
  } catch (error) {
    console.error('Global slash command cleanup failed:', error);
    logCommandSystem(`Global slash command cleanup failed: ${error?.message ?? 'unknown error'}`);
  }
}

async function runInviteRewardHook(hookName, ...args) {
  const hook = inviteRewardsManager?.[hookName];
  if (typeof hook !== 'function') return null; // FIXED: missing legacy invite hooks now no-op instead of crashing.
  try {
    return await Promise.resolve(hook(...args)); // FIXED: non-Promise hook results are normalized before awaiting.
  } catch (error) {
    console.error(`Invite rewards ${hookName} failed:`, error);
    logCommandSystem(`Invite rewards ${hookName} failed: ${error?.message ?? 'unknown error'}`);
    return null;
  }
}

client.once(Events.ClientReady, async () => {
  console.info(`Ready as ${client.user.tag}`);
  logCommandSystem(`Bot ready as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) ensureGuildConfig(guild.id);
  startAdminServer(client);
  await initCommandModules();
  await runInviteRewardHook('init', client); // FIXED: avoids calling .catch() on undefined legacy hook output.
  await registerSlashCommands();
});

client.on(Events.GuildCreate, async (guild) => {
  ensureGuildConfig(guild.id);
  await registerGuildSlashCommands(guild).catch((error) => {
    console.error(`Slash command registration failed for new guild ${guild.id}:`, error);
    logCommandSystem(`Slash command registration failed for new guild ${guild.id}: ${error?.message ?? 'unknown error'}`);
  });
  logCommandSystem(`Created blank server config for guild ${guild.id}.`);
});

client.on(Events.GuildDelete, (guild) => {
  if (deleteGuildConfig(guild.id)) logCommandSystem(`Removed server config for guild ${guild.id}.`);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (!isGuildEnabled(member.guild?.id)) return;
  await runInviteRewardHook('onGuildMemberAdd', member); // FIXED: avoids calling .catch() on undefined legacy hook output.
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberAdd === 'function') await command.handleGuildMemberAdd(member, client);
});
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!isGuildEnabled(newMember.guild?.id)) return;
  await runInviteRewardHook('onGuildMemberUpdate', oldMember, newMember); // FIXED: avoids calling .catch() on undefined legacy hook output.
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberUpdate === 'function') await command.handleGuildMemberUpdate(oldMember, newMember, client);
});
client.on(Events.InviteCreate, async (invite) => {
  if (!isGuildEnabled(invite.guild?.id)) return;
  await runInviteRewardHook('onInviteCreateOrDelete', invite); // FIXED: avoids calling .catch() on undefined legacy hook output.
  for (const command of client.commands.values()) if (typeof command.handleInviteCreate === 'function') await command.handleInviteCreate(invite, client);
});
client.on(Events.InviteDelete, async (invite) => {
  if (!isGuildEnabled(invite.guild?.id)) return;
  await runInviteRewardHook('onInviteCreateOrDelete', invite); // FIXED: avoids calling .catch() on undefined legacy hook output.
  for (const command of client.commands.values()) if (typeof command.handleInviteDelete === 'function') await command.handleInviteDelete(invite, client);
});
client.on(Events.MessageCreate, async (message) => {
  if (!isGuildEnabled(message.guildId)) return;
  dailyMessageStats.recordMessage(message);
  const prefixCommand = message.author?.bot ? null : getPrefixCommandLabel(message);
  if (prefixCommand) {
    logCommandUse({ userId: message.author.id, command: prefixCommand, channelId: message.channelId ?? 'unknown' });
  }
  await runInviteRewardHook('onMessageCreate', message); // FIXED: avoids calling .catch() on undefined legacy hook output.
  for (const command of client.commands.values()) {
    if (typeof command.handleMessageCreate !== 'function') continue;
    try {
      await command.handleMessageCreate(message, client);
    } catch (error) {
      const commandName = command.data?.name ?? 'unknown';
      console.error(`Message handler failed for ${commandName}:`, error);
      logCommandSystem(`Message handler failed for ${commandName}: ${error?.message ?? 'unknown error'}`);
    }
  }
});
client.on(Events.MessageDelete, async (message) => {
  if (!isGuildEnabled(message.guildId)) return;
  for (const command of client.commands.values()) if (typeof command.handleMessageDelete === 'function') await command.handleMessageDelete(message, client);
});
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!isGuildEnabled(interaction.guildId)) {
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
