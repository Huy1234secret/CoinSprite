'use strict';

const { Events, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');

const DEFAULT_MESSAGES = Object.freeze({
  welcome: 'Welcome <@mention> to **<server-name>**! You are member **<member-count>**.',
  goodbye: '**<display-name>** has left **<server-name>**.',
  booster: 'Thank you <@mention> for boosting **<server-name>**!',
});
let removeListenerInstalled = false;

function eventSettings(guildId, eventName) {
  const value = getGuildConfig(guildId)?.communityMessages?.[eventName] || {};
  return {
    enabled: Boolean(value.enabled),
    channelId: String(value.channelId || ''),
    message: String(value.message || DEFAULT_MESSAGES[eventName] || '').slice(0, 2000),
  };
}

function replaceMessagePlaceholders(template, member) {
  const user = member.user || member;
  const values = {
    mention: '<@' + user.id + '>',
    username: user.username || user.id,
    'display-name': member.displayName || user.globalName || user.username || user.id,
    'user-id': user.id,
    'server-name': member.guild?.name || 'this server',
    'member-count': String(member.guild?.memberCount || 0),
  };
  return String(template || '').replace(/<([a-z0-9_-]+)>/gi, (match, token) => (
    Object.prototype.hasOwnProperty.call(values, token.toLowerCase()) ? values[token.toLowerCase()] : match
  ));
}

async function sendCommunityMessage(member, eventName) {
  if (!member?.guild || member.user?.bot) return false;
  const settings = eventSettings(member.guild.id, eventName);
  if (!settings.enabled || !settings.channelId || !settings.message) return false;
  const channel = member.guild.channels.cache.get(settings.channelId)
    || await member.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({
    content: replaceMessagePlaceholders(settings.message, member),
    allowedMentions: { users: [member.id], roles: [], parse: [] },
  });
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

  __test: { eventSettings, replaceMessagePlaceholders, sendCommunityMessage },
};
