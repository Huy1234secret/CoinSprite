const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { PRCOIN, WHITE_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { FISHING_ROD_ID, ITEM_BY_ID, RARITY_EMOJIS, getCollectableBaseValue } = require('../src/fishingConfig');
const { destroyEquippedRod, getEquippedRod, getInventoryEntries } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ITEMS_PER_PAGE = 5;

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }
function userName(interaction) { return interaction.member?.displayName || interaction.user?.username || 'Player'; }

function buildInventoryPayload(interaction, page = 0) {
  const userId = interaction.user.id;
  const entries = getInventoryEntries(userId).sort((a, b) => a.item.name.localeCompare(b.item.name));
  const pages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
  const safePage = ((Number(page) || 0) % pages + pages) % pages;
  const shown = entries.slice(safePage * ITEMS_PER_PAGE, (safePage * ITEMS_PER_PAGE) + ITEMS_PER_PAGE);
  const equippedRod = getEquippedRod(userId);
  const components = [text(`## ${userName(interaction)}'s Inventory`)];

  if (equippedRod) {
    const rod = ITEM_BY_ID[FISHING_ROD_ID];
    components.push(text(`### ×1 ${rod.name} ${rod.emoji}\n-# **Using ×1 ${rod.name} - Dur: ${Math.max(0, Math.floor(equippedRod.durability))}\n-# Value: ${formatNumber(getCollectableBaseValue(FISHING_ROD_ID))} ${PRCOIN}`));
    components.push(row(button(`inventory:destroy:${userId}:${safePage}`, 'Destroy', 4, false)));
  }

  if (!shown.length && !equippedRod) components.push(text('-# Your inventory is empty.'));

  for (const entry of shown) {
    const rarityEmoji = RARITY_EMOJIS[entry.item.rarity] || '';
    components.push(text(`### ${entry.item.emoji || ''} ×${entry.amount} ${entry.item.name} ${rarityEmoji}\n-# Value: ${formatNumber(getCollectableBaseValue(entry.item.id))} ${PRCOIN}`));
  }

  components.push(separator());
  components.push(row(button(`inventory:page:${userId}:${safePage + 1}`, 'Switch page', 2, pages <= 1)));

  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components }] };
}

module.exports = {
  data: new SlashCommandBuilder().setName('inventory').setDescription('Show your item inventory'),
  async execute(interaction) { await interaction.reply(buildInventoryPayload(interaction, 0)); },
  async handleInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId?.startsWith('inventory:')) return false;
    const ownerId = ownerFromId(interaction.customId);
    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own inventory controls.', flags: EPHEMERAL_FLAG });
      return true;
    }
    const parts = interaction.customId.split(':');
    if (parts[1] === 'page') {
      await interaction.update(buildInventoryPayload(interaction, Number(parts[3]) || 0));
      return true;
    }
    if (parts[1] === 'destroy') {
      destroyEquippedRod(interaction.user.id);
      await interaction.update(buildInventoryPayload(interaction, Number(parts[3]) || 0));
      return true;
    }
    return false;
  },
};
