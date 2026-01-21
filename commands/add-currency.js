const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { addCurrencyToUser } = require('../src/userStats');
const { CURRENCIES, CURRENCIES_BY_KEY } = require('../src/currencies');

function formatCurrencyChoice(currency) {
  const emoji = currency.emoji ? `${currency.emoji} ` : '';
  return `${emoji}${currency.name}`.trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-currency')
    .setDescription('Add currency to a user (admin only).')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Currency type to add.')
        .setRequired(true)
        .addChoices(
          ...CURRENCIES.map((currency) => ({
            name: formatCurrencyChoice(currency),
            value: currency.key,
          }))
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Amount of currency to add (use a negative number to remove).')
        .setRequired(true)
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('User to receive the currency.').setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }

    const currencyKey = interaction.options.getString('type', true);
    const amount = interaction.options.getInteger('amount', true);
    const targetUser = interaction.options.getUser('user', true);
    const currency = CURRENCIES_BY_KEY[currencyKey];

    if (!currency) {
      await interaction.reply({ content: 'Unknown currency type.', ephemeral: true });
      return;
    }

    if (!Number.isInteger(amount) || amount === 0) {
      await interaction.reply({ content: 'Amount must be a non-zero integer.', ephemeral: true });
      return;
    }

    const updatedStats = addCurrencyToUser(targetUser.id, currencyKey, amount);

    if (!updatedStats) {
      await interaction.reply({ content: 'Unable to update that currency.', ephemeral: true });
      return;
    }

    const newBalance = updatedStats[currencyKey] ?? 0;
    const emoji = currency.emoji ? `${currency.emoji} ` : '';
    const action = amount > 0 ? 'Added' : 'Removed';
    const magnitude = Math.abs(amount);
    await interaction.reply({
      content: `${action} ${emoji}${magnitude} ${currency.name} ${
        amount > 0 ? 'to' : 'from'
      } ${targetUser.username}. New balance: ${newBalance}.`,
      ephemeral: true,
    });
  },
};
