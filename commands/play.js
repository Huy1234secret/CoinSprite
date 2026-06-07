const { SlashCommandBuilder } = require('discord.js');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const ffmpegPath = require('ffmpeg-static');

const sessions = new Map();
let youtubeCookieTokenPromise = null;
let ytdlAgent = null;
let ytdlAgentCookie = '';

if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

function getYoutubeCookie() {
  return process.env.PLAY_DL_YOUTUBE_COOKIE?.trim() || '';
}

function parseCookieHeader(cookieHeader) {
  const input = String(cookieHeader || '').trim();
  if (!input) return [];

  if (input.startsWith('[')) {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return input
    .split(';')
    .map((part) => {
      const [name, ...valueParts] = part.trim().split('=');
      const value = valueParts.join('=');
      if (!name || !value) return null;
      return { name, value, domain: '.youtube.com' };
    })
    .filter(Boolean);
}

async function ensureYoutubeCookieToken() {
  const cookie = getYoutubeCookie();
  if (!cookie) return;
  if (!youtubeCookieTokenPromise) {
    youtubeCookieTokenPromise = play.setToken({ youtube: { cookie } }).catch((error) => {
      youtubeCookieTokenPromise = null;
      throw error;
    });
  }
  await youtubeCookieTokenPromise;
}

function getYtdlAgent() {
  const cookie = getYoutubeCookie();
  if (!cookie) return undefined;
  if (!ytdlAgent || ytdlAgentCookie !== cookie) {
    ytdlAgent = ytdl.createAgent(parseCookieHeader(cookie));
    ytdlAgentCookie = cookie;
  }
  return ytdlAgent;
}

function isYoutubeBotCheckError(error) {
  const message = String(error?.message || error || '');
  return /sign in to confirm.*not a bot/i.test(message) || /confirm you.?re not a bot/i.test(message);
}

function getSessionKey(interaction) {
  return interaction.guildId;
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

function destroyConnection(connection) {
  if (!connection || connection.state?.status === VoiceConnectionStatus.Destroyed) return;
  connection.destroy();
}

async function resolveTrack(query) {
  const input = String(query || '').trim();
  if (!input) return null;

  await ensureYoutubeCookieToken();

  if (/^https?:\/\//i.test(input)) {
    return { title: input, url: input };
  }

  const results = await play.search(input, { limit: 1 });
  const first = results?.[0];
  if (!first?.url) return null;

  return {
    title: first.title || input,
    url: first.url,
  };
}

async function createTrackStream(url) {
  if (ytdl.validateURL(url)) {
    return {
      stream: ytdl(url, {
        agent: getYtdlAgent(),
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
      }),
    };
  }

  await ensureYoutubeCookieToken();
  const stream = await play.stream(url);
  return { stream: stream.stream, inputType: stream.type };
}

function destroySession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  sessions.delete(guildId);
  session.player.stop(true);
  destroyConnection(session.connection);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song in your voice channel.')
    .addStringOption((option) =>
      option
        .setName('music')
        .setDescription('Song name or URL')
        .setRequired(true),
    ),

  async execute(interaction) {
    const voiceChannel = getVoiceChannel(interaction);
    if (!voiceChannel) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const query = interaction.options.getString('music', true);
    const track = await resolveTrack(query);
    if (!track) {
      await interaction.editReply('No song found.');
      return;
    }

    const guildId = getSessionKey(interaction);
    destroySession(guildId);

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      const stream = await createTrackStream(track.url);
      const resource = createAudioResource(stream.stream, stream.inputType ? { inputType: stream.inputType } : undefined);
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Stop,
        },
      });

      sessions.set(guildId, { connection, player });
      connection.subscribe(player);
      player.play(resource);

      player.once(AudioPlayerStatus.Idle, () => destroySession(guildId));
      player.once('error', (error) => {
        console.error('Music player error:', error);
        destroySession(guildId);
      });

      await interaction.editReply(`Playing **${track.title}**`);
    } catch (error) {
      console.error('Play command failed:', error);
      destroySession(guildId);
      destroyConnection(connection);
      if (isYoutubeBotCheckError(error)) {
        await interaction.editReply('YouTube blocked playback from this server. Add `PLAY_DL_YOUTUBE_COOKIE` to the bot environment and restart, or try a direct non-YouTube audio URL.');
        return;
      }
      await interaction.editReply('I could not play that track. Try a different song or URL.');
    }
  },
};
