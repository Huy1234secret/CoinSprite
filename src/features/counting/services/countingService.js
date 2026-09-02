function parseCountAttempt(content) {
  const value = String(content || '').trim();
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value).toString();
}

class CountingService {
  constructor(repository) {
    this.repository = repository;
  }

  processMessage(message) {
    return this.repository.processAttempt({
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      submittedValue: parseCountAttempt(message.content),
    });
  }

  balance(userId) {
    return this.repository.balance(userId);
  }

  nextExpected(guildId) {
    return this.repository.nextExpected(guildId);
  }
}

module.exports = { CountingService, parseCountAttempt };
