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
const { requireSchedulerRole } = require('./src/runtimeRole');
const { startGag2StockPoster } = require('./src/gag2Stock/manager');
const { handleGag2RoleAssignmentInteraction } = require('./src/gag2Stock/roleAssignment');
const { startGag2UpdateAnnouncement } = require('./src/gag2Stock/updateAnnouncement');
const {
  COMPONENTS_V2_FLAG,
  LEVELING_COMMANDS,
  handleLevelingInteraction,
  handleLevelingMessage,
} = require('./src/leveling');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';
const STOCK_SETUP_COMMAND_NAME = 'stock-set-up';
const STOCK_SETUP_COMMAND = new SlashCommandBuilder()
  .setName(STOCK_SETUP_COMMAND_NAME)
  .setDescription('Set up GAG2 stock auto-posting in the dashboard.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();
const APPLICATION_COMMANDS = [STOCK_SETUP_COMMAND, ...LEVELING_COMMANDS.map((command) => command.data.toJSON())];

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
    flags: COMPONENTS_V2_FLAG | EPHEMERAL,
    components: [{
      type: 17,
      accent_color: 0xb9f547,
      components: [
        { type: 10, content: `## GAG2 Stock setup\nOpen the dashboard to configure live stock routes and notification roles.\n-# Server ID: ${interaction.guildId}` },
        { type: 14, divider: true, spacing: 1 },
        { type: 1, components: [{ type: 2, style: 5, label: 'Open stock dashboard', url: `${dashboardBaseUrl()}/admin` }] },
      ],
    }],
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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

setLogClient(client);

client.once(Events.ClientReady, async () => {
  console.info(`Ready as ${client.user.tag}`);
  logCommandSystem(`Bot ready as ${client.user.tag}. GAG stock, leveling, and owner panel are active.`);

  for (const guild of client.guilds.cache.values()) ensureGuildConfig(guild.id);

  // Remove every legacy guild command first. The focused stock and leveling
  // command set is registered globally below, so Discord exposes no stale extras.
  await Promise.all([...client.guilds.cache.values()].map(clearGuildCommands));
  await client.application.commands.set(APPLICATION_COMMANDS).catch((error) => {
    logCommandSystem(`Application command registration failed: ${error?.message || 'unknown error'}`);
  });

  startAdminServer(client);
  await startGag2UpdateAnnouncement(client);
  if (schedulerEnabled) {
    await startGag2StockPoster(client);
    console.info(`GAG2 stock poster started (role=${runtimeRole}).`);
  } else {
    console.info(`GAG2 stock poster disabled (role=${runtimeRole}).`);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  ensureGuildConfig(guild.id);
  await clearGuildCommands(guild);
  logCommandSystem(`CoinSprite stock and leveling configuration created for guild ${guild.id}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!isGuildEnabled(interaction.guildId)) {
    if (interaction.isRepliable?.()) {
      await interaction.reply({
        flags: COMPONENTS_V2_FLAG | EPHEMERAL,
        components: [{ type: 17, accent_color: 0xff6b6b, components: [{ type: 10, content: '## CoinSprite is disabled\nAsk the bot owner to enable this server.' }] }],
      }).catch(() => null);
    }
    return;
  }

  try {
    if (await handleGag2RoleAssignmentInteraction(interaction)) return;
    if (await handleLevelingInteraction(interaction)) return;
    if (interaction.isChatInputCommand?.() && interaction.commandName === STOCK_SETUP_COMMAND_NAME) {
      await executeStockSetupCommand(interaction);
    }
  } catch (error) {
    console.error('CoinSprite interaction failed:', error);
    logCommandSystem(`CoinSprite interaction failed: ${error?.message || 'unknown error'}`);
  }
});

client.on(Events.MessageCreate, (message) => {
  handleLevelingMessage(message).catch((error) => {
    logCommandSystem(`Leveling message handler failed in guild ${message.guildId || 'unknown'}: ${error?.message || 'unknown error'}`);
  });
});

const { role: runtimeRole, schedulerEnabled } = requireSchedulerRole();
console.info(`CoinSprite runtime role=${runtimeRole} schedulerEnabled=${schedulerEnabled} pid=${process.pid}`);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logCommandSystem('Startup failed: DISCORD_TOKEN environment variable is not set.');
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
