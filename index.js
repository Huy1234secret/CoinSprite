const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { config } = require('dotenv');

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  }
}

client.once(Events.ClientReady, async () => {
  const slashCommands = client.commands.map((command) => command.data.toJSON());
  await client.application.commands.set(slashCommands);
  console.info(`Ready as ${client.user.tag}`);

  for (const command of client.commands.values()) {
    if (typeof command.init === 'function') {
      await command.init(client);
    }
  }
});


client.on(Events.GuildMemberAdd, async (member) => {
  for (const command of client.commands.values()) {
    if (typeof command.handleGuildMemberAdd === 'function') {
      await command.handleGuildMemberAdd(member, client);
    }
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  for (const command of client.commands.values()) {
    if (typeof command.handleGuildMemberUpdate === 'function') {
      await command.handleGuildMemberUpdate(oldMember, newMember, client);
    }
  }
});

client.on(Events.InviteCreate, async (invite) => {
  for (const command of client.commands.values()) {
    if (typeof command.handleInviteCreate === 'function') {
      await command.handleInviteCreate(invite, client);
    }
  }
});

client.on(Events.InviteDelete, async (invite) => {
  for (const command of client.commands.values()) {
    if (typeof command.handleInviteDelete === 'function') {
      await command.handleInviteDelete(invite, client);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  for (const command of client.commands.values()) {
    if (typeof command.handleMessageCreate === 'function') {
      await command.handleMessageCreate(message, client);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) {
        await command.execute(interaction, client);
      }
      return;
    }

    for (const command of client.commands.values()) {
      if (typeof command.handleInteraction === 'function') {
        const handled = await command.handleInteraction(interaction, client);
        if (handled) {
          return;
        }
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error happened while handling this interaction.',
        ephemeral: true,
      });
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
