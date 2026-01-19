const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { config } = require('dotenv');

config();

const CHANNEL_ID = '1458499286294597709';
const RULES_CHANNEL_ID = '1462464917826179143';
const STATE_PATH = path.join(__dirname, '..', 'data', 'lunar-new-year-announcement.json');

const EVENT_START = Date.UTC(2026, 0, 15, 0, 0, 0);
const EVENT_END = Date.UTC(2026, 1, 15, 23, 59, 59);

const MAX_TIMEOUT_MS = 2_000_000_000; // ~23 days

function buildCountdown() {
  const unixSeconds = Math.floor(EVENT_END / 1000);
  return `<t:${unixSeconds}:R>`;
}

function buildAnnouncementContent() {
  const countdown = buildCountdown();

  return [
    '||@here||',
    '',
    '🎉 **Lunar New Year Event 2026** 🎉',
    `-# 🕒 Ends ${countdown}`,
    '-# 🧱 Game: Minecraft',
    '',
    '## 📅 Game Dates',
    '* January 15 – February 15',
    '',
    '## 🎯 Missions',
    '* Collect as many **ADVANCEMENTS** as you can!',
    '* When February 15 arrives, the server closes and advancements will be tallied.',
    '',
    '### 🧩 What counts as an advancement?',
    'The categories we count: **recipes**, **adventure**, **husbandry**, **nether**, and **end**.',
    '-# **Recipes** count every unique craft/cook/create method. Example: `baked_potato` = 1 point, `baked_potato_from_smoking` = another point.',
    '',
    '## 📜 Rules',
    `* Please review the rules in <#${RULES_CHANNEL_ID}>`,
    '',
    '## 🏆 Prizes',
    '* 🥇 1st: $30 gift card',
    '* 🥈 2nd: $20 gift card',
    '* 🥉 3rd: $10 gift card',
    '* 🎟️ 4th: x3 $1 tickets',
    '* 🎟️ 5th: x1 $1 ticket',
    '',
    '## 🌐 How to join the Minecraft server',
    '* Server IP: `jag.noob.club`',
    '-# Server version: Java 1.21.11',
  ].join('\n');
}

function buildEndedContent() {
  return [
    '||@here||',
    '',
    '🎊 **Lunar New Year Event 2026 — Ended**',
    '-# The event has concluded. Thanks for participating!',
    '',
    '## ✅ What happens next?',
    '* The server is now closed.',
    '* Advancements are being counted and winners will be announced soon.',
    '',
    '## 🌐 Minecraft Server',
    '* Server IP: `jag.noob.club`',
    '-# Server version: Java 1.21.11',
  ].join('\n');
}

function buildEmbed() {
  return new EmbedBuilder()
    .setColor(0x32cd32)
    .setThumbnail('https://i.ibb.co/BKVcRnh8/Minecraft-2024-cover-art-png.webp')
    .setTitle('Lunar New Year Event 2026')
    .setDescription('Collect advancements, earn prizes, and celebrate the new year together!');
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function scheduleEditAt(targetTimeMs, callback) {
  const now = Date.now();
  const delay = targetTimeMs - now;

  if (delay <= 0) {
    callback();
    return;
  }

  if (delay > MAX_TIMEOUT_MS) {
    setTimeout(() => scheduleEditAt(targetTimeMs, callback), MAX_TIMEOUT_MS);
    return;
  }

  setTimeout(callback, delay);
}

async function upsertAnnouncement(client) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${CHANNEL_ID} is not text-based or could not be found.`);
  }

  const embed = buildEmbed();
  const content = buildAnnouncementContent();

  const existingState = loadState();
  let message = null;

  if (existingState?.messageId && existingState.channelId === CHANNEL_ID) {
    try {
      message = await channel.messages.fetch(existingState.messageId);
    } catch (error) {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send({ content, embeds: [embed] });
    saveState({
      channelId: CHANNEL_ID,
      messageId: message.id,
      createdAt: new Date().toISOString(),
    });
    return message;
  }

  await message.edit({ content, embeds: [embed] });
  return message;
}

async function editAnnouncementToEnded(message) {
  const endedContent = buildEndedContent();
  const embed = buildEmbed().setTitle('Lunar New Year Event 2026 — Ended');
  await message.edit({ content: endedContent, embeds: [embed] });
}

async function run() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is not set.');
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once('ready', async () => {
    try {
      const message = await upsertAnnouncement(client);
      scheduleEditAt(EVENT_END, async () => {
        try {
          await editAnnouncementToEnded(message);
        } finally {
          client.destroy();
        }
      });
    } catch (error) {
      console.error('Failed to send announcement:', error);
      client.destroy();
      process.exitCode = 1;
    }
  });

  await client.login(token);
}

run();
