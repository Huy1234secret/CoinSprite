const Module = require('module');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');
const { findTemplate, buildMessagePayload } = require('../src/messageTemplates');
const { getUserProgress } = require('../src/levelingManager');
const { getControlWorkflow } = require('../src/requestControlWorkflows');

const originalLoad = Module._load;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' });
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function decodedActions(control) {
  return [...new Set((control.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
}
function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}
function requestComponents(type, requestId, disabled = false) {
  if (type.adminPanel?.enabled === false) return [];
  const controls = (type.adminPanel?.controls || []).filter((control) => !control.url && decodedActions(control).length);
  const rows = [];
  for (let index = 0; index < controls.length; index += 5) {
    rows.push({
      type: 1,
      components: controls.slice(index, index + 5).map((control) => ({
        type: 2,
        custom_id: `request:act:${requestId}:${control.id}`,
        label: String(control.name || 'Action').slice(0, 80),
        style: buttonStyle(control.buttonStyle),
        disabled,
        ...(control.emoji ? { emoji: discordEmoji(control.emoji) } : {}),
      })),
    });
  }
  return rows;
}
function storedContext(guild, request) {
  return {
    mention: `<@${request.userId}>`, username: request.username, displayName: request.displayName,
    userId: request.userId, ticketName: request.type.name, ticketId: request.id,
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', server: guild.name,
    avatarUrl: request.avatarUrl, formAnswers: formatFormAnswers(request.answers),
  };
}
function statusMessage(type, status, reason) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const suffix = reason ? `\n-# Reason: ${reason}` : '';
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${label}**${suffix}`.trim() };
}
function canInteract(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!(type.authorPermissions || []).includes('UseApplicationCommands')) return false;
  const config = getGuildConfig(interaction.guildId);
  const allowed = new Set(type.staffRoleIds?.length ? type.staffRoleIds : [config.roles?.staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
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
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
    return answer.split(',').map((value) => value.trim()).includes(String(condition.expected || '').trim());
  }
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}
function matchesCondition(request, condition, member) {
  if (condition.type === 'form_input') return matchesFormCondition(request, condition);
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  return false;
}
async function sendTemplate(member, guildId, templateId) {
  if (!member || !templateId) return;
  const template = findTemplate(guildId, templateId);
  if (template) await member.send(buildMessagePayload(template)).catch(() => null);
}
async function executeAction(action, context) {
  const { member, request, state } = context;
  if (action.type === 'dm_template') await sendTemplate(member, request.guildId, action.templateId);
  if (action.type === 'role_add' && member && action.roleId) await member.roles.add(action.roleId).catch(() => null);
  if (action.type === 'accept') context.terminal = 'accepted';
  if (action.type === 'deny') context.terminal = 'denied';
  if (action.type === 'blacklist') {
    state.blacklistedUsersByGuild ||= {};
    const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
    values.add(request.userId);
    state.blacklistedUsersByGuild[request.guildId] = [...values];
    if (member && request.type.blacklistRoleId) await member.roles.add(request.type.blacklistRoleId).catch(() => null);
    context.terminal ||= 'blacklisted';
  }
}
async function runWorkflow(interaction, request, control, workflow) {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const context = { member, request, state, terminal: '' };
  for (const actionType of decodedActions(control)) {
    if (actionType === 'dm_template') await sendTemplate(member, request.guildId, workflow.dmTemplateId);
    else if (actionType === 'role_add') await executeAction({ type: 'role_add', roleId: control.moveToTicketTypeId }, context);
    else await executeAction({ type: actionType }, context);
  }
  for (const condition of workflow.conditions || []) {
    if (!matchesCondition(request, condition, member)) continue;
    for (const action of condition.actions || []) await executeAction(action, context);
  }
  request.status = context.terminal || 'processed';
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  const payload = buildTicketMessagePayload(
    statusMessage(request.type, request.status, ''),
    storedContext(interaction.guild, request),
    requestComponents(request.type, request.id, true),
  );
  await interaction.update(payload);
  return true;
}
async function handleWorkflowInteraction(interaction) {
  if (!interaction.guildId || !interaction.isButton?.() || !interaction.customId.startsWith('request:act:')) return false;
  const [, , requestId, controlId] = interaction.customId.split(':');
  const request = loadState().roleRequests?.[requestId];
  const control = request?.type?.adminPanel?.controls?.find((item) => item.id === controlId);
  const workflow = request ? getControlWorkflow(interaction.guildId, request.type.id, controlId) : null;
  if (!request || !control || !workflow || (!workflow.dmTemplateId && !(workflow.conditions || []).length)) return false;
  if (!canInteract(interaction, request.type)) {
    await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
    return true;
  }
  if (request.status !== 'pending') {
    await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
    return true;
  }
  return runWorkflow(interaction, request, control, workflow);
}

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestWorkflowPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleWorkflowInteraction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestWorkflowPatched = true;
  return exported;
};

module.exports = {};
