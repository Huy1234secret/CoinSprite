const os = require('os');

const RUNTIME_ROLES = Object.freeze(['bot', 'panel', 'combined']);

function normalizeRuntimeRole(value = process.env.COINSPRITE_RUNTIME_ROLE) {
  const role = String(value || 'combined').trim().toLowerCase();
  return RUNTIME_ROLES.includes(role) ? role : 'combined';
}

function runtimeCapabilities(value) {
  const role = normalizeRuntimeRole(value);
  return Object.freeze({
    role,
    bot: role === 'bot' || role === 'combined',
    panel: role === 'panel' || role === 'combined',
    stockPoster: role === 'bot' || role === 'combined',
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
    role: capabilities.role,
    pid: process.pid,
    hostname: os.hostname(),
    shard: shardIds.length ? shardIds.join(',') : 'none',
    serviceName: String(serviceName).slice(0, 120),
    instanceId: String(process.env.COINSPRITE_INSTANCE_ID || `${os.hostname()}:${process.pid}`).slice(0, 180),
    stockPoster: capabilities.stockPoster ? 'enabled' : 'disabled',
  });
}

function runtimeDiagnostic(role, client) {
  const info = runtimeInstanceInfo(role, client);
  return `CoinSprite runtime role=${info.role} stockPoster=${info.stockPoster} instance=${info.instanceId} pid=${info.pid} hostname=${info.hostname} shard=${info.shard} service=${info.serviceName}`;
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
  createRuntimeStarter,
  normalizeRuntimeRole,
  runtimeCapabilities,
  runtimeDiagnostic,
  runtimeInstanceInfo,
};
