const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { SlashCommandBuilder } = require('discord.js');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const ffmpegPath = require('ffmpeg-static');

const sessions = new Map();
const YOUTUBE_COOKIE_FILE = path.join(__dirname, '..', 'data', 'youtube-cookies.json');
const YOUTUBE_NATIVE_COOKIE_FILE = path.join(__dirname, '..', 'data', 'youtube-cookies.txt');
const YOUTUBE_NETSCAPE_COOKIE_FILE = path.join(__dirname, '..', 'data', 'youtube-cookies-netscape.txt');
const YOUTUBE_PLAYER_CLIENTS = ['IOS', 'ANDROID'];
let youtubeCookieTokenPromise = null;
let youtubeCookieData = null;
let ytdlAgent = null;
let ytdlAgentKey = '';

if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

function getYoutubeCookieInput() {
  if (youtubeCookieData) return youtubeCookieData.raw;

  const fileCookie = fs.existsSync(YOUTUBE_COOKIE_FILE) ? fs.readFileSync(YOUTUBE_COOKIE_FILE, 'utf8').trim() : '';
  const envCookie = process.env.PLAY_DL_YOUTUBE_COOKIE?.trim() || '';
  return fileCookie || envCookie;
}

function parseYoutubeCookieInput() {
  const input = getYoutubeCookieInput();
  if (!input) {
    youtubeCookieData = { raw: '', header: '', cookies: null };
    return youtubeCookieData;
  }

  if (input.startsWith('[')) {
    try {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed)) {
        youtubeCookieData = { raw: input, header: '', cookies: null };
        return youtubeCookieData;
      }

      const cookies = parsed.filter((cookie) => cookie?.name && cookie?.value);
      const header = cookies
        .filter((cookie) => cookie?.name && cookie?.value)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
      youtubeCookieData = { raw: input, header, cookies };
      return youtubeCookieData;
    } catch {
      youtubeCookieData = { raw: input, header: '', cookies: null };
      return youtubeCookieData;
    }
  }

  youtubeCookieData = { raw: input, header: input, cookies: null };
  return youtubeCookieData;
}

function getYoutubeCookieHeader() {
  return parseYoutubeCookieInput().header;
}

function getYtdlOptions() {
  const cookieData = parseYoutubeCookieInput();
  if (!cookieData.raw) return {};

  if (cookieData.cookies?.length) {
    if (!ytdlAgent || ytdlAgentKey !== cookieData.raw) {
      ytdlAgent = ytdl.createAgent(cookieData.cookies);
      ytdlAgentKey = cookieData.raw;
    }
    return { agent: ytdlAgent };
  }

  return { requestOptions: { headers: { cookie: cookieData.header, Cookie: cookieData.header } } };
}

function isYtDlpEnabled() {
  return process.env.YOUTUBE_USE_YT_DLP === '1';
}

function isSpotifyUrl(url) {
  return /^https?:\/\/(?:open\.)?spotify\.com\//i.test(String(url || ''));
}

function getYtDlpPath() {
  return process.env.YT_DLP_PATH?.trim() || 'yt-dlp';
}

function getYoutubeProxyUrl() {
  return process.env.YOUTUBE_PROXY_URL?.trim() || '';
}

function toNetscapeCookieLine(cookie) {
  const baseDomain = cookie.domain || '.youtube.com';
  const domain = cookie.httpOnly && !baseDomain.startsWith('#HttpOnly_') ? `#HttpOnly_${baseDomain}` : baseDomain;
  const includeSubdomains = baseDomain.startsWith('.') ? 'TRUE' : 'FALSE';
  const pathValue = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = Number.isFinite(Number(cookie.expirationDate)) ? Math.floor(Number(cookie.expirationDate)) : 0;
  return [domain, includeSubdomains, pathValue, secure, expires, cookie.name, cookie.value].join('\t');
}

function ensureYtDlpCookieFile() {
  if (fs.existsSync(YOUTUBE_NATIVE_COOKIE_FILE)) return YOUTUBE_NATIVE_COOKIE_FILE;

  const cookieData = parseYoutubeCookieInput();
  if (!cookieData.cookies?.length) return null;

  const content = [
    '# Netscape HTTP Cookie File',
    ...cookieData.cookies.map(toNetscapeCookieLine),
    '',
  ].join('\n');

  const existing = fs.existsSync(YOUTUBE_NETSCAPE_COOKIE_FILE)
    ? fs.readFileSync(YOUTUBE_NETSCAPE_COOKIE_FILE, 'utf8')
    : '';
  if (existing !== content) fs.writeFileSync(YOUTUBE_NETSCAPE_COOKIE_FILE, content, { mode: 0o600 });
  return YOUTUBE_NETSCAPE_COOKIE_FILE;
}

async function ensureYoutubeCookieToken() {
  const cookie = getYoutubeCookieHeader();
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

async function createTrackStream(url) {
  if (ytdl.validateURL(url)) {
    if (isYtDlpEnabled()) {
      const args = [
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--remote-components',
        'ejs:github',
        '--format',
        'bestaudio/best',
        '--output',
        '-',
      ];
      const cookieFile = ensureYtDlpCookieFile();
      if (cookieFile) args.unshift('--cookies', cookieFile);
      const proxyUrl = getYoutubeProxyUrl();
      if (proxyUrl) args.unshift('--proxy', proxyUrl);
      args.push(url);

      const child = spawn(getYtDlpPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stderr.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (/broken pipe/i.test(line)) return;
        if (line) console.error(`yt-dlp: ${line}`);
      });
      child.once('error', (error) => {
        child.stdout.destroy(error);
      });
      const probed = await demuxProbe(child.stdout);
      return { stream: probed.stream, inputType: probed.type };
    }

    const youtubeStream = ytdl(url, {
      ...getYtdlOptions(),
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      dlChunkSize: 0,
      playerClients: YOUTUBE_PLAYER_CLIENTS,
    });
    const probed = await demuxProbe(youtubeStream);
    return { stream: probed.stream, inputType: probed.type };
  }

  if (isSpotifyUrl(url)) {
    throw new Error('Spotify links are not directly playable. Search the song name instead so I can find a playable YouTube or SoundCloud track.');
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
        console.error('Music player error:', error?.message || error);
        if (error?.resource?.metadata) console.error('Music player resource metadata:', error.resource.metadata);
        destroySession(guildId);
      });

      await interaction.editReply(`Playing **${track.title}**`);
    } catch (error) {
      console.error('Play command failed:', error);
      destroySession(guildId);
      destroyConnection(connection);
      if (isYoutubeBotCheckError(error)) {
        await interaction.editReply('YouTube blocked playback from this server. Refresh `data/youtube-cookies.json`, enable `YOUTUBE_USE_YT_DLP=1`, or try a direct non-YouTube audio URL.');
        return;
      }
      if (/spotify links are not directly playable/i.test(error?.message || '')) {
        await interaction.editReply(error.message);
        return;
      }
      await interaction.editReply('I could not play that track. Try a different song or URL.');
    }
  },
};
