const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const esbuild = require('esbuild');

test('committed dashboard bundle matches the feature source', () => {
  const options = require('../admin/build.cjs');
  const built = esbuild.buildSync({...options,write:false,logLevel:'silent'}).outputFiles[0].text;
  assert.equal(fs.readFileSync(options.outfile,'utf8').replaceAll('\r\n','\n'),built);
});

function transport(fetch) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector,{dataset:{},hidden:true,disabled:false,textContent:''});
    return nodes.get(selector);
  };
  const built = esbuild.buildSync({stdin:{contents:"export { api } from './http.js'; export { state } from './state.js';",resolveDir:path.join(__dirname,'../admin/client')},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'}).outputFiles[0].text;
  const sandbox = {module:{exports:{}},exports:{},window:{},document:{querySelector:node,getElementById:id=>node('#'+id)},fetch,Headers,AbortSignal,URL,console};
  vm.runInNewContext(built,sandbox);
  const api = sandbox.module.exports.api;
  const state = sandbox.module.exports.state;
  state.csrfToken = 'session-csrf';state.guilds = [{id:'server'}];state.me = {user:{id:'member'}};
  return {api,state,node};
}

test('mutations keep CSRF and same-origin credentials and prevent switching until response completes',async()=>{
  let finish,options;
  const fixture = transport((url,request)=>{options=request;return new Promise(resolve=>{finish=resolve;});});
  const request = fixture.api('/api/guilds/server/config',{method:'PATCH',body:'{}'});
  assert.equal(fixture.node('#guildSelect').disabled,true);
  assert.equal(options.headers.get('X-CSRF-Token'),'session-csrf');
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  finish(new Response('{"ok":true}',{status:200}));
  assert.equal((await request).ok,true);
  assert.equal(fixture.node('#guildSelect').disabled,false);assert.equal(fixture.state.pendingWrites,0);
});

test('expired sessions retain unsaved state and expose recovery without replaying writes',async()=>{
  let calls=0;
  const fixture = transport(async()=>{calls++;return new Response('{"error":"Not logged in"}',{status:401});});
  fixture.state.config = {unsaved:'keep me'};
  await assert.rejects(fixture.api('/api/profile/card',{method:'PATCH',body:'{}'}),/session expired/);
  assert.equal(fixture.state.config.unsaved,'keep me');assert.equal(fixture.node('#sessionRecovery').hidden,false);
  assert.equal(fixture.state.pendingWrites,0);assert.equal(calls,1);
});

test('network failures produce a usable error and release disabled controls',async()=>{
  const fixture = transport(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(fixture.api('/api/guilds/server/config',{method:'PATCH',body:'{}'}),/Check your connection/);
  assert.equal(fixture.node('#connectionState').dataset.state,'error');
  assert.equal(fixture.node('#guildSelect').disabled,false);
});
