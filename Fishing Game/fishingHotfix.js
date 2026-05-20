const feature = require('./fishingFeature');

const WOODEN_ROD_LABEL = 'Wooden Fishing Rod';
const WOODEN_ROD_UNICODE = '\uD83C\uDFA3';
const WOODEN_ROD_RAW = '<:IGWoodenFishingRod:1506709123646095430>';
const WOODEN_ROD_EMOJI = { name: 'IGWoodenFishingRod', id: '1506709123646095430' };

function patchTextDisplay(component) {
  if (component?.type !== 10 || typeof component.content !== 'string') return;
  component.content = component.content.replaceAll(`${WOODEN_ROD_LABEL} ${WOODEN_ROD_UNICODE}`, `${WOODEN_ROD_LABEL} ${WOODEN_ROD_RAW}`);
}

function patchSelect(component) {
  if (component?.type !== 3 || !Array.isArray(component.options)) return;
  for (const option of component.options) {
    if (option?.label === WOODEN_ROD_LABEL) option.emoji = { ...WOODEN_ROD_EMOJI };
  }
}

function patchContainer(component) {
  if (component?.type !== 17 || !Array.isArray(component.components)) return;
  const [first, second] = component.components;
  const media = first?.type === 12 ? first.items?.[0]?.media : null;
  if (media && second?.type === 10) {
    component.components.splice(0, 2, {
      type: 9,
      components: [second],
      accessory: { type: 11, media },
    });
  }
}

function patchComponents(components) {
  if (!Array.isArray(components)) return;
  for (const component of components) {
    patchContainer(component);
    patchTextDisplay(component);
    patchSelect(component);
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
        return (payload, ...args) => target.edit(patchPayload(payload), ...args);
      }
      return Reflect.get(target, prop, receiver);
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
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapCommand(command) {
  return {
    ...command,
    async execute(interaction, client) {
      return command.execute(patchInteraction(interaction), client);
    },
    async handleInteraction(interaction, client) {
      return command.handleInteraction(patchInteraction(interaction), client);
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(feature.fishCommand),
  inventoryCommand: wrapCommand(feature.inventoryCommand),
  fishBarrelCommand: wrapCommand(feature.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(feature.fishBalanceCommand),
};
