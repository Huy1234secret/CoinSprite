const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
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

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';
const STOCK_SETUP_COMMAND_NAME = 'stock-set-up';
const STOCK_SETUP_COMMAND = new SlashCommandBuilder()
  .setName(STOCK_SETUP_COMMAND_NAME)
  .setDescription('Set up GAG2 stock auto-posting in the dashboard.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

function dashboardBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configured) return configured;
  try {
    return new URL(process.env.DISCORD_REDIRECT_URI || '').origin;
  } catch {
    return DEFAULT_DASHBOARD_BASE_URL;
  }
}

async function executeStockSetupCommand(interaction) {
  await interaction.reply({
    content: [
      'Open the dashboard and edit the **GAG2 Stock** tab.',
      `Dashboard: ${dashboardBaseUrl()}/admin`,
      `Server ID: ${interaction.guildId}`,
    ].join('\n'),
    flags: EPHEMERAL,
  });
}

async function clearGuildCommands(guild) {
  await guild.commands.set([]).catch((error) => {
    logCommandSystem(`Old command cleanup failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
  });
}

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

  // Remove every legacy guild command first. The one supported GAG stock
  // command is registered globally below, so Discord exposes no stale extras.
  await Promise.all([...client.guilds.cache.values()].map(clearGuildCommands));
  await client.application.commands.set([STOCK_SETUP_COMMAND]).catch((error) => {
    logCommandSystem(`Stock setup command registration failed: ${error?.message || 'unknown error'}`);
  });

  startAdminServer(client);
  await startGag2UpdateAnnouncement(client);
  await startGag2StockPoster(client);
});

client.on(Events.GuildCreate, async (guild) => {
  ensureGuildConfig(guild.id);
  await clearGuildCommands(guild);
  logCommandSystem(`GAG stock configuration created for guild ${guild.id}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!isGuildEnabled(interaction.guildId)) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === STOCK_SETUP_COMMAND_NAME) {
      await interaction.reply({ content: 'GAG stock is disabled in this server.', flags: EPHEMERAL }).catch(() => null);
    }
    return;
  }

  try {
    if (await handleGag2RoleAssignmentInteraction(interaction)) return;
    if (interaction.isChatInputCommand?.() && interaction.commandName === STOCK_SETUP_COMMAND_NAME) {
      await executeStockSetupCommand(interaction);
    }
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
