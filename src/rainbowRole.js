const RAINBOW_ROLE_ID = '1544751586490716220';
const RAINBOW_ROLE_INTERVAL_MS = 5_000;

const RAINBOW_COLORS = Object.freeze([
  Object.freeze({ name: 'red', value: 0xFF0000 }),
  Object.freeze({ name: 'orange', value: 0xFF7F00 }),
  Object.freeze({ name: 'yellow', value: 0xFFFF00 }),
  Object.freeze({ name: 'green', value: 0x00FF00 }),
  Object.freeze({ name: 'blue', value: 0x0000FF }),
  Object.freeze({ name: 'indigo', value: 0x4B0082 }),
  Object.freeze({ name: 'violet', value: 0x9400D3 }),
]);

async function findRainbowRole(client, roleId) {
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (role) return role;
  }
  return null;
}

function createRainbowRoleScheduler(client, options = {}) {
  const roleId = String(options.roleId || RAINBOW_ROLE_ID);
  const intervalMs = Math.max(1_000, Number(options.intervalMs) || RAINBOW_ROLE_INTERVAL_MS);
  const colors = options.colors || RAINBOW_COLORS;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const setTimer = options.setInterval || setInterval;
  const clearTimer = options.clearInterval || clearInterval;

  let colorIndex = 0;
  let timer = null;
  let updateInProgress = false;

  async function tick() {
    if (updateInProgress) return { updated: false, reason: 'busy' };
    updateInProgress = true;

    try {
      const role = await findRainbowRole(client, roleId);
      if (!role) {
        log(`Rainbow role ${roleId} was not found in any connected guild.`);
        return { updated: false, reason: 'not-found' };
      }
      if (!role.editable) {
        log(`Rainbow role ${roleId} is not editable. Move CoinSprite's role above it and grant Manage Roles.`);
        return { updated: false, reason: 'not-editable' };
      }

      const color = colors[colorIndex];
      await role.setColor(color.value, `Rainbow role cycle: ${color.name}`);
      colorIndex = (colorIndex + 1) % colors.length;
      return { updated: true, color: color.name };
    } catch (error) {
      log(`Rainbow role update failed: ${error?.message || 'unknown error'}`);
      return { updated: false, reason: 'error' };
    } finally {
      updateInProgress = false;
    }
  }

  function start() {
    if (timer) return false;
    void tick();
    timer = setTimer(() => void tick(), intervalMs);
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearTimer(timer);
    timer = null;
    return true;
  }

  return Object.freeze({ start, stop, tick });
}

module.exports = {
  RAINBOW_COLORS,
  RAINBOW_ROLE_ID,
  RAINBOW_ROLE_INTERVAL_MS,
  createRainbowRoleScheduler,
  findRainbowRole,
};
