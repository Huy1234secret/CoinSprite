'use strict';

const discord = require('discord.js');
const dailyMessageStats = require('../src/dailyMessageStats');
const inviteRewardsManager = require('../src/inviteRewardsManager');
const { shouldIgnoreTextlessMessage } = require('../src/messageContentFilter');

function guarded(handler) {
  if (typeof handler !== 'function' || handler.__coinSpriteTextlessGuard) return handler;
  const next = function messageHookWithTextGuard(message, ...args) {
    if (shouldIgnoreTextlessMessage(message)) return undefined; // ADDED: command message hooks ignore emoji/link/media-only posts.
    return handler.call(this, message, ...args);
  };
  Object.defineProperty(next, '__coinSpriteTextlessGuard', { value: true });
  return next;
}

function patchCommands() {
  const proto = discord.Collection && discord.Collection.prototype;
  if (!proto || proto.set.__coinSpriteTextlessGuard) return;
  const nativeSet = proto.set;
  const nextSet = function setCommandWithTextGuard(key, command) {
    if (command && typeof command.handleMessageCreate === 'function' && !command.allowTextlessMessages) {
      command.handleMessageCreate = guarded(command.handleMessageCreate); // ADDED: later-loaded commands inherit the text payload filter.
    }
    return nativeSet.call(this, key, command);
  };
  Object.defineProperty(nextSet, '__coinSpriteTextlessGuard', { value: true });
  proto.set = nextSet;
}

function patchMethod(target, key) {
  if (!target || typeof target[key] !== 'function' || target[key].__coinSpriteTextlessGuard) return;
  target[key] = guarded(target[key].bind(target)); // ADDED: stats and invite hooks use the same filter as commands.
}

patchCommands();
patchMethod(dailyMessageStats, 'recordMessage');
patchMethod(inviteRewardsManager, 'onMessageCreate');

module.exports = {};
