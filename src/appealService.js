'use strict';

const {
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { sanitizeAppealConfig } = require('./appealConfig');
const appealFiles = require('./appealFileStore');
const appealStore = require('./appealStore');
const caseStore = require('./moderationCaseStore');
const messageTemplates = require('./messageTemplates');
const { getConfiguredGuildIds, getGuildConfig } = require('./serverConfig');
const { canManageWarnings, pardonWarning } = require('./warningService');

const APPEALABLE_TYPES = new Set(['warning', 'automod_warning', 'mute', 'kick', 'ban']);
const COMPONENTS_V2_FLAG = 32768;
const DECISION_PREFIX = 'appeal:decision:';
const MIME_BY_EXTENSION = Object.freeze({
  png: ['image/png'], jpg: ['image/jpeg', 'image/jpg'], jpeg: ['image/jpeg', 'image/jpg'],
  gif: ['image/gif'], webp: ['image/webp'], pdf: ['application/pdf'],
  txt: ['text/plain'], json: ['application/json', 'text/json'],
});
const BUTTON_PREFIX = 'appeal:review:';

function publicBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  try {
    const redirect = new URL(process.env.DISCORD_REDIRECT_URI || '');
    return redirect.origin;
  } catch {
    return '';
  }
}

function caseEligibility(guildId, record, userId, config) {
  if (!record || record.memberId !== String(userId)) return { allowed: false, code: 'not_found' };
  if (!APPEALABLE_TYPES.has(record.type)) return { allowed: false, code: 'unsupported' };
  if (!config.enabled || !config.logChannelId) return { allowed: false, code: 'disabled' };
  if (!record.appealable) return { allowed: false, code: 'unappealable' };
  if (record.status === caseStore.PARDONED) return { allowed: false, code: 'resolved' };
  return appealStore.eligibility(guildId, record.id, userId, config);
}

function answerMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function fileGroups(files) {
  const result = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const id = String(file?.fieldId || '');
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(file);
  }
  return result;
}

function validateSubmission(config, rawAnswers, files) {
  const values = answerMap(rawAnswers);
  const groupedFiles = fileGroups(files);
  const answers = [];
  let totalBytes = 0;
  for (const file of Array.isArray(files) ? files : []) totalBytes += file?.buffer?.length || 0;
  if (totalBytes > appealFiles.SUBMISSION_LIMIT_BYTES) throw new Error('Uploads cannot exceed 25 MB per appeal.');

  for (const field of config.questions) {
    const raw = values[field.id];
    if (field.type === 'file') {
      const uploads = groupedFiles.get(field.id) || [];
      if (field.required && !uploads.length) throw new Error(field.label + ' is required.');
      if (uploads.length > field.maxFiles) throw new Error(field.label + ' accepts at most ' + field.maxFiles + ' files.');
      for (const file of uploads) {
        const size = file?.buffer?.length || 0;
        if (!size || size > field.maxFileSizeMb * 1024 * 1024) {
          throw new Error('Each file for ' + field.label + ' must be ' + field.maxFileSizeMb + ' MB or smaller.');
        }
        const extension = appealFiles.extensionOf(file.name);
        if (field.allowedExtensions.length && !field.allowedExtensions.includes(extension)) {
          throw new Error(field.label + ' only accepts: ' + field.allowedExtensions.join(', ') + '.');
        }
        const contentType = String(file.contentType || '').toLowerCase();
        const expectedTypes = MIME_BY_EXTENSION[extension];
        if (expectedTypes && contentType && contentType !== 'application/octet-stream' && !expectedTypes.includes(contentType)) {
          throw new Error(field.label + ' contains a file whose MIME type does not match its extension.');
        }
      }
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: uploads.map((file) => file.name) });
      continue;
    }

    if (field.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
      if (field.required && !checked) throw new Error(field.label + ' must be checked.');
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: checked });
      continue;
    }

    if (field.type === 'choice') {
      const selected = [...new Set((Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw]).map(String))];
      const allowed = new Set(field.options.map((option) => option.id));
      if (selected.some((value) => !allowed.has(value))) throw new Error(field.label + ' contains an invalid choice.');
      if (selected.length < field.minSelections || selected.length > field.maxSelections) {
        throw new Error(field.label + ' requires between ' + field.minSelections + ' and ' + field.maxSelections + ' choices.');
      }
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: selected });
      continue;
    }

    if (field.type === 'number') {
      const empty = raw == null || String(raw).trim() === '';
      if (field.required && empty) throw new Error(field.label + ' is required.');
      if (empty) {
        answers.push({ fieldId: field.id, label: field.label, type: field.type, value: '' });
        continue;
      }
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(field.label + ' must be a number.');
      if (field.minimum != null && number < field.minimum) throw new Error(field.label + ' is below its minimum.');
      if (field.maximum != null && number > field.maximum) throw new Error(field.label + ' is above its maximum.');
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: number });
      continue;
    }

    const text = String(raw ?? '').trim();
    if (field.required && !text) throw new Error(field.label + ' is required.');
    if (text && text.length < field.minLength) throw new Error(field.label + ' is too short.');
    if (text.length > field.maxLength) throw new Error(field.label + ' is too long.');
    answers.push({ fieldId: field.id, label: field.label, type: field.type, value: text });
  }
  return answers;
}

function answerText(appeal, config) {
  const fields = new Map(config.questions.map((field) => [field.id, field]));
  return appeal.answers.map((answer) => {
    const field = fields.get(answer.fieldId);
    let value = answer.value;
    if (answer.type === 'choice') {
      const labels = new Map((field?.options || []).map((option) => [option.id, option.label]));
      value = (Array.isArray(value) ? value : []).map((item) => labels.get(item) || item).join(', ');
    } else if (Array.isArray(value)) value = value.join(', ');
    else if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
    return '**' + answer.label + ':** ' + (String(value || '').slice(0, 800) || 'Not provided');
  }).join('\n');
}

function replaceTokens(value, replacements) {
  return String(value || '').replace(/<([a-z0-9_-]+)>/gi, (match, key) => (
    Object.prototype.hasOwnProperty.call(replacements, key.toLowerCase()) ? replacements[key.toLowerCase()] : match
  ));
}

function applyTokens(template, replacements) {
  const copy = JSON.parse(JSON.stringify(template));
  copy.content = replaceTokens(copy.content, replacements);
  copy.containers = (copy.containers || []).map((container) => ({
    ...container,
    text: replaceTokens(container.text, replacements),
    thumbnailUrl: replaceTokens(container.thumbnailUrl, replacements),
    imageUrl: replaceTokens(container.imageUrl, replacements),
  }));
  return copy;
}

function decisionButtons(guildId, appealId, disabled = false) {
  return {
    type: 1,
    components: [
      { type: 2, style: ButtonStyle.Success, label: 'Accept', custom_id: BUTTON_PREFIX + 'accept:' + guildId + ':' + appealId, disabled },
      { type: 2, style: ButtonStyle.Danger, label: 'Deny', custom_id: BUTTON_PREFIX + 'deny:' + guildId + ':' + appealId, disabled },
    ],
  };
}

function logPayload(guild, user, record, appeal, config, disabled = false, decision = null) {
  const evidence = record.attachments?.length
    ? record.attachments.map((item) => item.name).join(', ')
    : record.evidence || 'None';
  const replacements = {
    'appeal-id': appeal.id,
    'case-id': record.id,
    punishment: record.type.replace('_', ' '),
    'case-reason': record.reason,
    'form-answers': answerText(appeal, config),
    evidence,
    'public-note': record.publicNote || 'None',
    mention: '<@' + user.id + '>',
    'user-id': user.id,
    username: user.username || user.id,
    avatar_url: user.displayAvatarURL?.({ size: 256 }) || '',
  };
  const payload = messageTemplates.buildMessagePayload(applyTokens(config.logMessage, replacements), { guild, user });
  if (decision) {
    payload.components.push({
      type: 17,
      accent_color: decision.status === 'accepted' ? 0x57f287 : 0xed4245,
      components: [{ type: 10, content: '**Decision:** ' + decision.status.toUpperCase() + '\n**Reviewer:** <@' + decision.decidedBy + '>\n**Reason:** ' + (decision.decisionReason || 'No note provided.') }],
    });
  }
  payload.components.push(decisionButtons(guild.id, appeal.id, disabled));
  payload.flags = COMPONENTS_V2_FLAG;
  return payload;
}

async function listUserCases(client, userId) {
  const result = [];
  for (const guildId of getConfiguredGuildIds()) {
    const config = getGuildConfig(guildId);
    if (!config) continue;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    for (const record of caseStore.listCases(guildId, { targetUserId: userId })) {
      if (!APPEALABLE_TYPES.has(record.type)) continue;
      const appeals = appealStore.listAppeals(guildId, { caseId: record.id, userId });
      result.push({
        guildId,
        guildName: guild?.name || 'Unknown server',
        case: record,
        appeals,
        eligibility: caseEligibility(guildId, record, userId, sanitizeAppealConfig(config.moderation?.appeals)),
      });
    }
  }
  return result.sort((a, b) => b.case.createdAt - a.case.createdAt);
}

async function submitAppeal(input) {
  const guildId = String(input.guildId || '');
  const userId = String(input.userId || '');
  const config = sanitizeAppealConfig(getGuildConfig(guildId)?.moderation?.appeals);
  const record = caseStore.getCase(guildId, input.caseId);
  const eligibility = caseEligibility(guildId, record, userId, config);
  if (!eligibility.allowed) throw new Error('This case cannot receive an appeal (' + eligibility.code + ').');
  const answers = validateSubmission(config, input.answers, input.files);
  const guild = input.client.guilds.cache.get(guildId) || await input.client.guilds.fetch(guildId);
  const user = await input.client.users.fetch(userId);
  let appeal = appealStore.createAppeal({
    guildId,
    caseId: record.id,
    userId,
    answers,
    formSnapshot: config.questions,
    attachments: [],
  });
  try {
    const attachments = await appealFiles.saveAppealFiles(guildId, appeal.id, input.files || []);
    appeal = appealStore.updateAttachments(guildId, appeal.id, attachments);
    const channel = guild.channels.cache.get(config.logChannelId) || await guild.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased?.()) throw new Error('The configured appeal log channel is unavailable.');
    const message = await channel.send(logPayload(guild, user, record, appeal, config));
    appeal = appealStore.updateLogReference(guildId, appeal.id, { channelId: channel.id, messageId: message.id });
    return appeal;
  } catch (error) {
    appealStore.removeAppeal(guildId, appeal.id);
    await appealFiles.removeAppealFiles(guildId, appeal.id);
    throw error;
  }
}

function parseReviewId(customId) {
  if (!String(customId || '').startsWith(BUTTON_PREFIX)) return null;
  const [action, guildId, appealId] = String(customId).slice(BUTTON_PREFIX.length).split(':');
  return ['accept', 'deny'].includes(action) && guildId && appealId ? { action, guildId, appealId } : null;
}

function parseDecisionId(customId) {
  if (!String(customId || '').startsWith(DECISION_PREFIX)) return null;
  const [action, guildId, appealId] = String(customId).slice(DECISION_PREFIX.length).split(':');
  return ['accept', 'deny'].includes(action) && guildId && appealId ? { action, guildId, appealId } : null;
}

async function reviewerMember(interaction) {
  return interaction.guild?.members?.fetch?.(interaction.user.id).catch(() => interaction.member) || interaction.member;
}

async function showDecisionModal(interaction, parsed) {
  if (!canManageWarnings(await reviewerMember(interaction))) {
    await interaction.reply({ content: 'You do not have permission to review appeals.', flags: 64 });
    return true;
  }
  const appeal = appealStore.getAppeal(parsed.guildId, parsed.appealId);
  if (!appeal || appeal.status !== 'pending') {
    await interaction.reply({ content: 'This appeal has already been handled.', flags: 64 });
    return true;
  }
  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel(parsed.action === 'accept' ? 'Reviewer note (optional)' : 'Denial reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(parsed.action === 'deny')
    .setMaxLength(1000);
  const modal = new ModalBuilder()
    .setCustomId(DECISION_PREFIX + parsed.action + ':' + parsed.guildId + ':' + parsed.appealId)
    .setTitle(parsed.action === 'accept' ? 'Accept appeal' : 'Deny appeal')
    .addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
  return true;
}

async function notifyDecision(client, appeal, record) {
  const user = await client.users.fetch(appeal.userId).catch(() => null);
  if (!user) return;
  const url = publicBaseUrl();
  const text = [
    'Your appeal for case ' + record.id + ' was **' + appeal.status + '**.',
    appeal.decisionReason ? 'Reviewer note: ' + appeal.decisionReason : '',
    url ? 'View the decision: ' + url + '/appeal' : '',
  ].filter(Boolean).join('\n');
  await user.send(text).catch(() => null);
}

async function decideAppeal(interaction, client, parsed) {
  if (!canManageWarnings(await reviewerMember(interaction))) {
    await interaction.reply({ content: 'You do not have permission to review appeals.', flags: 64 });
    return true;
  }
  const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
  if (parsed.action === 'deny' && !reason) {
    await interaction.reply({ content: 'A denial reason is required.', flags: 64 });
    return true;
  }
  const claim = appealStore.beginDecision(parsed.guildId, parsed.appealId, interaction.user.id, parsed.action);
  if (!claim.ok) {
    await interaction.reply({ content: 'This appeal is already being reviewed or resolved.', flags: 64 });
    return true;
  }
  const claimed = claim.appeal;
  await interaction.deferReply({ flags: 64 });
  try {
    const guild = interaction.guild || client.guilds.cache.get(parsed.guildId) || await client.guilds.fetch(parsed.guildId);
    const record = caseStore.getCase(parsed.guildId, claimed.caseId);
    if (!record) throw new Error('The moderation case no longer exists.');
    if (parsed.action === 'accept') {
      await pardonWarning({
        guild,
        caseId: record.id,
        moderatorId: interaction.user.id,
        reason: reason || 'Appeal accepted (' + claimed.id + ')',
      });
    }
    const decided = appealStore.finishDecision(
      parsed.guildId,
      parsed.appealId,
      interaction.user.id,
      parsed.action === 'accept' ? 'accepted' : 'denied',
      reason,
    );
    const config = sanitizeAppealConfig(getGuildConfig(parsed.guildId)?.moderation?.appeals);
    const user = await client.users.fetch(decided.userId);
    const channel = guild.channels.cache.get(decided.logReference.channelId) || await guild.channels.fetch(decided.logReference.channelId).catch(() => null);
    const message = channel?.messages?.fetch ? await channel.messages.fetch(decided.logReference.messageId).catch(() => null) : null;
    if (message) await message.edit(logPayload(guild, user, record, decided, config, true, decided)).catch(() => null);
    await notifyDecision(client, decided, record);
    await interaction.editReply('Appeal ' + decided.id + ' was ' + decided.status + '.');
  } catch (error) {
    appealStore.failDecision(parsed.guildId, parsed.appealId, interaction.user.id, error?.message || String(error));
    await interaction.editReply('The appeal decision failed: ' + (error?.message || 'unknown error'));
  }
  return true;
}

async function handleInteraction(interaction, client) {
  if (interaction.isButton?.()) {
    const parsed = parseReviewId(interaction.customId);
    if (parsed) return showDecisionModal(interaction, parsed);
  }
  if (interaction.isModalSubmit?.()) {
    const parsed = parseDecisionId(interaction.customId);
    if (parsed) return decideAppeal(interaction, client, parsed);
  }
  return false;
}

module.exports = {
  APPEALABLE_TYPES,
  caseEligibility,
  handleInteraction,
  listUserCases,
  publicBaseUrl,
  submitAppeal,
  validateSubmission,
  __test: { answerText, applyTokens, decisionButtons, logPayload, parseDecisionId, parseReviewId },
};
