const { ITEM_RARITIES, ITEM_TYPES } = require('../data/items');
const { RARITY_EMOJIS, componentEmoji } = require('../../rng-game/data/emojis');

function label(labelText, component, description) {
  return {
    type: 18,
    label: String(labelText).slice(0, 45),
    ...(description ? { description: String(description).slice(0, 100) } : {}),
    component,
  };
}

function rarityOptions(rarities, selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : (selected ? [selected] : []));
  return [...new Set(rarities || [])].map((rarity) => {
    const option = { label: rarity, value: rarity, default: selectedSet.has(rarity) };
    const emoji = componentEmoji(RARITY_EMOJIS[rarity]);
    if (emoji) option.emoji = emoji;
    return option;
  }).slice(0, 25);
}

function plantModal(view, seedStacks) {
  const options = (seedStacks || []).filter((stack) => (
    stack.quantity > 0n && stack.item?.itemTypes.includes('seed') && stack.item?.plantableCropId
  )).map((stack) => {
    const option = {
      label: `${stack.item.name} ×${stack.quantity.toLocaleString('en-US')}`.slice(0, 100),
      value: stack.item.id,
    };
    const emoji = componentEmoji(stack.item.emoji);
    if (emoji) option.emoji = emoji;
    return option;
  }).slice(0, 25);
  return {
    custom_id: `farm:plot:plant:${view.id}`,
    title: 'Plant selected plots',
    components: [
      { type: 10, content: 'What seed do you want to plant on the selected plots?' },
      label('Seed package', {
        type: 3,
        custom_id: 'seed',
        placeholder: 'Choose a seed package',
        min_values: 1,
        max_values: 1,
        required: true,
        options,
      }),
    ],
  };
}

function inventoryPageModal(view, maximum) {
  const maxPage = Math.max(1, Math.floor(Number(maximum) || 1));
  return {
    custom_id: `farm:inv:page-submit:${view.id}`,
    title: 'Switch inventory page',
    components: [label('What page do you want to switch to?', {
      type: 4,
      style: 1,
      custom_id: 'page',
      placeholder: `1 - ${maxPage}`,
      min_length: 1,
      max_length: String(maxPage).length,
      required: true,
    })],
  };
}

function cropsFilterModal(view, availableRarities) {
  const options = rarityOptions(availableRarities, view.cropFilters.rarity);
  const components = [
    label('Name filter', {
      type: 4,
      style: 1,
      custom_id: 'name',
      placeholder: 'Crop name',
      max_length: 80,
      required: false,
      ...(view.cropFilters.name ? { value: String(view.cropFilters.name).slice(0, 80) } : {}),
    }),
    label('Weight filter', {
      type: 4,
      style: 1,
      custom_id: 'weight',
      placeholder: 'Minimum crop weight',
      max_length: 20,
      required: false,
      ...(view.cropFilters.minimumWeightUnits ? { value: String(view.cropFilters.minimumWeightUnits / 100) } : {}),
    }),
  ];
  if (options.length) components.push(label('Rarity', {
    type: 3,
    custom_id: 'rarity',
    placeholder: 'Any rarity',
    min_values: 0,
    max_values: 1,
    required: false,
    options,
  }));
  return { custom_id: `farm:inv:filter-submit:${view.id}`, title: 'Filter Crops inventory', components };
}

function otherFilterModal(view) {
  return {
    custom_id: `farm:inv:filter-submit:${view.id}`,
    title: 'Filter Other inventory',
    components: [
      label('Item name', {
        type: 4,
        style: 1,
        custom_id: 'name',
        placeholder: 'Optional item name',
        max_length: 80,
        required: false,
        ...(view.otherFilters.name ? { value: String(view.otherFilters.name).slice(0, 80) } : {}),
      }),
      label('Rarity', {
        type: 3,
        custom_id: 'rarity',
        placeholder: 'Any rarity',
        min_values: 0,
        max_values: 1,
        required: false,
        options: rarityOptions(ITEM_RARITIES, view.otherFilters.rarity),
      }),
      label('Item type', {
        type: 3,
        custom_id: 'types',
        placeholder: 'Any item type',
        min_values: 0,
        max_values: ITEM_TYPES.length,
        required: false,
        options: ITEM_TYPES.map((type) => ({
          label: type.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase()),
          value: type,
          default: view.otherFilters.itemTypes?.includes(type) || false,
        })),
      }),
    ],
  };
}

module.exports = {
  cropsFilterModal,
  inventoryPageModal,
  label,
  otherFilterModal,
  plantModal,
  rarityOptions,
};
