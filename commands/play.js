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

const sessions = new Map();
let youtubeCookieTokenPromise = null;

function getYoutubeCookie() {
  return process.env.PLAY_DL_YOUTUBE_COOKIE?.trim() || '';
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
      await ensureYoutubeCookieToken();
      const stream = await play.stream(track.url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
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
