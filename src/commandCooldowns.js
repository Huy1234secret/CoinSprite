const cooldowns = new Map();

function keyFor(userId, commandName) {
  return `${commandName}:${userId}`;
}

function getCooldownUntil(userId, commandName) {
  const key = keyFor(userId, commandName);
  const until = cooldowns.get(key) || 0;
  if (until <= Date.now()) {
    cooldowns.delete(key);
    return 0;
  }
  return until;
}

function setCommandCooldown(userId, commandName, durationMs) {
  const duration = Math.max(0, Math.floor(Number(durationMs) || 0));
  if (!userId || !commandName || duration <= 0) return 0;
  const until = Date.now() + duration;
  cooldowns.set(keyFor(userId, commandName), until);
  return until;
}

async function replyIfOnCooldown(interaction, commandName, durationMs, flags) {
  const until = getCooldownUntil(interaction.user.id, commandName);
  if (until <= Date.now()) return false;
  await interaction.reply({
    content: `You can use /${commandName} again <t:${Math.floor(until / 1000)}:R>.`,
    flags,
  });
  return true;
}

module.exports = {
  getCooldownUntil,
  setCommandCooldown,
  replyIfOnCooldown,
};
