const VALID_ROLES = Object.freeze(new Set(['bot', 'panel', 'combined']));
const SCHEDULER_ENABLED_ROLES = Object.freeze(new Set(['bot', 'combined']));

function resolveRuntimeRole() {
  const raw = (process.env.COINSPRITE_RUNTIME_ROLE || '').trim().toLowerCase();
  return VALID_ROLES.has(raw) ? raw : null;
}

function isSchedulerEnabled(role) {
  return SCHEDULER_ENABLED_ROLES.has(role);
}

function isProductionLike() {
  const env = (process.env.NODE_ENV || '').trim().toLowerCase();
  return env === 'production' || env === 'staging';
}

function requireSchedulerRole() {
  const role = resolveRuntimeRole();
  if (!role) {
    throw new Error(
      `COINSPRITE_RUNTIME_ROLE is missing or invalid ("${process.env.COINSPRITE_RUNTIME_ROLE || ''}"). `
      + 'Set to "bot" for the stock poster or "panel" for the dashboard.'
    );
  }
  if (role === 'combined' && isProductionLike()) {
    throw new Error(
      'COINSPRITE_RUNTIME_ROLE="combined" is not allowed in production. '
      + 'Use "bot" or "panel".'
    );
  }
  return { role, schedulerEnabled: isSchedulerEnabled(role) };
}

module.exports = {
  isProductionLike,
  isSchedulerEnabled,
  requireSchedulerRole,
  resolveRuntimeRole,
  SCHEDULER_ENABLED_ROLES,
  VALID_ROLES,
};
