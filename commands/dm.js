const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const USER_ID_PATTERN = /^\d{16,20}$/;

function canUseDmCommand(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

const MAX_PREFIX_RECIPIENTS = 25;

function prefixDmUsage() {
  return 'Usage: `!DM [userId1,userId2] message yes|no` (`yes` mentions each recipient).';
}

function parsePrefixDm(content) {
  const command = String(content || '').trim();
  if (!/^!dm(?:\s|$)/i.test(command)) return null;

  const match = command.match(/^!dm\s+(\[[^\]]*\]|\S+)\s+([\s\S]*?)\s+(yes|no)$/i);
  if (!match) return { error: prefixDmUsage() };

  const recipientToken = match[1];
  const rawIds = recipientToken.startsWith('[') && recipientToken.endsWith(']')
    ? recipientToken.slice(1, -1).split(',').map((value) => value.trim())
    : [recipientToken.trim()];
  const userIds = [...new Set(rawIds.filter(Boolean))];
  const invalidIds = userIds.filter((userId) => !USER_ID_PATTERN.test(userId));
  if (!userIds.length) return { error: 'At least one Discord user ID is required.' };
  if (invalidIds.length) return { error: `Invalid Discord user ID(s): ${invalidIds.join(', ')}` };
  if (userIds.length > MAX_PREFIX_RECIPIENTS) {
    return { error: `You can DM at most ${MAX_PREFIX_RECIPIENTS} users at once.` };
  }

  const text = match[2].trim();
  if (!text) return { error: 'Message text is required.' };
  return {
    userIds,
    text,
    mentionUsers: match[3].toLowerCase() === 'yes',
  };
}

async function sendDm(client, userId, text, mentionUser = false) {
  if (!USER_ID_PATTERN.test(String(userId || ''))) throw new Error('Invalid user ID.');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Message text is required.');

  const prefix = mentionUser ? `<@${userId}> ` : '';
  if (prefix.length + clean.length > 2000) throw new Error('Message is too long for Discord.');
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) throw new Error('Could not find that Discord user.');
  await user.send({
    content: `${prefix}${clean}`,
    allowedMentions: mentionUser ? { parse: [], users: [userId] } : { parse: [] },
  });
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
    if (parsed.error) {
      await message.reply({ content: parsed.error }).catch(() => null);
      return;
    }

    const sent = [];
    const failed = [];
    for (const userId of parsed.userIds) {
      try {
        const user = await sendDm(client, userId, parsed.text, parsed.mentionUsers);
        sent.push(user.tag || user.username || userId);
      } catch (error) {
        failed.push(`${userId}: ${error?.message || 'Failed to send DM.'}`);
      }
    }

    const summary = [
      sent.length ? `DM sent to ${sent.length} user(s): ${sent.join(', ')}` : '',
      failed.length ? `Failed (${failed.length}): ${failed.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    await message.reply({ content: summary.slice(0, 2000) }).catch(() => null);
  },

  __test: { parsePrefixDm, sendDm },
};
