const COMMAND_ID_PATTERN = /^\d{16,20}$/;

function commandPath(value) {
  if (Array.isArray(value)) return value.map(String).map((part) => part.trim()).filter(Boolean).join(' ');
  return String(value?.path || value || '').trim().replace(/\s+/g, ' ');
}

function commandRoot(value) {
  return commandPath(value).split(' ')[0] || '';
}

function normalizeCommandIds(source) {
  if (source instanceof Map) return new Map([...source].map(([name, id]) => [String(name), String(id)]));
  const result = new Map();
  if (Array.isArray(source)) {
    for (const command of source) {
      if (command?.name && command?.id) result.set(String(command.name), String(command.id));
    }
    return result;
  }
  for (const [name, id] of Object.entries(source || {})) result.set(String(name), String(id));
  return result;
}

function commandMention(value, commandIds) {
  const path = commandPath(value);
  const id = normalizeCommandIds(commandIds).get(commandRoot(path));
  if (path && COMMAND_ID_PATTERN.test(String(id || ''))) return `</${path}:${id}>`;
  return `\`/${path || 'command'}\``;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function addCommandIds(result, commands) {
  for (const command of collectionValues(commands)) {
    if (command?.name && COMMAND_ID_PATTERN.test(String(command.id || ''))) {
      result.set(String(command.name), String(command.id));
    }
  }
}

function resolveCachedCommandIds(client, guildId) {
  const result = new Map();
  if (!client) return result;
  addCommandIds(result, client.application?.commands?.cache);
  const guild = client.guilds?.cache?.get?.(String(guildId || '')) || null;
  addCommandIds(result, guild?.commands?.cache);
  return result;
}

async function fetchManagerCommands(manager) {
  if (!manager) return [];
  const cached = collectionValues(manager.cache);
  if (cached.length) return cached;
  try {
    if (typeof manager.fetch === 'function') return collectionValues(await manager.fetch());
  } catch {
    return collectionValues(manager.cache);
  }
  return collectionValues(manager.cache);
}

async function resolveRegisteredCommandIds(client, guildId) {
  const result = new Map();
  if (!client) return result;

  addCommandIds(result, await fetchManagerCommands(client.application?.commands));

  let guild = client.guilds?.cache?.get?.(String(guildId || '')) || null;
  if (!guild && guildId && typeof client.guilds?.fetch === 'function') {
    guild = await client.guilds.fetch(String(guildId)).catch(() => null);
  }
  addCommandIds(result, await fetchManagerCommands(guild?.commands));
  return result;
}

module.exports = {
  COMMAND_ID_PATTERN,
  commandMention,
  commandPath,
  commandRoot,
  normalizeCommandIds,
  resolveCachedCommandIds,
  resolveRegisteredCommandIds,
};
