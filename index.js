const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const { config } = require('dotenv');

config();

const TOTAL_GIFTCARDS = 2;
const ANNOUNCEMENT_CHANNEL_ID = '1372572234949853367';
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const ROLL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
    ? '@here there\'s only 1 Giftcard left, goodluck users! Try your luck by using command `/roll`'
    : '@here, looks like all Giftcards are received. The event ends here, thanks for playing!';

  await channel.send(message);
}

const commands = [
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Try your luck for a $10 giftcard!')
    .toJSON()
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const cooldowns = new Collection();

client.once(Events.ClientReady, async () => {
  try {
    await client.application.commands.set(commands);
    console.info(`Ready! Logged in as ${client.user.tag}`);
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'roll') {
    return;
  }

  const now = Date.now();
  const lastUsed = cooldowns.get(interaction.user.id) ?? 0;
  const remainingMs = ROLL_COOLDOWN_MS - (now - lastUsed);

  if (remainingMs > 0) {
    const availableAt = Math.floor((now + remainingMs) / 1000);
    await interaction.reply({
      content: `You can use this command again <t:${availableAt}:R>.`,
      ephemeral: true
    });
    return;
  }

  cooldowns.set(interaction.user.id, now);

  const state = loadState();
  let giftcardsRemaining = state.giftcards_remaining ?? TOTAL_GIFTCARDS;
  const userKey = interaction.user.id;
  const userChances = state.user_chances ?? {};
  const successChance = Math.min(100, Math.max(0, userChances[userKey] ?? 1));

  if (giftcardsRemaining <= 0) {
    await interaction.reply({
      content: 'All giftcards have been claimed. The event has ended.',
      ephemeral: true
    });
    return;
  }

  const rollValue = Math.random();
  console.info(`User ${interaction.user.id} rolled ${rollValue.toFixed(4)} with success chance ${successChance}%`);

  if (rollValue <= successChance / 100) {
    giftcardsRemaining -= 1;
    state.giftcards_remaining = giftcardsRemaining;
    state.user_chances = { ...userChances, [userKey]: 1 };
    saveState(state);

    await interaction.reply(
      `Congratulation, ${interaction.user} you have won 10$ Giftcard! Your success chance has been reset for the next roll.\n-# Your current Success chance - 1% ; Fail chance - 99%`
    );
    await announceGiftcardStatus(interaction.client, giftcardsRemaining);
  } else {
    const nextSuccess = Math.min(100, successChance + 1);
    const nextFail = 100 - nextSuccess;
    state.user_chances = { ...userChances, [userKey]: nextSuccess };
    saveState(state);

    await interaction.reply(
      `No prize this time—your success chance increased by 1% for the next roll.\n-# Your current Success chance - ${nextSuccess}% ; Fail chance - ${nextFail}%`
    );
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token).catch((error) => {
  console.error('Failed to login:', error);
});
