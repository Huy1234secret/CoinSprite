const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { ITEMS, updateUser } = require('../Fishing Game/fishingFeature');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const ROLL_COUNT_WEIGHTS = [
  { value: 1, weight: 90 },
  { value: 2, weight: 9 },
  { value: 3, weight: 1 },
];

function weightedPick(entries) {
  const valid = entries.filter((entry) => Number(entry.weight) > 0);
  const total = valid.reduce((sum, entry) => sum + Number(entry.weight), 0);
  if (total <= 0) return valid[0]?.value ?? null;
  let roll = Math.random() * total;
  for (const entry of valid) {
    roll -= Number(entry.weight);
    if (roll <= 0) return entry.value;
  }
  return valid[valid.length - 1]?.value ?? null;
}

function baitChoices() {
  return Object.values(ITEMS)
    .filter((item) => item.type === 'Bait' && Number(item.bait?.boxChance) > 0)
    .map((item) => ({ value: item, weight: Number(item.bait.boxChance) }));
}

function addInventoryItem(user, itemId, amount) {
  const item = ITEMS[itemId];
  if (!item || amount <= 0) return;
  user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};
  const entry = user.inventory[itemId] && typeof user.inventory[itemId] === 'object' ? user.inventory[itemId] : { amount: 0 };
  entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0)) + amount;
  user.inventory[itemId] = entry;
}

function removeInventoryItem(user, itemId, amount) {
  const entry = user.inventory?.[itemId];
  const owned = Math.max(0, Math.floor(Number(entry?.amount) || 0));
  if (!entry || owned < amount) return false;
  entry.amount = owned - amount;
  if (entry.amount <= 0) delete user.inventory[itemId];
  return true;
}

function openBaitBoxes(amount) {
  const rewards = new Map();
  const choices = baitChoices();
  for (let box = 0; box < amount; box += 1) {
    const rolls = weightedPick(ROLL_COUNT_WEIGHTS) || 1;
    for (let roll = 0; roll < rolls; roll += 1) {
      const bait = weightedPick(choices);
      if (bait) rewards.set(bait.id, (rewards.get(bait.id) || 0) + 1);
    }
  }
  return rewards;
}

function rewardLines(rewards) {
  return [...rewards.entries()]
    .sort((a, b) => ITEMS[a[0]].name.localeCompare(ITEMS[b[0]].name))
    .map(([itemId, amount]) => `- x${amount} ${ITEMS[itemId].emoji} ${ITEMS[itemId].name}`)
    .join('\n');
}

const useCommand = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use a usable fishing item')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item to use')
      .setRequired(true)
      .addChoices({ name: 'Box of Fish Baits', value: 'box_of_fish_baits' }))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Amount to use')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)),
  suppressCommandLog: true,
  async execute(interaction) {
    const itemId = interaction.options.getString('item', true);
    const amount = interaction.options.getInteger('amount', true);
    const item = ITEMS[itemId];
    if (!item || item.useAction !== 'bait_box') {
      await interaction.reply({ content: 'That item cannot be used yet.', flags: EPHEMERAL_FLAG });
      return;
    }

    let message = '';
    updateUser(interaction.user.id, (user) => {
      if (!removeInventoryItem(user, itemId, amount)) {
        const owned = Math.max(0, Math.floor(Number(user.inventory?.[itemId]?.amount) || 0));
        message = `You only have x${owned} ${item.emoji} ${item.name}.`;
        return user;
      }
      const rewards = openBaitBoxes(amount);
      for (const [rewardId, rewardAmount] of rewards.entries()) addInventoryItem(user, rewardId, rewardAmount);
      message = [`Opened x${amount} ${item.emoji} ${item.name} worth ${item.value * amount} ${FISH_COIN}.`, 'Rewards:', rewardLines(rewards)].join('\n');
      return user;
    });

    await interaction.reply({ content: message });
  },
};

module.exports = useCommand;
