const { MessageFlags } = require('discord.js');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const EXPECTED_ACKNOWLEDGEMENT_CODES = new Set([10062, 40060]);

function discordErrorCode(error) {
  const value = error?.code ?? error?.rawError?.code;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function interactionKind(interaction) {
  if (interaction?.isChatInputCommand?.()) return 'chat-command';
  if (interaction?.isModalSubmit?.()) return 'modal';
  if (interaction?.isStringSelectMenu?.()) return 'string-select';
  if (interaction?.isUserSelectMenu?.()) return 'user-select';
  if (interaction?.isButton?.()) return 'button';
  return String(interaction?.type || 'unknown');
}

function safeControlKind(customId) {
  return String(customId || '')
    .split(':')
    .slice(0, 3)
    .map((part) => part.replace(/[^a-z0-9_-]/gi, '').slice(0, 32))
    .filter(Boolean)
    .join(':') || 'none';
}

function safeErrorMessage(error) {
  return String(error?.message || error?.name || 'unknown error')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:Bot|Bearer)\s+\S+/gi, '[redacted-authorization]')
    .replace(/[a-z0-9_-]{48,}/gi, '[redacted-token]')
    .slice(0, 1_000);
}

function formatInteractionFailure(error, interaction, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const code = discordErrorCode(error);
  const status = Number(error?.status);
  return [
    `operation=${String(options.operation || 'handle').replace(/[^a-z-]/gi, '') || 'handle'}`,
    `kind=${interactionKind(interaction)}`,
    `command=${String(interaction?.commandName || 'none').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'none'}`,
    `control=${safeControlKind(interaction?.customId)}`,
    `guild=${String(interaction?.guildId || 'dm').replace(/[^0-9a-z_-]/gi, '').slice(0, 32) || 'unknown'}`,
    `channel=${String(interaction?.channelId || 'unknown').replace(/[^0-9a-z_-]/gi, '').slice(0, 32) || 'unknown'}`,
    `deferred=${Boolean(interaction?.deferred)}`,
    `replied=${Boolean(interaction?.replied)}`,
    `error=${String(error?.name || 'Error').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'Error'}`,
    `code=${code ?? 'unknown'}`,
    `status=${Number.isFinite(status) ? status : 'unknown'}`,
    `elapsedMs=${elapsedMs}`,
  ].join(' ');
}

function reportExpectedAcknowledgementFailure(error, interaction, options = {}) {
  const diagnostic = formatInteractionFailure(error, interaction, options);
  const safeError = new Error(`Discord interaction acknowledgement was not available: ${diagnostic}`);
  safeError.code = discordErrorCode(error);
  if (options.reportError) options.reportError(safeError, { kind: 'interaction-acknowledgement', diagnostic });
  else console.warn(`CoinSprite interaction acknowledgement unavailable: ${diagnostic}`);
  return diagnostic;
}

async function acknowledgeUpdate(interaction, options = {}) {
  if (interaction?.deferred || interaction?.replied) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (!EXPECTED_ACKNOWLEDGEMENT_CODES.has(discordErrorCode(error))) throw error;
    reportExpectedAcknowledgementFailure(error, interaction, { ...options, operation: 'defer-update' });
    return false;
  }
}

async function acknowledgeEphemeral(interaction, options = {}) {
  if (interaction?.deferred || interaction?.replied) return true;
  try {
    await interaction.deferReply({ flags: EPHEMERAL_FLAG });
    return true;
  } catch (error) {
    if (!EXPECTED_ACKNOWLEDGEMENT_CODES.has(discordErrorCode(error))) throw error;
    reportExpectedAcknowledgementFailure(error, interaction, { ...options, operation: 'defer-reply' });
    return false;
  }
}

async function sendEphemeral(interaction, payload) {
  if (interaction?.deferred || interaction?.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

module.exports = {
  EXPECTED_ACKNOWLEDGEMENT_CODES,
  acknowledgeEphemeral,
  acknowledgeUpdate,
  discordErrorCode,
  formatInteractionFailure,
  interactionKind,
  reportExpectedAcknowledgementFailure,
  safeErrorMessage,
  safeControlKind,
  sendEphemeral,
};
