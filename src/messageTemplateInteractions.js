const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  MessageTemplateError,
  buildTemplatePayload,
  normalizeMessageTemplatesConfig,
  parseTemplateControlCustomId,
  templateById,
  templateControlIdentityToken,
  templateControlRevisionToken,
  templateIdentityToken,
  templateLegacyDropdownRevisionToken,
  templateOptionValue,
} = require('./messageTemplates');
const { fetchGuildRoles, roleSafety } = require('./reactionRoles');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

async function deferEphemeral(interaction) {
  if (!interaction?.deferred && !interaction?.replied && typeof interaction?.deferReply === 'function') {
    await interaction.deferReply({ flags: EPHEMERAL });
  }
}

async function ephemeral(interaction, content, options = {}) {
  const payload = {
    content: String(content || 'This Message Template action could not be completed.').slice(0, 1900),
    allowedMentions: { parse: [], users: [], roles: [] },
  };
  if (options.followUp && typeof interaction?.followUp === 'function') {
    return interaction.followUp({ ...payload, flags: EPHEMERAL });
  }
  if (interaction?.deferred || interaction?.replied) return interaction.editReply?.(payload);
  return interaction?.reply?.({ ...payload, flags: EPHEMERAL });
}

async function resolveOriginGuild(interaction, guildId, options = {}) {
  if (interaction?.guild?.id === guildId) return interaction.guild;
  const client = options.client || interaction?.client;
  const cached = client?.guilds?.cache?.get?.(guildId);
  if (cached) return cached;
  return client?.guilds?.fetch ? await client.guilds.fetch(guildId).catch(() => null) : null;
}

function uniqueMatch(values, tokenFor, expected) {
  const matches = values.filter((value) => tokenFor(value) === expected);
  return matches.length === 1 ? matches[0] : null;
}

function friendlyActionError(error, fallback) {
  if (error instanceof MessageTemplateError) return error.message;
  return String(error?.friendlyMessage || fallback || 'Discord rejected the action.');
}

async function actionMember(context) {
  if (context.memberPromise) return context.memberPromise;
  const memberId = context.interaction?.user?.id || context.interaction?.member?.id;
  context.memberPromise = context.guild?.members?.fetch
    ? context.guild.members.fetch(memberId).catch(() => null)
    : Promise.resolve(context.interaction?.member || null);
  return context.memberPromise;
}

async function actionRoleContext(context) {
  if (!context.roleContextPromise) context.roleContextPromise = fetchGuildRoles(context.guild);
  return context.roleContextPromise;
}

async function executeRoleAction(action, context) {
  const member = await actionMember(context);
  if (!member) throw Object.assign(new Error('You are no longer a member of the originating server.'), { friendlyMessage: 'You are no longer a member of the originating server.' });
  const { roles, botMember } = await actionRoleContext(context);
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    throw Object.assign(new Error('Manage Roles is missing.'), { friendlyMessage: 'CoinSprite needs Manage Roles in the originating server.' });
  }
  const role = roles?.get?.(action.roleId) || null;
  const safety = roleSafety(role, context.guild, botMember);
  if (!safety.ok) throw Object.assign(new Error(safety.reason), { friendlyMessage: safety.reason });
  const hasRole = Boolean(member.roles?.cache?.has?.(role.id));
  if (action.type === 'give_role') {
    if (hasRole) return `@${role.name} was already assigned`;
    if (typeof member.roles?.add !== 'function') throw new Error('Member roles are unavailable.');
    await member.roles.add(role);
    return `Gave @${role.name}`;
  }
  if (!hasRole) return `@${role.name} was already removed`;
  if (typeof member.roles?.remove !== 'function') throw new Error('Member roles are unavailable.');
  await member.roles.remove(role);
  return `Removed @${role.name}`;
}

function actionTargetTemplate(action, collection) {
  const target = templateById(collection, action.templateId);
  if (!target) throw Object.assign(new Error('Missing template.'), { friendlyMessage: 'The selected Message Template no longer exists.' });
  if (!target.enabled) throw Object.assign(new Error('Disabled template.'), { friendlyMessage: `“${target.name}” is disabled.` });
  return target;
}

async function executeTemplateAction(action, context) {
  if (['give_role', 'remove_role'].includes(action.type)) return executeRoleAction(action, context);
  const target = actionTargetTemplate(action, context.collection);
  if (action.type === 'send_message') {
    if (context.interaction?.guildId !== context.guild.id) {
      throw Object.assign(new Error('No server channel.'), { friendlyMessage: 'This action can send only from a server text channel.' });
    }
    const payload = buildTemplatePayload(target, context.guild, context.interaction.channel);
    if (context.ephemeralTemplateCount) {
      if (typeof context.interaction?.followUp !== 'function') throw new Error('Ephemeral follow-up delivery is unavailable.');
      await context.interaction.followUp({ ...payload, flags: Number(payload.flags || 0) | EPHEMERAL });
    } else {
      if (typeof context.interaction?.editReply !== 'function') throw new Error('Ephemeral reply delivery is unavailable.');
      await context.interaction.editReply(payload);
    }
    context.ephemeralTemplateCount = (context.ephemeralTemplateCount || 0) + 1;
    return `Showed “${target.name}” privately`;
  }
  const payload = buildTemplatePayload(
    target,
    context.guild,
    context.interaction?.guildId === context.guild.id ? context.interaction.channel : null,
  );
  if (typeof context.interaction?.user?.send !== 'function') throw Object.assign(new Error('DM delivery is unavailable.'), { friendlyMessage: 'I could not open a direct message for your account.' });
  try { await context.interaction.user.send(payload); }
  catch { throw Object.assign(new Error('DM delivery failed.'), { friendlyMessage: 'I could not send the DM. Your direct messages may be closed.' }); }
  return `Sent “${target.name}” by DM`;
}

function resultSummary(results) {
  if (results.length === 1) return results[0].ok ? `Done — ${results[0].message}.` : results[0].message;
  const succeeded = results.filter((result) => result.ok).length;
  const details = results.map((result) => `${result.ok ? '✓' : '✕'} ${result.message}`).join(' · ');
  return `Completed ${succeeded} of ${results.length} actions. ${details}`;
}

async function handleMessageTemplateInteraction(interaction, options = {}) {
  const rawCustomId = String(interaction?.customId || '');
  if (!rawCustomId.startsWith('mt:')) return false;
  await deferEphemeral(interaction);
  const parsed = parseTemplateControlCustomId(rawCustomId);
  if (!parsed) {
    await ephemeral(interaction, 'This Message Template control is unknown or has been tampered with.');
    return true;
  }
  if (interaction.guildId && interaction.guildId !== parsed.guildId) {
    await ephemeral(interaction, 'This Message Template control belongs to a different server.');
    return true;
  }
  const getConfig = options.getGuildConfigRaw || require('./serverConfig').getGuildConfigRaw;
  let config;
  try { config = getConfig(parsed.guildId); }
  catch {
    await ephemeral(interaction, 'The Message Template configuration is temporarily unavailable.');
    return true;
  }
  if (!config || config.enabled === false) {
    await ephemeral(interaction, 'The originating server is unavailable or CoinSprite is disabled there.');
    return true;
  }
  const collection = normalizeMessageTemplatesConfig(config.messageTemplates);
  const source = uniqueMatch(collection.items, (item) => templateIdentityToken(item.id), parsed.templateToken);
  if (!source || !source.enabled) {
    await ephemeral(interaction, 'This Message Template is no longer active.');
    return true;
  }
  const guild = await resolveOriginGuild(interaction, parsed.guildId, options);
  if (!guild) {
    await ephemeral(interaction, 'The originating server is currently unavailable.');
    return true;
  }

  let controls = [];
  if (parsed.type === 'button') {
    if (source.controls.type !== 'button') {
      await ephemeral(interaction, 'This button is stale and no longer belongs to the template.');
      return true;
    }
    const button = uniqueMatch(source.controls.buttons, (entry) => templateControlIdentityToken(entry.id), parsed.controlToken);
    if (!button || templateControlRevisionToken(source, 'button', button) !== parsed.revisionToken) {
      await ephemeral(interaction, 'This button is stale or has been removed.');
      return true;
    }
    controls = [button];
  } else {
    if (source.controls.type !== 'dropdown') {
      await ephemeral(interaction, 'This dropdown is stale or has been removed.');
      return true;
    }
    const dropdown = parsed.legacy
      ? source.controls.dropdowns.length === 1 ? source.controls.dropdowns[0] : null
      : uniqueMatch(source.controls.dropdowns, (entry) => templateControlIdentityToken(entry.id), parsed.controlToken);
    const revision = parsed.legacy
      ? templateLegacyDropdownRevisionToken(source, dropdown)
      : templateControlRevisionToken(source, 'dropdown', dropdown);
    if (!dropdown || revision !== parsed.revisionToken) {
      await ephemeral(interaction, 'This dropdown is stale or has been removed.');
      return true;
    }
    const selected = Array.isArray(interaction.values) ? interaction.values.map(String) : [];
    const uniqueSelected = new Set(selected);
    if (!selected.length || uniqueSelected.size !== selected.length || (!dropdown.allowMultiple && selected.length !== 1)) {
      await ephemeral(interaction, 'Choose a valid dropdown option.');
      return true;
    }
    for (const token of selected) {
      const option = uniqueMatch(dropdown.options, templateOptionValue, token);
      if (!option) {
        await ephemeral(interaction, 'One or more selected options are unknown or stale. No actions were run.');
        return true;
      }
      controls.push(option);
    }
  }

  const context = { interaction, guild, collection, memberPromise: null, roleContextPromise: null, ephemeralTemplateCount: 0 };
  const results = [];
  for (const control of controls) {
    try { results.push({ ok: true, type: control.action.type, message: await executeTemplateAction(control.action, context) }); }
    catch (error) { results.push({ ok: false, type: control.action.type, message: friendlyActionError(error, 'That action could not be completed.') }); }
  }
  const summarizedResults = results.filter((result) => result.type !== 'send_message' || !result.ok);
  if (summarizedResults.length) {
    await ephemeral(interaction, resultSummary(summarizedResults), { followUp: context.ephemeralTemplateCount > 0 });
  }
  (options.log || require('./commandLogger').logCommandSystem)(`Message Template ${source.id} executed ${results.length} control action(s) for user ${interaction.user?.id || 'unknown'} in guild ${parsed.guildId}.`);
  return true;
}

module.exports = {
  executeTemplateAction,
  handleMessageTemplateInteraction,
  resultSummary,
};
