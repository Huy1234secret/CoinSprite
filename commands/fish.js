const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { PRCOIN, WHITE_ACCENT, RED_ACCENT, GREEN_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { getBalance, spendBalance } = require('../src/gamblingStore');
const {
  WORM_ID,
  FISHES,
  RARITY_LABELS,
  FISHING_UPGRADES,
  calculateFishingProgressGain,
  clamp,
  emojiUrl,
  getFishingUpgradePrice,
  getFishFinalValue,
  getTotalRodStrength,
  randomInt,
  rollFish,
  romanize,
  getLuckAdjustedFishWeights,
} = require('../src/fishingConfig');
const {
  addInventoryItem,
  recordFishCaught,
  damageEquippedRod,
  equipNextFishingRod,
  getEquippedRod,
  getFishingUpgrades,
  hasFishingRequirements,
  increaseFishingUpgrade,
  removeInventoryItem,
} = require('../src/fishingStore');
const { unlockFishAchievements } = require('../src/achievementSystem');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const LOADING_FISH = '<:SBLoadingfish:1499381238656667728>';
const YES = '<:Y_:1498173245981986869>';
const NO = '<:N_:1498173244031631400>';

const RARE_FISH_ANNOUNCE_CHANNEL_ID = '1498300014114377860';
const LEGENDARY_ACCENT = 0xF1C40F;
const MYTHICAL_ACCENT = 0xE67E22;
const SECRET_ACCENT = 0xC8A2FF;

function formatChance(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 1) return numeric.toFixed(2);
  if (numeric >= 0.01) return numeric.toFixed(4);
  return numeric.toFixed(8);
}

function getSessionFishChancePercent(fish, luckTier = 0) {
  const weights = getLuckAdjustedFishWeights(luckTier);
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return 0;
  const match = weights.find((entry) => entry.fish.id === fish.id);
  if (!match) return 0;
  return (match.weight / totalWeight) * 100;
}

function getRareSuccessAccent(rarity) {
  if (rarity === 'legendary') return LEGENDARY_ACCENT;
  if (rarity === 'mythical') return MYTHICAL_ACCENT;
  if (rarity === 'secret') return SECRET_ACCENT;
  return GREEN_ACCENT;
}

async function announceRareCatch(interaction, session, succeeded) {
  if (!session || Number(session.personalChance) >= 1) return;
  const channel = await interaction.client.channels.fetch(RARE_FISH_ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return;
  const fish = session.fish;
  const chance = formatChance(session.personalChance);
  const baseChance = formatChance(fish.chance);
  const thumbnail = emojiUrl(fish.emoji);

  const failText = `${interaction.user} has found ${fish.name}\n-# But failed to fish it, better luck next time`;
  const successText = `${interaction.user} has found ${fish.name} ${fish.emoji}\n-# And successfully fish it! 🎉`;
  const message = succeeded ? successText : failText;

  const contentBlock = thumbnail && !succeeded
    ? { type: 9, components: [text(message)], accessory: { type: 11, media: { url: thumbnail } } }
    : text(message);

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: succeeded ? getRareSuccessAccent(fish.rarity) : RED_ACCENT,
      components: [
        contentBlock,
        separator(),
        text(`-# The fish chance: ${chance}% \`(${baseChance}%)\``),
      ],
    }],
  }).catch(() => null);
}
const activeFishingSessions = new Map();

function makeSessionId() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function row(...components) { return { type: 1, components }; }
function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }
function userName(interaction) { return interaction.member?.displayName || interaction.user?.username || 'Player'; }
function progressBar(progress) { const filled = clamp(Math.floor(progress / 10), 0, 10); return `${'🟩'.repeat(filled)}${'⬛'.repeat(10 - filled)}`; }
function laneDisplay(fishPosition, greenPosition) { const fishLine = Array.from({ length: 5 }, (_, index) => (index === fishPosition ? '🐟' : '➖')).join(' '); const zoneLine = Array.from({ length: 5 }, (_, index) => (index === greenPosition ? '🟩' : '🟥')).join(' '); return `${fishLine}\n${zoneLine}`; }
function buildFishHomePayload(interaction) { const req = hasFishingRequirements(interaction.user.id); const status = req.ready ? `-# ${YES} Press the button below to start fishing!` : `-# ${NO} You need at least ${req.missing.join(' and ')} to start fishing.`; return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`Welcome ${interaction.user} to Fishing!\n* ${status}`), separator(), row(button(`fish:start:${interaction.user.id}`, req.ready ? 'FISH' : 'Unable to fish', req.ready ? 3 : 2, !req.ready), button(`fish:upgrades:${interaction.user.id}:0`, 'Upgrades', 3, false))] }] }; }
function buildFishingPayload(session) { const fish = session.fish; const thumb = emojiUrl(fish.emoji); const content = [`### ${fish.emoji} ${fish.name} has bitten the hook.`, `-# Fishing rod durability: ${Math.max(0, Math.floor(session.rodDurability))}`, `-# Reeling progress: ${progressBar(session.progress)} ${Math.floor(session.progress * 10) / 10}%`, '', 'Click **REEL** when the fish is in the **green zone**!', laneDisplay(session.fishPosition, session.greenPosition)].join('\n'); const block = thumb ? { type: 9, components: [text(content)], accessory: { type: 11, media: { url: thumb } } } : text(content); return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`-# You've cast your line, waiting for the fish... ${LOADING_FISH}`), block, separator(), row(button(`fish:reel:${session.userId}:${session.id}`, 'REEL', 2, false))] }] }; }
function buildResultPayload(interaction, session, ok, reason) { const req = hasFishingRequirements(interaction.user.id); const fish = session.fish; const thumb = emojiUrl(fish.emoji); const content = ok ? [`### You've successfully reeled ${fish.emoji} ${fish.name}`, `-# Rarity: ${RARITY_LABELS[fish.rarity] || fish.rarity}`, `-# Value: ${formatNumber(session.finalValue)} ${PRCOIN}`].join('\n') : `### ${reason || `You have failed to reel ${fish.emoji} ${fish.name} and it escaped`}`; const block = thumb ? { type: 9, components: [text(content)], accessory: { type: 11, media: { url: thumb } } } : text(content); return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: ok ? GREEN_ACCENT : RED_ACCENT, components: [block, separator(), row(button(`fish:start:${interaction.user.id}`, 'FISH again', req.ready ? 3 : 2, !req.ready))] }] }; }
function describeUpgrade(key, tier) { const config = FISHING_UPGRADES[key]; if (key === 'durability') return config.fixedTiers[tier]?.perk || 'Max tier reached'; return config.perk; }
function buildUpgradesPayload(interaction) { const upgrades = getFishingUpgrades(interaction.user.id); const balance = getBalance(interaction.user.id); const components = [text(`## ${userName(interaction)}'s Fish upgrades`)]; for (const key of Object.keys(FISHING_UPGRADES)) { const config = FISHING_UPGRADES[key]; const tier = Math.max(0, Math.floor(Number(upgrades[key]) || 0)); const price = getFishingUpgradePrice(key, tier); const maxed = tier >= config.maxTier || price == null; const canBuy = !maxed && balance >= price; components.push(text(`### ${config.name} ${romanize(tier)} - ${maxed ? 'MAX' : `${formatNumber(price)} ${PRCOIN}`}\n-# ${describeUpgrade(key, tier)}`)); components.push(row(button(`fish:buyupgrade:${interaction.user.id}:${key}`, maxed ? 'MAX' : 'BUY', canBuy ? 3 : 4, !canBuy))); } components.push(separator()); components.push(row(button(`fish:upgradepage:${interaction.user.id}:0:1`, 'Switch page', 2, false), button(`fish:back:${interaction.user.id}`, 'Back', 2, false))); return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components }] }; }
function showUpgradePageModal(interaction, currentPage, maxPage) { const modal = new ModalBuilder().setCustomId(`fish:upgradepageform:${interaction.user.id}:${currentPage}:${maxPage}`).setTitle('Switch upgrade page').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('page_input').setLabel('Which page u wanna switch to').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(6).setPlaceholder(`1-${maxPage}`))); return interaction.showModal(modal); }
function cleanupSession(sessionId) { const session = activeFishingSessions.get(sessionId); if (session?.timer) clearTimeout(session.timer); activeFishingSessions.delete(sessionId); }
function scheduleFishMove(sessionId) { const session = activeFishingSessions.get(sessionId); if (!session || session.done) return; const delay = session.fishPosition === session.greenPosition ? 4_000 : 2_000; session.timer = setTimeout(async () => { const current = activeFishingSessions.get(sessionId); if (!current || current.done) return; let nextPosition = randomInt(0, 4); if (nextPosition === current.fishPosition) nextPosition = (nextPosition + randomInt(1, 4)) % 5; current.fishPosition = nextPosition; await current.message?.edit(buildFishingPayload(current)).catch(() => null); scheduleFishMove(sessionId); }, delay); }
async function startFishing(interaction) { const req = hasFishingRequirements(interaction.user.id); if (!req.ready) { await interaction.reply({ content: `You need at least ${req.missing.join(' and ')} to start fishing.`, flags: EPHEMERAL_FLAG }); return; } if (!removeInventoryItem(interaction.user.id, WORM_ID, 1)) { await interaction.reply({ content: 'You need at least 1 Worm to start fishing.', flags: EPHEMERAL_FLAG }); return; } const rod = equipNextFishingRod(interaction.user.id); if (!rod) { await interaction.reply({ content: 'You need at least 1 Fishing rod to start fishing.', flags: EPHEMERAL_FLAG }); return; } const upgrades = getFishingUpgrades(interaction.user.id); const fish = rollFish(upgrades.luck); const session = { id: makeSessionId(), userId: interaction.user.id, fish, progress: 20, greenPosition: randomInt(0, 4), fishPosition: randomInt(0, 4), rodDurability: rod.durability, strength: getTotalRodStrength(upgrades.strength), finalValue: getFishFinalValue(fish, upgrades.value), personalChance: getSessionFishChancePercent(fish, upgrades.luck), message: interaction.message, done: false, timer: null }; activeFishingSessions.set(session.id, session); await interaction.update(buildFishingPayload(session)); session.message = interaction.message; scheduleFishMove(session.id); }
async function reel(interaction) { const sessionId = interaction.customId.split(':')[3]; const session = activeFishingSessions.get(sessionId); if (!session || session.done) { await interaction.reply({ content: 'This fishing session is no longer active.', flags: EPHEMERAL_FLAG }); return; } if (session.userId !== interaction.user.id) { await interaction.reply({ content: 'You can only reel your own fish.', flags: EPHEMERAL_FLAG }); return; } if (session.fishPosition === session.greenPosition) { session.progress = clamp(session.progress + calculateFishingProgressGain(session.strength, session.fish.rodStrengthRequirement), 0, 100); } else { session.progress = clamp(session.progress - randomInt(20, 30), 0, 100); const damage = Math.max(1, Math.ceil(session.fish.durabilityDamage * 0.10)); const rodResult = damageEquippedRod(interaction.user.id, damage); session.rodDurability = rodResult.rod?.durability ?? Math.max(0, session.rodDurability - damage); if (rodResult.broke) { session.done = true; cleanupSession(session.id); await interaction.update(buildResultPayload(interaction, session, false, `Your fishing rod broke and ${session.fish.emoji} ${session.fish.name} has escaped`));
      await announceRareCatch(interaction, session, false);
      return; } } if (session.progress >= 100) { session.done = true; cleanupSession(session.id); addInventoryItem(interaction.user.id, session.fish.id, 1); const fishStats = recordFishCaught(interaction.user.id, session.fish.id, 1); await unlockFishAchievements(interaction.channel, interaction.user, fishStats, session.fish, FISHES.length); damageEquippedRod(interaction.user.id, session.fish.durabilityDamage); await interaction.update(buildResultPayload(interaction, session, true));
    await announceRareCatch(interaction, session, true);
    return; } if (session.progress <= 0) { session.done = true; cleanupSession(session.id); damageEquippedRod(interaction.user.id, session.fish.durabilityDamage); await interaction.update(buildResultPayload(interaction, session, false, `You have failed to reel ${session.fish.emoji} ${session.fish.name} and it escaped`));
    await announceRareCatch(interaction, session, false);
    return; } session.rodDurability = getEquippedRod(interaction.user.id)?.durability ?? session.rodDurability; await interaction.update(buildFishingPayload(session)); }
module.exports = { data: new SlashCommandBuilder().setName('fish').setDescription('Go fishing for collectible fish'), async execute(interaction) { await interaction.reply(buildFishHomePayload(interaction)); }, async handleInteraction(interaction) { if (!interaction.isButton?.() || !interaction.customId?.startsWith('fish:')) return false; const ownerId = ownerFromId(interaction.customId); if (ownerId && ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own fishing controls.', flags: EPHEMERAL_FLAG }); return true; } if (interaction.customId.startsWith('fish:start:')) { await startFishing(interaction); return true; } if (interaction.customId.startsWith('fish:reel:')) { await reel(interaction); return true; } if (interaction.customId.startsWith('fish:upgrades:')) { await interaction.update(buildUpgradesPayload(interaction)); return true; } if (interaction.customId.startsWith('fish:upgradepage:')) { const parts = interaction.customId.split(':'); await showUpgradePageModal(interaction, Number(parts[3]) || 0, Math.max(1, Number(parts[4]) || 1)); return true; } if (interaction.customId.startsWith('fish:back:')) { await interaction.update(buildFishHomePayload(interaction)); return true; } if (interaction.customId.startsWith('fish:buyupgrade:')) { const key = interaction.customId.split(':')[3]; const upgrades = getFishingUpgrades(interaction.user.id); const price = getFishingUpgradePrice(key, upgrades[key]); if (!price) { await interaction.reply({ content: 'That upgrade is already maxed.', flags: EPHEMERAL_FLAG }); return true; } if (!spendBalance(interaction.user.id, price)) { await interaction.reply({ content: `You need ${formatNumber(price - getBalance(interaction.user.id))} ${PRCOIN} more.`, flags: EPHEMERAL_FLAG }); return true; } increaseFishingUpgrade(interaction.user.id, key); await interaction.update(buildUpgradesPayload(interaction)); return true; } return false; }, async handleModalSubmit(interaction) { if (!interaction.isModalSubmit?.() || !interaction.customId?.startsWith('fish:upgradepageform:')) return false; const [, , ownerId] = interaction.customId.split(':'); if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own fishing controls.', flags: EPHEMERAL_FLAG }); return true; } await interaction.reply(buildUpgradesPayload(interaction)); return true; } };
