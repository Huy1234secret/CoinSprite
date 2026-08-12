const { infoMessagePayload } = require('./builders');
const { INFO_MESSAGE_VERSION } = require('./catalog');
const { resolveRegisteredCommandIds } = require('./mentions');

const DISCORD_API_BASE = 'https://discord.com/api/v10';

class InfoPublishError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'InfoPublishError';
    this.statusCode = statusCode;
  }
}

function restPayload(payload) {
  const result = { ...payload };
  if (result.allowedMentions) {
    result.allowed_mentions = {
      parse: result.allowedMentions.parse || [],
      users: result.allowedMentions.users || [],
      roles: result.allowedMentions.roles || [],
      replied_user: result.allowedMentions.repliedUser === true,
    };
    delete result.allowedMentions;
  }
  return result;
}

class InfoPublisher {
  constructor(options = {}) {
    this.client = options.client || null;
    this.token = String(options.token || '').trim();
    this.fetch = options.fetch || globalThis.fetch;
    this.apiBase = String(options.apiBase || DISCORD_API_BASE).replace(/\/$/, '');
  }

  async request(path, options = {}) {
    if (!this.token) throw new InfoPublishError('Discord publishing is unavailable because the bot token is not configured.', 503);
    const response = await this.fetch(`${this.apiBase}${path}`, {
      ...options,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    return response;
  }

  async botUserId() {
    const readyId = String(this.client?.user?.id || '');
    if (readyId) return readyId;
    const response = await this.request('/users/@me');
    if (!response.ok) throw new InfoPublishError(`Discord could not identify CoinSprite (${response.status}).`);
    const user = await response.json();
    const id = String(user?.id || '');
    if (!/^\d{16,20}$/.test(id)) throw new InfoPublishError('Discord returned an invalid bot identity.');
    return id;
  }

  async gatewayChannel(channelId) {
    if (!this.client?.channels) return null;
    const cached = this.client.channels.cache?.get?.(channelId);
    if (cached) return cached;
    if (!this.client.channels.fetch) return null;
    return this.client.channels.fetch(channelId).catch(() => null);
  }

  async channelGuildId(channelId) {
    const channel = await this.gatewayChannel(channelId);
    const gatewayGuildId = String(channel?.guildId || channel?.guild?.id || '');
    if (gatewayGuildId) return gatewayGuildId;
    if (!this.token) return '';
    const response = await this.request(`/channels/${channelId}`);
    if (!response.ok) return '';
    const raw = await response.json();
    return String(raw?.guild_id || '');
  }

  async payloadContext(channelId) {
    const guildId = await this.channelGuildId(channelId);
    return {
      client: this.client,
      commandIds: await resolveRegisteredCommandIds(this.client, guildId),
      guildId,
    };
  }

  async fetchMessage(channelId, messageId) {
    const channel = await this.gatewayChannel(channelId);
    if (channel?.messages?.fetch) {
      try {
        return { status: 'found', message: await channel.messages.fetch(messageId), transport: 'gateway' };
      } catch (error) {
        if (Number(error?.code) === 10008 || Number(error?.status) === 404) return { status: 'missing' };
        return { status: 'inaccessible' };
      }
    }
    try {
      const response = await this.request(`/channels/${channelId}/messages/${messageId}`);
      if (response.status === 404) return { status: 'missing' };
      if (!response.ok) return { status: 'inaccessible' };
      return { status: 'found', message: await response.json(), transport: 'rest' };
    } catch (error) {
      if (error instanceof InfoPublishError && error.statusCode === 503) throw error;
      return { status: 'inaccessible' };
    }
  }

  async createMessage(channelId, payload) {
    const channel = await this.gatewayChannel(channelId);
    if (channel?.send) return channel.send(payload);
    const response = await this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(restPayload(payload)),
    });
    if (!response.ok) throw new InfoPublishError(`Discord could not publish the information message (${response.status}).`);
    return response.json();
  }

  async editMessage(channelId, messageId, message, payload, transport) {
    if (transport === 'gateway' && message?.edit) return message.edit(payload);
    const response = await this.request(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(restPayload(payload)),
    });
    if (!response.ok) throw new InfoPublishError(`Discord could not update the information message (${response.status}).`);
    return response.json();
  }

  async inspect(reference = {}) {
    const channelId = String(reference.messageChannelId || '');
    const messageId = String(reference.messageId || '');
    if (!channelId || !messageId) return { state: 'not-published', canEdit: false, warning: '' };
    const botUserId = await this.botUserId();
    const result = await this.fetchMessage(channelId, messageId);
    if (result.status !== 'found') {
      return {
        state: result.status,
        canEdit: false,
        warning: result.status === 'missing'
          ? 'The stored information message no longer exists.'
          : 'The stored information message cannot be accessed.',
      };
    }
    const authorId = String(result.message?.author?.id || result.message?.authorId || '');
    if (authorId !== botUserId) {
      return { state: 'foreign-author', canEdit: false, warning: 'The stored message was not authored by CoinSprite.' };
    }
    return { state: 'published', canEdit: true, warning: '' };
  }

  async publish(channelId, reference = {}) {
    const destination = String(channelId || '');
    const botUserId = await this.botUserId();
    const context = await this.payloadContext(destination);
    const payload = infoMessagePayload(botUserId, context);
    const sameChannel = String(reference.messageChannelId || '') === destination;
    const messageId = String(reference.messageId || '');
    if (sameChannel && messageId) {
      const existing = await this.fetchMessage(destination, messageId);
      if (existing.status === 'found') {
        const authorId = String(existing.message?.author?.id || existing.message?.authorId || '');
        if (authorId !== botUserId) {
          throw new InfoPublishError('The stored message was not authored by CoinSprite and will not be edited.', 409);
        }
        const editPayload = infoMessagePayload(botUserId, context, { initial: false });
        const message = await this.editMessage(destination, messageId, existing.message, editPayload, existing.transport);
        return { action: 'updated', message, botUserId, messageVersion: INFO_MESSAGE_VERSION };
      }
    }
    const message = await this.createMessage(destination, payload);
    return { action: messageId ? 'reposted' : 'published', message, botUserId, messageVersion: INFO_MESSAGE_VERSION };
  }
}

module.exports = { DISCORD_API_BASE, InfoPublishError, InfoPublisher, restPayload };
