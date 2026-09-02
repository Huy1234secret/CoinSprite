const { COUNTING_COMMANDS, createCommandHandlers } = require('./commands');
const { CountingRepository } = require('./repositories/countingRepository');
const { openDatabase } = require('./repositories/database');
const { CountingService } = require('./services/countingService');

const COUNT_SUCCESS_EMOJI = '<:CSY:1544764502036447232>';
const COUNT_FAILURE_EMOJI = '<:CSN:1544764506381615104>';
const SAFE_ALLOWED_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });

function createCountingFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new CountingRepository(db, { clock: options.clock });
  const service = options.service || new CountingService(repository);
  const commands = createCommandHandlers(service);
  const reportError = (error, operation, message) => {
    try { options.onError?.(error, { operation, message }); } catch {}
  };

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system) return false;
    if (await commands.handleMessage(message)) return true;
    const channelId = String(options.getChannelId?.(message.guildId) || '');
    if (!channelId || String(message.channelId) !== channelId) return false;

    const result = service.processMessage(message);
    if (result.status === 'duplicate') return true;
    const emoji = result.status === 'correct' ? COUNT_SUCCESS_EMOJI : COUNT_FAILURE_EMOJI;
    try { await message.react?.(emoji); } catch (error) { reportError(error, 'reaction', message); }
    if (result.status === 'incorrect') {
      try {
        await message.channel?.send?.({
          content: result.reason === 'same-user'
            ? `<@${message.author.id}> counted twice in a row. Wait for someone else to take a turn. Start again at **1**.`
            : `The count was broken by <@${message.author.id}>. Start again at **1**.`,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
      } catch (error) {
        reportError(error, 'reset-message', message);
      }
    }
    return true;
  }

  return {
    commands: COUNTING_COMMANDS,
    db,
    repository,
    service,
    handleInteraction: commands.handleInteraction,
    handleMessage,
    close() {
      if (!options.db && db.open) db.close();
    },
  };
}

module.exports = {
  COUNT_FAILURE_EMOJI,
  COUNT_SUCCESS_EMOJI,
  COUNTING_COMMANDS,
  SAFE_ALLOWED_MENTIONS,
  createCountingFeature,
};

