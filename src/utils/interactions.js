function isRepliable(interaction) {
  return Boolean(interaction && typeof interaction === 'object');
}

async function safeErrorReply(interaction, message) {
  if (!isRepliable(interaction)) {
    return;
  }

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: 64 });
    } else {
      await interaction.reply({ content: message, flags: 64 });
    }
  } catch (error) {
    console.error('Failed to send error response for interaction:', error);
  }
}

module.exports = { safeErrorReply };
