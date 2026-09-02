const { SlashCommandBuilder } = require('discord.js');
const { balancePayload, invalidTargetPayload } = require('../components/builders');

const COUNTING_COMMANDS = Object.freeze([{
  data: new SlashCommandBuilder()
    .setName('cs-balance')
    .setDescription('View a Bronze Coin balance.')
    .addUserOption((option) => option.setName('user').setDescription('User to view')),
}]);

function parseBalanceCommand(content) {
  const match = String(content || '').trim().match(/^csbalance(?:\s+(.*))?$/i);
  if (!match) return null;
  return { argument: String(match[1] || '').trim() };
}

async function resolveTextTarget(message, argument) {
  if (!argument) return message.author;
  const mention = argument.match(/^<@!?(\d{16,20})>$/);
  const rawId = argument.match(/^(\d{16,20})$/);
  const userId = mention?.[1] || rawId?.[1];
  if (!userId) return null;
  const mentioned = message.mentions?.users?.get?.(userId);
  if (mentioned) return mentioned;
  const memberUser = message.guild?.members?.cache?.get?.(userId)?.user;
  if (memberUser) return memberUser;
  try {
    return await message.client?.users?.fetch?.(userId) || null;
  } catch {
    return null;
  }
}

function createCommandHandlers(service) {
  async function replyWithBalance(source, user) {
    await source.reply(balancePayload(user, service.balance(user.id)));
  }

  async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'cs-balance') return false;
    const user = interaction.options.getUser('user') || interaction.user;
    await replyWithBalance(interaction, user);
    return true;
  }

  async function handleMessage(message) {
    const command = parseBalanceCommand(message.content);
    if (!command) return false;
    const user = await resolveTextTarget(message, command.argument);
    if (!user) await message.reply(invalidTargetPayload());
    else await replyWithBalance(message, user);
    return true;
  }

  return { handleInteraction, handleMessage };
}

module.exports = {
  COUNTING_COMMANDS,
  createCommandHandlers,
  parseBalanceCommand,
  resolveTextTarget,
};
