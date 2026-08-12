const { MessageFlags } = require('discord.js');
const { payloadMetrics } = require('./discordPayload');

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

function sanitizeDiagnosticText(value, maximum = 1_000) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:Bot|Bearer)\s+\S+/gi, '[redacted-authorization]')
    .replace(/[a-z0-9_-]{48,}/gi, '[redacted-token]')
    .slice(0, maximum);
}

function safeErrorMessage(error) {
  return sanitizeDiagnosticText(error?.message || error?.name || 'unknown error');
}

function safeInteractionValue(value) {
  return String(value || '')
    .replace(/[^a-z0-9:_/-]/gi, '?')
    .slice(0, 100) || 'none';
}

function validationPath(parent, key) {
  if (/^\d+$/.test(key)) return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

function flattenDiscordValidationErrors(errors) {
  const flattened = [];
  function visit(node, path) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node._errors)) {
      for (const detail of node._errors) {
        flattened.push({
          path: path || 'body',
          code: safeInteractionValue(detail?.code || 'validation-error'),
          message: sanitizeDiagnosticText(detail?.message || 'Invalid value.'),
        });
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== '_errors') visit(child, validationPath(path, key));
    }
  }
  visit(errors, '');
  return flattened;
}

function requestPayload(error) {
  const payload = error?.requestBody?.json ?? error?.requestBody?.body ?? error?.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function validationDetails(error) {
  const discordErrors = flattenDiscordValidationErrors(error?.rawError?.errors);
  if (discordErrors.length) return discordErrors;
  return (error?.validationErrors || []).map((detail) => ({
    path: sanitizeDiagnosticText(detail?.path || 'body', 500),
    code: 'local-validation',
    message: sanitizeDiagnosticText(detail?.message || 'Invalid value.'),
  }));
}

function formatInteractionFailure(error, interaction, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const code = discordErrorCode(error);
  const status = Number(error?.status);
  const diagnostic = [
    `operation=${String(options.operation || 'handle').replace(/[^a-z-]/gi, '') || 'handle'}`,
    `kind=${interactionKind(interaction)}`,
    `command=${String(interaction?.commandName || 'none').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'none'}`,
    `control=${safeControlKind(interaction?.customId)}`,
    `customId=${JSON.stringify(safeInteractionValue(interaction?.customId))}`,
    `selected=${JSON.stringify(safeInteractionValue(interaction?.values?.[0]))}`,
    `guild=${String(interaction?.guildId || 'dm').replace(/[^0-9a-z_-]/gi, '').slice(0, 32) || 'unknown'}`,
    `channel=${String(interaction?.channelId || 'unknown').replace(/[^0-9a-z_-]/gi, '').slice(0, 32) || 'unknown'}`,
    `deferred=${Boolean(interaction?.deferred)}`,
    `replied=${Boolean(interaction?.replied)}`,
    `error=${String(error?.name || 'Error').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'Error'}`,
    `code=${code ?? 'unknown'}`,
    `status=${Number.isFinite(status) ? status : 'unknown'}`,
    `message=${JSON.stringify(safeErrorMessage(error))}`,
    `elapsedMs=${elapsedMs}`,
  ];
  const validation = validationDetails(error);
  if (validation.length) diagnostic.push(`validation=${JSON.stringify(validation)}`);
  const payload = requestPayload(error);
  if (payload) diagnostic.push(`payload=${JSON.stringify(payloadMetrics(payload))}`);
  else if (error?.payloadMetrics) diagnostic.push(`payload=${JSON.stringify(error.payloadMetrics)}`);
  return diagnostic.join(' ');
}

function reportExpectedAcknowledgementFailure(error, interaction, options = {}) {
  const diagnostic = formatInteractionFailure(error, interaction, options);
  const safeError = Object.assign(
    new Error(`Discord interaction acknowledgement was not available: ${diagnostic}`),
    { code: discordErrorCode(error) },
  );
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

async function completeEphemeral(interaction, payload) {
  if (interaction?.deferred || interaction?.replied) {
    const editPayload = { ...payload };
    if (editPayload.flags !== undefined) {
      const flags = Number(editPayload.flags) & ~EPHEMERAL_FLAG;
      if (flags) editPayload.flags = flags;
      else delete editPayload.flags;
    }
    return interaction.editReply(editPayload);
  }
  return interaction.reply(payload);
}

async function sendEphemeral(interaction, payload) {
  if (interaction?.deferred || interaction?.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

module.exports = {
  EXPECTED_ACKNOWLEDGEMENT_CODES,
  acknowledgeEphemeral,
  acknowledgeUpdate,
  completeEphemeral,
  discordErrorCode,
  flattenDiscordValidationErrors,
  formatInteractionFailure,
  interactionKind,
  reportExpectedAcknowledgementFailure,
  safeErrorMessage,
  safeInteractionValue,
  safeControlKind,
  sendEphemeral,
};
