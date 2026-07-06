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
const { getControlWorkflow } = require('../src/requestControlWorkflows');
const { getUserProgress } = require('../src/levelingManager');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const ACTION_MAP = { close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' };

function title(value, fallback = 'Processed') {
  const text = String(value || fallback).trim() || fallback;
  return /^[a-z_ -]+$/.test(text) ? text.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}
function actions(control) { return [...new Set((control?.actions || []).map((step) => ACTION_MAP[step]).filter(Boolean))]; }
function currentType(guildId, request) {
  const id = request?.type?.id || request?.ticketTypeId || '';
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || request?.type || null;
}
function componentStyle(style) { return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2; }
function option(control) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return { label: String(control.name || 'Action').slice(0, 100), value: String(control.id || '').slice(0, 100), ...(control.description ? { description: String(control.description).slice(0, 100) } : {}), ...(emoji ? { emoji } : {}) };
}
function button(control, requestId, disabled) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return { type: 2, custom_id: `request:act:${requestId}:${control.id}`, label: String(control.name || 'Action').slice(0, 80), style: componentStyle(control.buttonStyle), disabled, ...(emoji ? { emoji } : {}) };
}
function requestComponents(type, requestId, disabled = false) {
  const controls = (type?.adminPanel?.controls || []).filter((control) => !control.url && actions(control).length).slice(0, 25);
  if (type?.adminPanel?.enabled === false || !controls.length) return [];
  if (type.adminPanel?.style === 'buttons') {
    const rows = [];
    for (let i = 0; i < controls.length; i += 5) rows.push({ type: 1, components: controls.slice(i, i + 5).map((control) => button(control, requestId, disabled)) });
    return rows;
  }
  return [{ type: 1, components: [{ type: 3, custom_id: `request:act-select:${requestId}`, placeholder: disabled ? 'This request has been handled' : 'Choose request action', disabled, options: controls.map(option) }] }];
}
function parseSelection(interaction) {
  const id = interaction?.customId || '';
  if (interaction?.isButton?.() && id.startsWith('request:act:')) {
    const [, , requestId, controlId] = id.split(':');
    return { requestId, controlId };
  }
  if (interaction?.isStringSelectMenu?.() && id.startsWith('request:act-select:')) return { requestId: id.slice('request:act-select:'.length), controlId: interaction.values?.[0] || '' };
  return null;
}
function canUse(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const staff = getGuildConfig(interaction.guildId)?.roles?.staff;
  const allowed = new Set(type?.staffRoleIds?.length ? type.staffRoleIds : [staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}
function reasonModal(requestId, control) {
  return new ModalBuilder().setCustomId(`request:reason:${requestId}:${control.id}`).setTitle(`${control.name || 'Request action'} reason`.slice(0, 45)).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
  );
}
function stepConditionId(step) { return String(step || '').match(/^condition_([a-z0-9_-]{1,32})$/)?.[1] || ''; }
function sequence(control, workflow) { return Array.isArray(workflow?.sequence) && workflow.sequence.length ? workflow.sequence : [...(control?.actions || []), ...(workflow?.conditions || []).map((condition) => `condition_${condition.id}`)]; }
function workflowReady(workflow) { return Boolean(workflow && (workflow.dmTemplateId || (workflow.sequence || []).length || (workflow.conditions || []).length)); }
function answerFor(request, type, condition) {
  const question = (type.forms?.create || []).find((item) => item.id === condition.questionId);
  const answer = question ? (request.answers || []).find((item) => Number(item.order) === Number(question.order)) : null;
  return { question, answer: String(answer?.answer || '').trim() };
}
function matches(request, type, condition, member) {
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  const { question, answer } = answerFor(request, type, condition);
  if (!question) return false;
  if (question.type === 'file_upload') return condition.expected === 'has_files' ? Boolean(answer) : !answer;
  if (question.type === 'checkbox') return (['true', '1', 'yes', 'on', 'checked'].includes(answer.toLowerCase())) === (condition.expected === 'checked');
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) return answer.split(',').map((value) => value.trim()).includes(String(condition.expected || '').trim());
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}

function buildContext(guild, request, type, reason = '') {
  return {
    mention: `<@${request.userId}>`,
    username: request.username || '',
    displayName: request.displayName || request.username || '',
    userId: request.userId || '',
    ticketName: type.name || '',
    ticketId: request.id || '',
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '',
    server: guild?.name || '',
    avatarUrl: request.avatarUrl || '',
    formAnswers: formatFormAnswers(request.answers),
    reason: reason || '',
  };
}

function replacements(guild, request, type, reason = '') {
  return { '<@mention>': `<@${request.userId}>`, '<username>': request.username || '', '<display_name>': request.displayName || request.username || '', '<user_id>': request.userId || '', '<ticket_name>': type.name || '', '<ticket_id>': request.id || '', '<channel>': request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', '<server>': guild?.name || '', '<avatar_url>': request.avatarUrl || '', '<form-answer>': formatFormAnswers(request.answers), '<reason>': reason || '' };
}
function replaceDeep(value, map) {
  if (typeof value === 'string') { let out = value; for (const [from, to] of Object.entries(map)) out = out.split(from).join(String(to)); return out; }
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDeep(item, map)]));
  return value;
}
async function dmTarget(interaction, member, userId) { return member?.send ? member : interaction.client?.users?.fetch(userId).catch(() => null); }
async function dmText(target, text) {
  if (!target || !String(text || '').trim()) return { ok: false, reason: 'No DM target or message text.' };
  try { await target.send({ content: String(text).slice(0, 2000), allowedMentions: { parse: [] } }); return { ok: true }; }
  catch (error) { return { ok: false, reason: error?.message || 'Discord rejected the DM.' }; }
}
async function dmTemplate(target, guild, request, type, templateId, reason) {
  const template = templateId ? findTemplate(request.guildId, templateId) : null;
  if (!target || !template) return { ok: false, reason: templateId ? 'The selected DM template no longer exists.' : 'No DM template was selected.' };
  try { await target.send(buildMessagePayload(replaceDeep(template, replacements(guild, request, type, reason)))); return { ok: true }; }
  catch (error) { return { ok: false, reason: error?.message || 'Discord rejected the DM template.' }; }
}
function cleanEmojis(value) {
  if (Array.isArray(value)) return value.map(cleanEmojis);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'emoji').map(([key, item]) => [key, cleanEmojis(item)]));
  return value;
}
function invalidEmojiError(error) { return error?.code === 50035 || /Invalid Form Body|emoji/i.test(String(error?.message || '')); }
function expiredInteractionError(error) { return error?.code === 10062 || error?.code === 40060 || /Unknown interaction|already (been )?acknowledged/i.test(String(error?.message || '')); }
async function acknowledgeForWork(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  const defer = typeof interaction.deferUpdate === 'function'
    ? () => interaction.deferUpdate()
    : (typeof interaction.deferReply === 'function' ? () => interaction.deferReply({ flags: EPHEMERAL }) : null);
  if (!defer) return false;
  try { await defer(); return true; }
  catch (error) {
    if (expiredInteractionError(error)) return false;
    throw error;
  }
}
async function editRequestMessage(interaction, payload) {
  if (interaction.message?.edit) return interaction.message.edit(payload);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}
async function updateMessage(interaction, payload) {
  try { await editRequestMessage(interaction, payload); }
  catch (error) {
    if (invalidEmojiError(error)) { await editRequestMessage(interaction, cleanEmojis(payload)); return; }
    if (expiredInteractionError(error) && interaction.message?.edit) {
      try { await interaction.message.edit(payload); }
      catch (editError) {
        if (invalidEmojiError(editError)) { await interaction.message.edit(cleanEmojis(payload)); return; }
        throw editError;
      }
      return;
    }
    throw error;
  }
}
function statusMessage(type, statusLabel, reason, hasWarnings) {
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${title(statusLabel)}**${reason ? `\n-# Reason: ${reason}` : ''}${hasWarnings ? '\n-# Some follow-up actions failed; staff received details.' : ''}`.trim() };
}
async function finish(interaction, request, type, control, terminal, reason, state, warnings) {
  request.type = type;
  request.status = terminal || 'processed';
  request.statusLabel = title(control?.name || request.status);
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests ||= {};
  state.roleRequests[request.id] = request;
  saveState(state);
  await updateMessage(interaction, buildTicketMessagePayload(statusMessage(type, request.statusLabel, reason, warnings.length), buildContext(interaction.guild, request, type, reason), requestComponents(type, request.id, true)));
  if (warnings.length) await interaction.followUp({ content: warnings.join('\n'), flags: EPHEMERAL }).catch(() => null);
  return true;
}
async function execute(action, ctx) {
  if (action.type === 'accept') ctx.terminal = 'accepted';
  if (action.type === 'deny') ctx.terminal = 'denied';
  if (action.type === 'role_add' && ctx.member && action.roleId) {
    const ok = await ctx.member.roles.add(action.roleId, 'Request admin panel role-add action').then(() => true).catch(() => false);
    if (!ok) ctx.warnings.push(`Role add failed for <@${ctx.request.userId}>.`);
  }
  if (action.type === 'blacklist') {
    ctx.state.blacklistedUsersByGuild ||= {};
    const set = new Set(ctx.state.blacklistedUsersByGuild[ctx.request.guildId] || []);
    set.add(ctx.request.userId);
    ctx.state.blacklistedUsersByGuild[ctx.request.guildId] = [...set];
    if (ctx.member && ctx.type.blacklistRoleId) await ctx.member.roles.add(ctx.type.blacklistRoleId, 'Request admin panel blacklist action').catch(() => null);
    ctx.terminal ||= 'blacklisted';
  }
  if (action.type === 'dm_template') {
    const result = action.templateId
      ? await dmTemplate(ctx.target, ctx.guild, ctx.request, ctx.type, action.templateId, ctx.reason)
      : await dmText(ctx.target, replaceDeep(action.text || ctx.control.description || `Your ${ctx.type.name} request was reviewed.`, replacements(ctx.guild, ctx.request, ctx.type, ctx.reason)));
    ctx.dmTried = true;
    if (!result.ok) ctx.warnings.push(`DM failed for <@${ctx.request.userId}>: ${result.reason}`);
  }
}
async function run(interaction, request, type, control, workflow, reason = '') {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const ctx = { guild: interaction.guild, member, target: await dmTarget(interaction, member, request.userId), request, type, control, reason, state: loadState(), terminal: '', dmTried: false, warnings: [] };
  if (workflowReady(workflow)) {
    const conditions = new Map((workflow.conditions || []).map((condition) => [condition.id, condition]));
    for (const step of sequence(control, workflow)) {
      const conditionId = stepConditionId(step);
      if (conditionId) {
        const condition = conditions.get(conditionId);
        if (condition && matches(request, type, condition, member)) for (const item of condition.actions || []) await execute(item, ctx);
        continue;
      }
      const typeName = ACTION_MAP[step];
      if (typeName === 'dm_template') await execute({ type: 'dm_template', templateId: workflow.dmTemplateId, text: control.description }, ctx);
      else if (typeName === 'role_add') await execute({ type: 'role_add', roleId: control.moveToTicketTypeId }, ctx);
      else if (typeName) await execute({ type: typeName }, ctx);
    }
    if (!ctx.dmTried && workflow.dmTemplateId && actions(control).includes('dm_template')) await execute({ type: 'dm_template', templateId: workflow.dmTemplateId }, ctx);
  } else {
    for (const action of actions(control)) {
      if (action === 'dm_template') await execute({ type: 'dm_template', text: control.description }, ctx);
      else if (action === 'role_add') await execute({ type: 'role_add', roleId: control.moveToTicketTypeId }, ctx);
      else await execute({ type: action }, ctx);
    }
  }
  return finish(interaction, request, type, control, ctx.terminal, reason, ctx.state, ctx.warnings);
}
async function handleRequestAction(interaction) {
  if (!interaction.guildId) return false;
  let selection = parseSelection(interaction);
  let reason = '';
  if (!selection && interaction.isModalSubmit?.() && interaction.customId?.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    selection = { requestId, controlId };
    reason = interaction.fields.getTextInputValue('reason');
  }
  if (!selection) return false;
  const request = loadState().roleRequests?.[selection.requestId];
  const type = request ? currentType(interaction.guildId, request) : null;
  const control = type?.adminPanel?.controls?.find((item) => item.id === selection.controlId);
  if (!request?.requestKind || !type || !control) return false;
  if (!canUse(interaction, type)) { await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL }); return true; }
  if (request.status !== 'pending') { await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL }); return true; }
  const needsReason = !reason && String(control.id).startsWith('reason-') && actions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
  if (needsReason) { await interaction.showModal(reasonModal(request.id, control)); return true; }
  await acknowledgeForWork(interaction);
  return run(interaction, request, type, control, getControlWorkflow(interaction.guildId, type.id, control.id), reason);
}

Module._load = function requestDmRuntimePatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestDmRuntimePatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestAction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestDmRuntimePatched = true;
  return exported;
};

module.exports = { __test: { parseSelection, requestComponents, sequence, title } };
