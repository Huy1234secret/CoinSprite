const os = require('os');

const RUNTIME_ROLES = Object.freeze(['bot', 'panel', 'combined']);
const VALID_ROLES = Object.freeze(new Set(RUNTIME_ROLES));
const SCHEDULER_ENABLED_ROLES = Object.freeze(new Set(['bot', 'combined']));

function resolveRuntimeRole(value = process.env.COINSPRITE_RUNTIME_ROLE) {
  const raw = (value || '').trim().toLowerCase();
  return VALID_ROLES.has(raw) ? raw : null;
}

function normalizeRuntimeRole(value = process.env.COINSPRITE_RUNTIME_ROLE) {
  return resolveRuntimeRole(value);
}

function isSchedulerEnabled(role) {
  return SCHEDULER_ENABLED_ROLES.has(role);
}

function isProductionLike() {
  const env = (process.env.NODE_ENV || '').trim().toLowerCase();
  return env === 'production' || env === 'staging';
}

function requireSchedulerRole(value = process.env.COINSPRITE_RUNTIME_ROLE) {
  let role = resolveRuntimeRole(value);
  if (!role) {
    console.warn(
      `\n[WARNING] COINSPRITE_RUNTIME_ROLE is missing or invalid ("${process.env.COINSPRITE_RUNTIME_ROLE || ''}"). `
      + 'Falling back to legacy "combined" role. Please configure your deployment to use "bot" or "panel" for isolation.\n'
    );
    role = 'combined';
  }
  if (role === 'combined' && isProductionLike()) {
    console.warn(
      '\n[WARNING] COINSPRITE_RUNTIME_ROLE="combined" is running in production. '
      + 'This is not recommended and may cause duplicate background jobs. Use "bot" or "panel".\n'
    );
  }
  return { role, schedulerEnabled: isSchedulerEnabled(role) };
}

function runtimeCapabilities(value) {
  const role = resolveRuntimeRole(value);
  const isValid = role !== null;
  return Object.freeze({
    role,
    bot: isValid && (role === 'bot' || role === 'combined'),
    panel: isValid && (role === 'panel' || role === 'combined'),
    scheduler: isValid && (role === 'bot' || role === 'combined'),
  });
}

function runtimeInstanceInfo(role, client) {
  const capabilities = runtimeCapabilities(role);
  const serviceName = process.env.RAILWAY_SERVICE_NAME
    || process.env.RENDER_SERVICE_NAME
    || process.env.K_SERVICE
    || process.env.PM2_PROCESS_NAME
    || 'local';
  const shardIds = client?.shard?.ids || [];
  return Object.freeze({
    role: capabilities.role || 'invalid',
    pid: process.pid,
    hostname: os.hostname(),
    shard: shardIds.length ? shardIds.join(',') : 'none',
    serviceName: String(serviceName).slice(0, 120),
    instanceId: String(process.env.COINSPRITE_INSTANCE_ID || `${os.hostname()}:${process.pid}`).slice(0, 180),
    scheduler: capabilities.scheduler ? 'enabled' : 'disabled',
  });
}

function runtimeDiagnostic(role, client) {
  const info = runtimeInstanceInfo(role, client);
  return `CoinSprite runtime role=${info.role} scheduler=${info.scheduler} instance=${info.instanceId} pid=${info.pid} hostname=${info.hostname} shard=${info.shard} service=${info.serviceName}`;
}

function createRuntimeStarter(role, initializers = {}) {
  const capabilities = runtimeCapabilities(role);
  let started = false;
  return Object.freeze({
    capabilities,
    async start() {
      if (started) return { started: false, capabilities };
      started = true;
      await initializers.common?.(capabilities);
      if (capabilities.bot) await initializers.bot?.(capabilities);
      if (capabilities.panel) await initializers.panel?.(capabilities);
      return { started: true, capabilities };
    },
  });
}

module.exports = {
  RUNTIME_ROLES,
  VALID_ROLES,
  SCHEDULER_ENABLED_ROLES,
  createRuntimeStarter,
  isProductionLike,
  isSchedulerEnabled,
  normalizeRuntimeRole,
  requireSchedulerRole,
  resolveRuntimeRole,
  runtimeCapabilities,
  runtimeDiagnostic,
  runtimeInstanceInfo,
};
