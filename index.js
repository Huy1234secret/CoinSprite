const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} = require('discord.js');
const { config } = require('dotenv');

config();

const { logCommandSystem, setLogClient } = require('./src/commandLogger');
const {
  ensureGuildConfig,
  getGuildConfigRaw,
  isGuildEnabled,
} = require('./src/serverConfig');
const { startAdminServer } = require('./src/adminServer');
const { logLevelCardRendererIdentity } = require('./src/canvasFonts');
const {
  createRuntimeStarter,
  normalizeRuntimeRole,
  requireSchedulerRole,
  runtimeDiagnostic,
} = require('./src/runtimeRole');
const { startGag2StockPoster } = require('./src/gag2Stock/manager');
const { handleGag2RoleAssignmentInteraction } = require('./src/gag2Stock/roleAssignment');
const { startGag2UpdateAnnouncement } = require('./src/gag2Stock/updateAnnouncement');
const { createRngGameFeature } = require('./src/features/rng-game');
const { createFarmingGameFeature } = require('./src/features/farming-game');
const {
  GLOBAL_APPLICATION_COMMANDS,
  STOCK_SETUP_COMMAND_NAME,
  syncGuildApplicationCommands,
} = require('./src/applicationCommands');
const {
  COMPONENTS_V2_FLAG,
  handleLevelingInteraction,
  handleLevelingMessage,
} = require('./src/leveling');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';
const { role: runtimeRole, schedulerEnabled } = requireSchedulerRole();
function getRngGuildPolicy(guildId) {
  const guildConfig = getGuildConfigRaw(guildId);
  return {
    unlocked: guildConfig?.enabled !== false && guildConfig?.features?.rngGame === true,
    enabled: guildConfig?.rngGame?.enabled === true,
    gameChannelIds: guildConfig?.rngGame?.gameChannelIds || [],
    cooldownBypassRoleIds: guildConfig?.rngGame?.cooldownBypassRoleIds || [],
  };
}

function getFarmingGuildPolicy(guildId) {
  const guildConfig = getGuildConfigRaw(guildId);
  return {
    unlocked: guildConfig?.enabled !== false && guildConfig?.features?.farmingGame === true,
    enabled: guildConfig?.farmingGame?.enabled === true,
    gameChannelIds: guildConfig?.farmingGame?.gameChannelIds || [],
  };
}

const rngGame = createRngGameFeature({ getGuildPolicy: getRngGuildPolicy });
const farmingGame = createFarmingGameFeature({
  db: rngGame.db,
  cropRepository: rngGame.repository,
  cropGameService: rngGame.gameService,
  saleSessions: rngGame.saleSessions,
  getGuildPolicy: getFarmingGuildPolicy,
});

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

async function syncGuildCommands(guild) {
  await syncGuildApplicationCommands(guild).catch((error) => {
    logCommandSystem(`Application command sync failed for guild ${guild.id}: ${error?.message || 'unknown error'}`);
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

const runtimeStarter = createRuntimeStarter(runtimeRole, {
  async common() {
    console.info(`Ready as ${client.user.tag}`);
    logLevelCardRendererIdentity(logCommandSystem, 'Bot');
    logCommandSystem(runtimeDiagnostic(runtimeRole, client));
    for (const guild of client.guilds.cache.values()) ensureGuildConfig(guild.id);
  },
  async bot() {
    await client.application.commands.set(GLOBAL_APPLICATION_COMMANDS).catch((error) => {
      logCommandSystem(`Application command registration failed: ${error?.message || 'unknown error'}`);
    });
    await Promise.all([...client.guilds.cache.values()].map(syncGuildCommands));

    rngGame.startScheduler(client);
    await startGag2UpdateAnnouncement(client);
    if (schedulerEnabled) {
      await startGag2StockPoster(client, { runtimeRole });
    }
  },
  async panel() {
    startAdminServer(client);
  },
});

client.once(Events.ClientReady, async () => {
  await runtimeStarter.start().catch((error) => {
    logCommandSystem(`Runtime startup failed: ${error?.message || 'unknown error'}`);
    console.error('CoinSprite runtime startup failed:', error);
  });
});

if (runtimeStarter.capabilities.bot) {
  client.on(Events.GuildCreate, async (guild) => {
    ensureGuildConfig(guild.id);
    await syncGuildCommands(guild);
    logCommandSystem(`CoinSprite stock, leveling, and RNG configuration created for guild ${guild.id}.`);
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
      if (await rngGame.handleInteraction(interaction)) return;
      if (await farmingGame.handleInteraction(interaction)) return;
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

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (isGuildEnabled(message.guildId) && await rngGame.handleMessage(message)) return;
      await handleLevelingMessage(message);
    } catch (error) {
      logCommandSystem(`Message command handler failed in guild ${message.guildId || 'unknown'}: ${error?.message || 'unknown error'}`);
    }
  });
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logCommandSystem('Startup failed: DISCORD_TOKEN environment variable is not set.');
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
