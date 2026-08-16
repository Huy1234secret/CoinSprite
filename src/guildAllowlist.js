const ALLOWED_GUILD_IDS = Object.freeze([
  '1534541772850724967',
  '1493901002519347290',
]);

const ALLOWED_GUILD_ID_SET = new Set(ALLOWED_GUILD_IDS);
const pendingUnauthorizedGuildIds = new Set();

function isGuildAllowlisted(guildId) {
  return ALLOWED_GUILD_ID_SET.has(String(guildId || ''));
}

function isUnauthorizedGuildPending(guildId) {
  return pendingUnauthorizedGuildIds.has(String(guildId || ''));
}

async function leaveUnauthorizedGuild(guild, options = {}) {
  const guildId = String(guild?.id || '');
  if (!guildId || isGuildAllowlisted(guildId)) return { guildId, allowed: true, left: false };

  const log = typeof options.log === 'function' ? options.log : () => {};
  pendingUnauthorizedGuildIds.add(guildId);
  log(`Leaving unauthorized guild ${guildId}.`);
  try {
    await guild.leave();
    pendingUnauthorizedGuildIds.delete(guildId);
    return { guildId, allowed: false, left: true };
  } catch (error) {
    log(`Failed to leave unauthorized guild ${guildId}: ${error?.message || 'unknown error'}`);
    return { guildId, allowed: false, left: false, error };
  }
}

async function leaveUnauthorizedGuilds(guilds, options = {}) {
  const results = [];
  // Deliberately sequential: startup cleanup is bounded and never bursts the API.
  for (const guild of guilds || []) results.push(await leaveUnauthorizedGuild(guild, options));
  return results;
}

function createGuildCreateHandler(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  return async function handleGuildCreate(guild) {
    if (!isGuildAllowlisted(guild?.id)) {
      await leaveUnauthorizedGuild(guild, { log });
      return { allowed: false };
    }
    if (options.botEnabled === false) return { allowed: true, initialized: false };
    options.ensureGuildConfig?.(guild.id);
    await options.syncGuildCommands?.(guild);
    log(`CoinSprite leveling and RNG configuration created for guild ${guild.id}.`);
    return { allowed: true, initialized: true };
  };
}

module.exports = {
  ALLOWED_GUILD_IDS,
  createGuildCreateHandler,
  isGuildAllowlisted,
  isUnauthorizedGuildPending,
  leaveUnauthorizedGuild,
  leaveUnauthorizedGuilds,
};
