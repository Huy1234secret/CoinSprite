const { errorPayload, v2Payload, WHITE } = require('../../shared/components');
const {
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  INFO_TOPICS,
  topicPages,
} = require('./catalog');

const SECONDARY = 2;

function infoMessagePayload(botUserId, options = {}) {
  const id = String(botUserId || '0');
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 10,
        content: `### <@${id}>'s Information\n\nEverything you need to start, progress, and master the RNG game is here.\nChoose a topic below to open the guide.`,
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 1,
        components: [{
          type: 3,
          custom_id: INFO_SELECT_CUSTOM_ID,
          placeholder: 'Choose an information topic',
          min_values: 1,
          max_values: 1,
          options: INFO_TOPICS.map((topic) => ({
            label: topic.label,
            value: topic.id,
            description: topic.description,
            emoji: { name: topic.emoji },
          })),
        }],
      },
    ],
  }], options);
}

function pageButton(topicId, page, label, disabled = false) {
  return {
    type: 2,
    style: SECONDARY,
    label,
    custom_id: `rng:info:page:v${INFO_MESSAGE_VERSION}:${topicId}:${page}`,
    disabled,
  };
}

function topicPayload(topicId, page, context = {}, options = {}) {
  const result = topicPages(topicId, context);
  if (!result) return errorPayload('Unknown information topic\nChoose a current topic from the published menu.', { ephemeral: true, ...options });
  const maximum = result.pages.length;
  const selectedPage = Math.max(1, Math.min(maximum, Math.floor(Number(page) || 1)));
  const components = [
    { type: 10, content: `## ${result.topic.emoji} ${result.topic.label}` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: result.pages[selectedPage - 1] },
  ];
  if (maximum > 1) {
    components.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `-# Page ${selectedPage} of ${maximum} • Guide version ${INFO_MESSAGE_VERSION}` },
      {
        type: 1,
        components: [
          pageButton(result.topic.id, Math.max(1, selectedPage - 1), 'Previous', selectedPage === 1),
          pageButton(result.topic.id, Math.min(maximum, selectedPage + 1), 'Next', selectedPage === maximum),
        ],
      },
    );
  }
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components,
  }], { ephemeral: true, ...options });
}

module.exports = { infoMessagePayload, pageButton, topicPayload };
