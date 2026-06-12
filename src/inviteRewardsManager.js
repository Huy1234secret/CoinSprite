// Compatibility shim for existing event hooks. The invite rewards system has been removed.
const noop = async () => {};

module.exports = {
  init: noop,
  isEnabled: () => false,
  onGuildMemberAdd: noop,
  onGuildMemberUpdate: noop,
  onInviteCreateOrDelete: noop,
  onMessageCreate: noop,
};
