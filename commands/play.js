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

function readTextFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
}

function getYoutubeCookieInput() {
  if (youtubeCookieData) return youtubeCookieData.raw;

  const fileCookie = readTextFileIfExists(YOUTUBE_COOKIE_FILE);
  const nativeCookie = readTextFileIfExists(YOUTUBE_NATIVE_COOKIE_FILE);
  const envCookie = process.env.PLAY_DL_YOUTUBE_COOKIE?.trim() || '';
  return fileCookie || nativeCookie || envCookie;
}

function normaliseCookie(cookie) {
  if (!cookie?.name || cookie.value == null) return null;

  const name = String(cookie.name).trim();
  const value = String(cookie.value);
  if (!name) return null;

  const domain = String(cookie.domain || '.youtube.com').replace(/^#HttpOnly_/i, '') || '.youtube.com';
  const secure = cookie.secure == null ? /^__Secure-|^__Host-/.test(name) : Boolean(cookie.secure);
  const expirationDate = Number(cookie.expirationDate ?? cookie.expires ?? cookie.expiry ?? 0) || 0;

  return {
    ...cookie,
    name,
    value,
    domain,
    path: cookie.path || '/',
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    expirationDate,
  };
}

function cookieArrayToHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function extractCookieArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.cookies)) return parsed.cookies;
  if (Array.isArray(parsed?.youtube?.cookies)) return parsed.youtube.cookies;
  if (Array.isArray(parsed?.data?.cookies)) return parsed.data.cookies;
  return null;
}

function parseCookieHeader(input) {
  return input
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...valueParts] = part.split('=');
      const value = valueParts.join('=');
      return normaliseCookie({
        name,
        value,
        domain: '.youtube.com',
        path: '/',
        secure: /^__Secure-|^__Host-/.test(String(name || '')),
      });
    })
    .filter(Boolean);
}

function parseNetscapeCookieInput(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length < 7) return null;

      const [rawDomain, , cookiePath, secure, expires, name, ...valueParts] = parts;
      const httpOnly = rawDomain.startsWith('#HttpOnly_');
      const domain = rawDomain.replace(/^#HttpOnly_/i, '');
      return normaliseCookie({
        domain,
        path: cookiePath || '/',
        secure: /^true$/i.test(secure),
        expirationDate: Number(expires) || 0,
        name,
        value: valueParts.join('\t'),
        httpOnly,
      });
    })
    .filter(Boolean);
}

function looksLikeNetscapeCookieFile(input) {
  return /Netscape HTTP Cookie File/i.test(input) || input.split(/\r?\n/).some((line) => line.split('\t').length >= 7);
}

function parseYoutubeCookieInput() {
  const input = getYoutubeCookieInput();
  if (!input) {
    youtubeCookieData = { raw: '', header: '', cookies: null, sourceType: 'empty' };
    return youtubeCookieData;
  }

  if (input.startsWith('{') || input.startsWith('[')) {
    try {
      const parsed = JSON.parse(input);
      const cookieArray = extractCookieArray(parsed);
      if (cookieArray) {
        const cookies = cookieArray.map(normaliseCookie).filter(Boolean);
        youtubeCookieData = {
          raw: input,
          header: cookieArrayToHeader(cookies),
          cookies,
          sourceType: 'json',
        };
        return youtubeCookieData;
      }
    } catch (error) {
      console.warn(`Could not parse ${YOUTUBE_COOKIE_FILE} as JSON cookies: ${error.message}`);
    }
  }

  if (looksLikeNetscapeCookieFile(input)) {
    const cookies = parseNetscapeCookieInput(input);
    youtubeCookieData = {
      raw: input,
      header: cookieArrayToHeader(cookies),
      cookies,
      sourceType: 'netscape',
    };
    return youtubeCookieData;
  }

  const cookies = parseCookieHeader(input);
  youtubeCookieData = {
    raw: input,
    header: cookieArrayToHeader(cookies) || input,
    cookies,
    sourceType: 'header',
  };
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
  const normalised = normaliseCookie(cookie);
  if (!normalised) return null;

  const baseDomain = normalised.domain || '.youtube.com';
  const domain = normalised.httpOnly && !baseDomain.startsWith('#HttpOnly_') ? `#HttpOnly_${baseDomain}` : baseDomain;
  const includeSubdomains = baseDomain.startsWith('.') ? 'TRUE' : 'FALSE';
  const pathValue = normalised.path || '/';
  const secure = normalised.secure ? 'TRUE' : 'FALSE';
  const expires = Number.isFinite(Number(normalised.expirationDate)) ? Math.floor(Number(normalised.expirationDate)) : 0;
  return [domain, includeSubdomains, pathValue, secure, expires, normalised.name, normalised.value].join('\t');
}

function ensureYtDlpCookieFile() {
  if (fs.existsSync(YOUTUBE_NATIVE_COOKIE_FILE)) return YOUTUBE_NATIVE_COOKIE_FILE;

  const cookieData = parseYoutubeCookieInput();
  if (!cookieData.cookies?.length) {
    console.warn('No usable YouTube cookies found for yt-dlp. Add a browser-exported cookie array to data/youtube-cookies.json, a Netscape file to data/youtube-cookies.txt, or PLAY_DL_YOUTUBE_COOKIE in name=value; name2=value2 format.');
    return null;
  }

  const content = [
    '# Netscape HTTP Cookie File',
    ...cookieData.cookies.map(toNetscapeCookieLine).filter(Boolean),
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

async function waitForYtDlpExit(child, stderrChunks) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = stderrChunks.join('').trim();
      reject(new Error(stderr || `yt-dlp exited with code ${code}`));
    });
  });
}

async function createYtDlpStream(url) {
  const args = [
    '--no-playlist',
    '--quiet',
    '--no-warnings',
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

  const stderrChunks = [];
  const child = spawn(getYtDlpPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const exitPromise = waitForYtDlpExit(child, stderrChunks);

  child.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    stderrChunks.push(line);
    const trimmed = line.trim();
    if (/broken pipe/i.test(trimmed)) return;
    if (trimmed) console.error(`yt-dlp: ${trimmed}`);
  });

  const probed = await Promise.race([
    demuxProbe(child.stdout),
    exitPromise.then(() => new Promise(() => {})),
  ]);

  exitPromise.catch((error) => {
    if (!isYoutubeBotCheckError(error)) console.error('yt-dlp exited after stream start:', error.message);
  });

  return { stream: probed.stream, inputType: probed.type };
}

async function createTrackStream(url) {
  if (ytdl.validateURL(url)) {
    if (isYtDlpEnabled()) {
      return createYtDlpStream(url);
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
        await interaction.editReply('YouTube blocked playback from this server. Refresh your YouTube cookies, restart the bot, and make sure yt-dlp is receiving `--cookies data/youtube-cookies-netscape.txt`.');
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
