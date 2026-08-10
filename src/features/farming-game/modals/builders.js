const { ITEM_RARITIES, ITEM_TYPES } = require('../data/items');
const { componentEmoji } = require('../../shared/emojis');

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
  return [...new Set(rarities || [])].map((rarity) => ({
    label: rarity,
    value: rarity,
    default: selectedSet.has(rarity),
  })).slice(0, 25);
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

function inventoryFilterModal(view, category, availableRarities = ITEM_RARITIES, availableTypes = ITEM_TYPES) {
  const isOther = category === 'other';
  const filters = isOther ? view.otherFilters : view.cropFilters;
  const options = rarityOptions(availableRarities, filters.rarity);
  const typeOptions = [...new Set(availableTypes || [])].map((type) => ({
    label: type.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase()),
    value: type,
    default: filters.itemTypes?.includes(type) || false,
  })).slice(0, 25);
  const components = [
    label(isOther ? 'Item name' : 'Crop name', {
      type: 4,
      style: 1,
      custom_id: 'name',
      placeholder: isOther ? 'Optional item name' : 'Optional crop name',
      max_length: 80,
      required: false,
      ...(filters.name ? { value: String(filters.name).slice(0, 80) } : {}),
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
  if (typeOptions.length) components.push(label('Item type', {
    type: 3,
    custom_id: 'types',
    placeholder: 'Any item type',
    min_values: 0,
    max_values: typeOptions.length,
    required: false,
    options: typeOptions,
  }));
  return {
    custom_id: `farm:inv:filter-submit:${view.id}`,
    title: `Filter ${isOther ? 'Other' : 'Crops'} inventory`,
    components,
  };
}

function cropsFilterModal(view, availableRarities, availableTypes) {
  return inventoryFilterModal(view, 'crops', availableRarities, availableTypes);
}

function otherFilterModal(view, availableRarities, availableTypes) {
  return inventoryFilterModal(view, 'other', availableRarities, availableTypes);
}

module.exports = {
  cropsFilterModal,
  inventoryFilterModal,
  inventoryPageModal,
  label,
  otherFilterModal,
  plantModal,
  rarityOptions,
};
