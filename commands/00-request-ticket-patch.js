const Module = require('module');
const {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');

const originalLoad = Module._load;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm', move_to: 'role_add', blacklist: 'blacklist' });
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function isRequestType(type) {
  return Boolean(type && String(type.id || '').startsWith('request-'));
}

function ticketType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
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

function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}

function decodedActions(control) {
  return [...new Set((control.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
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

async function submitRequest(interaction, type, answers) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const config = getGuildConfig(interaction.guildId);
  const state = loadState();
  state.roleRequests ||= {};
  const blacklist = new Set(state.blacklistedUsersByGuild?.[interaction.guildId] || []);
  if (blacklist.has(interaction.user.id)) {
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
    requestKind: 'configurable', id, guildId: interaction.guildId, userId: interaction.user.id,
    username: interaction.user.username, displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(), type, answers, status: 'pending',
    reviewChannelId, createdAt: new Date().toISOString(),
  };
  const payload = buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents(type, id));
  const message = await reviewChannel.send(payload);
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
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

async function runActions(interaction, request, control, reason = '') {
  const actions = decodedActions(control);
  const guild = interaction.guild;
  const member = await guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const type = request.type;
  let terminal = '';
  for (const action of actions) {
    if (action === 'accept') terminal = 'accepted';
    if (action === 'deny') terminal = 'denied';
    if (action === 'dm' && member) {
      const text = String(control.description || `Your ${type.name} request was reviewed.`)
        .replace(/<reason>/gi, reason).replace(/<ticket_name>/gi, type.name);
      await member.send(text).catch(() => null);
    }
    if (action === 'role_add' && member && /^\d{16,20}$/.test(control.moveToTicketTypeId || '')) {
      await member.roles.add(control.moveToTicketTypeId).catch(() => null);
    }
    if (action === 'blacklist') {
      state.blacklistedUsersByGuild ||= {};
      const values = new Set(state.blacklistedUsersByGuild[interaction.guildId] || []);
      values.add(request.userId);
      state.blacklistedUsersByGuild[interaction.guildId] = [...values];
      if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
      terminal ||= 'blacklisted';
    }
  }
  request.status = terminal || 'processed';
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  const payload = buildTicketMessagePayload(statusMessage(type, request.status, reason), storedContext(guild, request), requestComponents(type, request.id, true));
  if (interaction.isModalSubmit()) await interaction.update(payload);
  else await interaction.update(payload);
  if (member && terminal === 'accepted') await member.send(`Your **${type.name}** request was accepted.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  if (member && terminal === 'denied') await member.send(`Your **${type.name}** request was denied.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  return true;
}

async function handleRequestInteraction(interaction) {
  if (!interaction.guildId) return false;
  let typeId = '';
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type-select') typeId = interaction.values[0];
  if (interaction.isButton() && interaction.customId.startsWith('ticket:type-button:')) typeId = interaction.customId.slice('ticket:type-button:'.length);
  if (typeId) {
    const type = ticketType(interaction.guildId, typeId);
    if (!isRequestType(type)) return false;
    const questions = type.forms?.enabled ? type.forms.create || [] : [];
    if (questions.length) return false;
    return submitRequest(interaction, type, []);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create-form:')) {
    const type = ticketType(interaction.guildId, interaction.customId.slice('ticket:create-form:'.length));
    if (!isRequestType(type)) return false;
    return submitRequest(interaction, type, formAnswers(interaction, type.forms?.create || []));
  }
  if (interaction.isButton() && interaction.customId.startsWith('request:act:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    if (!request?.requestKind) return false;
    if (!canInteract(interaction, request.type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    if (request.status !== 'pending') {
      await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
      return true;
    }
    const control = request.type.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!control) return false;
    const needsReason = String(control.id).startsWith('reason-') && decodedActions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
    if (needsReason) {
      await interaction.showModal(reasonModal(requestId, control));
      return true;
    }
    return runActions(interaction, request, control);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    const control = request?.type?.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!request || !control) return false;
    if (!canInteract(interaction, request.type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    return runActions(interaction, request, control, interaction.fields.getTextInputValue('reason'));
  }
  return false;
}

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestTicketPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestInteraction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestTicketPatched = true;
  return exported;
};
