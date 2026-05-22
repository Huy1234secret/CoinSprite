const { MessageFlags } = require('discord.js');
const feature = require('./fishingFeature');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WOODEN_ROD_LABEL = 'Wooden Fishing Rod';
const WOODEN_ROD_UNICODE = '\uD83C\uDFA3';
const WOODEN_ROD_RAW = '<:IGWoodenFishingRod:1506709123646095430>';
const WOODEN_ROD_EMOJI = { name: 'IGWoodenFishingRod', id: '1506709123646095430' };
const FISH_GAME_LOCK_TIMEOUT_MS = 90_000;

let activeFishGame = null;
let activeFishGameTimer = null;

function clearFishGameLock() {
  activeFishGame = null;
  if (activeFishGameTimer) clearTimeout(activeFishGameTimer);
  activeFishGameTimer = null;
}

function getActiveFishGame() {
  if (!activeFishGame) return null;
  if (Date.now() >= activeFishGame.expiresAt) clearFishGameLock();
  return activeFishGame;
}

function startFishGameLock(userId) {
  clearFishGameLock();
  activeFishGame = { userId, expiresAt: Date.now() + FISH_GAME_LOCK_TIMEOUT_MS };
  activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS);
  activeFishGameTimer.unref?.();
}

function refreshFishGameLock() {
  if (!activeFishGame) return;
  activeFishGame.expiresAt = Date.now() + FISH_GAME_LOCK_TIMEOUT_MS;
  if (activeFishGameTimer) clearTimeout(activeFishGameTimer);
  activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS);
  activeFishGameTimer.unref?.();
}

function collectPayloadText(payload, out = []) {
  if (!payload || typeof payload !== 'object') return out;
  if (payload.type === 10 && typeof payload.content === 'string') out.push(payload.content);
  if (Array.isArray(payload.components)) payload.components.forEach((component) => collectPayloadText(component, out));
  return out;
}

function isTerminalFishingPayload(payload) {
  const text = collectPayloadText(payload).join('\n');
  return text.includes('has been caught!')
    || text.includes('has escaped!')
    || text.includes('Fish Barrel is full!');
}

function rejectActiveFishGame(interaction) {
  return interaction.reply({
    content: 'A fishing minigame is already active. Please wait until it ends.',
    flags: EPHEMERAL_FLAG,
  }).catch(() => null);
}

function patchTextDisplay(component) {
  if (component?.type !== 10 || typeof component.content !== 'string') return;
  component.content = component.content.replaceAll(`${WOODEN_ROD_LABEL} ${WOODEN_ROD_UNICODE}`, `${WOODEN_ROD_LABEL} ${WOODEN_ROD_RAW}`);
}

function parseOptionEmoji(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'object' && emoji.id) return emoji;
  const raw = typeof emoji === 'string' ? emoji : emoji.name;
  const match = String(raw || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (match) return { name: match[1], id: match[2], animated: String(raw).startsWith('<a:') };
  return raw ? { name: raw } : null;
}

function patchOption(option) {
  if (!option || typeof option !== 'object') return;
  if (option.label === WOODEN_ROD_LABEL) option.emoji = { ...WOODEN_ROD_EMOJI };
  else if (option.emoji) option.emoji = parseOptionEmoji(option.emoji);
  if (option.data?.emoji) option.data.emoji = parseOptionEmoji(option.data.emoji);
}

function patchSelect(component) {
  if (component?.type !== 3) return;
  if (Array.isArray(component.options)) component.options.forEach(patchOption);
  if (Array.isArray(component.data?.options)) component.data.options.forEach(patchOption);
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
  if (isTerminalFishingPayload(payload)) clearFishGameLock();
  return payload;
}

function patchMessage(message) {
  if (!message || typeof message !== 'object') return message;
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (prop === 'edit' && typeof target.edit === 'function') {
        return (payload, ...args) => target.edit(patchPayload(payload), ...args);
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

function shouldLockFishStart(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fish:start:')) return false;
  return interaction.user?.id === id.split(':')[2];
}

function shouldRefreshFishLock(interaction) {
  const active = getActiveFishGame();
  return Boolean(active && (interaction.customId || '').startsWith('fish:reel:') && interaction.user?.id === active.userId);
}

function wrapCommand(command) {
  return {
    ...command,
    async execute(interaction, client) {
      if (typeof command.execute !== 'function') return undefined;
      return command.execute(patchInteraction(interaction), client);
    },
    async handleInteraction(interaction, client) {
      if (typeof command.handleInteraction !== 'function') return false;

      const lockFishStart = shouldLockFishStart(interaction);
      if (lockFishStart && getActiveFishGame()) {
        await rejectActiveFishGame(interaction);
        return true;
      }

      if (lockFishStart) startFishGameLock(interaction.user.id);
      else if (shouldRefreshFishLock(interaction)) refreshFishGameLock();

      try {
        return await command.handleInteraction(patchInteraction(interaction), client);
      } catch (error) {
        if (lockFishStart) clearFishGameLock();
        throw error;
      }
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(feature.fishCommand),
  inventoryCommand: wrapCommand(feature.inventoryCommand),
  fishBarrelCommand: wrapCommand(feature.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(feature.fishBalanceCommand),
};
