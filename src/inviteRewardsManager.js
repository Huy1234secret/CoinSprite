'use strict';

function removedFeatureHook() {
  return Promise.resolve(null); // FIXED: legacy callers can always append .catch() when this no-op hook runs.
}

const legacyHooks = {
  init: removedFeatureHook,
  isEnabled: () => false,
  onGuildMemberAdd: removedFeatureHook,
  onGuildMemberUpdate: removedFeatureHook,
  onInviteCreateOrDelete: removedFeatureHook,
  onMessageCreate: removedFeatureHook,
};

module.exports = new Proxy(legacyHooks, {
  get(target, property) {
    if (property in target) return target[property];
    if (typeof property === 'string' && property.startsWith('on')) return removedFeatureHook; // FIXED: missing legacy event hooks safely no-op instead of returning undefined.
    return target[property];
  },
});
