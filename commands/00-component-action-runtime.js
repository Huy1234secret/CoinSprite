const fs = require('fs');
const Module = require('module');
const path = require('path');

const TARGET = path.resolve(__dirname, '..', 'src', 'messageTemplates.js');
const nativeJsLoader = Module._extensions['.js'];

function patchSanitizers(source) {
  let patched = source.replace(
    "function cleanEmoji(value) {\n  return String(value || '').trim().slice(0, 100);\n}\n",
    `function cleanEmoji(value) {\n  return String(value || '').trim().slice(0, 100);\n}\nfunction cleanOptionalId(value) {\n  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);\n}\nfunction cleanRoleId(value) {\n  const text = String(value || '').trim();\n  return /^\\d{16,20}$/.test(text) ? text : '';\n}\nfunction cleanBoolean(value) {\n  return value === true || ['true', '1', 'on', 'yes'].includes(String(value || '').toLowerCase());\n}\nfunction cleanActionType(value, fallback = 'send_message') {\n  const type = String(value || '');\n  return ['send_message', 'give_role', 'legacy_response'].includes(type) ? type : fallback;\n}\n`,
  );
  patched = patched.replace(
    "  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;\n  return {",
    "  const style = requestedStyle === 'link' && !url ? 'primary' : requestedStyle;\n  const fallbackAction = value?.roleId ? 'give_role' : value?.templateId ? 'send_message' : value?.response ? 'legacy_response' : 'send_message';\n  const actionType = style === 'link' ? '' : cleanActionType(value?.actionType, fallbackAction);\n  return {",
  );
  patched = patched.replace(
    "    response: style === 'link' ? '' : cleanText(value?.response, 'This button has no response configured.', 2000),\n  };\n}\n\nfunction sanitizeSelectOption",
    "    response: actionType === 'legacy_response' ? cleanText(value?.response, 'This button has no response configured.', 2000) : '',\n    actionType,\n    templateId: actionType === 'send_message' ? cleanOptionalId(value?.templateId) : '',\n    roleId: actionType === 'give_role' ? cleanRoleId(value?.roleId) : '',\n    reverse: actionType === 'give_role' && cleanBoolean(value?.reverse),\n  };\n}\n\nfunction sanitizeSelectOption",
  );
  patched = patched.replace(
    "function sanitizeSelectOption(value, index) {\n  return {",
    "function sanitizeSelectOption(value, index) {\n  const fallbackAction = value?.roleId ? 'give_role' : value?.templateId ? 'send_message' : value?.response ? 'legacy_response' : 'send_message';\n  const actionType = cleanActionType(value?.actionType, fallbackAction);\n  return {",
  );
  patched = patched.replace(
    "    response: cleanText(value?.response, 'This option has no response configured.', 2000),\n  };\n}\n\nfunction sanitizeComponentRow",
    "    response: actionType === 'legacy_response' ? cleanText(value?.response, 'This option has no response configured.', 2000) : '',\n    actionType,\n    templateId: actionType === 'send_message' ? cleanOptionalId(value?.templateId) : '',\n    roleId: actionType === 'give_role' ? cleanRoleId(value?.roleId) : '',\n    reverse: actionType === 'give_role' && cleanBoolean(value?.reverse),\n  };\n}\n\nfunction sanitizeComponentRow",
  );
  return patched;
}

function patchInteractionHandler(source) {
  const start = source.indexOf('async function handleMessageTemplateInteraction(interaction) {');
  const end = source.indexOf('\nfunction parseDiscordMessageLink', start);
  if (start < 0 || end < 0) throw new Error('Message template interaction handler signature changed.');
  const replacement = `async function componentRespond(interaction, payload) {\n  const body = { ...payload, flags: Number(payload.flags || 0) | EPHEMERAL_FLAG };\n  if (interaction.replied || interaction.deferred) return interaction.followUp(body);\n  return interaction.reply(body);\n}\n\nasync function executeComponentAction(interaction, action, context) {\n  if (action.actionType === 'legacy_response') {\n    return componentRespond(interaction, {\n      content: formatPlaceholders(action.response, context),\n      allowedMentions: allowedMentions(context),\n    });\n  }\n  if (action.actionType === 'send_message') {\n    const target = findTemplate(interaction.guildId, action.templateId);\n    if (!target) throw new Error('The selected message template is no longer available.');\n    return componentRespond(interaction, buildMessagePayload(target, context));\n  }\n  if (action.actionType === 'give_role') {\n    const guild = interaction.guild;\n    const member = interaction.member?.roles?.cache\n      ? interaction.member\n      : await guild?.members?.fetch(interaction.user.id).catch(() => null);\n    const role = guild?.roles?.cache?.get(action.roleId) || await guild?.roles?.fetch(action.roleId).catch(() => null);\n    if (!member || !role) throw new Error('The selected role is no longer available.');\n    if (role.id === guild.id || role.managed || !role.editable) throw new Error('The bot cannot manage the selected role.');\n    const hasRole = member.roles.cache.has(role.id);\n    if (action.reverse && hasRole) {\n      await member.roles.remove(role, 'Message component reverse role action');\n      return componentRespond(interaction, { content: \\`Removed the **\\${role.name}** role.\\` });\n    }\n    if (hasRole) return componentRespond(interaction, { content: \\`You already have the **\\${role.name}** role.\\` });\n    await member.roles.add(role, 'Message component role action');\n    return componentRespond(interaction, { content: \\`Added the **\\${role.name}** role.\\` });\n  }\n  throw new Error('This message component has no action configured.');\n}\n\nasync function handleMessageTemplateInteraction(interaction) {\n  if (!interaction?.isButton?.() && !interaction?.isStringSelectMenu?.()) return false;\n  const parsed = parseComponentCustomId(interaction.customId);\n  if (!parsed) return false;\n  const template = findTemplate(interaction.guildId, parsed.templateId);\n  const context = interactionContext(interaction);\n  const actions = [];\n\n  if (interaction.isButton()) {\n    for (const row of template?.componentRows || []) {\n      if (row.type !== 'buttons') continue;\n      const button = row.buttons.find((item) => \\`\\${row.id}-\\${item.id}\\` === parsed.componentId);\n      if (button) { actions.push(button); break; }\n    }\n  } else {\n    const row = template?.componentRows?.find((item) => item.type === 'select' && item.id === parsed.componentId);\n    const selected = new Set(interaction.values || []);\n    actions.push(...(row?.options || []).filter((option) => selected.has(option.id)));\n  }\n\n  if (!template || !actions.length) {\n    await componentRespond(interaction, { content: 'This message component is no longer configured.' }).catch(() => null);\n    return true;\n  }\n  for (const action of actions) {\n    try {\n      await executeComponentAction(interaction, action, context);\n    } catch (error) {\n      await componentRespond(interaction, { content: error.message || 'This action could not be completed.' }).catch(() => null);\n    }\n  }\n  return true;\n}\n`;
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

Module._extensions['.js'] = function messageTemplateActionLoader(module, filename) {
  if (path.resolve(filename) !== TARGET) return nativeJsLoader(module, filename);
  Module._extensions['.js'] = nativeJsLoader;
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(patchInteractionHandler(patchSanitizers(source)), filename);
};

module.exports = {};
