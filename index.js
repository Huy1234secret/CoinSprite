const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags, Partials } = require('discord.js');
const { config } = require('dotenv');
const { logCommandUse, logCommandSystem, setLogClient } = require('./src/commandLogger');
const { getCommandBlockReason } = require('./src/gameSessionLock');
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ALLOWED_GUILD_ID = '1493901002519347290';

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
  await registerSlashCommands();
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild?.id !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberAdd === 'function') await command.handleGuildMemberAdd(member, client);
});
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild?.id !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleGuildMemberUpdate === 'function') await command.handleGuildMemberUpdate(oldMember, newMember, client);
});
client.on(Events.InviteCreate, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleInviteCreate === 'function') await command.handleInviteCreate(invite, client);
});
client.on(Events.InviteDelete, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;
  for (const command of client.commands.values()) if (typeof command.handleInviteDelete === 'function') await command.handleInviteDelete(invite, client);
});
client.on(Events.MessageCreate, async (message) => {
  if (message.guildId !== ALLOWED_GUILD_ID) return;
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

    if (interaction.isAutocomplete?.()) {
      const command = client.commands.get(interaction.commandName);
      if (command && typeof command.handleInteraction === 'function') await command.handleInteraction(interaction, client);
      return;
    }

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
      }
      return;
    }

    for (const command of client.commands.values()) {
      if (typeof command.handleInteraction !== 'function') continue;
      const handled = await command.handleInteraction(interaction, client);
      if (handled) {
        const shouldLogInteraction = typeof command.shouldLogInteraction === 'function' ? command.shouldLogInteraction(interaction) : true;
        if (interaction.user && shouldLogInteraction) logCommandUse({ userId: interaction.user.id, command: interaction.customId ?? interaction.type, channelId: interaction.channelId ?? 'unknown' });
        return;
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    logCommandSystem(`Interaction error: ${error?.message ?? 'unknown error'}`);
    if (error?.code === 10062) return;
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
