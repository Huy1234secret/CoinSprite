'use strict';

// Compatibility shim for existing event hooks. The invite rewards system has been removed.
function removedFeatureHook() {
  return Promise.resolve(null); // FIXED: always return a Promise so legacy callers can safely append .catch().
}

module.exports = {
  init: removedFeatureHook,
  isEnabled: () => false,
  onGuildMemberAdd: removedFeatureHook,
  onGuildMemberUpdate: removedFeatureHook,
  onInviteCreateOrDelete: removedFeatureHook,
  onMessageCreate: removedFeatureHook,
};
