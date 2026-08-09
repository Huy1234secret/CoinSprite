const { SEEDS } = require('../data/seeds');
const { upgradeCost } = require('../services/gameService');
const { filterInventory, normalizeCropName, parseWeightThreshold } = require('../utils/normalize');
const {
  errorPayload,
  inventoryPageData,
  inventoryPayload,
  saleDeniedPayload,
  saleFinishedPayload,
  salePageData,
  salePayload,
  textContainer,
  upgradePromptPayload,
} = require('./builders');
const { inventoryFilterModal, inventoryPageModal, sellFilterModal } = require('../modals/builders');

const NORMALIZED_SEEDS = new Map(SEEDS.map((seed) => [normalizeCropName(seed.displayName), seed]));

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
  const ownerId = record?.ownerId || record?.userId;
  if (ownerId === interaction.user.id) return true;
  await interaction.reply(errorPayload(`Not your ${label}\nOnly the command invoker can use these controls.`, { ephemeral: true })).catch(() => null);
  return false;
}

function availableRarities(items) {
  return [...new Set(items.map((item) => item.rarity))];
}

function createComponentHandler(context) {
  const { actions, gameService, inventoryViews, saleSessions } = context;

  async function inventoryInteraction(interaction, parts) {
    const action = parts[2];
    const token = parts[3];
    const view = inventoryViews.get(token);
    if (!view) {
      await respondExpired(interaction, 'inventory controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'inventory')) return true;
    const state = gameService.inventory(view.ownerId);

    if (action === 'page' && interaction.isButton?.()) {
      const page = inventoryPageData(state, view);
      await interaction.showModal(inventoryPageModal(view, page.maxPage));
      return true;
    }
    if (action === 'page-submit' && interaction.isModalSubmit?.()) {
      const pageData = inventoryPageData(state, view);
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > pageData.maxPage) {
        await interaction.reply(errorPayload(`Invalid page\nEnter a page from **1** to **${pageData.maxPage}**.`, { ephemeral: true }));
        return true;
      }
      view.page = page;
      await interaction.deferUpdate();
      await interaction.editReply(inventoryPayload(interaction.user, state, view)).catch(() => null);
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      await interaction.showModal(inventoryFilterModal(view, availableRarities(state.items)));
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      let minimumWeightUnits;
      try {
        minimumWeightUnits = parseWeightThreshold(textFromModal(interaction.fields, 'weight'));
      } catch (error) {
        await interaction.reply(errorPayload(`Invalid weight\n${error.message}`, { ephemeral: true }));
        return true;
      }
      const rarity = valuesFromModal(interaction.fields, 'rarity')[0] || '';
      if (rarity && !availableRarities(state.items).includes(rarity)) {
        await interaction.reply(errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
        return true;
      }
      view.filters = {
        name: textFromModal(interaction.fields, 'name').trim(),
        minimumWeightUnits,
        rarity,
      };
      view.page = 1;
      await interaction.deferUpdate();
      await interaction.editReply(inventoryPayload(interaction.user, state, view)).catch(() => null);
      return true;
    }
    if (action === 'upgrade' && interaction.isButton?.()) {
      const cost = upgradeCost(state.player.upgradeLevel);
      const upgradeAction = actions.create(view.ownerId, { viewId: view.id, cost });
      await interaction.reply(upgradePromptPayload(upgradeAction, state.player));
      return true;
    }
    return false;
  }

  async function upgradeInteraction(interaction, parts) {
    if (parts[2] !== 'confirm' || !interaction.isButton?.()) return false;
    const action = actions.claim(parts[3], interaction.user.id);
    if (!action) {
      await respondExpired(interaction, 'upgrade confirmation');
      return true;
    }
    const result = gameService.upgrade(interaction.user.id, action.id);
    if (result.status !== 'ok') {
      await interaction.update(errorPayload(`Upgrade unavailable\nYou need **${result.missing?.toLocaleString?.('en-US') || 'more'}** more Sheckles.`, { initial: false })).catch(() => null);
      return true;
    }
    await interaction.update(textContainer(`Inventory upgraded\nYour capacity is now **${result.inventoryCapacity}**.`, { color: 0x22C55E, initial: false })).catch(() => null);
    const view = inventoryViews.get(action.viewId, { touch: false });
    if (view?.editOriginal) {
      const state = gameService.inventory(interaction.user.id);
      await view.editOriginal(inventoryPayload(interaction.user, state, view)).catch(() => null);
    }
    return true;
  }

  async function saleInteraction(interaction, parts) {
    const action = parts[2];
    const session = saleSessions.getByToken(parts[3], { touch: false });
    if (!session) {
      await respondExpired(interaction, 'sale controls');
      return true;
    }
    if (!await enforceOwner(interaction, session, 'sale')) return true;
    saleSessions.getByToken(parts[3]);
    const state = gameService.inventory(session.userId);

    if (action === 'select' && interaction.isStringSelectMenu?.()) {
      const page = salePageData(state, session);
      const visibleIds = new Set(page.pageItems.map((item) => item.id));
      for (const id of visibleIds) session.selectedItemIds.delete(id);
      for (const value of interaction.values || []) {
        const id = String(value);
        if (visibleIds.has(id)) session.selectedItemIds.add(id);
      }
      await interaction.update(salePayload(state, session, { initial: false })).catch(() => null);
      return true;
    }
    if ((action === 'prev' || action === 'next') && interaction.isButton?.()) {
      const page = salePageData(state, session);
      session.currentPage += action === 'prev' ? -1 : 1;
      session.currentPage = Math.max(1, Math.min(page.maxPage, session.currentPage));
      await interaction.update(salePayload(state, session, { initial: false })).catch(() => null);
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      await interaction.showModal(sellFilterModal(session, availableRarities(state.items)));
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      const rarity = valuesFromModal(interaction.fields, 'rarity')[0] || '';
      if (rarity && !availableRarities(state.items).includes(rarity)) {
        await interaction.reply(errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
        return true;
      }
      const rawNames = textFromModal(interaction.fields, 'crops');
      const normalizedNames = [...new Set(rawNames.split(',').map(normalizeCropName).filter(Boolean))];
      const unknown = normalizedNames.filter((name) => !NORMALIZED_SEEDS.has(name));
      if (unknown.length) {
        await interaction.reply(errorPayload(`Unknown crop name${unknown.length === 1 ? '' : 's'}\n${unknown.join(', ')}`, { ephemeral: true }));
        return true;
      }
      if (!rarity && !normalizedNames.length) {
        await interaction.reply(errorPayload('Sell filter required\nChoose a rarity, enter crop names, or use both.', { ephemeral: true }));
        return true;
      }
      const cropIds = new Set(normalizedNames.map((name) => NORMALIZED_SEEDS.get(name).id));
      session.filters = { rarity, cropIds };
      session.currentPage = 1;
      for (const item of filterInventory(state.items, session.filters)) session.selectedItemIds.add(item.id);
      await interaction.deferUpdate();
      await interaction.editReply(salePayload(state, session, { initial: false })).catch(() => null);
      return true;
    }
    if (action === 'deny' && interaction.isButton?.()) {
      saleSessions.delete(session.userId);
      await interaction.update(saleDeniedPayload({ initial: false })).catch(() => null);
      return true;
    }
    if (action === 'confirm' && interaction.isButton?.()) {
      if (session.processing) {
        await interaction.reply(errorPayload('Sale already processing\nWait for the current sale to finish.', { ephemeral: true })).catch(() => null);
        return true;
      }
      if (!session.selectedItemIds.size) {
        await interaction.reply(errorPayload('No crops selected\nSelect at least one crop to sell.', { ephemeral: true })).catch(() => null);
        return true;
      }
      session.processing = true;
      try {
        const result = gameService.sell(session.userId, [...session.selectedItemIds], session.id);
        if (result.status !== 'ok') {
          session.processing = false;
          await interaction.reply(errorPayload('Sale changed\nSome selected crops are no longer available. Refresh the sale and try again.', { ephemeral: true })).catch(() => null);
          return true;
        }
        saleSessions.delete(session.userId);
        await interaction.update(saleFinishedPayload(result.itemCount, result.total, { initial: false })).catch(() => null);
      } catch (error) {
        session.processing = false;
        throw error;
      }
      return true;
    }
    return false;
  }

  return async function handleComponent(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('rng:')) return false;
    const parts = customId.split(':');
    if (parts[1] !== 'sale' && saleSessions.has(interaction.user.id)) {
      await interaction.reply(errorPayload('Sale in progress\nFinish or deny your current sale before using other RNG/economy controls.', { ephemeral: true })).catch(() => null);
      return true;
    }
    if (parts[1] === 'inv') return inventoryInteraction(interaction, parts);
    if (parts[1] === 'upgrade') return upgradeInteraction(interaction, parts);
    if (parts[1] === 'sale') return saleInteraction(interaction, parts);
    return false;
  };
}

module.exports = { createComponentHandler, textFromModal, valuesFromModal };
