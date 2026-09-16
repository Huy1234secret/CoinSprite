// Isolated UI test server. Only Discord is simulated; auth, APIs and persistence are real.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-dashboard-'));
process.env.SERVER_CONFIG_STORE_PATH = path.join(temporary,'config.json');
process.env.ADMIN_SESSION_STORE_PATH = path.join(temporary,'sessions.json');
process.env.LEVELING_DATA_PATH = path.join(temporary,'leveling.json');
process.env.COUNTING_DATABASE_PATH = path.join(temporary,'games.sqlite');
const USER = '123456789012345678', GUILD = '223456789012345678', CHANNEL = '323456789012345678', ROLE = '423456789012345678';
process.env.OWNER_USER_IDS = USER;
const secret = 'dashboard-test-only-local-secret';
const session = 'dashboard-test';
const cookie = `${session}.${crypto.createHmac('sha256',secret).update(session).digest('base64url')}`;
fs.writeFileSync(process.env.ADMIN_SESSION_STORE_PATH, JSON.stringify({sessions:{[cookie]:{createdAt:Date.now(),expiresAt:Date.now()+86400000,csrfToken:'dashboard-test-csrf',user:{id:USER,username:'Workspace tester',globalName:'Workspace tester'}}}}));
const { Collection, ChannelType } = require('discord.js');
const config = require('../src/serverConfig');
config.ensureGuildConfig(GUILD);
const state = config.loadState();
state.guilds[GUILD].enabled = true;
state.guilds[GUILD].features.leveling = true;
state.guilds[GUILD].leveling.enabled = true;
config.saveState(state);
const sent = [];
const permissions = {has:()=>true};
const channel = {id:CHANNEL,name:'general',type:ChannelType.GuildText,rawPosition:0,isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>permissions,
  send:async payload=>{sent.push(payload); return {id:'623456789012345678',url:`https://discord.com/channels/${GUILD}/${CHANNEL}/623456789012345678`};},
  messages:{fetch:async id=>({id,author:{id:'523456789012345678'},edit:async payload=>{sent.push(payload);return {id,url:`https://discord.com/channels/${GUILD}/${CHANNEL}/${id}`};}})}
};
const channels = new Collection([[CHANNEL,channel]]);
const role = {id:ROLE,name:'Community regular',hexColor:'#b38326',rawPosition:1,position:1,editable:true,managed:false,permissions:{has:()=>false}};
const roles = new Collection([[ROLE,role]]);
const guild = {id:GUILD,name:'Dashboard test community',memberCount:42,iconURL:()=>null,
  channels:{cache:channels,fetch:async id=>id ? channels.get(id) : channels,fetchActiveThreads:async()=>({threads:new Collection()})},
  roles:{cache:roles,fetch:async id=>id ? roles.get(id) : roles},
  members:{me:{id:'523456789012345678',permissions,roles:{highest:{position:100}}},fetchMe:async()=>guild.members.me,fetch:async()=>({permissions,send:async()=>{}})},
  commands:{set:async()=>[]},emojis:{cache:new Collection(),fetch:async()=>new Collection()},fetchOwner:async()=>({send:async()=>{}})
};
channel.guild = guild;
const guilds = new Collection([[GUILD,guild]]);
const client = {user:{id:'523456789012345678',tag:'CoinSprite',displayAvatarURL:()=>'/test-avatar.png'},ws:{ping:12},guilds:{cache:guilds,fetch:async id=>id?guilds.get(id):guilds},application:{emojis:{fetch:async()=>new Collection()}}};
guild.client = client;
const { createAdminRequestHandler } = require('../src/adminServer');
const handler = createAdminRequestHandler({sessionSecret:secret,cookieSecure:false,publicOrigin:'http://127.0.0.1',redirectUri:'http://127.0.0.1/auth/discord/callback'},client);
const server = http.createServer((req,res)=>{
  // This route exists only in this test helper, never in the application server.
  if(req.url === '/test-login') {res.writeHead(302,{'Set-Cookie':`coinsprite_admin=${cookie}; Path=/; HttpOnly; SameSite=Lax`,Location:'/admin'});return res.end();}
  if(req.url === '/test-avatar.png') {res.writeHead(200,{'Content-Type':'image/png'});return res.end(fs.readFileSync(path.join(__dirname,'fixtures/bot-avatar.png')));}
  handler(req,res);
});
server.listen(process.env.DASHBOARD_TEST_PORT === undefined ? 4173 : Number(process.env.DASHBOARD_TEST_PORT),'127.0.0.1',()=>console.log(`Dashboard test server: http://127.0.0.1:${server.address().port}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
