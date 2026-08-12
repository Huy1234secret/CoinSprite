const { RARITIES, SEED_BY_ID } = require('../data/seeds');
const { SHECKLES_EMOJI, componentEmoji } = require('../data/emojis');
const { AUTO_SELL_RARITIES } = require('../services/autoRollService');

function label(labelText, component, description) {
  return {
    type: 18,
    label: labelText.slice(0, 45),
    ...(description ? { description: description.slice(0, 100) } : {}),
    component,
  };
}

function rarityOptions(rarities, selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : (selected ? [selected] : []));
  return [...new Set(rarities || [])]
    .filter((rarity) => RARITIES[rarity])
    .map((rarity) => {
      const option = { label: rarity, value: rarity, default: selectedSet.has(rarity) };
      const emoji = componentEmoji(RARITIES[rarity].emoji);
      if (emoji) option.emoji = emoji;
      return option;
    })
    .slice(0, 25);
}

function inventoryPageModal(view, maxPage) {
  const maximum = Math.max(1, Math.floor(Number(maxPage) || 1));
  return {
    custom_id: `rng:inv:page-submit:${view.id}`,
    title: 'Switch inventory page',
    components: [label('What page do you want to switch to?', {
      type: 4,
      style: 1,
      custom_id: 'page',
      placeholder: `1 - ${maximum}`,
      min_length: 1,
      max_length: String(maximum).length,
      required: true,
    })],
  };
}

function inventoryFilterModal(view, availableRarities) {
  const components = [
    label('Name filter', {
      type: 4,
      style: 1,
      custom_id: 'name',
      placeholder: 'Crop name',
      max_length: 80,
      required: false,
      ...(view.filters.name ? { value: String(view.filters.name).slice(0, 80) } : {}),
    }),
    label('Weight filter', {
      type: 4,
      style: 1,
      custom_id: 'weight',
      placeholder: 'Bot will filter weight higher than or equal to this',
      max_length: 20,
      required: false,
      ...(view.filters.weight ? { value: String(view.filters.weight).slice(0, 20) } : {}),
    }),
  ];
  const options = rarityOptions(availableRarities, view.filters.rarity);
  if (options.length) {
    components.push(label('Rarity', {
      type: 3,
      custom_id: 'rarity',
      placeholder: 'Any rarity',
      min_values: 0,
      max_values: 1,
      required: false,
      options,
    }));
  }
  return { custom_id: `rng:inv:filter-submit:${view.id}`, title: 'Filter inventory', components };
}

function sellFilterModal(session, availableRarities) {
  const options = rarityOptions(availableRarities, session.filters.rarities);
  const components = [];
  if (options.length) components.push(label('Rarity', {
    type: 3,
    custom_id: 'rarities',
    placeholder: 'Any rarity',
    min_values: 0,
    max_values: options.length,
    required: false,
    options,
  }));
  const cropNames = session.filters.cropIds?.size
    ? [...session.filters.cropIds].map((id) => SEED_BY_ID.get(id)?.displayName).filter(Boolean).join(', ')
    : '';
  components.push(label('Crop', {
    type: 4,
    style: 2,
    custom_id: 'crops',
    placeholder: 'Type crop names separated with commas',
    max_length: 500,
    required: false,
    ...(cropNames ? { value: cropNames.slice(0, 500) } : {}),
  }));
  return { custom_id: `rng:sale:filter-submit:${session.id}`, title: 'Sell filter', components };
}

function autoRollModal(action) {
  return {
    custom_id: `rng:auto:submit:${action.id}`,
    title: 'Configure Auto Roll',
    components: [
      {
        type: 10,
        content: `* When your inventory is full, the bot will automatically sell crops matching your selected rarities.\n\n- Price per roll scales with your current Luck and BIG tiers; the next screen shows the exact snapshot.\n- The bot rolls once every 5 seconds.\n- Maximum duration: 24 hours.`,
      },
      label('Auto Roll duration', {
        type: 4,
        style: 1,
        custom_id: 'duration',
        placeholder: 'Example: 50m, 4h 13m, or 1d',
        min_length: 2,
        max_length: 30,
        required: true,
        ...(action.normalized ? { value: action.normalized } : {}),
      }),
      label('Auto sell rarity', {
        type: 3,
        custom_id: 'rarities',
        placeholder: 'Select rarities you want to sell',
        min_values: 0,
        max_values: AUTO_SELL_RARITIES.length,
        required: false,
        options: rarityOptions(AUTO_SELL_RARITIES, action.selectedAutoSellRarities),
      }),
    ],
  };
}

function indexPageModal(view) {
  return {
    custom_id: `rng:index:page-submit:${view.id}`,
    title: 'Switch Index page',
    components: [label('What page do you want to switch to?', {
      type: 4,
      style: 1,
      custom_id: 'page',
      placeholder: `1 - ${view.maxPage}`,
      min_length: 1,
      max_length: String(view.maxPage).length,
      required: true,
    })],
  };
}

module.exports = {
  autoRollModal,
  indexPageModal,
  inventoryFilterModal,
  inventoryPageModal,
  rarityOptions,
  sellFilterModal,
};
