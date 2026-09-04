function createGuildCreateHandler(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  return async function handleGuildCreate(guild) {
    if (!guild?.id || options.botEnabled === false) return { initialized: false };
    options.ensureGuildConfig?.(guild.id);
    await options.syncGuildCommands?.(guild);
    log(`CoinSprite configuration created for guild ${guild.id}.`);
    return { initialized: true };
  };
}

module.exports = { createGuildCreateHandler };
