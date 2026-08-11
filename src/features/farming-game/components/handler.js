const { ITEMS, getItem } = require('../data/items');
const { catalogIndexForName } = require('../data/catalog');
const {
  errorPayload,
  farmActionOptions,
  farmPayload,
  farmingIndexPayload,
  farmingSaleDeniedPayload,
  farmingSaleFinishedPayload,
  farmingSalePageData,
  farmingSalePayload,
  inventoryPageCount,
  myInventoryPayload,
  successPayload,
} = require('./builders');
const {
  cropsFilterModal,
  inventoryPageModal,
  indexSearchModal,
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

function categoryCatalog(category) {
  return ITEMS.filter((item) => item.inventoryCategory === category);
}

function availableRarities(category) {
  return [...new Set(categoryCatalog(category).map((item) => item.rarity))];
}

function availableItemTypes(category) {
  return [...new Set(categoryCatalog(category).flatMap((item) => item.itemTypes))];
}

function createFarmingComponentHandler(context) {
  const {
    farmingService,
    farmRenderer,
    farmViews,
    indexRenderer,
    indexViews,
    inventoryViews,
    saleSessions,
  } = context;

  function inventoryStacks(ownerId) {
    return farmingService.inventory(ownerId);
  }

  async function rebuildFarm(interaction, view) {
    const state = farmingService.farmState(view.ownerId);
    const image = await farmRenderer.render(state, {
      selectedPlotNumbers: [...view.selectedPlots],
    });
    await interaction.editReply(farmPayload(view.ownerId, state, view, image, { initial: false }));
    return state;
  }

  async function rebuildInventory(interaction, view) {
    const stacks = inventoryStacks(view.ownerId);
    await interaction.editReply(myInventoryPayload(interaction.user, stacks, view));
    return stacks;
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
        const seedStacks = farmingService.inventory(view.ownerId).stacks.filter((stack) => (
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
    const stacks = inventoryStacks(view.ownerId);

    if (action === 'type' && interaction.isStringSelectMenu?.()) {
      const type = String(interaction.values?.[0] || '');
      if (!['crops', 'other'].includes(type)) {
        await interaction.reply(errorPayload('Invalid inventory type\nChoose Crops or Other.', { ephemeral: true }));
        return true;
      }
      view.type = type;
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, stacks, view));
      return true;
    }
    if (action === 'page' && interaction.isButton?.()) {
      await interaction.showModal(inventoryPageModal(view, inventoryPageCount(stacks, view)));
      return true;
    }
    if (action === 'page-submit' && interaction.isModalSubmit?.()) {
      const maximum = inventoryPageCount(stacks, view);
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > maximum) {
        await interaction.reply(errorPayload(`Invalid page\nEnter a page from **1** to **${maximum}**.`, { ephemeral: true }));
        return true;
      }
      if (view.type === 'other') view.otherPage = page;
      else view.cropPage = page;
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, stacks, view));
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      const category = view.type === 'other' ? 'other' : 'crops';
      const modal = category === 'other'
        ? otherFilterModal(view, availableRarities(category), availableItemTypes(category))
        : cropsFilterModal(view, availableRarities(category), availableItemTypes(category));
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      const category = view.type === 'other' ? 'other' : 'crops';
      const rarity = String(valuesFromModal(interaction.fields, 'rarity')[0] || '');
      const itemTypes = [...new Set(valuesFromModal(interaction.fields, 'types').map(String))];
      if (rarity && !availableRarities(category).includes(rarity)) {
        await interaction.reply(errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
        return true;
      }
      if (itemTypes.some((type) => !availableItemTypes(category).includes(type))) {
        await interaction.reply(errorPayload('Invalid item type\nChoose item types shown in the form.', { ephemeral: true }));
        return true;
      }
      const filters = { name: textFromModal(interaction.fields, 'name').trim(), rarity, itemTypes };
      if (category === 'other') {
        view.otherFilters = filters;
        view.otherPage = 1;
      } else {
        view.cropFilters = filters;
        view.cropPage = 1;
      }
      await interaction.deferUpdate();
      await interaction.editReply(myInventoryPayload(interaction.user, stacks, view));
      return true;
    }
    return false;
  }

  async function saleInteraction(interaction, parts) {
    const action = parts[2];
    const session = saleSessions.getByToken(parts[3], { touch: false });
    if (!session || session.kind !== 'sale') {
      await respondExpired(interaction, 'sale controls');
      return true;
    }
    if (!await enforceOwner(interaction, session, 'sale')) return true;
    saleSessions.getByToken(parts[3]);
    const inventory = farmingService.inventory(session.ownerId);

    if (action === 'select' && interaction.isStringSelectMenu?.()) {
      const page = farmingSalePageData(inventory, session);
      const visibleIds = new Set(page.pageCrops.map((crop) => crop.id));
      for (const id of visibleIds) session.selectedCropIds.delete(id);
      for (const value of interaction.values || []) {
        const id = String(value);
        if (visibleIds.has(id)) session.selectedCropIds.add(id);
      }
      await interaction.update(farmingSalePayload(inventory, session, { initial: false })).catch(() => null);
      return true;
    }
    if ((action === 'prev' || action === 'next') && interaction.isButton?.()) {
      const page = farmingSalePageData(inventory, session);
      session.currentPage += action === 'prev' ? -1 : 1;
      session.currentPage = Math.max(1, Math.min(page.maxPage, session.currentPage));
      await interaction.update(farmingSalePayload(inventory, session, { initial: false })).catch(() => null);
      return true;
    }
    if (action === 'deny' && interaction.isButton?.()) {
      saleSessions.delete(session.ownerId);
      await interaction.update(farmingSaleDeniedPayload({ initial: false })).catch(() => null);
      return true;
    }
    if (action === 'confirm' && interaction.isButton?.()) {
      if (session.processing) {
        await interaction.reply(errorPayload('Sale already processing\nWait for the current sale to finish.', { ephemeral: true })).catch(() => null);
        return true;
      }
      if (!session.selectedCropIds.size) {
        await interaction.reply(errorPayload('No crops selected\nSelect at least one harvested Farming crop.', { ephemeral: true })).catch(() => null);
        return true;
      }
      session.processing = true;
      try {
        const result = farmingService.sellCrops(session.ownerId, [...session.selectedCropIds], session.id);
        if (result.status !== 'ok') {
          session.processing = false;
          await interaction.reply(errorPayload('Sale changed\nSome selected Farming crops are no longer available.', { ephemeral: true })).catch(() => null);
          return true;
        }
        saleSessions.delete(session.ownerId);
        await interaction.update(farmingSaleFinishedPayload(result.itemCount, result.total, { initial: false })).catch(() => null);
      } catch (error) {
        session.processing = false;
        throw error;
      }
      return true;
    }
    return false;
  }

  async function rebuildIndex(interaction, view) {
    const state = farmingService.indexState(view.ownerId);
    view.maxPage = Math.max(1, state.entries.length);
    view.page = Math.max(1, Math.min(view.maxPage, view.page));
    const image = await indexRenderer.render(state.entries[view.page - 1]);
    await interaction.editReply(farmingIndexPayload(view.ownerId, view, image, { initial: false }));
  }

  async function indexInteraction(interaction, parts) {
    const action = parts[2];
    const view = indexViews.get(parts[3]);
    if (!view || view.kind !== 'index') {
      await respondExpired(interaction, 'Index controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'Index')) return true;
    if (action === 'page' && interaction.isButton?.()) {
      view.page = (view.page % view.maxPage) + 1;
      await interaction.deferUpdate();
      await rebuildIndex(interaction, view).catch(async () => {
        await followUp(interaction, errorPayload('Index unavailable\nThe next Farming Index page could not be rendered.', { ephemeral: true }));
      });
      return true;
    }
    if (action === 'search' && interaction.isButton?.()) {
      await interaction.showModal(indexSearchModal(view));
      return true;
    }
    if (action === 'search-submit' && interaction.isModalSubmit?.()) {
      const query = textFromModal(interaction.fields, 'query').trim();
      const index = catalogIndexForName(query);
      if (index < 0) {
        await interaction.reply(errorPayload(`Crop not found\nNo Farming seed or crop matches **${query || 'that name'}**.`, { ephemeral: true }));
        return true;
      }
      view.page = index + 1;
      await interaction.deferUpdate();
      await rebuildIndex(interaction, view).catch(async () => {
        await followUp(interaction, errorPayload('Index unavailable\nThat Farming Index entry could not be rendered.', { ephemeral: true }));
      });
      return true;
    }
    return false;
  }

  return async function handleFarmingComponent(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('farm:')) return false;
    const parts = customId.split(':');
    if (parts[1] !== 'sale' && saleSessions.has(interaction.user.id)) {
      await interaction.reply(errorPayload('Sale in progress\nFinish or deny your current Farming crop sale first.', { ephemeral: true })).catch(() => null);
      return true;
    }
    if (parts[1] === 'plot') return plotInteraction(interaction, parts);
    if (parts[1] === 'inv') return inventoryInteraction(interaction, parts);
    if (parts[1] === 'sale') return saleInteraction(interaction, parts);
    if (parts[1] === 'index') return indexInteraction(interaction, parts);
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
