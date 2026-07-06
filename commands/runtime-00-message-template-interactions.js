const Module = require('module');
const { handleMessageTemplateInteraction } = require('../src/messageTemplates');
const { fitMessageThumbnailSquares } = require('../src/thumbnailFit');

const previousLoad = Module._load;

function wrapThumbnailReplies(interaction) {
  if (!interaction || interaction.__coinSpriteThumbnailRepliesWrapped) return;
  interaction.__coinSpriteThumbnailRepliesWrapped = true;
  for (const method of ['reply', 'followUp']) {
    if (typeof interaction[method] !== 'function') continue;
    const nativeMethod = interaction[method].bind(interaction);
    interaction[method] = async (payload, ...args) => nativeMethod(await fitMessageThumbnailSquares(payload), ...args);
  }
}

Module._load = function registerMessageTemplateInteractions(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__messageTemplateInteractionCapture) return exported;

  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => {
    if (!client.__messageTemplateInteractionHandler) {
      client.__messageTemplateInteractionHandler = true;
      client.on('interactionCreate', (interaction) => {
        wrapThumbnailReplies(interaction);
        handleMessageTemplateInteraction(interaction).catch((error) => {
          console.error('Message template component interaction failed:', error);
        });
      });
    }
    if (nativeInit) await nativeInit(client);
  };
  exported.__messageTemplateInteractionCapture = true;
  return exported;
};

module.exports = {};
