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
const { startGag2StockPoster } = require('./src/gag2Stock/manager');
const { handleGag2RoleAssignmentInteraction } = require('./src/gag2Stock/roleAssignment');
const { startGag2UpdateAnnouncement } = require('./src/gag2Stock/updateAnnouncement');
const { createRngGameFeature } = require('./src/features/rng-game');
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
const rngGame = createRngGameFeature({
  getGuildPolicy(guildId) {
    const config = getGuildConfigRaw(guildId);
    return {
      unlocked: config?.enabled !== false && config?.features?.rngGame === true,
      enabled: config?.rngGame?.enabled === true,
      gameChannelId: config?.rngGame?.gameChannelId || '',
      cooldownBypassRoleIds: config?.rngGame?.cooldownBypassRoleIds || [],
    };
  },
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

client.once(Events.ClientReady, async () => {
  console.info(`Ready as ${client.user.tag}`);
  logLevelCardRendererIdentity(logCommandSystem, 'Bot');
  logCommandSystem(`Bot ready as ${client.user.tag}. GAG stock, leveling, RNG economy, and owner panel are active.`);

  for (const guild of client.guilds.cache.values()) ensureGuildConfig(guild.id);

  // Optional features are guild commands so Discord only exposes them where the
  // owner has unlocked the feature and the server has enabled its engine.
  await client.application.commands.set(GLOBAL_APPLICATION_COMMANDS).catch((error) => {
    logCommandSystem(`Application command registration failed: ${error?.message || 'unknown error'}`);
  });
  await Promise.all([...client.guilds.cache.values()].map(syncGuildCommands));

  startAdminServer(client);
  await startGag2UpdateAnnouncement(client);
  await startGag2StockPoster(client);
});

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

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logCommandSystem('Startup failed: DISCORD_TOKEN environment variable is not set.');
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token);
