'use strict';

const Module = require('module');
const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');
const { findTemplate, buildMessagePayload } = require('../src/messageTemplates');
const { getUserProgress } = require('../src/levelingManager');
const { getControlWorkflow } = require('../src/requestControlWorkflows');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' });

function isRequestType(type) {
  return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
}
function configuredType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
}
function currentRequestType(guildId, request) {
  const typeId = request?.type?.id || request?.ticketTypeId || '';
  return configuredType(guildId, typeId) || request?.type || null;
}
function decodedActions(control) {
  return [...new Set((control?.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
}
function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}
function requestButton(control, requestId, disabled = false) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return {
    type: 2,
    custom_id: `request:act:${requestId}:${control.id}`,
    label: String(control.name || 'Action').slice(0, 80),
    style: buttonStyle(control.buttonStyle),
    disabled,
    ...(emoji ? { emoji } : {}),
  };
}
function requestOption(control) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return {
    label: String(control.name || 'Action').slice(0, 100),
    value: String(control.id || '').slice(0, 100),
    ...(control.description ? { description: String(control.description).slice(0, 100) } : {}),
    ...(emoji ? { emoji } : {}),
  };
}
function requestComponents(type, requestId, disabled = false) {
  if (type?.adminPanel?.enabled === false) return [];
  const controls = (type?.adminPanel?.controls || []).filter((control) => !control.url && decodedActions(control).length).slice(0, 25);
  if (!controls.length) return [];
  if (type.adminPanel?.style === 'buttons') {
    const rows = [];
    for (let index = 0; index < controls.length; index += 5) {
      rows.push({ type: 1, components: controls.slice(index, index + 5).map((control) => requestButton(control, requestId, disabled)) });
    }
    return rows;
  }
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `request:act-select:${requestId}`,
      placeholder: disabled ? 'This request has been handled' : 'Choose request action',
      disabled,
      options: controls.map(requestOption),
    }],
  }];
}
function parseRequestAction(interaction) {
  const customId = interaction?.customId || '';
  if (interaction?.isButton?.() && customId.startsWith('request:act:')) {
    const [, , requestId, controlId] = customId.split(':');
    return { requestId, controlId };
  }
  if (interaction?.isStringSelectMenu?.() && customId.startsWith('request:act-select:')) {
    return { requestId: customId.slice('request:act-select:'.length), controlId: interaction.values?.[0] || '' };
  }
  return null;
}
function submittedComponent(value, customId) {
  if (!value || typeof value !== 'object') return null;
  if (value.customId === customId || value.custom_id === customId) return value;
  for (const child of value.components || []) {
    const found = submittedComponent(child, customId);
    if (found) return found;
  }
  return null;
}
function attachmentUrl(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments || interaction?.resolved?.attachments;
  const attachment = typeof resolved?.get === 'function' ? resolved.get(id) : resolved?.[id];
  return attachment?.url || attachment?.proxyURL || attachment?.proxy_url || id;
}
function formAnswers(interaction, questions) {
  return (questions || []).filter((question) => question.type !== 'text_display').map((question, index) => {
    let answer = '';
    try { answer = interaction.fields.getTextInputValue(question.id); } catch { /* Components V2 fields are read below. */ }
    if (!answer) {
      const component = submittedComponent(interaction, question.id);
      const values = component?.values || (component?.value !== undefined ? [component.value] : []);
      answer = (Array.isArray(values) ? values : [values])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => question.type === 'file_upload' ? attachmentUrl(interaction, value) : String(value))
        .join(', ');
    }
    return { order: question.order || index + 1, question: question.question, type: question.type, answer };
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
    formAnswers: formatFormAnswers(answers),
  };
}
function storedContext(guild, request, type) {
  return {
    mention: `<@${request.userId}>`, username: request.username, displayName: request.displayName,
    userId: request.userId, ticketName: type.name, ticketId: request.id,
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', server: guild.name,
    avatarUrl: request.avatarUrl, formAnswers: formatFormAnswers(request.answers),
  };
}
function statusLabelFrom(value) {
  const text = String(value || '').trim();
  if (!text) return 'Processed';
  return /^[a-z_ -]+$/.test(text) ? text.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}
function selectedStatusLabel(control, fallback) {
  return statusLabelFrom(control?.name || fallback).slice(0, 80);
}
function statusMessage(type, statusLabel, reason = '') {
  const suffix = reason ? `\n-# Reason: ${reason}` : '';
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${statusLabelFrom(statusLabel)}**${suffix}`.trim() };
}
function canInteract(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!(type.authorPermissions || []).includes('UseApplicationCommands')) return false;
  const config = getGuildConfig(interaction.guildId);
  const allowed = new Set(type.staffRoleIds?.length ? type.staffRoleIds : [config.roles?.staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}
function reasonModal(requestId, control) {
  return new ModalBuilder()
    .setCustomId(`request:reason:${requestId}:${control.id}`)
    .setTitle(`${control.name || 'Request action'} reason`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
    ));
}
async function sendTemplate(member, guildId, templateId) {
  if (!member || !templateId) return;
  const template = findTemplate(guildId, templateId);
  if (template) await member.send(buildMessagePayload(template)).catch(() => null);
}
function conditionIdFromStep(value) {
  return String(value || '').match(/^condition_([a-z0-9_-]{1,32})$/)?.[1] || '';
}
function workflowSequence(control, workflow) {
  if (Array.isArray(workflow?.sequence) && workflow.sequence.length) return workflow.sequence;
  return [
    ...(control.actions || []),
    ...(workflow?.conditions || []).map((condition) => `condition_${condition.id}`),
  ];
}
function answerForCondition(request, condition) {
  const question = (request.type.forms?.create || []).find((item) => item.id === condition.questionId);
  if (!question) return { question: null, answer: '' };
  const answer = (request.answers || []).find((item) => Number(item.order) === Number(question.order));
  return { question, answer: String(answer?.answer || '').trim() };
}
function matchesFormCondition(request, condition) {
  const { question, answer } = answerForCondition(request, condition);
  if (!question) return false;
  if (question.type === 'file_upload') return condition.expected === 'has_files' ? Boolean(answer) : !answer;
  if (question.type === 'checkbox') {
    const checked = ['true', '1', 'yes', 'on', 'checked'].includes(answer.toLowerCase());
    return condition.expected === 'checked' ? checked : !checked;
  }
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
    const expected = String(condition.expected || '').trim();
    return Boolean(expected) && answer.split(',').map((value) => value.trim()).includes(expected);
  }
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}
function matchesCondition(request, condition, member) {
  if (condition.type === 'form_input') return matchesFormCondition(request, condition);
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  return false;
}
async function executeWorkflowAction(action, context) {
  const { member, request, state, type } = context;
  if (action.type === 'dm_template') await sendTemplate(member, request.guildId, action.templateId);
  if (action.type === 'role_add' && member && action.roleId) await member.roles.add(action.roleId).catch(() => null);
  if (action.type === 'accept') context.terminal = 'accepted';
  if (action.type === 'deny') context.terminal = 'denied';
  if (action.type === 'blacklist') {
    state.blacklistedUsersByGuild ||= {};
    const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
    values.add(request.userId);
    state.blacklistedUsersByGuild[request.guildId] = [...values];
    if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
    context.terminal ||= 'blacklisted';
  }
}
async function runWorkflow(interaction, request, type, control, workflow) {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const requestForConditions = { ...request, type };
  const context = { member, request, state, type, terminal: '' };
  const conditions = new Map((workflow.conditions || []).map((condition) => [condition.id, condition]));
  for (const step of workflowSequence(control, workflow)) {
    const conditionId = conditionIdFromStep(step);
    if (conditionId) {
      const condition = conditions.get(conditionId);
      if (condition && matchesCondition(requestForConditions, condition, member)) {
        for (const action of condition.actions || []) await executeWorkflowAction(action, context);
      }
      continue;
    }
    const actionType = ACTION_MAP[step];
    if (actionType === 'dm_template') await sendTemplate(member, request.guildId, workflow.dmTemplateId);
    else if (actionType === 'role_add') await executeWorkflowAction({ type: 'role_add', roleId: control.moveToTicketTypeId }, context);
    else if (actionType) await executeWorkflowAction({ type: actionType }, context);
  }
  request.type = type;
  request.status = context.terminal || 'processed';
  request.statusLabel = selectedStatusLabel(control, request.status);
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  await interaction.update(buildTicketMessagePayload(statusMessage(type, request.statusLabel), storedContext(interaction.guild, request, type), requestComponents(type, request.id, true)));
  return true;
}
async function runSimpleActions(interaction, request, type, control, reason = '') {
  const actions = decodedActions(control);
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  let terminal = '';
  for (const action of actions) {
    if (action === 'accept') terminal = 'accepted';
    if (action === 'deny') terminal = 'denied';
    if (action === 'dm_template' && member) {
      const text = String(control.description || `Your ${type.name} request was reviewed.`).replace(/<reason>/gi, reason).replace(/<ticket_name>/gi, type.name);
      await member.send(text).catch(() => null);
    }
    if (action === 'role_add' && member && /^\d{16,20}$/.test(control.moveToTicketTypeId || '')) await member.roles.add(control.moveToTicketTypeId).catch(() => null);
    if (action === 'blacklist') {
      state.blacklistedUsersByGuild ||= {};
      const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
      values.add(request.userId);
      state.blacklistedUsersByGuild[request.guildId] = [...values];
      if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
      terminal ||= 'blacklisted';
    }
  }
  request.type = type;
  request.status = terminal || 'processed';
  request.statusLabel = selectedStatusLabel(control, request.status);
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  await interaction.update(buildTicketMessagePayload(statusMessage(type, request.statusLabel, reason), storedContext(interaction.guild, request, type), requestComponents(type, request.id, true)));
  if (member && terminal === 'accepted') await member.send(`Your **${type.name}** request was accepted.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  if (member && terminal === 'denied') await member.send(`Your **${type.name}** request was denied.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  return true;
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
  const reviewChannelId = type.transcriptChannelId || config.channels?.roleRequestReview;
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The request review channel is unavailable. Ask an administrator to configure it.' });
    return true;
  }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const request = {
    requestKind: 'configurable', id, guildId: interaction.guildId, userId: interaction.user.id,
    username: interaction.user.username, displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(), type, answers, status: 'pending', statusLabel: 'Pending',
    reviewChannelId, createdAt: new Date().toISOString(),
  };
  const message = await reviewChannel.send(buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents(type, id)));
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
}
function workflowIsExecutable(workflow) {
  return Boolean(workflow && (workflow.dmTemplateId || (workflow.conditions || []).length || (workflow.sequence || []).length));
}
async function handleRequestInteraction(interaction) {
  if (!interaction?.guildId) return false;
  let typeId = '';
  if (interaction.isStringSelectMenu?.() && interaction.customId === 'ticket:type-select') typeId = interaction.values?.[0] || '';
  if (interaction.isButton?.() && interaction.customId?.startsWith('ticket:type-button:')) typeId = interaction.customId.slice('ticket:type-button:'.length);
  if (typeId) {
    const type = configuredType(interaction.guildId, typeId);
    if (!isRequestType(type)) return false;
    const questions = type.forms?.enabled ? type.forms.create || [] : [];
    if (questions.length) return false;
    return submitRequest(interaction, type, []);
  }
  if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('ticket:create-form:')) {
    const type = configuredType(interaction.guildId, interaction.customId.slice('ticket:create-form:'.length));
    if (!isRequestType(type)) return false;
    return submitRequest(interaction, type, formAnswers(interaction, type.forms?.create || []));
  }
  if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    const type = request ? currentRequestType(interaction.guildId, request) : null;
    const control = type?.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!request || !type || !control) return false;
    if (!canInteract(interaction, type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    return runSimpleActions(interaction, request, type, control, interaction.fields.getTextInputValue('reason'));
  }
  const selection = parseRequestAction(interaction);
  if (!selection) return false;
  const request = loadState().roleRequests?.[selection.requestId];
  const type = request ? currentRequestType(interaction.guildId, request) : null;
  const control = type?.adminPanel?.controls?.find((item) => item.id === selection.controlId);
  if (!request || !type || !control) return false;
  if (!canInteract(interaction, type)) {
    await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
    return true;
  }
  if (request.status !== 'pending') {
    await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
    return true;
  }
  const workflow = getControlWorkflow(interaction.guildId, type.id, control.id);
  if (workflowIsExecutable(workflow)) return runWorkflow(interaction, request, type, control, workflow);
  const needsReason = String(control.id).startsWith('reason-') && decodedActions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
  if (needsReason) {
    await interaction.showModal(reasonModal(request.id, control));
    return true;
  }
  return runSimpleActions(interaction, request, type, control);
}
Module._load = function requestSelectPanelPatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestSelectPanelPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestInteraction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestSelectPanelPatched = true;
  return exported;
};

module.exports = { __test: { requestComponents, selectedStatusLabel, workflowSequence } };
