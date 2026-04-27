const userSessions = new Map();

function startUserSession(userId, session) {
  if (!userId || !session?.type) return;
  userSessions.set(userId, { ...session, startedAt: Date.now() });
}

function endUserSession(userId, type = null) {
  if (!userId) return;
  if (!type) {
    userSessions.delete(userId);
    return;
  }

  const current = userSessions.get(userId);
  if (current?.type === type) {
    userSessions.delete(userId);
  }
}

function getUserSession(userId) {
  return userSessions.get(userId) || null;
}

function getCommandBlockReason(userId, commandName) {
  const session = getUserSession(userId);
  if (!session) return null;

  if (session.lockedCommand === commandName) {
    return null;
  }

  if (session.lockToCommand && commandName !== session.lockedCommand) {
    return session.lockMessage || `You have an active ${session.label || session.type} game. Use /${session.lockedCommand} until it ends.`;
  }

  if (Array.isArray(session.blockedCommands) && session.blockedCommands.includes(commandName)) {
    return session.lockMessage || `You cannot use /${commandName} while ${session.label || session.type} is active.`;
  }

  return null;
}

module.exports = {
  startUserSession,
  endUserSession,
  getUserSession,
  getCommandBlockReason,
};
