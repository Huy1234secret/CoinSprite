const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { config } = require('dotenv');
const { safeErrorReply } = require('./src/utils/interactions');
const { addXpToUser } = require('./src/userStats');

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
client.commands = new Collection();

const activeVoiceSessions = new Map();

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`The command at ${filePath} is missing required "data" or "execute" properties.`);
    }
  }
}

client.once(Events.ClientReady, async () => {
  try {
    const slashCommands = client.commands.map((command) => command.data.toJSON());
    await client.application.commands.set(slashCommands);
    console.info(`Ready! Logged in as ${client.user.tag}`);
    for (const command of client.commands.values()) {
      if (typeof command.init === 'function') {
        await command.init(client);
      }
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return;
    }

    try {
      await command.execute(interaction, client);
      await addXpToUser(interaction.user.id, 1);
    } catch (error) {
      console.error(`Failed to execute /${interaction.commandName}:`, error);
      await safeErrorReply(interaction, 'There was an error while executing this command.');
    }
    return;
  }

  for (const command of client.commands.values()) {
    if (typeof command.handleComponent === 'function') {
      const handled = await command.handleComponent(interaction);
      if (handled) {
        await addXpToUser(interaction.user.id, 1);
        return;
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) {
    return;
  }

  const randomXp = Math.floor(Math.random() * 5) + 1;
  await addXpToUser(message.author.id, randomXp);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const user = newState.member?.user ?? oldState.member?.user;
  if (!user || user.bot) {
    return;
  }

  const wasInChannel = Boolean(oldState.channelId);
  const isInChannel = Boolean(newState.channelId);
  const userId = user.id;

  if (!wasInChannel && isInChannel) {
    activeVoiceSessions.set(userId, Date.now());
    return;
  }

  if (wasInChannel && !isInChannel) {
    const joinedAt = activeVoiceSessions.get(userId);
    if (joinedAt) {
      const minutes = Math.floor((Date.now() - joinedAt) / 60000);
      if (minutes > 0) {
        await addXpToUser(userId, minutes * 3);
      }
    }
    activeVoiceSessions.delete(userId);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token).catch((error) => {
  console.error('Failed to login:', error);
});
