const { SEEDS } = require('../data/seeds');
const { upgradeCost } = require('../services/gameService');
const { filterInventory, normalizeCropName, parseWeightThreshold } = require('../utils/normalize');
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
} = require('../modals/builders');
const { createPowerUpgradeControls } = require('../services/upgradeService');
const { indexDiscoveryCount } = require('../services/indexRenderer');
const { createRpsComponentHandler } = require('./rpsHandler');

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
  const {
    actions,
    autoRollService,
    gameService,
    indexRenderer,
    indexViews,
    inventoryViews,
    repository,
    saleSessions,
  } = context;
  const handleRpsComponent = createRpsComponentHandler(context);

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
      const rarities = valuesFromModal(interaction.fields, 'rarities') || [];
      const invalidRarities = rarities.filter((r) => !availableRarities(state.items).includes(r));
      if (invalidRarities.length) {
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
      if (!rarities.length && !normalizedNames.length) {
        await interaction.reply(errorPayload('Sell filter required\nChoose at least one rarity, enter crop names, or use both.', { ephemeral: true }));
        return true;
      }
      const cropIds = new Set(normalizedNames.map((name) => NORMALIZED_SEEDS.get(name).id));
      session.filters = { rarities, cropIds };
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
      let preview;
      try {
        preview = autoRollService.preview(
          formAction.ownerId,
          textFromModal(interaction.fields, 'duration'),
          valuesFromModal(interaction.fields, 'rarities'),
        );
      } catch (error) {
        await interaction.reply(errorPayload(`Invalid Auto Roll duration\n${error.message}`, { ephemeral: true }));
        return true;
      }
      actions.delete(formAction.id);
      if (formAction.previewId) actions.delete(formAction.previewId);
      const previewAction = actions.create(formAction.ownerId, { kind: 'auto-preview', ...preview });
      await interaction.deferUpdate();
      await interaction.editReply(autoRollPreviewPayload(
        previewAction,
        gameService.balance(formAction.ownerId),
        { initial: false },
      )).catch(() => null);
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
        await interaction.update(autoRollPreviewPayload(
          refreshed,
          gameService.balance(interaction.user.id),
          { initial: false },
        )).catch(() => null);
        return true;
      }
      if (result.status === 'already-active') {
        await interaction.update(autoRollStatusPayload(result.job, { initial: false })).catch(() => null);
        return true;
      }
      if (result.status === 'sale-active') {
        await interaction.update(errorPayload('Sale in progress\nFinish or deny your sale before starting Auto Roll.', { initial: false })).catch(() => null);
        return true;
      }
      if (result.status === 'insufficient') {
        await interaction.update(errorPayload(`Auto Roll unavailable\nYou need **${result.missing.toLocaleString('en-US')}** more Sheckles.`, { initial: false })).catch(() => null);
        return true;
      }
      await interaction.update(autoRollStartedPayload(result.job, { initial: false })).catch(() => null);
      return true;
    }
    return false;
  }

  async function powerUpgradeInteraction(interaction, parts) {
    if (parts[2] !== 'buy' || !interaction.isButton?.()) return false;
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
      await interaction.reply(errorPayload(`Upgrade unavailable\n${reason}`, { ephemeral: true })).catch(() => null);
      return true;
    }
    const player = repository.getPlayer(interaction.user.id);
    const controls = createPowerUpgradeControls(actions, interaction.user.id, player);
    await interaction.update(powerUpgradePayload(interaction.user, player, controls, { initial: false })).catch(() => null);
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
      const page = Number(textFromModal(interaction.fields, 'page').trim());
      if (!Number.isInteger(page) || page < 1 || page > view.maxPage) {
        await interaction.reply(errorPayload(`Invalid page\nEnter a page from **1** to **${view.maxPage}**.`, { ephemeral: true }));
        return true;
      }
      view.page = page;
      await interaction.deferUpdate();
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
        await interaction.editReply(errorPayload('Index unavailable\nThe requested crop page could not be rendered.', { initial: false })).catch(() => null);
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
    if (parts[1] === 'rps' || parts[1] === 'exchange') return handleRpsComponent(interaction, parts);
    if (parts[1] === 'inv') return inventoryInteraction(interaction, parts);
    if (parts[1] === 'upgrade') return upgradeInteraction(interaction, parts);
    if (parts[1] === 'sale') return saleInteraction(interaction, parts);
    if (parts[1] === 'auto') return autoRollInteraction(interaction, parts);
    if (parts[1] === 'power') return powerUpgradeInteraction(interaction, parts);
    if (parts[1] === 'index') return indexInteraction(interaction, parts);
    return false;
  };
}

module.exports = { createComponentHandler, textFromModal, valuesFromModal };
