const fs = require('fs');
const Module = require('module');
const path = require('path');

const TARGET = path.resolve(__dirname, '..', 'src', 'messageTemplates.js');
const nativeJsLoader = Module._extensions['.js'];

function patchSanitizers(source) {
  let patched = source.replace(
    "function cleanEmoji(value) {\n  return String(value || '').trim().slice(0, 100);\n}\n",
    `function cleanEmoji(value) {\n  return String(value || '').trim().slice(0, 100);\n}\nfunction cleanOptionalId(value) {\n  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);\n}\nfunction cleanRoleId(value) {\n  const text = String(value || '').trim();\n  return /^\\d{16,20}$/.test(text) ? text : '';\n}\nfunction cleanBoolean(value) {\n  return value === true || ['true', '1', 'on', 'yes'].includes(String(value || '').toLowerCase());\n}\nfunction cleanComponentAction(value) {\n  const source = value && typeof value === 'object' ? value : {};\n  const type = ['send_message', 'give_role', 'legacy_response'].includes(source.type || source.actionType)\n    ? source.type || source.actionType\n    : 'send_message';\n  if (type === 'give_role') return { type, roleId: cleanRoleId(source.roleId), reverse: cleanBoolean(source.reverse) };\n  if (type === 'legacy_response') return { type, response: cleanText(source.response, 'This action has no response configured.', 2000) };\n  return { type: 'send_message', templateId: cleanOptionalId(source.templateId) };\n}\nfunction sanitizeComponentActions(value) {\n  const source = value && typeof value === 'object' ? value : {};\n  let actions = Array.isArray(source.actions) ? source.actions.slice(0, 2).map(cleanComponentAction) : [];\n  if (!actions.length) {\n    if (source.roleId || source.actionType === 'give_role') actions = [cleanComponentAction({ type: 'give_role', roleId: source.roleId, reverse: source.reverse })];\n    else if (source.templateId || source.actionType === 'send_message') actions = [cleanComponentAction({ type: 'send_message', templateId: source.templateId })];\n    else if (source.response) actions = [cleanComponentAction({ type: 'legacy_response', response: source.response })];\n    else actions = [cleanComponentAction({ type: 'send_message' })];\n  }\n  const unique = [];\n  for (const action of actions) {\n    if (action.type !== 'legacy_response' && unique.some((item) => item.type === action.type)) continue;\n    unique.push(action);\n  }\n  return unique.slice(0, 2);\n}\n`,
  );
  patched = patched.replace(
    "  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;\n  return {",
    "  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;\n  const actions = style === 'link' ? [] : sanitizeComponentActions(value);\n  return {",
  );
  patched = patched.replace(
    "    response: style === 'link' ? '' : cleanText(value?.response, 'This button has no response configured.', 2000),\n  };\n}\n\nfunction sanitizeSelectOption",
    "    response: '',\n    actions,\n  };\n}\n\nfunction sanitizeSelectOption",
  );
  patched = patched.replace(
    "function sanitizeSelectOption(value, index) {\n  return {",
    "function sanitizeSelectOption(value, index) {\n  const actions = sanitizeComponentActions(value);\n  return {",
  );
  patched = patched.replace(
    "    response: cleanText(value?.response, 'This option has no response configured.', 2000),\n  };\n}\n\nfunction sanitizeComponentRow",
    "    response: '',\n    actions,\n  };\n}\n\nfunction sanitizeComponentRow",
  );
  return patched;
}

async function componentRespond(interaction, payload) {
  const body = { ...payload, flags: Number(payload.flags || 0) | EPHEMERAL_FLAG };
  if (interaction.replied || interaction.deferred) return interaction.followUp(body);
  return interaction.reply(body);
}

async function executeComponentAction(interaction, action, context) {
  if (action.type === 'legacy_response') {
    return componentRespond(interaction, {
      content: formatPlaceholders(action.response, context),
      allowedMentions: allowedMentions(context),
    });
  }
  if (action.type === 'send_message') {
    const target = findTemplate(interaction.guildId, action.templateId);
    if (!target) throw new Error('The selected message template is no longer available.');
    return componentRespond(interaction, buildMessagePayload(target, context));
  }
  if (action.type === 'give_role') {
    const guild = interaction.guild;
    const member = interaction.member?.roles?.cache
      ? interaction.member
      : await guild?.members?.fetch(interaction.user.id).catch(() => null);
    const role = guild?.roles?.cache?.get(action.roleId) || await guild?.roles?.fetch(action.roleId).catch(() => null);
    if (!member || !role) throw new Error('The selected role is no longer available.');
    if (role.id === guild.id || role.managed || !role.editable) throw new Error('The bot cannot manage the selected role.');
    const hasRole = member.roles.cache.has(role.id);
    if (action.reverse && hasRole) {
      await member.roles.remove(role, 'Message component reverse role action');
      return componentRespond(interaction, { content: 'Removed the **' + role.name + '** role.' });
    }
    if (hasRole) return componentRespond(interaction, { content: 'You already have the **' + role.name + '** role.' });
    await member.roles.add(role, 'Message component role action');
    return componentRespond(interaction, { content: 'Added the **' + role.name + '** role.' });
  }
  throw new Error('This message component has no action configured.');
}

async function handleMessageTemplateInteraction(interaction) {
  if (!interaction?.isButton?.() && !interaction?.isStringSelectMenu?.()) return false;
  const parsed = parseComponentCustomId(interaction.customId);
  if (!parsed) return false;
  const template = findTemplate(interaction.guildId, parsed.templateId);
  const actions = [];

  if (interaction.isButton()) {
    for (const row of template?.componentRows || []) {
      if (row.type !== 'buttons') continue;
      const button = row.buttons.find((item) => row.id + '-' + item.id === parsed.componentId);
      if (button) { actions.push(...(button.actions || [])); break; }
    }
  } else {
    const row = template?.componentRows?.find((item) => item.type === 'select' && item.id === parsed.componentId);
    const selected = new Set(interaction.values || []);
    for (const option of row?.options || []) {
      if (selected.has(option.id)) actions.push(...(option.actions || []));
    }
  }

  if (!template || !actions.length) {
    await componentRespond(interaction, { content: 'This message component is no longer configured.' }).catch(() => null);
    return true;
  }
  const context = interactionContext(interaction);
  for (const action of actions) {
    try {
      await executeComponentAction(interaction, action, context);
    } catch (error) {
      await componentRespond(interaction, { content: error.message || 'This action could not be completed.' }).catch(() => null);
    }
  }
  return true;
}

function patchInteractionHandler(source) {
  const start = source.indexOf('async function handleMessageTemplateInteraction(interaction) {');
  const end = source.indexOf('\nfunction parseDiscordMessageLink', start);
  if (start < 0 || end < 0) throw new Error('Message template interaction handler signature changed.');
  const replacement = [componentRespond, executeComponentAction, handleMessageTemplateInteraction]
    .map((handler) => handler.toString())
    .join('\n\n');
  return `${source.slice(0, start)}${replacement}\n${source.slice(end)}`;
}

Module._extensions['.js'] = function messageTemplateActionLoader(module, filename) {
  if (path.resolve(filename) !== TARGET) return nativeJsLoader(module, filename);
  Module._extensions['.js'] = nativeJsLoader;
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(patchInteractionHandler(patchSanitizers(source)), filename);
};

module.exports = {};
