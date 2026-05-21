const commands = require('./fishingHotfix');
const { trackMessage } = require('../src/actionTimeouts');

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

function patchMessage(message) {
  if (!message || typeof message !== 'object') return message;
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (prop === 'edit' && typeof target.edit === 'function') {
        return async (payload, ...args) => {
          const result = await target.edit(patchPayload(payload), ...args);
          trackMessage(result?.id ? result : target);
          return result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function patchInteraction(interaction) {
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      if (prop === 'message') return patchMessage(target.message);
      if (['reply', 'update', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') {
        return (payload, ...args) => target[prop](patchPayload(payload), ...args);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapCommand(command) {
  return {
    ...command,
    disableActionTimeout: false,
    async execute(interaction, client) {
      return command.execute(patchInteraction(interaction), client);
    },
    async handleInteraction(interaction, client) {
      return command.handleInteraction(patchInteraction(interaction), client);
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(commands.fishCommand),
  inventoryCommand: wrapCommand(commands.inventoryCommand),
  fishBarrelCommand: wrapCommand(commands.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(commands.fishBalanceCommand),
};
