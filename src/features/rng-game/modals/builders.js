const { RARITIES, SEED_BY_ID } = require('../data/seeds');
const { componentEmoji } = require('../data/emojis');

function label(labelText, component, description) {
  return {
    type: 18,
    label: labelText.slice(0, 45),
    ...(description ? { description: description.slice(0, 100) } : {}),
    component,
  };
}

function rarityOptions(rarities, selected) {
  return [...new Set(rarities || [])]
    .filter((rarity) => RARITIES[rarity])
    .map((rarity) => {
      const option = { label: rarity, value: rarity, default: rarity === selected };
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
    }),
  ];
  const options = rarityOptions(availableRarities, view.filters.rarity);
  if (options.length) components.push(label('Rarity filter', {
    type: 3,
    custom_id: 'rarity',
    placeholder: 'Any rarity',
    min_values: 0,
    max_values: 1,
    required: false,
    options,
  }));
  return { custom_id: `rng:inv:filter-submit:${view.id}`, title: 'Filter inventory', components };
}

function sellFilterModal(session, availableRarities) {
  const options = rarityOptions(availableRarities, session.filters.rarity);
  const components = [];
  if (options.length) components.push(label('Rarity', {
    type: 3,
    custom_id: 'rarity',
    placeholder: 'Any rarity',
    min_values: 0,
    max_values: 1,
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

module.exports = { inventoryFilterModal, inventoryPageModal, rarityOptions, sellFilterModal };
