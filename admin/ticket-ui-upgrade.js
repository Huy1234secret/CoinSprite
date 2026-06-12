(function dashboardUpgrade() {
  const nativeFetch = window.fetch.bind(window);
  const state = {
    directory: { channels: [], categories: [] },
    xpIds: [], savedXpIds: [],
    gameChannel: '', savedGameChannel: '',
    gameEnabled: false, savedGameEnabled: false,
    dirty: false, reloaded: false,
  };
  const EMOJIS = [
    ['🎫','ticket'],['🎟️','admission'],['✅','approved'],['❌','denied'],['⚠️','warning'],['🔒','lock'],
    ['🔓','unlock'],['🛡️','security'],['📩','mail'],['📢','announcement'],['🔔','notification'],['📝','note'],
    ['📎','attachment'],['🔗','link'],['⚙️','settings'],['🛠️','tools'],['🗑️','delete'],['🔍','search'],
    ['👤','user'],['👥','users'],['💬','chat'],['📞','support'],['🎁','gift'],['🏆','trophy'],
    ['👑','crown'],['💎','diamond'],['🪙','coin'],['🚀','rocket'],['🔥','fire'],['✨','sparkles'],
    ['⭐','star'],['💡','idea'],['👍','yes'],['👎','no'],['❤️','heart'],['🎉','celebrate'],
  ];

  function splitXp(config) {
    const xp = config?.xp || {};
    const minXp = Number(xp.messageXpMin) || 0;
    const maxXp = Math.max(minXp, Number(xp.messageXpMax) || minXp);
    const cooldownMs = Math.max(0, Number(xp.messageCooldownMs) || 0);
    const normalize = (raw) => {
      const channelId = String(typeof raw === 'string' ? raw : raw?.channelId || raw?.id || '');
      return channelId ? {
        channelId,
        minXp: Number(raw?.minXp ?? minXp),
        maxXp: Number(raw?.maxXp ?? maxXp),
        cooldownMs: Number(raw?.cooldownMs ?? cooldownMs),
      } : null;
    };
    const overrides = Array.isArray(xp.channelOverrides)
      ? xp.channelOverrides.map(normalize).filter(Boolean)
      : (xp.channels || []).map((raw) => ({ raw, rule: normalize(raw) }))
        .filter(({ raw, rule }) => rule && typeof raw !== 'string' && (
          rule.minXp !== minXp || rule.maxXp !== maxXp || rule.cooldownMs !== cooldownMs
        )).map(({ rule }) => rule);
    const overrideIds = new Set(overrides.map((rule) => rule.channelId));
    const ids = (xp.channels || []).map((raw) => normalize(raw)?.channelId)
      .filter((id) => id && !overrideIds.has(id));
    return { ids: [...new Set(ids)], overrides };
  }

  function responseWithJson(response, value) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const configRequest = /\/api\/guilds\/\d{16,20}\/config$/.test(url);
    let options = init;
    if (configRequest && method === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      const overrides = Array.isArray(body.xp?.channels) ? body.xp.channels : [];
      body.xp.channels = [
        ...state.xpIds,
        ...overrides.filter((rule) => rule?.channelId && !state.xpIds.includes(String(rule.channelId))),
      ];
      delete body.xp.channelOverrides;
      body.channels.wordChain = state.gameEnabled ? state.gameChannel : '';
      delete body.inviteRewards;
      options = { ...init, body: JSON.stringify(body) };
    }
    const response = await nativeFetch(input, options);
    if (!response.ok) return response;
    if (/\/directory$/.test(url)) {
      const payload = await response.json();
      state.directory = payload.directory || state.directory;
      setTimeout(renderDashboard, 0);
      return responseWithJson(response, payload);
    }
    if (configRequest) {
      const payload = await response.json();
      const split = splitXp(payload.config);
      state.xpIds = split.ids;
      state.savedXpIds = [...split.ids];
      state.gameChannel = String(payload.config?.channels?.wordChain || '');
      state.savedGameChannel = state.gameChannel;
      state.gameEnabled = Boolean(payload.config?.wordChain?.enabled ?? state.gameChannel);
      state.savedGameEnabled = state.gameEnabled;
      state.dirty = false;
      payload.config.xp.channels = split.overrides;
      setTimeout(renderDashboard, 0);
      return responseWithJson(response, payload);
    }
    return response;
  };

  function syncDirty() {
    state.dirty = state.gameEnabled !== state.savedGameEnabled
      || state.gameChannel !== state.savedGameChannel
      || JSON.stringify([...state.xpIds].sort()) !== JSON.stringify([...state.savedXpIds].sort());
    if (!state.dirty) return;
    const bar = document.querySelector('#unsavedBar');
    const save = document.querySelector('#saveButton');
    const label = document.querySelector('#savedState');
    if (bar) bar.hidden = false;
    if (save) save.disabled = false;
    if (label) label.textContent = 'Unsaved changes';
  }

  function items(mode) {
    return [...(state.directory.categories || []), ...(state.directory.channels || [])]
      .filter((item) => mode === 'xp' ? item.kind !== 'voice' : ['text','announcement','thread'].includes(item.kind));
  }

  function picker(mode, multiple, current, change) {
    const chosen = new Set(current.filter(Boolean).map(String));
    const root = document.createElement('div'); root.className = 'upgrade-picker';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'upgrade-picker-button';
    const menu = document.createElement('div'); menu.className = 'upgrade-picker-menu';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search by name or ID';
    const list = document.createElement('div'); list.className = 'upgrade-picker-list';
    menu.append(search, list); root.append(button, menu);
    const label = (item) => `${item.kind === 'category' ? 'CAT' : item.kind === 'thread' ? 'THR' : '#'}  ${item.parentName ? `${item.parentName} / ` : ''}${item.name}`;
    function drawButton() {
      const names = items(mode).filter((item) => chosen.has(item.id)).map((item) => item.name);
      button.textContent = names.length ? (multiple ? `${names.slice(0,3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : names[0]) : 'Select a channel';
    }
    function drawList() {
      const query = search.value.trim().toLowerCase(); list.replaceChildren();
      items(mode).filter((item) => !query || `${item.name} ${item.id} ${item.parentName || ''}`.toLowerCase().includes(query)).forEach((item) => {
        const row = document.createElement('label'); row.className = 'upgrade-picker-option';
        const input = document.createElement('input'); input.type = multiple ? 'checkbox' : 'radio'; input.checked = chosen.has(item.id);
        const text = document.createElement('span'); text.textContent = label(item);
        input.addEventListener('change', (event) => {
          event.stopPropagation();
          if (!multiple) chosen.clear();
          if (input.checked) chosen.add(item.id); else chosen.delete(item.id);
          change([...chosen]); drawButton(); drawList();
          if (!multiple) menu.classList.remove('open');
          setTimeout(syncDirty, 0);
        });
        row.append(input, text); list.append(row);
      });
    }
    button.onclick = (event) => { event.stopPropagation(); menu.classList.toggle('open'); if (menu.classList.contains('open')) { drawList(); search.focus(); } };
    search.oninput = drawList; drawButton(); return root;
  }

  function renderDashboard() {
    document.querySelector('[data-tab="invites"]')?.remove();
    document.querySelector('[data-panel="invites"]')?.remove();
    const xpPanel = document.querySelector('[data-leveling-panel="xp"] .panel');
    let xpMount = document.querySelector('#xpDefaultChannelsMount');
    if (xpPanel && !xpMount) {
      const field = document.createElement('div'); field.className = 'picker-field default-xp-destinations';
      field.innerHTML = '<span class="field-label">XP channels</span><p>Only messages sent in these channels, categories, or forum threads earn the default XP values.</p><div id="xpDefaultChannelsMount"></div>';
      xpPanel.querySelector('.grid')?.before(field); xpMount = field.querySelector('div');
    }
    if (xpMount) xpMount.replaceChildren(picker('xp', true, state.xpIds, (ids) => { state.xpIds = ids; }));
    const empty = document.querySelector('#xpEmptyState');
    if (empty) empty.textContent = 'No channel overrides. Add one only when a destination should use different XP values.';

    const gamePanel = document.querySelector('[data-panel="games"] .panel');
    let controls = document.querySelector('.word-chain-controls');
    if (gamePanel && !controls) {
      controls = document.createElement('div'); controls.className = 'word-chain-controls';
      controls.innerHTML = '<label class="switch-control"><input id="wordChainEnabled" type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span><span>Enabled</span></label><div class="picker-field"><span class="field-label">Game channel</span><div id="wordChainChannelMount"></div></div>';
      gamePanel.querySelector('.panel-heading')?.after(controls);
    }
    const toggle = document.querySelector('#wordChainEnabled');
    if (toggle) {
      toggle.checked = state.gameEnabled;
      toggle.onchange = (event) => { event.stopPropagation(); state.gameEnabled = toggle.checked; setTimeout(syncDirty, 0); };
    }
    const gameMount = document.querySelector('#wordChainChannelMount');
    if (gameMount) gameMount.replaceChildren(picker('game', false, [state.gameChannel], (ids) => { state.gameChannel = ids[0] || ''; }));
    document.querySelectorAll('#channelsGrid .picker-field').forEach((field) => { if (/word chain/i.test(field.textContent)) field.hidden = true; });
    syncDirty();
  }

  function permissions(scope = document) {
    scope.querySelectorAll('.ticket-modal-head p').forEach((item) => item.remove());
    scope.querySelectorAll('.permission-item:not([data-upgraded])').forEach((item) => {
      const input = item.querySelector('input[data-permission]');
      const title = item.querySelector('span')?.textContent?.trim();
      if (!input || !title) return;
      item.dataset.upgraded = 'true';
      const name = document.createElement('span'); name.className = 'permission-name'; name.textContent = title;
      const buttons = document.createElement('span'); buttons.className = 'permission-state';
      buttons.innerHTML = '<button type="button" class="permission-deny" disabled>X</button><button type="button" class="permission-neutral">/</button><button type="button" class="permission-allow">✓</button>';
      const refresh = () => { buttons.children[1].classList.toggle('active', !input.checked); buttons.children[2].classList.toggle('active', input.checked); };
      buttons.children[1].onclick = () => { input.checked = false; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); };
      buttons.children[2].onclick = () => { input.checked = true; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); };
      item.replaceChildren(input, name, buttons); refresh();
    });
  }

  function emoji(input) {
    if (input.dataset.emojiPicker) return;
    input.dataset.emojiPicker = 'true';
    const wrap = document.createElement('span'); wrap.className = 'emoji-field'; input.parentNode.insertBefore(wrap,input); wrap.append(input);
    const button = document.createElement('button'); button.type='button'; button.className='emoji-picker-button'; button.textContent='☺'; button.title='Choose emoji';
    const pop = document.createElement('span'); pop.className='emoji-popover';
    const search = document.createElement('input'); search.type='search'; search.placeholder='Search emoji';
    const grid = document.createElement('span'); grid.className='emoji-grid'; pop.append(search,grid);
    const draw = () => { const q=search.value.toLowerCase(); grid.replaceChildren(); EMOJIS.filter(([e,w])=>!q||`${e} ${w}`.includes(q)).forEach(([e,w])=>{ const option=document.createElement('button'); option.type='button'; option.textContent=e; option.title=w; option.onclick=()=>{ input.value=e; input.dispatchEvent(new Event('input',{bubbles:true})); pop.classList.remove('open'); }; grid.append(option); }); };
    button.onclick=(event)=>{ event.stopPropagation(); pop.classList.toggle('open'); draw(); if(pop.classList.contains('open')) search.focus(); };
    search.oninput=draw; wrap.append(button,pop);
  }

  function upgradeDynamic() {
    permissions();
    document.querySelectorAll('input[data-ticket-field="emoji"],input[data-control-field="emoji"],input[data-option-field="emoji"]').forEach(emoji);
  }
  new MutationObserver(upgradeDynamic).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.upgrade-picker')) document.querySelectorAll('.upgrade-picker-menu.open').forEach((menu)=>menu.classList.remove('open'));
    if (!event.target.closest('.emoji-field')) document.querySelectorAll('.emoji-popover.open').forEach((pop)=>pop.classList.remove('open'));
  });
  document.querySelector('#resetTabButton')?.addEventListener('click',()=>{
    if(!state.dirty)return; state.xpIds=[...state.savedXpIds]; state.gameChannel=state.savedGameChannel; state.gameEnabled=state.savedGameEnabled; state.dirty=false; setTimeout(renderDashboard,0);
  },true);
  window.addEventListener('beforeunload',(event)=>{ if(state.dirty){event.preventDefault();event.returnValue='';} });

  const timer=setInterval(()=>{
    const select=document.querySelector('#guildSelect');
    if(state.reloaded||!select?.value||select.disabled||document.querySelector('#editor')?.hidden)return;
    state.reloaded=true; select.dispatchEvent(new Event('change',{bubbles:true})); clearInterval(timer);
  },250);
  upgradeDynamic(); renderDashboard();
}());
