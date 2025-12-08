const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  StringSelectMenuBuilder,
  SlashCommandBuilder
} = require('discord.js');
const { config } = require('dotenv');
const { ensureShopAssets, createShopImage, getPlaceholderItems, ITEM_PLACEHOLDER_EMOJI } = require('./src/shopImage');

config();

const TOTAL_GIFTCARDS = 2;
const ANNOUNCEMENT_CHANNEL_ID = '1372572234949853367';
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const ROLL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SHOP_RESTOCK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SHOP_PAGE_SELECT_ID = 'shop-page-select';
const SHOP_ITEM_BUTTON_PREFIX = 'shop-item-';
const COMPONENTS_V2_FLAG = 1 << 15;

async function safeErrorReply(interaction, message) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: 64 });
    } else {
      await interaction.reply({ content: message, flags: 64 });
    }
  } catch (error) {
    console.error('Failed to send error response for interaction:', error);
  }
}

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
    .toJSON(),
  new SlashCommandBuilder()
    .setName('shop-view')
    .setDescription('Generate a preview image of the current shop rotation.')
    .toJSON()
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const cooldowns = new Collection();

function getRestockTimestamp() {
  const now = Date.now();
  return Math.floor((now + SHOP_RESTOCK_INTERVAL_MS) / 1000);
}

async function buildShopPreview() {
  const assetPaths = await ensureShopAssets();
  const items = getPlaceholderItems(assetPaths);
  const buffer = await createShopImage(items, assetPaths.currencyIcon);
  const attachment = new AttachmentBuilder(buffer, { name: 'shop-view.png' });

  const components = buildShopComponents(items);

  return { attachment, components };
}

function buildShopComponents(items) {
  const previewContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 10,
        content: `## Jag's Shop\n-# Shop restock <t:${getRestockTimestamp()}:R>`
      },
      {
        type: 12,
        items: [
          {
            media: {
              url: 'attachment://shop-view.png'
            }
          }
        ]
      },
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(SHOP_PAGE_SELECT_ID)
            .setPlaceholder('Page 1')
            .addOptions({ label: 'Page 1', value: 'page-1', default: true })
        )
        .toJSON()
    ]
  };

  const BUTTONS_PER_ROW = 3;
  const buttonRows = [];

  for (let i = 0; i < items.length; i += BUTTONS_PER_ROW) {
    const slice = items.slice(i, i + BUTTONS_PER_ROW);
    const row = new ActionRowBuilder();

    slice.forEach((item, index) => {
      const buttonEmoji = item.emoji || ITEM_PLACEHOLDER_EMOJI;

      const button = new ButtonBuilder()
        .setCustomId(`${SHOP_ITEM_BUTTON_PREFIX}${i + index}`)
        .setLabel(item.name)
        .setStyle(ButtonStyle.Success);

      if (buttonEmoji) {
        button.setEmoji(buttonEmoji);
      }

      row.addComponents(button);
    });

    buttonRows.push(row.toJSON());
  }

  const buttonsContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: buttonRows
  };

  return [previewContainer, buttonsContainer];
}

client.once(Events.ClientReady, async () => {
  try {
    await client.application.commands.set(commands);
    console.info(`Ready! Logged in as ${client.user.tag}`);
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith(SHOP_ITEM_BUTTON_PREFIX)) {
      await safeErrorReply(interaction, 'Item purchase is not available in the preview.');
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === SHOP_PAGE_SELECT_ID) {
      await safeErrorReply(interaction, 'Pagination will be available when multiple pages exist.');
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === 'roll') {
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
      const successChance = Math.min(100, Math.max(0, userChances[userKey] ?? 1));

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

      const rollValue = Math.random();
      console.info(`User ${interaction.user.id} rolled ${rollValue.toFixed(4)} with success chance ${successChance}%`);

      if (rollValue <= successChance / 100) {
        giftcardsRemaining -= 1;
        state.giftcards_remaining = giftcardsRemaining;
        state.user_chances = { ...userChances, [userKey]: 1 };
        saveState(state);

        await interaction.editReply(
          `Congratulation, ${interaction.user} you have won 10$ Giftcard! Your success chance has been reset for the next roll.\n-# Your current Success chance - 1% ; Fail chance - 99%`
        );
        await announceGiftcardStatus(interaction.client, giftcardsRemaining);
      } else {
        const nextSuccess = Math.min(100, successChance + 1);
        const nextFail = 100 - nextSuccess;
        state.user_chances = { ...userChances, [userKey]: nextSuccess };
        saveState(state);

        await interaction.editReply(
          `No prize this time—your success chance increased by 1% for the next roll.\n-# Your current Success chance - ${nextSuccess}% ; Fail chance - ${nextFail}%`
        );
      }
    } catch (error) {
      console.error('Failed to process /roll interaction:', error);
      await safeErrorReply(interaction, 'Something went wrong handling your roll. Please try again in a moment.');
    }
    return;
  }

  if (interaction.commandName === 'shop-view') {
    await interaction.deferReply({ flags: COMPONENTS_V2_FLAG });
    try {
      const { attachment, components } = await buildShopPreview();

      await interaction.editReply({
        files: [attachment],
        components,
        flags: COMPONENTS_V2_FLAG
      });
    } catch (error) {
      console.error('Failed to generate shop view:', error);
      await interaction.editReply({
        components: [
          {
            type: 10,
            content: 'Unable to generate the shop view right now.'
          }
        ],
        flags: COMPONENTS_V2_FLAG
      });
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is not set.');
}

client.login(token).catch((error) => {
  console.error('Failed to login:', error);
});
