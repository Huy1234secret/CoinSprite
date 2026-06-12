const { Events, SlashCommandBuilder } = require('discord.js');
const wordChainManager = require('../src/wordChainManager');

const runtimeKey = Symbol.for('coinsprite.wordChainRuntime');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('word-chain')
    .setDescription('Show the current Word Chain game status.'),
  disableActionTimeout: true,

  async init(client) {
    await wordChainManager.init(client);
    if (!client[runtimeKey]) {
      client[runtimeKey] = true;
      client.on(Events.MessageCreate, async (message) => {
        try {
          await wordChainManager.handleMessageCreate(message);
        } catch (error) {
          console.error('Word Chain message handler failed:', error);
        }
      });
    }

    // Keep the automatic game runtime, but exclude /word-chain from registration.
    client.commands.delete('word-chain');
  },

  async execute(interaction) {
    await wordChainManager.handleStatus(interaction);
  },
};
