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
const { createRngGameFeature } = require('./src/features/rng-game');
const { createGuildCreateHandler } = require('./src/guildLifecycle');
const { formatInteractionFailure, safeErrorMessage } = require('./src/features/shared/interactionResponses');
const {
  GLOBAL_APPLICATION_COMMANDS,
  syncGuildApplicationCommands,
} = require('./src/applicationCommands');
const {
  handleLevelingInteraction,
  handleLevelingMessage,
  startXpDropScheduler,
} = require('./src/leveling');
const {
  handleBoostSystemMessage,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleGuildMemberUpdate,
} = require('./src/memberMessages');
const { handleReactionRoleInteraction } = require('./src/reactionRoles');
const { handleMessageTemplateInteraction } = require('./src/messageTemplateInteractions');
const { createRainbowRoleScheduler } = require('./src/rainbowRole');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';
const { role: runtimeRole } = requireSchedulerRole();
function getRngGuildPolicy(guildId) {
  const guildConfig = getGuildConfigRaw(guildId);
  return {
    unlocked: guildConfig?.enabled !== false && guildConfig?.features?.rngGame === true,
    enabled: guildConfig?.rngGame?.enabled === true,
    gameChannelIds: guildConfig?.rngGame?.gameChannelIds || [],
    cooldownBypassRoleIds: guildConfig?.rngGame?.cooldownBypassRoleIds || [],
  };
}

const rngGame = createRngGameFeature({
  getGuildPolicy: getRngGuildPolicy,
  chancePageUrl: `${dashboardBaseUrl()}/chances`,
  onError(error) {
    logCommandSystem(`RNG game event failed: ${safeErrorMessage(error)}`);
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

const rainbowRoleScheduler = createRainbowRoleScheduler(client, { log: logCommandSystem });

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
    startXpDropScheduler(client);
    rainbowRoleScheduler.start();
  },
  async panel() {
    startAdminServer(client, { rngGame });
  },
});

client.once(Events.ClientReady, async () => {
  await runtimeStarter.start().catch((error) => {
    logCommandSystem(`Runtime startup failed: ${error?.message || 'unknown error'}`);
    console.error('CoinSprite runtime startup failed:', error);
  });
});

client.on(Events.GuildCreate, createGuildCreateHandler({
  botEnabled: runtimeStarter.capabilities.bot,
  ensureGuildConfig,
  syncGuildCommands,
  log: logCommandSystem,
}));

if (runtimeStarter.capabilities.bot) {
  client.on(Events.GuildMemberAdd, async (member) => {
    await handleGuildMemberAdd(member).catch((error) => {
      logCommandSystem(`Welcome Messages join handler failed in guild ${member?.guild?.id || 'unknown'}: ${error?.message || 'unknown error'}`);
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await handleGuildMemberRemove(member).catch((error) => {
      logCommandSystem(`Welcome Messages leave handler failed in guild ${member?.guild?.id || 'unknown'}: ${error?.message || 'unknown error'}`);
    });
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    await handleGuildMemberUpdate(oldMember, newMember).catch((error) => {
      logCommandSystem(`Welcome Messages boost handler failed in guild ${newMember?.guild?.id || 'unknown'}: ${error?.message || 'unknown error'}`);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    const startedAt = Date.now();
    try {
      if (await handleMessageTemplateInteraction(interaction, { client })) return;
      if (!isGuildEnabled(interaction.guildId)) {
        if (interaction.isRepliable?.()) {
          await interaction.reply({
            flags: EPHEMERAL,
            content: 'CoinSprite is disabled. Ask the bot owner to enable this server.',
          });
        }
        return;
      }
      if (await handleReactionRoleInteraction(interaction)) return;
      if (await rngGame.handleInteraction(interaction)) return;
      if (await handleLevelingInteraction(interaction)) return;
    } catch (error) {
      const diagnostic = formatInteractionFailure(error, interaction, { startedAt });
      console.error(`CoinSprite interaction failed: ${diagnostic}`);
      logCommandSystem(`CoinSprite interaction failed: ${diagnostic}`);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleBoostSystemMessage(message);
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
