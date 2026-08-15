const { SEEDS } = require('../data/seeds');
const { upgradeCost } = require('../services/gameService');
const { filterInventory, normalizeCropName, parseWeightThreshold } = require('../utils/normalize');
const { formatInteger } = require('../utils/format');
const {
  errorPayload,
  autoRollPreviewPayload,
  autoRollStartedPayload,
  autoRollStatusPayload,
  indexPayload,
  inventoryPageData,
  inventoryPayload,
  saleDeniedPayload,
  saleFinishedPayload,
  salePageData,
  salePayload,
  textContainer,
  powerUpgradePayload,
  upgradePromptPayload,
} = require('./builders');
const {
  autoRollModal,
  indexPageModal,
  inventoryFilterModal,
  inventoryPageModal,
  sellFilterModal,
  petEquipModal,
  shopPurchaseModal,
} = require('../modals/builders');
const { ITEM_BY_ID } = require('../data/items');
const { PET_SLOT_PRICES } = require('../data/pets');
const {
  purchasePreviewPayload,
  purchaseResultPayload,
  shopPayload,
  unlockPreviewPayload,
} = require('./itemBuilders');
const { createPowerUpgradeControls } = require('../services/upgradeService');
const { indexDiscoveryCount } = require('../services/indexRenderer');
const { createRpsComponentHandler } = require('./rpsHandler');
const { createRouletteComponentHandler } = require('./rouletteHandler');
const {
  acknowledgeUpdate,
  sendEphemeral,
} = require('../../shared/interactionResponses');

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
  await sendEphemeral(interaction, errorPayload(`Expired ${label}\nRun the command again to open fresh controls.`, { ephemeral: true }));
}

async function enforceOwner(interaction, record, label) {
  const ownerId = record?.ownerId || record?.userId;
  if (ownerId === interaction.user.id) return true;
  await sendEphemeral(interaction, errorPayload(`Not your ${label}\nOnly the command invoker can use these controls.`, { ephemeral: true }));
  return false;
}

function availableRarities(items) {
  return [...new Set(items.map((item) => item.rarity))];
}

function createComponentHandler(context) {
  const {
    actions,
    autoRollService,
    gameService,
    indexRenderer,
    indexViews,
    itemRepository,
    inventoryViews,
    repository,
    saleSessions,
    shopService,
    shopViews,
  } = context;
  const handleRpsComponent = createRpsComponentHandler(context);
  const handleRouletteComponent = createRouletteComponentHandler(context);

  function acknowledge(interaction) {
    return acknowledgeUpdate(interaction, { reportError: context.reportError, startedAt: Date.now() });
  }

  function fullInventoryState(userId) {
    return {
      crops: gameService.inventory(userId),
      itemInventory: itemRepository.itemInventory(userId),
      boosts: itemRepository.activeBoosts(userId),
      pets: itemRepository.petState(userId),
    };
  }

  async function inventoryInteraction(interaction, parts) {
    const action = parts[2];
    const token = parts[3];
    const view = inventoryViews.get(token);
    if (!view) {
      await respondExpired(interaction, 'inventory controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'inventory')) return true;
    if (action === 'type' && interaction.isStringSelectMenu?.()) {
      if (!await acknowledge(interaction)) return true;
      const type = String(interaction.values?.[0] || '');
      if (!['crops', 'items', 'pets'].includes(type)) {
        await sendEphemeral(interaction, errorPayload('Invalid inventory type\nChoose Crops, Items, or Pets.', { ephemeral: true }));
        return true;
      }
      view.type = type;
      view.page = 1;
      await interaction.editReply(inventoryPayload(interaction.user, fullInventoryState(view.ownerId), view, { initial: false }));
      return true;
    }
    if ((action === 'prev' || action === 'next') && interaction.isButton?.()) {
      if (!await acknowledge(interaction)) return true;
      view.page += action === 'prev' ? -1 : 1;
      await interaction.editReply(inventoryPayload(interaction.user, fullInventoryState(view.ownerId), view, { initial: false }));
      return true;
    }
    if (action === 'page' && interaction.isButton?.()) {
      const state = gameService.inventory(view.ownerId);
      const page = inventoryPageData(state, view);
      await interaction.showModal(inventoryPageModal(view, page.maxPage));
      return true;
    }
    if (action === 'page-submit' && interaction.isModalSubmit?.()) {
      if (!await acknowledge(interaction)) return true;
      const state = gameService.inventory(view.ownerId);
      const pageData = inventoryPageData(state, view);
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > pageData.maxPage) {
        await sendEphemeral(interaction, errorPayload(`Invalid page\nEnter a page from **1** to **${pageData.maxPage}**.`, { ephemeral: true }));
        return true;
      }
      view.page = page;
      await interaction.editReply(inventoryPayload(interaction.user, fullInventoryState(view.ownerId), view, { initial: false }));
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      const state = gameService.inventory(view.ownerId);
      await interaction.showModal(inventoryFilterModal(view, availableRarities(state.items)));
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      if (!await acknowledge(interaction)) return true;
      const state = gameService.inventory(view.ownerId);
      let minimumWeightUnits;
      try {
        minimumWeightUnits = parseWeightThreshold(textFromModal(interaction.fields, 'weight'));
      } catch (error) {
        await sendEphemeral(interaction, errorPayload(`Invalid weight\n${error.message}`, { ephemeral: true }));
        return true;
      }
      const rarity = valuesFromModal(interaction.fields, 'rarity')[0] || '';
      if (rarity && !availableRarities(state.items).includes(rarity)) {
        await sendEphemeral(interaction, errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
        return true;
      }
      view.filters = {
        name: textFromModal(interaction.fields, 'name').trim(),
        minimumWeightUnits,
        rarity,
      };
      view.page = 1;
      await interaction.editReply(inventoryPayload(interaction.user, fullInventoryState(view.ownerId), view, { initial: false }));
      return true;
    }
    if (action === 'upgrade' && interaction.isButton?.()) {
      const state = gameService.inventory(view.ownerId);
      const cost = upgradeCost(state.player.upgradeLevel);
      const upgradeAction = actions.create(view.ownerId, { viewId: view.id, cost });
      await interaction.reply(upgradePromptPayload(upgradeAction, state.player));
      return true;
    }
    return false;
  }

  async function upgradeInteraction(interaction, parts) {
    if (parts[2] !== 'confirm' || !interaction.isButton?.()) return false;
    if (!await acknowledge(interaction)) return true;
    const action = actions.claim(parts[3], interaction.user.id);
    if (!action) {
      await respondExpired(interaction, 'upgrade confirmation');
      return true;
    }
    const result = gameService.upgrade(interaction.user.id, action.id);
    if (result.status !== 'ok') {
      await interaction.editReply(errorPayload(`Upgrade unavailable\nYou need **${result.missing?.toLocaleString?.('en-US') || 'more'}** more Sheckles.`, { initial: false }));
      return true;
    }
    await interaction.editReply(textContainer(`Inventory upgraded\nYour capacity is now **${result.inventoryCapacity}**.`, { color: 0x22C55E, initial: false }));
    const view = inventoryViews.get(action.viewId, { touch: false });
    if (view?.editOriginal) {
      await view.editOriginal(inventoryPayload(
        interaction.user,
        fullInventoryState(interaction.user.id),
        view,
        { initial: false },
      )).catch(() => null);
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
    if (action === 'select' && interaction.isStringSelectMenu?.()) {
      if (!await acknowledge(interaction)) return true;
      const state = gameService.inventory(session.userId);
      const page = salePageData(state, session);
      const visibleIds = new Set(page.pageItems.map((item) => item.id));
      for (const id of visibleIds) session.selectedItemIds.delete(id);
      for (const value of interaction.values || []) {
        const id = String(value);
        if (visibleIds.has(id)) session.selectedItemIds.add(id);
      }
      await interaction.editReply(salePayload(state, session, { initial: false }));
      return true;
    }
    if ((action === 'prev' || action === 'next') && interaction.isButton?.()) {
      if (!await acknowledge(interaction)) return true;
      const state = gameService.inventory(session.userId);
      const page = salePageData(state, session);
      session.currentPage += action === 'prev' ? -1 : 1;
      session.currentPage = Math.max(1, Math.min(page.maxPage, session.currentPage));
      await interaction.editReply(salePayload(state, session, { initial: false }));
      return true;
    }
    if (action === 'filter' && interaction.isButton?.()) {
      const state = gameService.inventory(session.userId);
      await interaction.showModal(sellFilterModal(session, availableRarities(state.items)));
      return true;
    }
    if (action === 'filter-submit' && interaction.isModalSubmit?.()) {
      if (!await acknowledge(interaction)) return true;
      const state = gameService.inventory(session.userId);
      const rarities = valuesFromModal(interaction.fields, 'rarities') || [];
      const invalidRarities = rarities.filter((r) => !availableRarities(state.items).includes(r));
      if (invalidRarities.length) {
        await sendEphemeral(interaction, errorPayload('Invalid rarity\nChoose a rarity shown in the form.', { ephemeral: true }));
        return true;
      }
      const rawNames = textFromModal(interaction.fields, 'crops');
      const normalizedNames = [...new Set(rawNames.split(',').map(normalizeCropName).filter(Boolean))];
      const unknown = normalizedNames.filter((name) => !NORMALIZED_SEEDS.has(name));
      if (unknown.length) {
        await sendEphemeral(interaction, errorPayload(`Unknown crop name${unknown.length === 1 ? '' : 's'}\n${unknown.join(', ')}`, { ephemeral: true }));
        return true;
      }
      if (!rarities.length && !normalizedNames.length) {
        await sendEphemeral(interaction, errorPayload('Sell filter required\nChoose at least one rarity, enter crop names, or use both.', { ephemeral: true }));
        return true;
      }
      const cropIds = new Set(normalizedNames.map((name) => NORMALIZED_SEEDS.get(name).id));
      session.filters = { rarities, cropIds };
      session.currentPage = 1;
      for (const item of filterInventory(state.items, session.filters)) session.selectedItemIds.add(item.id);
      await interaction.editReply(salePayload(state, session, { initial: false }));
      return true;
    }
    if (action === 'deny' && interaction.isButton?.()) {
      if (!await acknowledge(interaction)) return true;
      saleSessions.delete(session.userId);
      await interaction.editReply(saleDeniedPayload({ initial: false }));
      return true;
    }
    if (action === 'confirm' && interaction.isButton?.()) {
      if (session.processing) {
        await sendEphemeral(interaction, errorPayload('Sale already processing\nWait for the current sale to finish.', { ephemeral: true }));
        return true;
      }
      if (!session.selectedItemIds.size) {
        await sendEphemeral(interaction, errorPayload('No crops selected\nSelect at least one crop to sell.', { ephemeral: true }));
        return true;
      }
      if (!await acknowledge(interaction)) return true;
      session.processing = true;
      try {
        const result = gameService.sell(session.userId, [...session.selectedItemIds], session.id);
        if (result.status !== 'ok') {
          session.processing = false;
          await sendEphemeral(interaction, errorPayload('Sale changed\nSome selected crops are no longer available. Refresh the sale and try again.', { ephemeral: true }));
          return true;
        }
        saleSessions.delete(session.userId);
        await interaction.editReply(saleFinishedPayload(result.itemCount, result.total, { initial: false }));
      } catch (error) {
        session.processing = false;
        throw error;
      }
      return true;
    }
    return false;
  }

  async function autoRollInteraction(interaction, parts) {
    const actionName = parts[2];
    const token = parts[3];
    if (actionName === 'form' && interaction.isButton?.()) {
      const action = actions.get(token);
      if (!action || action.kind !== 'auto-form') {
        await respondExpired(interaction, 'Auto Roll form');
        return true;
      }
      if (!await enforceOwner(interaction, action, 'Auto Roll')) return true;
      await interaction.showModal(autoRollModal(action));
      return true;
    }
    if (actionName === 'submit' && interaction.isModalSubmit?.()) {
      const formAction = actions.get(token);
      if (!formAction || formAction.kind !== 'auto-form') {
        await respondExpired(interaction, 'Auto Roll form');
        return true;
      }
      if (!await enforceOwner(interaction, formAction, 'Auto Roll')) return true;
      if (!await acknowledge(interaction)) return true;
      let preview;
      try {
        preview = autoRollService.preview(
          formAction.ownerId,
          textFromModal(interaction.fields, 'duration'),
          valuesFromModal(interaction.fields, 'rarities'),
        );
      } catch (error) {
        await sendEphemeral(interaction, errorPayload(`Invalid Auto Roll duration\n${error.message}`, { ephemeral: true }));
        return true;
      }
      actions.delete(formAction.id);
      if (formAction.previewId) actions.delete(formAction.previewId);
      const previewAction = actions.create(formAction.ownerId, { kind: 'auto-preview', ...preview });
      await interaction.editReply(autoRollPreviewPayload(
        previewAction,
        gameService.balance(formAction.ownerId),
        { initial: false },
      ));
      return true;
    }
    if (actionName === 'change' && interaction.isButton?.()) {
      const preview = actions.get(token);
      if (!preview || preview.kind !== 'auto-preview') {
        await respondExpired(interaction, 'Auto Roll preview');
        return true;
      }
      if (!await enforceOwner(interaction, preview, 'Auto Roll')) return true;
      const formAction = actions.create(preview.ownerId, {
        kind: 'auto-form',
        previewId: preview.id,
        normalized: preview.normalized,
        selectedAutoSellRarities: preview.selectedAutoSellRarities,
      });
      await interaction.showModal(autoRollModal(formAction));
      return true;
    }
    if (actionName === 'start' && interaction.isButton?.()) {
      if (!await acknowledge(interaction)) return true;
      const preview = actions.claim(token, interaction.user.id);
      if (!preview || preview.kind !== 'auto-preview') {
        await respondExpired(interaction, 'Auto Roll preview');
        return true;
      }
      const result = autoRollService.start(interaction.user.id, preview, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      if (result.status === 'price-changed') {
        const refreshed = actions.create(interaction.user.id, { kind: 'auto-preview', ...result.preview });
        await interaction.editReply(autoRollPreviewPayload(
          refreshed,
          gameService.balance(interaction.user.id),
          { initial: false },
        ));
        return true;
      }
      if (result.status === 'already-active') {
        await interaction.editReply(autoRollStatusPayload(result.job, { initial: false }));
        return true;
      }
      if (result.status === 'sale-active') {
        await interaction.editReply(errorPayload('Sale in progress\nFinish or deny your sale before starting Auto Roll.', { initial: false }));
        return true;
      }
      if (result.status === 'insufficient') {
        await interaction.editReply(errorPayload(`Auto Roll unavailable\nYou need **${result.missing.toLocaleString('en-US')}** more Sheckles.`, { initial: false }));
        return true;
      }
      await interaction.editReply(autoRollStartedPayload(result.job, { initial: false }));
      return true;
    }
    return false;
  }

  async function powerUpgradeInteraction(interaction, parts) {
    if (parts[2] !== 'buy' || !interaction.isButton?.()) return false;
    if (!await acknowledge(interaction)) return true;
    const action = actions.claim(parts[3], interaction.user.id);
    if (!action || action.kind !== 'power-upgrade') {
      await respondExpired(interaction, 'upgrade control');
      return true;
    }
    const result = gameService.purchasePowerUpgrade(interaction.user.id, action.upgradeKind, action.id);
    if (result.status !== 'ok') {
      const reason = result.status === 'max-tier'
        ? 'This upgrade is already at tier XX.'
        : `You need **${result.missing?.toLocaleString?.('en-US') || 'more'}** more Sheckles.`;
      await sendEphemeral(interaction, errorPayload(`Upgrade unavailable\n${reason}`, { ephemeral: true }));
      return true;
    }
    const player = repository.getPlayer(interaction.user.id);
    const controls = createPowerUpgradeControls(actions, interaction.user.id, player);
    await interaction.editReply(powerUpgradePayload(interaction.user, player, controls, { initial: false }));
    return true;
  }

  async function indexInteraction(interaction, parts) {
    const action = parts[2];
    const view = indexViews.get(parts[3]);
    if (!view) {
      await respondExpired(interaction, 'Index controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'Index')) return true;
    if (action === 'page' && interaction.isButton?.()) {
      await interaction.showModal(indexPageModal(view));
      return true;
    }
    if (action === 'page-submit' && interaction.isModalSubmit?.()) {
      if (!await acknowledge(interaction)) return true;
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > view.maxPage) {
        await sendEphemeral(interaction, errorPayload(`Invalid page\nEnter a page from **1** to **${view.maxPage}**.`, { ephemeral: true }));
        return true;
      }
      view.page = page;
      const discoveries = repository.discoveries(view.ownerId);
      try {
        const image = await indexRenderer.render(view.ownerId, discoveries.map((entry) => entry.seedId), view.page);
        await interaction.editReply(indexPayload(
          view.ownerId,
          indexDiscoveryCount(discoveries.map((entry) => entry.seedId)),
          view,
          image,
          { initial: false },
        ));
      } catch {
        await interaction.editReply(errorPayload('Index unavailable\nThe requested crop page could not be rendered.', { initial: false }));
      }
      return true;
    }
    return false;
  }

  async function shopInteraction(interaction, parts) {
    const actionName = parts[2];
    if (actionName === 'confirm' || actionName === 'cancel') {
      const action = actions.get(parts[3]);
      if (!action || action.kind !== 'shop-purchase') {
        await respondExpired(interaction, 'purchase confirmation');
        return true;
      }
      if (!await enforceOwner(interaction, action, 'purchase')) return true;
      if (!await acknowledge(interaction)) return true;
      const claimed = actions.claim(action.id, interaction.user.id);
      if (!claimed) {
        await interaction.editReply(errorPayload('Purchase already handled\nOpen the shop again to make another purchase.', { initial: false }));
        return true;
      }
      if (actionName === 'cancel') {
        await interaction.editReply(textContainer('Purchase cancelled\nYour balance, stock, and inventory were not changed.', { color: 0x64748B, initial: false }));
        return true;
      }
      let result;
      try {
        result = shopService.purchase(
          interaction.user.id,
          claimed.itemId,
          claimed.amount,
          `shop-purchase:${claimed.id}`,
          claimed,
        );
      } catch (error) {
        if (error instanceof RangeError) {
          await interaction.editReply(errorPayload(`Purchase unavailable\n${error.message}`, { initial: false }));
          return true;
        }
        throw error;
      }
      if (result.status !== 'ok') {
        if (result.status === 'price-changed') {
          const refreshed = actions.create(interaction.user.id, {
            kind: 'shop-purchase',
            viewId: claimed.viewId,
            itemId: claimed.itemId,
            amount: claimed.amount,
            restockEpoch: result.restockEpoch,
            configVersion: result.current.configVersion,
            price: result.current.price,
          });
          await interaction.editReply(purchasePreviewPayload(refreshed, ITEM_BY_ID.get(claimed.itemId), { initial: false }));
          return true;
        }
        let message = 'The purchase could not be completed.';
        if (result.status === 'stock') message = `Only **${result.available || 0}** remain in the current restock.`;
        if (result.status === 'insufficient') message = `You need **${formatInteger(result.missing)}** more Sheckles.`;
        if (result.status === 'stale-restock') message = 'The shop restocked. Select the item again to use current stock and pricing.';
        await interaction.editReply(errorPayload(`Purchase unavailable\n${message}`, { initial: false }));
        return true;
      }
      await interaction.editReply(purchaseResultPayload(result, { initial: false }));
      const view = shopViews.get(claimed.viewId, { touch: false });
      if (view?.editOriginal) {
        const page = await shopService.page(view.ownerId, view.page);
        view.page = page.page;
        await view.editOriginal(shopPayload(page, view, { initial: false })).catch(() => null);
      }
      return true;
    }

    if (actionName === 'amount' && interaction.isModalSubmit?.()) {
      const view = shopViews.get(parts[3]);
      if (!view) {
        await respondExpired(interaction, 'shop controls');
        return true;
      }
      if (!await enforceOwner(interaction, view, 'shop')) return true;
      const item = ITEM_BY_ID.get(parts[4]);
      const amountText = textFromModal(interaction.fields, 'amount').trim();
      if (!item || !/^[1-9]\d*$/.test(amountText)) {
        await sendEphemeral(interaction, errorPayload('Invalid purchase amount\nEnter a positive whole number.', { ephemeral: true }));
        return true;
      }
      let amount;
      try {
        amount = BigInt(amountText);
        if (amount > 9_223_372_036_854_775_807n) throw new RangeError('amount overflow');
      } catch {
        await sendEphemeral(interaction, errorPayload('Invalid purchase amount\nThe amount is too large.', { ephemeral: true }));
        return true;
      }
      const state = shopService.state(view.ownerId);
      const current = state.items.find((entry) => entry.id === item.id);
      if (!current || current.stockRemaining < amount) {
        await sendEphemeral(interaction, errorPayload(`Not enough stock\nOnly **${current?.stockRemaining || 0}** remain. Nothing was charged.`, { ephemeral: true }));
        return true;
      }
      const total = current.price * amount;
      const player = repository.getPlayer(interaction.user.id);
      if (player.balance < total) {
        await sendEphemeral(interaction, errorPayload(`Insufficient balance\nYou need **${formatInteger(total - player.balance)}** more Sheckles.`, { ephemeral: true }));
        return true;
      }
      const purchaseAction = actions.create(interaction.user.id, {
        kind: 'shop-purchase',
        viewId: view.id,
        itemId: item.id,
        amount,
        restockEpoch: state.restockEpoch,
        configVersion: current.configVersion,
        price: current.price,
      });
      await interaction.reply(purchasePreviewPayload(purchaseAction, item));
      return true;
    }

    const view = shopViews.get(parts[3]);
    if (!view) {
      await respondExpired(interaction, 'shop controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'shop')) return true;
    if (actionName === 'select' && interaction.isStringSelectMenu?.()) {
      const item = ITEM_BY_ID.get(String(interaction.values?.[0] || ''));
      const state = shopService.state(view.ownerId);
      const current = state.items.find((entry) => entry.id === item?.id);
      if (!item || !current) {
        await sendEphemeral(interaction, errorPayload('Item unavailable\nRefresh the shop and choose an item shown on the current page.', { ephemeral: true }));
        return true;
      }
      if (current.stockRemaining <= 0n) {
        await sendEphemeral(interaction, errorPayload('Out of stock\nThis item cannot be purchased until a future restock.', { ephemeral: true }));
        return true;
      }
      await interaction.showModal(shopPurchaseModal(view, item));
      return true;
    }
    if ((actionName === 'prev' || actionName === 'next') && interaction.isButton?.()) {
      if (!await acknowledge(interaction)) return true;
      view.page += actionName === 'prev' ? -1 : 1;
      const page = await shopService.page(view.ownerId, view.page);
      view.page = page.page;
      await interaction.editReply(shopPayload(page, view, { initial: false }));
      return true;
    }
    return false;
  }

  async function petInteraction(interaction, parts) {
    const actionName = parts[2];
    if (actionName === 'unlock' || actionName === 'cancel') {
      const action = actions.get(parts[3]);
      if (!action || action.kind !== 'pet-slot-unlock') {
        await respondExpired(interaction, 'pet slot confirmation');
        return true;
      }
      if (!await enforceOwner(interaction, action, 'pet slot confirmation')) return true;
      if (!await acknowledge(interaction)) return true;
      const claimed = actions.claim(action.id, interaction.user.id);
      if (!claimed) {
        await interaction.editReply(errorPayload('Pet slot already handled\nRefresh your inventory.', { initial: false }));
        return true;
      }
      if (actionName === 'cancel') {
        await interaction.editReply(textContainer('Pet slot unlock cancelled\nYour balance was not changed.', { color: 0x64748B, initial: false }));
        return true;
      }
      const result = itemRepository.unlockSlot(
        interaction.user.id,
        claimed.slotNumber,
        `pet-slot-unlock:${claimed.id}`,
      );
      if (result.status !== 'ok') {
        const reason = result.status === 'insufficient'
          ? `You need **${formatInteger(result.missing)}** more Sheckles.`
          : 'That slot is already unlocked or unavailable.';
        await interaction.editReply(errorPayload(`Pet slot unavailable\n${reason}`, { initial: false }));
        return true;
      }
      await interaction.editReply(textContainer(
        `Pet slot unlocked\nSlot **${result.slotNumber}** is ready. Your balance is **${formatInteger(result.balance)}** Sheckles.`,
        { color: 0x22C55E, initial: false },
      ));
      const view = inventoryViews.get(claimed.viewId, { touch: false });
      if (view?.editOriginal) {
        await view.editOriginal(inventoryPayload(
          interaction.user,
          fullInventoryState(interaction.user.id),
          view,
          { initial: false },
        )).catch(() => null);
      }
      return true;
    }

    const view = inventoryViews.get(parts[3]);
    if (!view) {
      await respondExpired(interaction, 'inventory controls');
      return true;
    }
    if (!await enforceOwner(interaction, view, 'inventory')) return true;
    const slotNumber = Number(parts[4]);
    if (![1, 2, 3].includes(slotNumber)) {
      await sendEphemeral(interaction, errorPayload('Invalid pet slot\nRefresh your inventory.', { ephemeral: true }));
      return true;
    }
    if (actionName === 'unlock-preview' && interaction.isButton?.()) {
      const state = itemRepository.petState(view.ownerId);
      const slot = state.slots.find((entry) => entry.slotNumber === slotNumber);
      if (!slot || slot.unlocked) {
        await sendEphemeral(interaction, errorPayload('Slot already unlocked\nRefresh your inventory.', { ephemeral: true }));
        return true;
      }
      const action = actions.create(view.ownerId, {
        kind: 'pet-slot-unlock',
        viewId: view.id,
        slotNumber,
        cost: PET_SLOT_PRICES[slotNumber],
      });
      await interaction.reply(unlockPreviewPayload(action));
      return true;
    }
    if (actionName === 'equip' && interaction.isButton?.()) {
      const selection = itemRepository.availablePetSpecies(view.ownerId, slotNumber);
      if (!selection.slot?.unlocked) {
        await sendEphemeral(interaction, errorPayload('Pet slot locked\nUnlock this slot before equipping a pet.', { ephemeral: true }));
        return true;
      }
      if (!selection.available.length && !selection.slot.pet) {
        await sendEphemeral(interaction, errorPayload('No pet available\nHatch another pet or free one from a different slot.', { ephemeral: true }));
        return true;
      }
      await interaction.showModal(petEquipModal(view, slotNumber, selection));
      return true;
    }
    if (actionName === 'equip-submit' && interaction.isModalSubmit?.()) {
      if (!await acknowledge(interaction)) return true;
      const petId = valuesFromModal(interaction.fields, 'pet')[0] || '';
      const result = itemRepository.equipPet(view.ownerId, slotNumber, petId);
      if (result.status !== 'ok') {
        await sendEphemeral(interaction, errorPayload(
          'Pet unavailable\nYou do not own an unequipped copy of that pet, or the slot is locked.',
          { ephemeral: true },
        ));
        return true;
      }
      await interaction.editReply(inventoryPayload(
        interaction.user,
        fullInventoryState(view.ownerId),
        view,
        { initial: false },
      ));
      return true;
    }
    return false;
  }

  return async function handleComponent(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('rng:')) return false;
    const parts = customId.split(':');
    if (parts[1] !== 'sale' && saleSessions.has(interaction.user.id)) {
      await sendEphemeral(interaction, errorPayload('Sale in progress\nFinish or deny your current sale before using other RNG/economy controls.', { ephemeral: true }));
      return true;
    }
    if (parts[1] === 'rps' || parts[1] === 'exchange') return handleRpsComponent(interaction, parts);
    if (parts[1] === 'roulette') return handleRouletteComponent(interaction, parts);
    if (parts[1] === 'inv') return inventoryInteraction(interaction, parts);
    if (parts[1] === 'upgrade') return upgradeInteraction(interaction, parts);
    if (parts[1] === 'sale') return saleInteraction(interaction, parts);
    if (parts[1] === 'auto') return autoRollInteraction(interaction, parts);
    if (parts[1] === 'power') return powerUpgradeInteraction(interaction, parts);
    if (parts[1] === 'index') return indexInteraction(interaction, parts);
    if (parts[1] === 'shop') return shopInteraction(interaction, parts);
    if (parts[1] === 'pet') return petInteraction(interaction, parts);
    return false;
  };
}

module.exports = { createComponentHandler, textFromModal, valuesFromModal };
