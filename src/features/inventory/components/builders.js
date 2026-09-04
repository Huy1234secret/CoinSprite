const { ButtonStyle, TextInputStyle } = require('discord.js');
const { v2Payload, WHITE } = require('../../shared/components');
const { assertValidMessagePayload } = require('../../shared/discordPayload');

function itemLine(item) {
  return `${item.emoji} ${item.name} \`×${BigInt(item.quantity)}\`\n-# Rarity: ${item.rarity} • ${item.type}`;
}

function inventoryPayload(ownerId, data, options = {}) {
  const itemList = data.items.length
    ? data.items.map(itemLine).join('\n\n')
    : '-# Your inventory is empty.';
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### <@${ownerId}>'s Inventory` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: itemList },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `-# Page ${data.page}/${data.maxPages} • ${data.totalItemStacks} item stacks` },
      { type: 1, components: [{
        type: 2,
        style: ButtonStyle.Secondary,
        label: 'Switch Page',
        custom_id: `csinventory:page:${ownerId}`,
        disabled: data.maxPages <= 1,
      }] },
    ],
  }], options));
}

function inventoryPageModal(ownerId, maxPages) {
  return {
    custom_id: `csinventory:modal:${ownerId}`,
    title: 'Switch Inventory Page',
    components: [{
      type: 1,
      components: [{
        type: 4,
        custom_id: 'page',
        label: 'Which page would you like to view?',
        placeholder: `1 - ${maxPages}`,
        style: TextInputStyle.Short,
        required: true,
      }],
    }],
  };
}

function inventoryErrorPayload(content, options = {}) {
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [{ type: 10, content: String(content).slice(0, 4_000) }],
  }], options));
}

module.exports = { inventoryErrorPayload, inventoryPageModal, inventoryPayload, itemLine };
