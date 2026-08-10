const { ITEM_RARITIES, ITEM_TYPES, getItem } = require('../data/items');
const { upgradeCost } = require('../../rng-game/services/gameService');
const { parseWeightThreshold } = require('../../rng-game/utils/normalize');
const {
  errorPayload,
  farmActionOptions,
  farmPayload,
  inventoryPageCount,
  inventoryUpgradePromptPayload,
  myInventoryPayload,
  successPayload,
} = require('./builders');
const {
  cropsFilterModal,
  inventoryPageModal,
  otherFilterModal,
  plantModal,
} = require('../modals/builders');
const { normalizePlotNumbers } = require('../repositories/farmingRepository');

function valuesFromModal(fields, customId) {
  try {
    return fields.getStringSelectValues(customId) || [];
  } catch {
    return [];
  }
}

function textFromModal(fields, customId) {
  try {
    return fields.getTextInputValue(customId) || '';
  } catch {
    return '';
  }
}

async function respondExpired(interaction, label = 'controls') {
  if (!interaction.isRepliable?.()) return;
  await interaction.reply(errorPayload(`Expired ${label}\nRun the command again to open fresh controls.`, { ephemeral: true })).catch(() => null);
}

async function enforceOwner(interaction, record, label) {
  if (record?.ownerId === String(interaction.user.id)) return true;
  await interaction.reply(errorPayload(`Not your ${label}\nOnly the command invoker can use these controls.`, { ephemeral: true })).catch(() => null);
  return false;
}

async function followUp(interaction, payload) {
  if (interaction.followUp) return interaction.followUp(payload).catch(() => null);
  return null;
}

function availableRarities(items) {
  return [...new Set((items || []).map((item) => item.rarity))];
}

function createFarmingComponentHandler(context) {
  const {
    actions,
    cropGameService,
    farmingService,
    farmRenderer,
    farmViews,
    inventoryViews,
    refreshScheduler,
    saleSessions,
  } = context;

  function inventoryStates(ownerId) {
    return {
      crops: cropGameService.inventory(ownerId),
      other: farmingService.inventory(ownerId),
    };
  }

  async function rebuildFarm(interaction, view) {
    const state = farmingService.farmState(view.ownerId);
    const image = await farmRenderer.render(state);
    await interaction.editReply(farmPayload(view.ownerId, state, view, image, { initial: false }));
    refreshScheduler?.schedule?.(view);
    return state;
  }

  async function rebuildInventory(interaction, view) {
    const state = inventoryStates(view.ownerId);
    await interaction.editReply(myInventoryPayload(interaction.user, state.crops, state.other, view));
    return state;
  }

  async function plotInteraction(interaction, parts) {
    const action = parts[2];
    const view = farmViews.get(parts[3]);
    if (!view || view.kind !== 'farm') {
      await respondExpired(interaction, 'farm controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'farm')) return true;

    if (action === 'select' && interaction.isStringSelectMenu?.()) {
      const requested = interaction.values || [];
      const selected = normalizePlotNumbers(requested);
      if (selected.length !== requested.length) {
        await interaction.reply(errorPayload('Invalid plots\nChoose plots numbered 1 through 9.', { ephemeral: true }));
        return true;
      }
      view.selectedPlots = new Set(selected);
      await interaction.deferUpdate();
      await rebuildFarm(interaction, view).catch(async () => {
        await followUp(interaction, errorPayload('Farm unavailable\nThe farm image could not be refreshed.', { ephemeral: true }));
      });
      return true;
    }

    if (action === 'action' && interaction.isStringSelectMenu?.()) {
      const selectedAction = String(interaction.values?.[0] || '');
      const state = farmingService.farmState(view.ownerId);
      const allowed = new Set(farmActionOptions(state, view.selectedPlots).map((option) => option.value));
      if (!view.selectedPlots.size || !allowed.has(selectedAction)) {
        await interaction.reply(errorPayload('Farm changed\nRefresh your plot selection and choose an available action.', { ephemeral: true }));
        return true;
      }
      if (selectedAction === 'gear') {
        await interaction.reply(successPayload('Coming soon\nGear and tool actions are not available yet.', { ephemeral: true }));
        return true;
      }
      if (selectedAction === 'plant') {
        const seedStacks = farmingService.inventory(view.ownerId).filter((stack) => (
          stack.quantity > 0n && stack.item?.itemTypes.includes('seed') && stack.item?.plantableCropId
        ));
        if (!seedStacks.length) {
          await interaction.reply(errorPayload('No seeds available\nYour Farming inventory has no plantable seed packages.', { ephemeral: true }));
          return true;
        }
        await interaction.showModal(plantModal(view, seedStacks));
        return true;
      }
      await interaction.deferUpdate();
      if (selectedAction === 'harvest') {
        const result = farmingService.harvest(view.ownerId, [...view.selectedPlots]);
        if (result.status !== 'ok') {
          await followUp(interaction, errorPayload('Nothing ready\nThe selected plots are no longer ready to harvest.', { ephemeral: true }));
          return true;
        }
        await rebuildFarm(interaction, view);
        const carrot = getItem('carrot');
        await followUp(interaction, successPayload(
          `Harvest complete\nHarvested **${result.plotCount}** plot${result.plotCount === 1 ? '' : 's'} and collected **${result.amount.toLocaleString('en-US')}** ${carrot.emoji} Carrots.`,
          { ephemeral: true },
        ));
        return true;
      }
      if (selectedAction === 'shovel') {
        const result = farmingService.shovel(view.ownerId, [...view.selectedPlots]);
        if (result.status !== 'ok') {
          await followUp(interaction, errorPayload('Nothing to shovel\nThe selected plots are already empty.', { ephemeral: true }));
          return true;
        }
        await rebuildFarm(interaction, view);
        await followUp(interaction, successPayload(
          `Plots cleared\nRemoved plants from **${result.plotCount}** plot${result.plotCount === 1 ? '' : 's'}. Removed plants cannot be recovered.`,
          { ephemeral: true },
        ));
        return true;
      }
      return true;
    }

    if (action === 'plant' && interaction.isModalSubmit?.()) {
      const itemId = String(valuesFromModal(interaction.fields, 'seed')[0] || '');
      const item = getItem(itemId);
      if (!item || !item.itemTypes.includes('seed') || !item.plantableCropId) {
        await interaction.reply(errorPayload('Invalid seed\nChoose a plantable seed shown in the form.', { ephemeral: true }));
        return true;
      }
      if (!view.selectedPlots.size) {
        await interaction.reply(errorPayload('No plots selected\nSelect at least one empty plot first.', { ephemeral: true }));
        return true;
      }
      await interaction.deferUpdate();
      const result = farmingService.plant(view.ownerId, [...view.selectedPlots], item.id);
      if (result.status !== 'ok') {
        const message = result.status === 'insufficient'
          ? 'You no longer have enough seed packages for every selected plot.'
          : 'One or more selected plots are no longer empty.';
        await followUp(interaction, errorPayload(`Planting unavailable\n${message}`, { ephemeral: true }));
        return true;
      }
      await rebuildFarm(interaction, view);
      await followUp(interaction, successPayload(
        `Planting complete\nPlanted **${result.plotNumbers.length}** plot${result.plotNumbers.length === 1 ? '' : 's'} with ${item.emoji} **${item.name}**.`,
        { ephemeral: true },
      ));
      return true;
    }
    return false;
  }

  async function inventoryInteraction(interaction, parts) {
    const action = parts[2];
    const token = parts[3];
    const view = inventoryViews.get(token);
    if (!view || view.kind !== 'inventory') {
      await respondExpired(interaction, 'inventory controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'inventory')) return true;
    const state = inventoryStates(view.ownerId);

    if (action === 'type' && interaction.isStringSelectMenu?.()) {
      const type = String(interaction.values?.[0] || '');
      if (!['crops', 'other'].includes(type)) {
        await interaction.reply(errorPayload('Invalid inventory type\nChoose Crops or Other.', { ephemeral: true }));
        return true;
      }
      view.type = type;
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, state.crops, state.other, view));
      return true;
    }
    if (action === 'page' && interaction.isButton?.()) {
      await interaction.showModal(inventoryPageModal(view, inventoryPageCount(state.crops, state.other, view)));
      return true;
    }
    if (action === 'page-submit' && interaction.isModalSubmit?.()) {
      const maximum = inventoryPageCount(state.crops, state.other, view);
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > maximum) {
        await interaction.reply(errorPayload(`Invalid page\nEnter a page from **1** to **${maximum}**.`, { ephemeral: true }));
        return true;
      }
      if (view.type === 'other') view.otherPage = page;
      else view.cropPage = page;
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, state.crops, state.other, view));
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      const modal = view.type === 'other'
        ? otherFilterModal(view)
        : cropsFilterModal(view, availableRarities(state.crops.items));
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      if (view.type === 'other') {
        const rarity = String(valuesFromModal(interaction.fields, 'rarity')[0] || '');
        const itemTypes = [...new Set(valuesFromModal(interaction.fields, 'types').map(String))];
        if (rarity && !ITEM_RARITIES.includes(rarity)) {
          await interaction.reply(errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
          return true;
        }
        if (itemTypes.some((type) => !ITEM_TYPES.includes(type))) {
          await interaction.reply(errorPayload('Invalid item type\nChoose item types shown in the form.', { ephemeral: true }));
          return true;
        }
        view.otherFilters = { name: textFromModal(interaction.fields, 'name').trim(), rarity, itemTypes };
        view.otherPage = 1;
      } else {
        let minimumWeightUnits;
        try {
          minimumWeightUnits = parseWeightThreshold(textFromModal(interaction.fields, 'weight'));
        } catch (error) {
          await interaction.reply(errorPayload(`Invalid weight\n${error.message}`, { ephemeral: true }));
          return true;
        }
        const rarity = String(valuesFromModal(interaction.fields, 'rarity')[0] || '');
        if (rarity && !availableRarities(state.crops.items).includes(rarity)) {
          await interaction.reply(errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
          return true;
        }
        view.cropFilters = { name: textFromModal(interaction.fields, 'name').trim(), minimumWeightUnits, rarity };
        view.cropPage = 1;
      }
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, state.crops, state.other, view));
      return true;
    }
    if (action === 'upgrade' && interaction.isButton?.()) {
      if (view.type !== 'crops') {
        await interaction.reply(errorPayload('Upgrade unavailable\nOther inventory has unlimited capacity.', { ephemeral: true }));
        return true;
      }
      const cost = upgradeCost(state.crops.player.upgradeLevel);
      const upgradeAction = actions.create(view.ownerId, { kind: 'inventory-upgrade', viewId: view.id, cost });
      await interaction.reply(inventoryUpgradePromptPayload(upgradeAction, state.crops.player));
      return true;
    }
    return false;
  }

  async function upgradeInteraction(interaction, parts) {
    const token = parts[3];
    const action = actions.get(token);
    if (!action || action.kind !== 'inventory-upgrade') {
      await respondExpired(interaction, 'upgrade confirmation');
      return true;
    }
    if (!await enforceOwner(interaction, action, 'upgrade')) return true;
    const claimed = actions.claim(token, interaction.user.id);
    if (!claimed) {
      await respondExpired(interaction, 'upgrade confirmation');
      return true;
    }
    const result = cropGameService.upgrade(interaction.user.id, claimed.id);
    if (result.status !== 'ok') {
      await interaction.update(errorPayload(`Upgrade unavailable\nYou need **${result.missing?.toLocaleString?.('en-US') || 'more'}** more Sheckles.`, { initial: false })).catch(() => null);
      return true;
    }
    await interaction.update(successPayload(`Inventory upgraded\nYour capacity is now **${result.inventoryCapacity}**.`, { initial: false })).catch(() => null);
    const view = inventoryViews.get(claimed.viewId, { touch: false });
    if (view?.editOriginal) {
      const state = inventoryStates(view.ownerId);
      await view.editOriginal(myInventoryPayload(interaction.user, state.crops, state.other, view)).catch(() => null);
    }
    return true;
  }

  return async function handleFarmingComponent(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('farm:')) return false;
    const parts = customId.split(':');
    if (parts[1] === 'plot') return plotInteraction(interaction, parts);
    if (parts[1] === 'inv' && saleSessions?.has?.(interaction.user.id)) {
      await interaction.reply(errorPayload('Sale in progress\nFinish or deny your current sale before using inventory controls.', { ephemeral: true })).catch(() => null);
      return true;
    }
    if (parts[1] === 'inv' && parts[2] === 'upgrade-confirm') return upgradeInteraction(interaction, parts);
    if (parts[1] === 'inv') return inventoryInteraction(interaction, parts);
    return false;
  };
}

module.exports = {
  createFarmingComponentHandler,
  enforceOwner,
  respondExpired,
  textFromModal,
  valuesFromModal,
};
