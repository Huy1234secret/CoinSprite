const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'ticket-system-state.json');

const DEFAULT_STATE = {
  panelMessageIdByGuild: {},
  panelChannelIdByGuild: {},
  nextTicketIdByGuild: {},
  tickets: {},
  blacklistedUsersByGuild: {},
  roleRequests: {},
  giveawayRequests: {},
};

function ensureParentDir() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

function loadState() {
  ensureParentDir();

  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
    return structuredClone(DEFAULT_STATE);
  }

  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      panelMessageIdByGuild: parsed.panelMessageIdByGuild ?? {},
      panelChannelIdByGuild: parsed.panelChannelIdByGuild ?? {},
      nextTicketIdByGuild: parsed.nextTicketIdByGuild ?? {},
      tickets: parsed.tickets ?? {},
      blacklistedUsersByGuild: parsed.blacklistedUsersByGuild ?? {},
      roleRequests: parsed.roleRequests ?? {},
      giveawayRequests: parsed.giveawayRequests ?? {},
    };
  } catch {
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(state) {
  ensureParentDir();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

module.exports = {
  loadState,
  saveState,
};
