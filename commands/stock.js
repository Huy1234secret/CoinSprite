const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { loadState, saveState } = require('../src/serverConfig');
const stockManager = require('../src/growGardenStock');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const DEFAULT_CHANNEL_NAME = 'grow-a-garden-2-stock';

function canManageStock(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

async function requireManager(interaction) {
  if (canManageStock(interaction)) return true;
  await interaction.reply({ content: 'Manage Server permission is required to configure stock updates.', flags: EPHEMERAL_FLAG });
  return false;
}

function updateStockConfig(guildId, patch) {
  const state = loadState();
  const guildConfig = state.guilds?.[guildId];
  if (!guildConfig) throw new Error('This server does not have a CoinSprite configuration.');
  guildConfig.channels = guildConfig.channels || {};
  guildConfig.roles = guildConfig.roles || {};
  guildConfig.growGardenStock = {
    ...(guildConfig.growGardenStock || {}),
    ...(patch.stock || {}),
  };
  if (patch.channelId !== undefined) guildConfig.channels.growGardenStock = patch.channelId;
  if (patch.pingRoleId !== undefined) guildConfig.roles.growGardenStockPing = patch.pingRoleId;
  saveState(state);
}

async function resolveSetupChannel(interaction) {
  const selected = interaction.options.getChannel('channel');
  if (selected) {
    if (!selected.isTextBased?.() || typeof selected.send !== 'function') throw new Error('Choose a text or announcement channel.');
    return { channel: selected, created: false };
  }

  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('Choose an existing channel, or give the bot Manage Channels so it can create one.');
  }
  const channel = await interaction.guild.channels.create({
    name: DEFAULT_CHANNEL_NAME,
    type: ChannelType.GuildText,
    topic: 'Automatic Grow a Garden 2 shop stock updates from CoinSprite.',
    reason: `Grow a Garden 2 stock setup by ${interaction.user.tag}`,
  });
  return { channel, created: true };
}

function formatStatus(guildId) {
  const config = stockManager.getStockConfig(guildId);
  const runtime = stockManager.getRuntimeGuild(guildId);
  const checked = runtime.lastCheckedAt ? `<t:${Math.floor(runtime.lastCheckedAt / 1000)}:R>` : 'Never';
  const posted = runtime.lastPostedAt ? `<t:${Math.floor(runtime.lastPostedAt / 1000)}:R>` : 'Never';
  return [
    `**Enabled:** ${config.enabled ? 'Yes' : 'No'}`,
    `**Channel:** ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}`,
    `**Provider:** ${config.endpointUrl ? `\`${config.endpointUrl}\`` : 'Not configured'}`,
    `**Interval:** ${Math.round(config.pollIntervalMs / 60000)} minute(s)`,
    `**Mode:** ${config.updateMode === 'post' ? 'Post each stock change' : 'Edit one live stock message'}`,
    `**Ping role:** ${config.pingRoleId ? `<@&${config.pingRoleId}>` : 'None'}`,
    `**Last check:** ${checked}`,
    `**Last post:** ${posted}`,
    runtime.lastError ? `**Last error:** ${runtime.lastError}` : null,
  ].filter(Boolean).join('\n');
}

async function showStockInReply(target, guildId) {
  const { config, stock } = await stockManager.fetchStockSnapshot(guildId);
  const payload = stockManager.buildStockPayload(stock, config, { ping: false });
  await target(payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('View or configure Grow a Garden 2 stock updates.')
    .addSubcommand((subcommand) => subcommand
      .setName('show')
      .setDescription('Show the current Grow a Garden 2 stock.'))
    .addSubcommand((subcommand) => subcommand
      .setName('setup')
      .setDescription('Configure automatic Grow a Garden 2 stock updates.')
      .addStringOption((option) => option
        .setName('endpoint')
        .setDescription('HTTPS JSON stock API endpoint.')
        .setRequired(true)
        .setMaxLength(1000))
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Stock channel. Leave empty to create one.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addIntegerOption((option) => option
        .setName('interval')
        .setDescription('Check interval in minutes (1-60).')
        .setMinValue(1)
        .setMaxValue(60))
      .addStringOption((option) => option
        .setName('mode')
        .setDescription('Keep one live message or post each change.')
        .addChoices(
          { name: 'Edit one live message', value: 'edit' },
          { name: 'Post each stock change', value: 'post' },
        ))
      .addRoleOption((option) => option
        .setName('ping_role')
        .setDescription('Optional role to mention when stock changes.')))
    .addSubcommand((subcommand) => subcommand
      .setName('refresh')
      .setDescription('Force a stock update in the configured channel.'))
    .addSubcommand((subcommand) => subcommand
      .setName('status')
      .setDescription('Show the current stock updater configuration.'))
    .addSubcommand((subcommand) => subcommand
      .setName('disable')
      .setDescription('Disable automatic stock updates.')),

  disableActionTimeout: true,

  async init(client) {
    stockManager.init(client);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'show') {
      await interaction.deferReply();
      try {
        await showStockInReply((payload) => interaction.editReply(payload), interaction.guildId);
      } catch (error) {
        await interaction.editReply(`Could not load stock: ${error?.message || 'unknown error'}`);
      }
      return;
    }

    if (!await requireManager(interaction)) return;

    if (subcommand === 'status') {
      await interaction.reply({ content: formatStatus(interaction.guildId), flags: EPHEMERAL_FLAG });
      return;
    }

    if (subcommand === 'disable') {
      updateStockConfig(interaction.guildId, { stock: { enabled: false } });
      await interaction.reply({ content: 'Automatic Grow a Garden 2 stock updates are disabled.', flags: EPHEMERAL_FLAG });
      return;
    }

    await interaction.deferReply({ flags: EPHEMERAL_FLAG });

    if (subcommand === 'refresh') {
      try {
        const result = await stockManager.publishGuildStock(interaction.guild, { force: true });
        await interaction.editReply(`Stock refreshed in ${result.channel}.`);
      } catch (error) {
        await interaction.editReply(`Could not refresh stock: ${error?.message || 'unknown error'}`);
      }
      return;
    }

    try {
      const endpointUrl = stockManager.assertSafeEndpointUrl(interaction.options.getString('endpoint', true));
      const { channel, created } = await resolveSetupChannel(interaction);
      const intervalMinutes = interaction.options.getInteger('interval') || 5;
      const updateMode = interaction.options.getString('mode') || 'edit';
      const pingRole = interaction.options.getRole('ping_role');
      updateStockConfig(interaction.guildId, {
        channelId: channel.id,
        pingRoleId: pingRole?.id || '',
        stock: {
          enabled: true,
          endpointUrl,
          pollIntervalMs: intervalMinutes * 60 * 1000,
          updateMode,
          title: 'Grow a Garden 2 Stock',
        },
      });

      try {
        await stockManager.publishGuildStock(interaction.guild, { force: true });
        await interaction.editReply(
          `${created ? `Created ${channel} and ` : ''}enabled Grow a Garden 2 stock updates every ${intervalMinutes} minute(s).`,
        );
      } catch (error) {
        await interaction.editReply(
          `${created ? `Created ${channel}. ` : ''}The setup was saved, but the provider test failed: ${error?.message || 'unknown error'}`,
        );
      }
    } catch (error) {
      await interaction.editReply(`Could not configure stock updates: ${error?.message || 'unknown error'}`);
    }
  },

  async handleMessageCreate(message) {
    if (!message.guild || message.author.bot) return;
    const command = message.content.trim().toLowerCase();
    if (command !== '!gagstock' && command !== '!stock') return;
    await message.channel.sendTyping().catch(() => null);
    try {
      await showStockInReply((payload) => message.reply(payload), message.guild.id);
    } catch (error) {
      await message.reply(`Could not load stock: ${error?.message || 'unknown error'}`);
    }
  },
};
