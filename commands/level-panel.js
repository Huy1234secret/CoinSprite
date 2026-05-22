const fs = require('fs');
const path = require('path');
const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');

const NERF_STORE_PATH = path.join(__dirname, '..', 'data', 'level-panel-xp-nerfs.json');
const XP_LOGS_DIR = path.join(__dirname, '..', 'logs', 'xp log');

function floorOneDecimal(value) {
  return Math.floor(Math.max(0, Number(value) || 0) * 10) / 10;
}

function loadNerfState() {
  try {
    if (!fs.existsSync(NERF_STORE_PATH)) return { guilds: {} };
    const parsed = JSON.parse(fs.readFileSync(NERF_STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
    return parsed;
  } catch {
    return { guilds: {} };
  }
}

function saveNerfState(state) {
  fs.mkdirSync(path.dirname(NERF_STORE_PATH), { recursive: true });
  fs.writeFileSync(NERF_STORE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getGuildNerfState(state, guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = { users: {} };
  if (!state.guilds[guildId].users || typeof state.guilds[guildId].users !== 'object') {
    state.guilds[guildId].users = {};
  }
  return state.guilds[guildId];
}

function setUserXpNerf(guildId, userId, scalePercent, durationMs, reason = '') {
  const state = loadNerfState();
  const guild = getGuildNerfState(state, guildId);
  const safeScalePercent = Math.max(1, Math.min(100, Number(scalePercent) || 100));
  const endsAt = Date.now() + Math.max(1, Math.floor(Number(durationMs) || 0));

  guild.users[userId] = {
    scalePercent: safeScalePercent,
    endsAt,
    reason: typeof reason === 'string' ? reason.trim() : '',
    appliedMessages: [],
    updatedAt: Date.now(),
  };
  saveNerfState(state);

  return { userId, scalePercent: safeScalePercent, endsAt };
}

function getActiveNerf(guildId, userId) {
  const state = loadNerfState();
  const guild = getGuildNerfState(state, guildId);
  const nerf = guild.users[userId];
  if (!nerf) return null;

  if (!nerf.endsAt || Date.now() >= nerf.endsAt) {
    delete guild.users[userId];
    saveNerfState(state);
    return null;
  }

  return { state, guild, nerf };
}

function markApplied(state, guildId, userId, messageId) {
  const guild = getGuildNerfState(state, guildId);
  const nerf = guild.users[userId];
  if (!nerf) return;

  const appliedMessages = Array.isArray(nerf.appliedMessages) ? nerf.appliedMessages : [];
  nerf.appliedMessages = [...new Set([...appliedMessages, messageId])].slice(-100);
  nerf.updatedAt = Date.now();
  saveNerfState(state);
}

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function getDailyXpLogPath(now = new Date()) {
  const day = padTwo(now.getUTCDate());
  const month = padTwo(now.getUTCMonth() + 1);
  const year = now.getUTCFullYear();
  return path.join(XP_LOGS_DIR, `XP Log ${day}-${month}-${year}.log`);
}

function getLoggedMessageXp(userId, messageId) {
  const logPath = getDailyXpLogPath();
  if (!fs.existsSync(logPath)) return null;

  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).reverse();
  const line = lines.find((entry) => entry.includes(`${userId} earned `) && entry.includes(`message ${messageId}`));
  const match = line?.match(new RegExp(`${userId} earned (\\d+(?:\\.\\d+)?) XP`));
  if (!match) return null;

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

manager.setUserXpNerf = setUserXpNerf;

async function applyNerfCorrection(message) {
  if (!message.guild || message.author.bot) return;

  const active = getActiveNerf(message.guild.id, message.author.id);
  if (!active) return;
  if (active.nerf.appliedMessages?.includes(message.id)) return;

  const awardedXp = getLoggedMessageXp(message.author.id, message.id);
  if (!awardedXp || awardedXp <= 0) return;

  const scalePercent = Math.max(1, Math.min(100, Number(active.nerf.scalePercent) || 100));
  const correction = floorOneDecimal(awardedXp * ((100 - scalePercent) / 100));
  if (correction <= 0) {
    markApplied(active.state, message.guild.id, message.author.id, message.id);
    return;
  }

  const current = manager.getUserProgress(message.guild.id, message.author.id);
  manager.setUserXp(message.guild.id, message.author.id, Math.max(0, current.totalXp - correction), {
    source: 'level-panel xp nerf correction',
    channelId: message.channelId,
    messageId: message.id,
    command: '/level-panel',
  });

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member) await syncMemberLevelRoles(message.guild, member).catch(() => null);
  markApplied(active.state, message.guild.id, message.author.id, message.id);
}

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const RADIO_GROUP_COMPONENT_TYPE = 21;
const USER_SELECT_COMPONENT_TYPE = 5;
const WHITE_ACCENT = 0xffffff;
const RED_ACCENT = 0xED4245;
const GREEN_ACCENT = 0x57F287;
const MAX_LEVEL_OPERAND = 10_000;
const MAX_XP_OPERAND = 1_000_000_000;
const PANEL_SELECT_ID = 'level-panel:action';
const EDIT_MODAL_ID = 'level-panel:edit-modal';
const PUNISH_MODAL_ID = 'level-panel:punish-modal';
const FIELD_TARGET_USER = 'level_panel_target_user';
const FIELD_EDIT_TYPE = 'level_panel_edit_type';
const FIELD_AMOUNT = 'level_panel_amount';
const FIELD_PUNISHMENT = 'level_panel_punishment';
const FIELD_REASON = 'level_panel_reason';

function container(accent, components) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: accent,
        components,
      },
    ],
  };
}

function getPanelPayload() {
  return {
    flags: COMPONENTS_V2_FLAG | EPHEMERAL_FLAG,
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          { type: 10, content: 'Select an action below' },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: PANEL_SELECT_ID,
                placeholder: 'Choose an action',
                min_values: 1,
                max_values: 1,
                options: [
                  { label: 'Edit level / xp', value: 'edit_level_xp' },
                  { label: 'Execute punishment', value: 'execute_punishment' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function resetPanelSelection(interaction) {
  if (!interaction?.message?.editable) return;
  await interaction.message.edit(getPanelPayload()).catch(() => null);
}

function userSelect(label) {
  return {
    type: 18,
    label,
    component: {
      type: USER_SELECT_COMPONENT_TYPE,
      custom_id: FIELD_TARGET_USER,
      placeholder: 'Select a user',
      min_values: 1,
      max_values: 1,
      required: true,
    },
  };
}

function radioGroup(label, customId, options) {
  return {
    type: 18,
    label,
    component: {
      type: RADIO_GROUP_COMPONENT_TYPE,
      custom_id: customId,
      required: true,
      options,
    },
  };
}

function shortInput(label, customId, required, placeholder, maxLength = 80) {
  return {
    type: 18,
    label,
    component: {
      type: 4,
      custom_id: customId,
      style: 1,
      required,
      ...(required ? { min_length: 1 } : {}),
      max_length: maxLength,
      placeholder,
    },
  };
}

function longInput(label, customId, required, placeholder, maxLength = 500) {
  return {
    type: 18,
    label,
    component: {
      type: 4,
      custom_id: customId,
      style: 2,
      required,
      ...(required ? { min_length: 1 } : {}),
      max_length: maxLength,
      placeholder,
    },
  };
}

function getEditModal() {
  return {
    custom_id: EDIT_MODAL_ID,
    title: 'Edit level / XP',
    components: [
      userSelect('Which user?'),
      radioGroup('What you wanna edit?', FIELD_EDIT_TYPE, [
        { label: 'Level', value: 'level' },
        { label: 'XP', value: 'xp' },
      ]),
      shortInput('Amount?', FIELD_AMOUNT, true, 'use + = plus, - = minus, s = set to, example: s5', 20),
    ],
  };
}

function getPunishmentModal() {
  return {
    custom_id: PUNISH_MODAL_ID,
    title: 'Execute punishment',
    components: [
      userSelect('Which user?'),
      radioGroup('What punishment?', FIELD_PUNISHMENT, [
        { label: 'Wipe level [half]', value: 'wipe_half' },
        { label: 'Wipe level [all]', value: 'wipe_all' },
        { label: 'Lock XP', value: 'lock_xp' },
        { label: 'Nerf XP gain', value: 'nerf_xp_gain' },
      ]),
      shortInput('Amount - time last? (for nerf XP gain)', FIELD_AMOUNT, false, 'scale: 1% - 100%, input example: 50% - 10h', 60),
      longInput('Reason?', FIELD_REASON, true, 'Reason for this punishment', 500),
    ],
  };
}

function getSubmittedComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  const stack = [...getSubmittedComponents(interaction)];
  while (stack.length) {
    const component = stack.shift();
    if (!component) continue;

    if (component.custom_id === customId || component.customId === customId) return component;
    if (component.component) stack.push(component.component);
    if (Array.isArray(component.components)) stack.push(...component.components);
  }
  return null;
}

function getSubmittedValue(interaction, customId) {
  const component = findSubmittedComponent(interaction, customId);
  if (component) {
    if (Array.isArray(component.values) && component.values.length) return component.values[0];
    if (Array.isArray(component.selected_values) && component.selected_values.length) return component.selected_values[0];
    if (component.value !== undefined) return component.value;
    if (component.selected_value !== undefined) return component.selected_value;
  }

  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return null;
  }
}

async function getTargetUser(interaction) {
  const userId = getSubmittedValue(interaction, FIELD_TARGET_USER);
  if (!userId) throw new Error('Select a user.');

  const member = interaction.guild.members.cache.get(userId)
    || await interaction.guild.members.fetch(userId).catch(() => null);
  const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) throw new Error('That user could not be found.');
  return { user, member };
}

function parseEditAmount(raw, maxValue, allowDecimal = false) {
  const pattern = allowDecimal ? /^([+\-s])\s*(\d+(?:\.\d+)?)$/ : /^([+\-s])\s*(\d+)$/;
  const match = pattern.exec(String(raw || '').trim().toLowerCase());
  if (!match) throw new Error('Invalid format. Use +N to add, -N to remove, or sN to set. Example: s5.');

  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0 || value > maxValue) {
    throw new Error(`Invalid value. Please use a number from 0 to ${maxValue.toLocaleString()}.`);
  }

  return {
    operation: match[1],
    value: allowDecimal ? value : Math.floor(value),
  };
}

function parseDurationMs(raw) {
  const compact = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = compact.match(/(\d+(?:\.\d+)?)(m|h|d|w)$/);
  if (!match) throw new Error('For nerf XP gain, include a duration like 10h, 30m, 2d, or 1w.');

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error('The nerf duration must be greater than 0.');

  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return Math.round(value * unitMs[match[2]]);
}

function parseNerfInput(raw) {
  const input = String(raw || '').trim().toLowerCase();
  const percentMatch = input.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!percentMatch) throw new Error('For nerf XP gain, use a scale and duration. Example: 50% - 10h.');

  const scalePercent = Number(percentMatch[1]);
  if (!Number.isFinite(scalePercent) || scalePercent < 1 || scalePercent > 100) {
    throw new Error('XP gain scale must be between 1% and 100%.');
  }

  const durationMs = parseDurationMs(input.replace(percentMatch[0], ''));
  return { scalePercent, durationMs };
}

async function syncTargetRoles(interaction, member) {
  if (member) {
    await syncMemberLevelRoles(interaction.guild, member).catch(() => null);
  }
}

function publicContainer(accent, content) {
  return {
    ...container(accent, [{ type: 10, content }]),
    allowedMentions: { users: [] },
  };
}

function ephemeralContainer(accent, content) {
  return {
    ...container(accent, [{ type: 10, content }]),
    flags: COMPONENTS_V2_FLAG | EPHEMERAL_FLAG,
  };
}

function formatEndTime(endsAt) {
  return endsAt ? `<t:${Math.floor(endsAt / 1000)}:R>` : 'now';
}

async function handleEditSubmit(interaction) {
  const { user, member } = await getTargetUser(interaction);
  const editType = getSubmittedValue(interaction, FIELD_EDIT_TYPE);
  const rawAmount = getSubmittedValue(interaction, FIELD_AMOUNT);

  if (editType === 'level') {
    const { operation, value } = parseEditAmount(rawAmount, MAX_LEVEL_OPERAND, false);
    const current = manager.getUserProgress(interaction.guildId, user.id);
    const targetLevel = operation === 's'
      ? Math.max(1, value)
      : Math.max(1, current.level + (operation === '+' ? value : -value));
    const result = manager.setUserLevel(interaction.guildId, user.id, targetLevel, {
      source: operation === '+' ? 'level-panel level add' : operation === 's' ? 'level-panel level set' : 'level-panel level remove',
      channelId: interaction.channelId,
      command: '/level-panel',
    });

    await syncTargetRoles(interaction, member);
    await interaction.reply(publicContainer(
      GREEN_ACCENT,
      `Updated <@${user.id}> to level **${result.level}** (Total XP: **${result.totalXp}**).`,
    ));
    return;
  }

  if (editType === 'xp') {
    const { operation, value } = parseEditAmount(rawAmount, MAX_XP_OPERAND, true);
    const current = manager.getUserProgress(interaction.guildId, user.id);
    const targetXp = operation === 's'
      ? value
      : Math.max(0, current.totalXp + (operation === '+' ? value : -value));
    const result = manager.setUserXp(interaction.guildId, user.id, targetXp, {
      source: operation === '+' ? 'level-panel xp add' : operation === 's' ? 'level-panel xp set' : 'level-panel xp remove',
      channelId: interaction.channelId,
      command: '/level-panel',
    });

    await syncTargetRoles(interaction, member);
    await interaction.reply(publicContainer(
      GREEN_ACCENT,
      `Updated <@${user.id}> to **${result.totalXp} XP**. New level: **${result.level}**.`,
    ));
    return;
  }

  throw new Error('Choose Level or XP.');
}

async function sendPunishmentDm(user, punishmentLabel, reason) {
  await user.send({
    ...container(WHITE_ACCENT, [
      {
        type: 10,
        content: [
          `## Hey ${user.username}, you have been punished in our Leveling system`,
          `* Punishment: ${punishmentLabel}`,
          `-# Reason: ${reason}`,
        ].join('\n'),
      },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# If you believe this was a false punishment, create a support ticket to appeal.' },
    ]),
    allowedMentions: { users: [] },
  }).catch(() => null);
}

async function handlePunishmentSubmit(interaction) {
  const { user, member } = await getTargetUser(interaction);
  const punishment = getSubmittedValue(interaction, FIELD_PUNISHMENT);
  const amount = String(getSubmittedValue(interaction, FIELD_AMOUNT) || '').trim();
  const reason = String(getSubmittedValue(interaction, FIELD_REASON) || '').trim();
  if (!reason) throw new Error('Reason is required.');

  const current = manager.getUserProgress(interaction.guildId, user.id);
  let punishmentLabel;
  let result;

  if (punishment === 'wipe_half') {
    result = manager.setUserXp(interaction.guildId, user.id, current.totalXp * 0.5, {
      source: 'level-panel wipe half',
      channelId: interaction.channelId,
      command: '/level-panel',
    });
    punishmentLabel = `Wipe level [half] - now **${result.totalXp} XP**, level **${result.level}**`;
    await syncTargetRoles(interaction, member);
  } else if (punishment === 'wipe_all') {
    result = manager.setUserXp(interaction.guildId, user.id, 0, {
      source: 'level-panel wipe all',
      channelId: interaction.channelId,
      command: '/level-panel',
    });
    punishmentLabel = `Wipe level [all] - now **${result.totalXp} XP**, level **${result.level}**`;
    await syncTargetRoles(interaction, member);
  } else if (punishment === 'lock_xp') {
    result = manager.setUserExpLock(interaction.guildId, user.id, true, reason);
    punishmentLabel = result.changed ? 'Lock XP' : 'Lock XP (already locked)';
  } else if (punishment === 'nerf_xp_gain') {
    const nerf = parseNerfInput(amount);
    result = manager.setUserXpNerf(interaction.guildId, user.id, nerf.scalePercent, nerf.durationMs, reason);
    punishmentLabel = `Nerf XP gain to **${result.scalePercent}%** until ${formatEndTime(result.endsAt)}`;
  } else {
    throw new Error('Choose a punishment.');
  }

  await sendPunishmentDm(user, punishmentLabel.replace(/\*\*/g, ''), reason);
  await interaction.reply(publicContainer(
    RED_ACCENT,
    [
      `## ${interaction.user.username} executed a Leveling punishment on <@${user.id}>`,
      `* Punishment: ${punishmentLabel}`,
      `-# Reason: ${reason}`,
    ].join('\n'),
  ));
}

module.exports = {
  handleMessageCreate: function handleMessageCreate(message) {
    setTimeout(() => {
      applyNerfCorrection(message).catch(() => null);
    }, 1500);
  },
  data: new SlashCommandBuilder()
    .setName('level-panel')
    .setDescription('Open the leveling staff panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.reply(getPanelPayload());
  },

  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu?.() && interaction.customId === PANEL_SELECT_ID) {
      const action = interaction.values?.[0];
      if (action === 'edit_level_xp') {
        await interaction.showModal(getEditModal());
        await resetPanelSelection(interaction);
        return true;
      }

      if (action === 'execute_punishment') {
        await interaction.showModal(getPunishmentModal());
        await resetPanelSelection(interaction);
        return true;
      }
    }

    if (interaction.isModalSubmit?.() && interaction.customId === EDIT_MODAL_ID) {
      try {
        await handleEditSubmit(interaction);
      } catch (error) {
        await interaction.reply(ephemeralContainer(RED_ACCENT, error?.message || 'Could not edit that level or XP value.'));
      }
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === PUNISH_MODAL_ID) {
      try {
        await handlePunishmentSubmit(interaction);
      } catch (error) {
        await interaction.reply(ephemeralContainer(RED_ACCENT, error?.message || 'Could not execute that punishment.'));
      }
      return true;
    }

    return false;
  },
};
