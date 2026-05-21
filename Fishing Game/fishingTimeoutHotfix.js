const commands = require('./fishingHotfix');

const FISH_TIMEOUT_MS = 30_000;
const fishTimeouts = new Map();

function cloneComponents(components) {
  return JSON.parse(JSON.stringify(components || []));
}

function isInteractiveComponent(component) {
  return Boolean(component && [2, 3, 5, 6, 7, 8].includes(component.type));
}

function disableComponents(components) {
  return cloneComponents(components).map((component) => {
    if (Array.isArray(component.components)) component.components = disableComponents(component.components);
    if (isInteractiveComponent(component)) component.disabled = true;
    return component;
  });
}

function hasFishControl(components) {
  for (const component of components || []) {
    if (typeof component?.custom_id === 'string' && component.custom_id.startsWith('fish:')) return true;
    if (Array.isArray(component?.components) && hasFishControl(component.components)) return true;
  }
  return false;
}

function messageComponents(message) {
  return message?.components?.map((component) => component.toJSON ? component.toJSON() : component) || [];
}

function armFishTimeout(message, components = null) {
  if (!message?.id || typeof message.edit !== 'function') return;
  const sourceComponents = cloneComponents(components?.length ? components : messageComponents(message));
  if (!hasFishControl(sourceComponents)) return;
  const existing = fishTimeouts.get(message.id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    fishTimeouts.delete(message.id);
    message.edit({ components: disableComponents(sourceComponents) }).catch(() => null);
  }, FISH_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  fishTimeouts.set(message.id, { timer });
}

function patchFishNames(component) {
  if (component?.type !== 10 || typeof component.content !== 'string') return;
  component.content = component.content.replace(/\bF[1-7]\s+(?=[A-Z])/g, '');
}

function patchComponents(components) {
  if (!Array.isArray(components)) return;
  for (const component of components) {
    patchFishNames(component);
    patchComponents(component.components);
  }
}

function patchPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  patchComponents(payload.components);
  return payload;
}

async function armFromInteraction(interaction, payload, result) {
  if (!hasFishControl(payload?.components)) return false;
  const message = result?.id ? result : interaction.message || await interaction.fetchReply?.().catch(() => null);
  if (!message) return false;
  armFishTimeout(message, payload.components);
  return true;
}

function patchMessage(message, state) {
  if (!message || typeof message !== 'object') return message;
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (prop === 'edit' && typeof target.edit === 'function') {
        return async (payload, ...args) => {
          const patchedPayload = patchPayload(payload);
          const result = await target.edit(patchedPayload, ...args);
          armFishTimeout(target, patchedPayload.components);
          if (state) state.fishTimeoutArmed = true;
          return result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function patchInteraction(interaction, state) {
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      if (prop === 'message') return patchMessage(target.message, state);
      if (['reply', 'update', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') {
        return async (payload, ...args) => {
          const patchedPayload = patchPayload(payload);
          const result = await target[prop](patchedPayload, ...args);
          const armed = await armFromInteraction(target, patchedPayload, result);
          if (armed) state.fishTimeoutArmed = true;
          return result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapCommand(command) {
  return {
    ...command,
    async execute(interaction, client) {
      const state = { fishTimeoutArmed: false };
      const result = await command.execute(patchInteraction(interaction, state), client);
      if (!state.fishTimeoutArmed) armFishTimeout(await interaction.fetchReply?.().catch(() => null));
      return result;
    },
    async handleInteraction(interaction, client) {
      const state = { fishTimeoutArmed: false };
      const result = await command.handleInteraction(patchInteraction(interaction, state), client);
      if (!state.fishTimeoutArmed && interaction.customId?.startsWith('fish:')) armFishTimeout(interaction.message);
      return result;
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(commands.fishCommand),
  inventoryCommand: wrapCommand(commands.inventoryCommand),
  fishBarrelCommand: wrapCommand(commands.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(commands.fishBalanceCommand),
};
