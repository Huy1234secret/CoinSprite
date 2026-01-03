const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { config } = require('dotenv');
const { safeErrorReply } = require('./src/utils/interactions');
const { addXpToUser } = require('./src/userStats');
const { saveGuildData } = require('./src/serverData');

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});
client.commands = new Collection();

const activeVoiceSessions = new Map();

const HOME_SERVER_ID = '1372572233930903592';
const HOME_CHANNEL_ID = '1456942349765836936';
const GUIDE_URL = 'https://sites.google.com/view/coinsprite/home';
const KNOWN_GUILDS_FILE = path.join(__dirname, 'data', 'known-guilds.json');

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

function loadKnownGuilds() {
  try {
    const raw = fs.readFileSync(KNOWN_GUILDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Unable to load known guilds list:', error);
    }
  }

  return new Set();
}

function persistKnownGuilds(guildIds) {
  try {
    const dir = path.dirname(KNOWN_GUILDS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KNOWN_GUILDS_FILE, JSON.stringify([...guildIds], null, 2));
  } catch (error) {
    console.warn('Unable to persist known guilds list:', error);
  }
}

const knownGuildIds = loadKnownGuilds();

async function sendOwnerGreeting(guild) {
  try {
    const owner = await guild.fetchOwner();
    if (!owner?.user || owner.user.bot) {
      return;
    }

    const greeting = [
      `Thanks for adding **${client.user.username}** to **${guild.name}**!`,
      'Here are a few tips to get started:',
      '- Explore the available slash commands to see what I can do.',
      `- Check out the quick guide for more info: ${GUIDE_URL}`,
    ].join('\n');

    await owner.send(greeting);
  } catch (error) {
    console.warn(`Unable to DM guild owner for ${guild.id}:`, error);
  }
}

async function notifyHomeServer(guild) {
  try {
    const homeChannel = await client.channels.fetch(HOME_CHANNEL_ID);
    if (!homeChannel || homeChannel.guildId !== HOME_SERVER_ID) {
      return;
    }

    const ownerTag = guild.members.cache.get(guild.ownerId)?.user?.tag;
    const joinedAt = new Date();

    const details = [
      `🆕 Joined server: **${guild.name}** (${guild.id})`,
      `👥 Members: ${guild.memberCount}`,
      `👑 Owner: <@${guild.ownerId}>${ownerTag ? ` (${ownerTag})` : ''}`,
      `📅 Date invited: ${joinedAt.toLocaleString()}`,
    ].join('\n');

    await homeChannel.send({ content: details });
  } catch (error) {
    console.warn('Failed to notify home channel about new guild:', error);
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

client.on(Events.GuildCreate, async (guild) => {
  try {
    await saveGuildData(guild);
  } catch (error) {
    console.warn(`Failed to save data for guild ${guild.id}:`, error);
  }

  const isNewGuild = !knownGuildIds.has(guild.id);
  if (isNewGuild) {
    knownGuildIds.add(guild.id);
    persistKnownGuilds(knownGuildIds);

    await sendOwnerGreeting(guild);
    await notifyHomeServer(guild);
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
