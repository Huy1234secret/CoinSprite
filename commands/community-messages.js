'use strict';

const { Events, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { defaultTemplate, sanitizeCommunityMessages } = require('../src/communityMessageConfig');
const { buildMessagePayload } = require('../src/messageTemplates');

let removeListenerInstalled = false;

function eventSettings(guildId, eventName) {
  const messages = sanitizeCommunityMessages(getGuildConfig(guildId)?.communityMessages);
  return messages[eventName] || { enabled: false, channelId: '', messageTemplate: defaultTemplate(eventName) };
}

async function sendCommunityMessage(member, eventName) {
  if (!member?.guild || member.user?.bot) return false;
  const settings = eventSettings(member.guild.id, eventName);
  if (!settings.enabled || !settings.channelId) return false;
  const channel = member.guild.channels.cache.get(settings.channelId)
    || await member.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send(buildMessagePayload(settings.messageTemplate, {
    guild: member.guild,
    channel,
    user: member.user,
    member,
  }));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('community-messages')
    .setDescription('Show welcome, goodbye, and booster message status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  init(client) {
    if (removeListenerInstalled) return;
    removeListenerInstalled = true;
    client.on(Events.GuildMemberRemove, (member) => {
      sendCommunityMessage(member, 'goodbye').catch((error) => console.error('Goodbye message failed:', error));
    });
  },

  async execute(interaction) {
    const lines = ['welcome', 'goodbye', 'booster'].map((eventName) => {
      const settings = eventSettings(interaction.guildId, eventName);
      return '**' + eventName[0].toUpperCase() + eventName.slice(1) + ':** '
        + (settings.enabled ? 'enabled in <#' + settings.channelId + '>' : 'disabled');
    });
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
  },

  async handleGuildMemberAdd(member) {
    await sendCommunityMessage(member, 'welcome');
  },

  async handleGuildMemberUpdate(oldMember, newMember) {
    const wasBoosting = Boolean(oldMember?.premiumSinceTimestamp || oldMember?.premiumSince);
    const isBoosting = Boolean(newMember?.premiumSinceTimestamp || newMember?.premiumSince);
    if (!wasBoosting && isBoosting) await sendCommunityMessage(newMember, 'booster');
  },

  __test: { eventSettings, sendCommunityMessage },
};
