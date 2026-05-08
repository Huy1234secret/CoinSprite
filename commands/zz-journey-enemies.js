const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { WHITE_ACCENT, GREEN_ACCENT, RED_ACCENT, COIN, formatNumber } = require('../src/gamblingConfig');
const { addBalance } = require('../src/gamblingStore');
const { addInventoryItem } = require('../src/playerInventoryStore');
const { addPlayerXp } = require('../src/playerLevelStore');
const { ENEMIES, createStageEnemy } = require('../data/enemies');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const sessions = new Map();

const STAGES = [
  {
    id: 'jungle_entrance',
    name: 'Jungle Entrance',
    chapter: 1,
    stage: 1,
    reward: { coins: 100, exp: 25 },
    enemies: [createStageEnemy('jungle_slime', 2, { battle: { hp: 10, shield: 0, attackDamage: [3, 4], powerRequired: 0, xp: 5 } })],
  },
];

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function container(accent, components) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: accent, components }] }; }
function rand(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function uid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
function stageTitle(stage) { return `Chapter ${stage.chapter} - ${stage.stage}: ${stage.name}`; }
function hpBar(hp, maxHp) { return `${Math.max(0, hp)}/${maxHp} HP`; }

function listEnemies(stage) {
  return stage.enemies.map((enemy) => `- ${enemy.name}${enemy.emoji ? ` ${enemy.emoji}` : ''} x${enemy.count} (${enemy.rarity})`).join('\n');
}
function listEnemyDataPreview() {
  const names = ENEMIES.map((enemy) => enemy.name).join(', ');
  return `Loaded enemy data: ${ENEMIES.length} enemies\n-# ${names}`;
}
function homePayload(user, stage = STAGES[0]) {
  return container(WHITE_ACCENT, [
    text(`## ${user.username}'s Journey`),
    text(`**${stageTitle(stage)}**\n${listEnemies(stage)}\n\nReward: ${formatNumber(stage.reward.coins)} ${COIN}, ${formatNumber(stage.reward.exp)} EXP`),
    text(`-# ${listEnemyDataPreview()}`),
    separator(),
    row(button(`journey_enemy:play:${user.id}:${stage.id}`, 'Play Stage', 3)),
  ]);
}
function expandStageEnemies(stage) {
  const result = [];
  for (const enemy of stage.enemies) {
    for (let index = 1; index <= enemy.count; index += 1) {
      const battle = enemy.battle || {};
      const hp = Math.max(1, Math.floor(Number(battle.hp) || 10));
      result.push({
        id: `${enemy.id}_${index}_${uid()}`,
        enemyId: enemy.enemyId || enemy.id,
        name: enemy.name,
        emoji: enemy.emoji || '',
        rarity: enemy.rarity,
        hp,
        maxHp: hp,
        shield: Math.max(0, Math.floor(Number(battle.shield) || 0)),
        attackDamage: Array.isArray(battle.attackDamage) ? battle.attackDamage : [3, 4],
        xp: Math.max(0, Math.floor(Number(battle.xp) || 0)),
        loot: enemy.loot || [],
      });
    }
  }
  return result;
}
function createSession(user, stage) {
  return {
    id: uid(),
    userId: user.id,
    username: user.username,
    stage,
    player: { hp: 20, maxHp: 20, power: 0, maxPower: 10 },
    enemies: expandStageEnemies(stage),
    log: ['-# Battle started. Choose an enemy to attack.'],
    finished: false,
  };
}
function aliveEnemies(session) { return session.enemies.filter((enemy) => enemy.hp > 0); }
function battleSummary(session) {
  const enemyLines = session.enemies.map((enemy, index) => {
    const dead = enemy.hp <= 0 ? ' defeated' : '';
    const shield = enemy.shield > 0 ? ` | ${enemy.shield} shield` : '';
    return `**${index + 1}.** ${enemy.name}${enemy.emoji ? ` ${enemy.emoji}` : ''} — ${hpBar(enemy.hp, enemy.maxHp)}${shield}${dead}`;
  }).join('\n');
  return `Player: **${hpBar(session.player.hp, session.player.maxHp)}** | Power ${session.player.power}/${session.player.maxPower}\n\n${enemyLines}`;
}
function battleButtons(session) {
  return session.enemies.map((enemy, index) => button(`journey_enemy:hit:${session.userId}:${session.id}:${enemy.id}`, `Attack ${index + 1}`, 1, enemy.hp <= 0));
}
function battlePayload(session, accent = WHITE_ACCENT) {
  const buttons = battleButtons(session);
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(row(...buttons.slice(i, i + 5)));
  rows.push(row(button(`journey_enemy:home:${session.userId}`, 'Back Home', 2)));
  return container(accent, [
    text(`## ${session.username} is doing ${stageTitle(session.stage)}`),
    text(`${battleSummary(session)}\n\n${session.log.slice(-5).join('\n')}`),
    separator(),
    ...rows,
  ]);
}
function rollDrops(enemy) {
  const drops = [];
  for (const drop of enemy.loot || []) {
    if (Math.random() * 100 <= Number(drop.chance || 0)) drops.push({ ...drop, amount: 1 });
  }
  return drops;
}
function applyDrops(userId, drops) {
  const granted = [];
  for (const drop of drops) {
    if (drop.id === 'jungle_goo') {
      addInventoryItem(userId, 'jungle_goo', drop.amount);
      granted.push(`x${drop.amount} ${drop.name}${drop.emoji ? ` ${drop.emoji}` : ''}`);
    } else {
      granted.push(`x${drop.amount} ${drop.name} (data only)`);
    }
  }
  return granted;
}
async function finishBattle(interaction, session, win) {
  session.finished = true;
  sessions.delete(session.id);
  if (!win) {
    await interaction.message.edit(container(RED_ACCENT, [text(`## ${session.username} failed ${stageTitle(session.stage)}`), text(`${battleSummary(session)}\n\n-# You were defeated.`), separator(), row(button(`journey_enemy:play:${session.userId}:${session.stage.id}`, 'Retry', 2), button(`journey_enemy:home:${session.userId}`, 'Home', 2))])).catch(() => null);
    return;
  }
  const drops = session.enemies.flatMap(rollDrops);
  const grantedDrops = applyDrops(session.userId, drops);
  addBalance(session.userId, session.stage.reward.coins);
  const xpResult = addPlayerXp(session.userId, session.stage.reward.exp + session.enemies.reduce((sum, enemy) => sum + enemy.xp, 0));
  await interaction.message.edit(container(GREEN_ACCENT, [
    text(`## ${session.username} cleared ${stageTitle(session.stage)}!`),
    text(`Rewards:\n- ${formatNumber(session.stage.reward.coins)} ${COIN}\n- ${formatNumber(xpResult.addedXp)} EXP\n${grantedDrops.length ? grantedDrops.map((item) => `- ${item}`).join('\n') : '- No item drops this time.'}`),
    separator(),
    row(button(`journey_enemy:home:${session.userId}`, 'Home', 2)),
  ])).catch(() => null);
}
async function enemyTurn(interaction, session) {
  for (const enemy of aliveEnemies(session)) {
    const [min, max] = enemy.attackDamage;
    const damage = rand(min, max);
    session.player.hp = Math.max(0, session.player.hp - damage);
    session.log.push(`-# ${enemy.name} attacks and deals ${damage} damage.`);
    if (session.player.hp <= 0) break;
  }
  if (session.player.hp <= 0) return finishBattle(interaction, session, false);
  return interaction.message.edit(battlePayload(session)).catch(() => null);
}
async function handleHit(interaction, session, enemyId) {
  const target = session.enemies.find((enemy) => enemy.id === enemyId && enemy.hp > 0);
  if (!target) {
    await interaction.reply({ content: 'That enemy is already defeated.', flags: EPHEMERAL_FLAG });
    return true;
  }
  await interaction.deferUpdate();
  const damage = rand(2, 4);
  target.hp = Math.max(0, target.hp - damage);
  session.player.power = Math.min(session.player.maxPower, session.player.power + 2);
  session.log.push(`-# ${session.username} punches ${target.name} for ${damage} damage.`);
  if (target.hp <= 0) session.log.push(`-# ${target.name} was defeated.`);
  if (aliveEnemies(session).length === 0) return finishBattle(interaction, session, true);
  return enemyTurn(interaction, session);
}

module.exports = {
  bypassGlobalCooldown: true,
  disableActionTimeout: true,
  data: new SlashCommandBuilder().setName('journey').setDescription('Select an adventure stage.'),
  async execute(interaction) {
    await interaction.reply(homePayload(interaction.user));
  },
  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('journey_enemy:')) return false;
    const [, action, userId, sessionOrStageId, enemyId] = interaction.customId.split(':');
    if (userId && userId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own journey controls.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (action === 'home') {
      await interaction.update(homePayload(interaction.user)).catch(() => null);
      return true;
    }
    if (action === 'play') {
      const stage = STAGES.find((item) => item.id === sessionOrStageId) || STAGES[0];
      const session = createSession(interaction.user, stage);
      sessions.set(session.id, session);
      await interaction.update(battlePayload(session)).catch(() => null);
      return true;
    }
    if (action === 'hit') {
      const session = sessions.get(sessionOrStageId);
      if (!session || session.userId !== interaction.user.id || session.finished) {
        await interaction.reply({ content: 'This journey battle is no longer active.', flags: EPHEMERAL_FLAG });
        return true;
      }
      return handleHit(interaction, session, enemyId);
    }
    await interaction.reply({ content: 'More stages and chapters are coming soon.', flags: EPHEMERAL_FLAG });
    return true;
  },
};
