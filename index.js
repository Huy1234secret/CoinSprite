const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { config } = require('dotenv');

config();

const { logCommandSystem, setLogClient } = require('./src/commandLogger');
const {
  ensureGuildConfig,
  isGuildEnabled,
} = require('./src/serverConfig');
const { startAdminServer } = require('./src/adminServer');
const { startGag2StockPoster } = require('./src/gag2Stock/manager');
const { handleGag2RoleAssignmentInteraction } = require('./src/gag2Stock/roleAssignment');
const { startGag2UpdateAnnouncement } = require('./src/gag2Stock/updateAnnouncement');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.GuildMember],
});

setLogClient(client);

client.once(Events.ClientReady, async () => {
  console.info(`Ready as ${client.user.tag}`);
  logCommandSystem(`Bot ready as ${client.user.tag}. GAG stock and owner panel are active.`);

  for (const guild of client.guilds.cache.values()) ensureGuildConfig(guild.id);

  startAdminServer(client);
  await startGag2UpdateAnnouncement(client);
  await startGag2StockPoster(client);

  await client.application.commands.set([]).catch((error) => {
    logCommandSystem(`Global command cleanup failed: ${error?.message || 'unknown error'}`);
  });
});

client.on(Events.GuildCreate, async (guild) => {
  ensureGuildConfig(guild.id);
  await guild.commands.set([]).catch((error) => {
    logCommandSystem(`Command cleanup failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });
  logCommandSystem(`GAG stock configuration created for guild ${guild.id}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!isGuildEnabled(interaction.guildId)) return;

  try {
    await handleGag2RoleAssignmentInteraction(interaction);
  } catch (error) {
    console.error('GAG stock interaction failed:', error);
    logCommandSystem(`GAG stock interaction failed: ${error?.message || 'unknown error'}`);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logCommandSystem('Startup failed: DISCORD_TOKEN environment variable is not set.');
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
