const { secretRollAnnouncementPayload } = require('../components/builders');

const DEFAULT_SECRET_ROLL_CHANNEL_ID = '1536335786411298817';

function createSecretRollAnnouncer(options = {}) {
  const channelId = String(
    options.channelId
      || process.env.RNG_SECRET_ROLL_CHANNEL_ID
      || DEFAULT_SECRET_ROLL_CHANNEL_ID,
  );
  const getClient = options.getClient || (() => null);
  const onError = options.onError || ((error) => console.error(
    'RNG Secret roll announcement failed:',
    error?.message || error,
  ));

  return async function announceSecretRoll(event) {
    if (event?.seed?.id !== 'eclipse_bloom') return false;
    try {
      const client = getClient();
      if (!client) throw new Error('Discord client is unavailable.');
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || !channel?.send) {
        throw new Error(`Secret roll channel ${channelId} is unavailable.`);
      }
      await channel.send(secretRollAnnouncementPayload(event));
      return true;
    } catch (error) {
      onError(error, event);
      return false;
    }
  };
}

module.exports = { DEFAULT_SECRET_ROLL_CHANNEL_ID, createSecretRollAnnouncer };
