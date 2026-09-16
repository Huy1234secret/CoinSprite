const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('rebuilt dashboard assets and feature writes use the existing authenticated server', async t => {
  const child = spawn(process.execPath, [path.join(__dirname,'../testSupport/dashboardServer.cjs')], {
    env:{...process.env,DASHBOARD_TEST_PORT:'0'},stdio:['ignore','pipe','pipe'],
  });
  t.after(()=>child.kill());
  const origin = await new Promise((resolve,reject)=>{
    let output = '';
    const timeout = setTimeout(()=>reject(new Error(`Test server did not start: ${output}`)),20000);
    child.stdout.on('data',data=>{output += data;const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
    child.stderr.on('data',data=>{output += data;});
    child.on('exit',code=>{clearTimeout(timeout);if(code)reject(new Error(output));});
  });
  const page = await fetch(`${origin}/admin`);
  assert.equal(page.status,200);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/admin\/(?:workspace\.(?:js|css)|emojiData\.js)[^"]*)"/g)].map(match=>match[1]);
  assert.equal(assets.length,3);
  for(const url of assets){const response = await fetch(origin+url);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);}
  assert.equal((await fetch(origin+'/admin/app.js')).status,404);
  assert.equal((await fetch(origin+'/api/me')).status,401);
  const login = await fetch(origin+'/test-login',{redirect:'manual'});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  async function call(route,method='GET',body,csrf=true) {
    const response = await fetch(origin+route,{method,headers:{Cookie:cookie,...(body ? {'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':'dashboard-test-csrf'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  const me = await call('/api/me');assert.equal(me.status,200);assert.equal(me.data.owner,true);assert.equal(me.data.guilds.length,1);
  const guild = '/api/guilds/223456789012345678';
  const directory = await call(guild+'/directory');assert.equal(directory.status,200);assert.equal(directory.data.directory.channels[0].name,'general');
  const blocked = await call(guild+'/config','PATCH',{leveling:{xp:{cooldownSeconds:0}}},false);assert.equal(blocked.status,403);
  const saved = await call(guild+'/config','PATCH',{leveling:{xp:{cooldownSeconds:0}},counting:{channelId:'323456789012345678'},games:{lotteryChannelId:'323456789012345678'}});
  assert.equal(saved.status,200);assert.equal(saved.data.config.leveling.xp.cooldownSeconds,0);assert.equal(saved.data.config.counting.channelId,'323456789012345678');
  const folder = await call(guild+'/message-template-folders','POST',{name:'Community'});assert.equal(folder.status,201);
  const template = await call(guild+'/message-templates','POST',{name:'Welcome',content:'Hello {user}!'});assert.equal(template.status,201);
  const id = template.data.item.id;
  const updated = await call(`${guild}/message-templates/${id}`,'PATCH',{name:'Updated welcome'});
  assert.equal(updated.status,200); assert.equal(updated.data.item.name,'Updated welcome');
  assert.equal((await call(`${guild}/message-templates/${id}/duplicate`,'POST',{})).status,201);
  assert.equal((await call(`${guild}/message-templates/${id}`,'DELETE',{})).status,200);
  const role = await call(guild+'/reaction-roles','POST',{name:'Community roles'});assert.equal(role.status,201);
  assert.equal((await call(`${guild}/reaction-roles/${role.data.item.id}/duplicate`,'POST',{})).status,201);
  assert.equal((await call(`${guild}/reaction-roles/${role.data.item.id}`,'DELETE',{})).status,200);
  for(const route of ['/api/owner/overview','/api/owner/metrics','/api/owner/console','/api/profile/card','/api/profile/inventory','/api/profile/lottery'])assert.equal((await call(route)).status,200,route);
  const avatar = await fetch(origin+'/bot-avatar.png',{redirect:'manual'});assert.equal(avatar.status,302);assert.equal(avatar.headers.get('location'),'/test-avatar.png');
  assert.equal((await call('/auth/logout','POST',{})).status,200);
  assert.equal((await call('/api/me')).status,401);
});
