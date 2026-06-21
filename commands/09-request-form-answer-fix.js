'use strict';

const Module = require('module');
const { MessageFlags } = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, formatFormAnswers } = require('../src/ticketConfig');
const requestSelectPatch = require('./05-request-select-panel-fix');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const CREATE_FORM_PREFIX = 'ticket:create-form:';
const LEGACY_FORM_ID_PREFIX = 'ticket_question_';

function isRequestType(type) {
  return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
}

function configuredType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
}

function getModalComponents(interaction) {
  const raw = interaction?.components ?? interaction?.data?.components ?? [];
  return Array.isArray(raw) ? raw : [];
}

function findSubmittedComponent(interaction, customIds) {
  const ids = new Set((Array.isArray(customIds) ? customIds : [customIds]).filter(Boolean));
  const stack = [...getModalComponents(interaction)];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    const component = item.component ?? item;
    const customId = component?.custom_id ?? component?.customId;
    if (customId && ids.has(customId)) return component;
    if (Array.isArray(item.components)) stack.push(...item.components);
    if (Array.isArray(component?.components)) stack.push(...component.components);
  }
  return null;
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [value];
}

function getCollectionItem(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === 'function') return collection.get(id) ?? null;
  return collection[id] ?? null;
}

function getTextAnswer(interaction, customIds) {
  for (const customId of customIds) {
    try {
      const value = interaction.fields?.getTextInputValue(customId);
      if (value !== undefined && value !== null && value !== '') return String(value);
    } catch {
      // Discord.js throws when a text field is not present for this id.
    }
  }
  const component = findSubmittedComponent(interaction, customIds);
  const value = component?.value;
  return value === undefined || value === null ? '' : String(value);
}

function normalizeAttachment(attachment) {
  if (!attachment) return null;
  const url = attachment.url || attachment.proxyURL || attachment.proxy_url || attachment.attachment || '';
  if (!/^https?:\/\//i.test(url)) return null;
  const clean = String(url).split('?')[0];
  const fallbackName = clean.split('/').pop() || 'uploaded-file';
  return {
    url,
    filename: attachment.name || attachment.filename || fallbackName,
  };
}

function getResolvedAttachment(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments
    ?? interaction?.resolved?.attachments
    ?? interaction?.fields?.resolved?.attachments
    ?? null;
  return normalizeAttachment(getCollectionItem(resolved, id));
}

function getUploadedFiles(interaction, customIds) {
  for (const customId of customIds) {
    if (typeof interaction?.fields?.getUploadedFiles === 'function') {
      try {
        const fromFields = collectionToArray(interaction.fields.getUploadedFiles(customId))
          .map(normalizeAttachment)
          .filter(Boolean);
        if (fromFields.length) return fromFields;
      } catch {
        // Continue checking alternate custom ids and resolved attachment data.
      }
    }
  }

  const component = findSubmittedComponent(interaction, customIds);
  const fromComponentAttachments = collectionToArray(component?.attachments)
    .map(normalizeAttachment)
    .filter(Boolean);
  if (fromComponentAttachments.length) return fromComponentAttachments;

  const rawValues = component?.values ?? component?.value ?? [];
  const ids = Array.isArray(rawValues) ? rawValues : [rawValues];
  const fromResolved = ids.map((id) => getResolvedAttachment(interaction, id)).filter(Boolean);
  if (fromResolved.length) return fromResolved;

  return collectionToArray(interaction?.attachments).map(normalizeAttachment).filter(Boolean);
}

function getSubmittedValues(interaction, customIds) {
  const component = findSubmittedComponent(interaction, customIds);
  const raw = component?.values ?? component?.value ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function questionCustomIds(question, index) {
  return [
    `${LEGACY_FORM_ID_PREFIX}${index + 1}`,
    question?.id,
  ].filter(Boolean);
}

function optionName(question, value) {
  const byIndex = question.options?.[Number(value)]?.name;
  if (byIndex) return byIndex;
  const byValue = question.options?.find((option) => option.value === value || option.name === value)?.name;
  return byValue || String(value);
}

function requestFormAnswers(interaction, questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => {
      const customIds = questionCustomIds(question, index);
      let answer = '';
      let uploadedFiles = [];

      if (question.type === 'text_display') {
        return { order: question.order || index + 1, question: question.question, type: question.type, answer: '' };
      }

      if (question.type === 'text_input') {
        answer = getTextAnswer(interaction, customIds);
      } else if (question.type === 'file_upload') {
        uploadedFiles = getUploadedFiles(interaction, customIds);
        answer = uploadedFiles.map((file) => `[${file.filename}](${file.url})`).join('\n');
      } else if (question.type === 'checkbox') {
        const value = getSubmittedValues(interaction, customIds)[0];
        answer = value === true || value === 'true' || value === 'on' ? 'Yes' : 'No';
      } else {
        const values = getSubmittedValues(interaction, customIds);
        if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
          answer = values.map((value) => optionName(question, value)).join(', ');
        } else if (question.type === 'user_select') {
          answer = values.map((value) => `<@${value}>`).join(', ');
        } else if (question.type === 'role_select') {
          answer = values.map((value) => `<@&${value}>`).join(', ');
        } else if (question.type === 'channel_select') {
          answer = values.map((value) => `<#${value}>`).join(', ');
        }
      }

      return {
        order: question.order || index + 1,
        question: question.question,
        type: question.type,
        answer,
        uploadedFiles,
      };
    });
}

function requestContext(interaction, type, requestId, answers) {
  return {
    mention: `<@${interaction.user.id}>`,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    userId: interaction.user.id,
    ticketName: type.name,
    ticketId: requestId,
    channel: interaction.channel ? `<#${interaction.channel.id}>` : '',
    server: interaction.guild?.name || '',
    avatarUrl: interaction.user.displayAvatarURL(),
    formAnswers: formatFormAnswers(answers) || '-# No form answers were submitted.',
  };
}

async function submitRequest(interaction, type, answers) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const config = getGuildConfig(interaction.guildId);
  const state = loadState();
  state.roleRequests ||= {};

  if (new Set(state.blacklistedUsersByGuild?.[interaction.guildId] || []).has(interaction.user.id)) {
    await interaction.editReply({ content: 'You are not allowed to create this request.' });
    return true;
  }

  const reviewChannelId = type.transcriptChannelId || resolveLoggingChannelId(config, 'requests', 'role_review', config.channels?.roleRequestReview);
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The request review channel is unavailable. Ask an administrator to configure it.' });
    return true;
  }

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const request = {
    requestKind: 'configurable',
    id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(),
    type,
    answers,
    status: 'pending',
    statusLabel: 'Pending',
    reviewChannelId,
    createdAt: new Date().toISOString(),
  };

  const requestComponents = requestSelectPatch.__test?.requestComponents?.(type, id) || [];
  const message = await reviewChannel.send(buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents));
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
}

async function handleRequestCreateForm(interaction) {
  if (!interaction?.guildId || !interaction?.isModalSubmit?.()) return false;
  if (!interaction.customId?.startsWith(CREATE_FORM_PREFIX)) return false;
  const type = configuredType(interaction.guildId, interaction.customId.slice(CREATE_FORM_PREFIX.length));
  if (!isRequestType(type)) return false;
  const questions = type.forms?.enabled ? type.forms.create || [] : [];
  if (!questions.length) return false;
  return submitRequest(interaction, type, requestFormAnswers(interaction, questions));
}

Module._load = function requestFormAnswerPatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestFormAnswerPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestCreateForm(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestFormAnswerPatched = true;
  return exported;
};

module.exports = { __test: { requestFormAnswers, optionName } };
