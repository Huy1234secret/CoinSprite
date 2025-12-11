const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');

const TOTAL_GIFTCARDS = 2;
const ANNOUNCEMENT_CHANNEL_ID = '1372572234949853367';
const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');
const ROLL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const cooldowns = new Map();

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { giftcards_remaining: TOTAL_GIFTCARDS, user_chances: {} };
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    return {
      giftcards_remaining: state.giftcards_remaining ?? TOTAL_GIFTCARDS,
      user_chances: state.user_chances ?? {}
    };
  } catch (error) {
    console.warn('State file was corrupted; resetting state.', error);
    return { giftcards_remaining: TOTAL_GIFTCARDS, user_chances: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function announceGiftcardStatus(client, giftcardsRemaining) {
  let channel = client.channels.cache.get(ANNOUNCEMENT_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
    } catch (error) {
      console.error('Unable to fetch announcement channel:', error);
      return;
    }
  }

  const message = giftcardsRemaining === 1
    ? "@here there's only 1 Giftcard left, goodluck users! Try your luck by using command `/roll`"
    : '@here, looks like all Giftcards are received. The event ends here, thanks for playing!';

  await channel.send(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Try your luck for a $10 giftcard!'),

  async execute(interaction) {
    try {
      const now = Date.now();
      const lastUsed = cooldowns.get(interaction.user.id) ?? 0;
      const remainingMs = ROLL_COOLDOWN_MS - (now - lastUsed);

      if (remainingMs > 0) {
        const availableAt = Math.floor((now + remainingMs) / 1000);
        await interaction.reply({
          content: `You can use this command again <t:${availableAt}:R>.`,
          flags: 64
        });
        return;
      }

      const state = loadState();
      let giftcardsRemaining = state.giftcards_remaining ?? TOTAL_GIFTCARDS;
      const userKey = interaction.user.id;
      const userChances = state.user_chances ?? {};
      // Guarantee a win on every roll by forcing the success chance to 100%
      const successChance = 100;

      if (giftcardsRemaining <= 0) {
        await interaction.reply({
          content: 'All giftcards have been claimed. The event has ended.',
          flags: 64
        });
        return;
      }

      try {
        await interaction.deferReply();
      } catch (error) {
        console.error('Failed to acknowledge /roll interaction:', error);
        return;
      }

      cooldowns.set(interaction.user.id, now);

      console.info(`User ${interaction.user.id} rolled and automatically won with success chance ${successChance}%`);

      giftcardsRemaining -= 1;
      state.giftcards_remaining = giftcardsRemaining;
      state.user_chances = { ...userChances, [userKey]: 1 };
      saveState(state);

      await interaction.editReply(
        `Congratulation, ${interaction.user}! You have instantly won a 10$ Giftcard. Enjoy your prize!`
      );
      await announceGiftcardStatus(interaction.client, giftcardsRemaining);
    } catch (error) {
      console.error('Failed to process /roll interaction:', error);
      await safeErrorReply(interaction, 'Something went wrong handling your roll. Please try again in a moment.');
    }
  }
};
