const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const USER_ID_PATTERN = /^\d{16,20}$/;

function canUseDmCommand(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function parsePrefixDm(content) {
  const match = String(content || '').match(/^!dm\s+(\d{16,20})\s+([\s\S]+)$/i);
  if (!match) return null;
  let text = match[2].trim();
  let deleteInvoker = false;
  const flag = text.match(/\s+(yes|no)$/i);
  if (flag) {
    deleteInvoker = flag[1].toLowerCase() === 'yes';
    text = text.slice(0, flag.index).trim();
  }
  return { userId: match[1], text, deleteInvoker };
}

async function sendDm(client, userId, text) {
  if (!USER_ID_PATTERN.test(String(userId || ''))) throw new Error('Invalid user ID.');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Message text is required.');
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) throw new Error('Could not find that Discord user.');
  await user.send({ content: clean.slice(0, 2000), allowedMentions: { parse: [] } });
  return user;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message from the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option
      .setName('user_id')
      .setDescription('Discord user ID to DM')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('message')
      .setDescription('Message text to send')
      .setRequired(true)),

  async execute(interaction, client) {
    if (!canUseDmCommand(interaction.member)) {
      await interaction.reply({ content: 'Only administrators can use this command.', flags: EPHEMERAL_FLAG });
      return;
    }
    const userId = interaction.options.getString('user_id', true).trim();
    const text = interaction.options.getString('message', true);
    try {
      const user = await sendDm(client, userId, text);
      await interaction.reply({ content: `DM sent to ${user.tag || user.username}.`, flags: EPHEMERAL_FLAG });
    } catch (error) {
      await interaction.reply({ content: error?.message || 'Failed to send DM.', flags: EPHEMERAL_FLAG });
    }
  },

  async handleMessageCreate(message, client) {
    if (message.author?.bot || !message.guildId) return;
    const parsed = parsePrefixDm(message.content);
    if (!parsed) return;
    if (!canUseDmCommand(message.member)) {
      await message.reply({ content: 'Only administrators can use `!DM`.' }).catch(() => null);
      return;
    }
    try {
      const user = await sendDm(client, parsed.userId, parsed.text);
      await message.reply({ content: `DM sent to ${user.tag || user.username}.` }).catch(() => null);
      if (parsed.deleteInvoker) await message.delete().catch(() => null);
    } catch (error) {
      await message.reply({ content: error?.message || 'Failed to send DM.' }).catch(() => null);
    }
  },

  __test: { parsePrefixDm },
};
