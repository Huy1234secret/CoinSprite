(function dashboardUpgrade() {
  const nativeFetch = window.fetch.bind(window);
  const state = {
    directory: { channels: [], categories: [] },
    xpIds: [], savedXpIds: [], gameChannel: '', savedGameChannel: '',
    gameEnabled: false, savedGameEnabled: false, dirty: false, reloaded: false,
  };
  const EMOJI_CATEGORIES = {
    recent: { icon: '☺', label: 'Frequently used', emojis: ['✅','❌','⚠️','🎫','🎟️','🔒','📩','📢','🔔','🎁','🏆','🔥','✨','👍','❤️'] },
    faces: { icon: '😀', label: 'Smileys and emotion', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫡','🤭','🫢','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🤢','🤮','🤧','😷','🤒','🤕','😈','👿','💀','☠️','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
    people: { icon: '👋', label: 'People and body', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🫀','🫁','🦷','👀','👁️','👅','👄','🫦','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','👷','💂','🕵️','👩‍⚕️','👩‍🎓','👩‍🏫','👩‍⚖️','👩‍🌾','👩‍🍳','👩‍🔧','👩‍💻','👩‍🎤','👩‍🎨','👩‍✈️','👩‍🚀','👩‍🚒','🥷','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟'] },
    nature: { icon: '🌿', label: 'Animals and nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🕷️','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐠','🐟','🐡','🐬','🐳','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐐','🦌','🐕','🐈','🪶','🌵','🎄','🌲','🌳','🌴','🪴','🌱','🌿','☘️','🍀','🎍','🪹','🍄','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','☀️','🌤️','⛅','🌧️','⛈️','🌈','❄️','☃️','💨','💧','🌊'] },
    food: { icon: '🍜', label: 'Food and drink', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🍸','🍹'] },
    activities: { icon: '🎮', label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🧩'] },
    travel: { icon: '🚲', label: 'Travel and places', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🛟','⛽','🚧','🚦','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️'] },
    objects: { icon: '🛠️', label: 'Objects', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','🛡️','🔮','📿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🚪','🪞','🪟','🛏️','🪑','🚿','🛁','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🎁','🎈','🎀','🪄','🪅','🎊','🎉','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'] },
    symbols: { icon: '♥', label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','🔀','🔁','🔂','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝'] },
    flags: { icon: '🏳️', label: 'Flags', emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇺🇳','🇺🇸','🇨🇦','🇲🇽','🇧🇷','🇦🇷','🇬🇧','🇮🇪','🇫🇷','🇩🇪','🇪🇸','🇮🇹','🇵🇹','🇳🇱','🇧🇪','🇨🇭','🇦🇹','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇺🇦','🇷🇺','🇹🇷','🇸🇦','🇦🇪','🇮🇳','🇵🇰','🇧🇩','🇱🇰','🇨🇳','🇭🇰','🇹🇼','🇯🇵','🇰🇷','🇸🇬','🇲🇾','🇹🇭','🇻🇳','🇵🇭','🇮🇩','🇦🇺','🇳🇿','🇿🇦','🇪🇬','🇳🇬','🇰🇪'] },
  };

  function splitXp(config) {
    const xp = config?.xp || {};
    const minXp = Number(xp.messageXpMin) || 0;
    const maxXp = Math.max(minXp, Number(xp.messageXpMax) || minXp);
    const cooldownMs = Math.max(0, Number(xp.messageCooldownMs) || 0);
    const normalize = (raw) => {
      const channelId = String(typeof raw === 'string' ? raw : raw?.channelId || raw?.id || '');
      return channelId ? { channelId, minXp: Number(raw?.minXp ?? minXp), maxXp: Number(raw?.maxXp ?? maxXp), cooldownMs: Number(raw?.cooldownMs ?? cooldownMs) } : null;
    };
    const overrides = Array.isArray(xp.channelOverrides) ? xp.channelOverrides.map(normalize).filter(Boolean) : (xp.channels || []).map((raw) => ({ raw, rule: normalize(raw) })).filter(({ raw, rule }) => rule && typeof raw !== 'string' && (rule.minXp !== minXp || rule.maxXp !== maxXp || rule.cooldownMs !== cooldownMs)).map(({ rule }) => rule);
    const overrideIds = new Set(overrides.map((rule) => rule.channelId));
    return { ids: [...new Set((xp.channels || []).map((raw) => normalize(raw)?.channelId).filter((id) => id && !overrideIds.has(id)))], overrides };
  }
  function responseWithJson(response, value) {
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
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
      body.xp.channels = [...state.xpIds, ...overrides.filter((rule) => rule?.channelId && !state.xpIds.includes(String(rule.channelId)))];
      delete body.xp.channelOverrides;
      body.channels.wordChain = state.gameEnabled ? state.gameChannel : '';
      delete body.inviteRewards;
      options = { ...init, body: JSON.stringify(body) };
    }
    const response = await nativeFetch(input, options);
    if (!response.ok) return response;
    if (/\/directory$/.test(url)) {
      const payload = await response.json(); state.directory = payload.directory || state.directory; setTimeout(renderDashboard, 0); return responseWithJson(response, payload);
    }
    if (configRequest) {
      const payload = await response.json(); const split = splitXp(payload.config);
      state.xpIds = split.ids; state.savedXpIds = [...split.ids];
      state.gameChannel = String(payload.config?.channels?.wordChain || ''); state.savedGameChannel = state.gameChannel;
      state.gameEnabled = Boolean(payload.config?.wordChain?.enabled ?? state.gameChannel); state.savedGameEnabled = state.gameEnabled; state.dirty = false;
      payload.config.xp.channels = split.overrides; setTimeout(renderDashboard, 0); return responseWithJson(response, payload);
    }
    return response;
  };
  function syncDirty() {
    state.dirty = state.gameEnabled !== state.savedGameEnabled || state.gameChannel !== state.savedGameChannel || JSON.stringify([...state.xpIds].sort()) !== JSON.stringify([...state.savedXpIds].sort());
    if (!state.dirty) return;
    const bar = document.querySelector('#unsavedBar'); const save = document.querySelector('#saveButton'); const label = document.querySelector('#savedState');
    if (bar) bar.hidden = false; if (save) save.disabled = false; if (label) label.textContent = 'Unsaved changes';
  }
  function channelItems(mode) {
    return [...(state.directory.categories || []), ...(state.directory.channels || [])].filter((item) => mode === 'xp' ? item.kind !== 'voice' : ['text','announcement','thread'].includes(item.kind));
  }
  function badge(item) {
    const tag = document.createElement('span'); tag.className = `tag ${item.kind || 'text'}`;
    tag.textContent = item.kind === 'category' ? 'CAT' : item.kind === 'thread' ? 'THR' : item.kind === 'announcement' ? 'ANN' : item.kind === 'forum' ? 'FOR' : '#';
    return tag;
  }
  function token(item) {
    const chip = document.createElement('span'); chip.className = 'token'; chip.append(badge(item));
    const name = document.createElement('span'); name.textContent = `${item.parentName ? `${item.parentName} / ` : ''}${item.name}`; chip.append(name); return chip;
  }
  function picker(mode, multiple, current, change) {
    const options = channelItems(mode); const selected = new Set(current.filter(Boolean).map(String));
    const root = document.createElement('div'); root.className = 'picker';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'picker-button';
    const selectedWrap = document.createElement('span'); selectedWrap.className = 'selected-wrap';
    const chevron = document.createElement('span'); chevron.className = 'chevron'; chevron.textContent = 'v';
    const menu = document.createElement('div'); menu.className = 'picker-menu';
    const search = document.createElement('input'); search.className = 'picker-search'; search.type = 'search'; search.placeholder = 'Search by name or ID'; search.autocomplete = 'off';
    const list = document.createElement('div'); list.className = 'option-list'; menu.append(search, list); button.append(selectedWrap, chevron); root.append(button, menu);
    const find = (id) => options.find((item) => item.id === id) || { id, name: id, kind: 'text', parentName: '' };
    function drawButton() {
      selectedWrap.replaceChildren(); const values = [...selected].map(find);
      if (!values.length) { const empty = document.createElement('span'); empty.className = 'placeholder'; empty.textContent = 'Select a channel'; selectedWrap.append(empty); return; }
      values.slice(0, multiple ? 5 : 1).forEach((item) => selectedWrap.append(token(item)));
      if (values.length > 5) { const more = document.createElement('span'); more.className = 'token'; more.textContent = `+${values.length - 5}`; selectedWrap.append(more); }
    }
    function drawList() {
      const query = search.value.trim().toLowerCase(); list.replaceChildren();
      const filtered = options.filter((item) => !query || `${item.name} ${item.id} ${item.parentName || ''}`.toLowerCase().includes(query));
      if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'empty-option'; empty.textContent = 'No results'; list.append(empty); return; }
      filtered.forEach((item) => {
        const row = document.createElement('button'); row.type = 'button'; row.className = `option${selected.has(item.id) ? ' selected' : ''}`;
        const main = document.createElement('span'); main.className = 'option-main'; main.append(token(item));
        const check = document.createElement('span'); check.className = 'check-mark'; check.textContent = selected.has(item.id) ? 'Selected' : ''; row.append(main, check);
        row.onclick = (event) => { event.stopPropagation(); if (multiple) { if (selected.has(item.id)) selected.delete(item.id); else selected.add(item.id); } else { selected.clear(); selected.add(item.id); } change([...selected]); drawButton(); drawList(); if (!multiple) closeMenu(); setTimeout(syncDirty, 0); };
        list.append(row);
      });
    }
    function closeMenu() { menu.classList.remove('open'); button.classList.remove('open'); }
    button.onclick = (event) => { event.stopPropagation(); const open = !menu.classList.contains('open'); document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open')); document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open')); menu.classList.toggle('open', open); button.classList.toggle('open', open); if (open) { drawList(); search.focus(); requestAnimationFrame(() => positionPicker(menu)); } };
    search.oninput = drawList; drawButton(); return root;
  }
  function positionPicker(menu) {
    const button = menu.closest('.picker')?.querySelector('.picker-button'); if (!button || !menu.classList.contains('open')) return;
    const rect = button.getBoundingClientRect(); const gap = 6; const pad = 12; const below = innerHeight - rect.bottom - pad - gap; const above = rect.top - pad - gap; const up = below < 220 && above > below;
    const width = Math.min(Math.max(rect.width, 320), innerWidth - pad * 2); const height = Math.min(420, Math.max(170, up ? above : below));
    menu.style.width = `${width}px`; menu.style.maxHeight = `${height}px`; menu.style.left = `${Math.min(Math.max(pad, rect.left), innerWidth - width - pad)}px`; menu.style.right = 'auto';
    if (up) { menu.style.top = 'auto'; menu.style.bottom = `${innerHeight - rect.top + gap}px`; } else { menu.style.top = `${rect.bottom + gap}px`; menu.style.bottom = 'auto'; }
  }
  function installTabIcon(tabName, filename, label) {
    const tab = document.querySelector(`.tab[data-tab="${tabName}"]`); if (!tab) return;
    tab.querySelector('.tab-image-icon')?.remove(); const image = document.createElement('img'); image.className = 'tab-image-icon'; image.src = `/images/${filename}`; image.alt = ''; image.title = label; tab.prepend(image);
  }
  function renderDashboard() {
    document.querySelector('[data-tab="invites"]')?.remove(); document.querySelector('[data-panel="invites"]')?.remove();
    installTabIcon('leveling', 'leveling.png', 'Leveling'); installTabIcon('tickets', 'ticket.png', 'Tickets');
    const xpPanel = document.querySelector('[data-leveling-panel="xp"] .panel'); let xpMount = document.querySelector('#xpDefaultChannelsMount');
    if (xpPanel && !xpMount) { const field = document.createElement('div'); field.className = 'picker-field default-xp-destinations'; field.innerHTML = '<span class="field-label">XP channels</span><p>Only messages sent in these channels, categories, or forum threads earn the default XP values.</p><div id="xpDefaultChannelsMount"></div>'; xpPanel.querySelector('.grid')?.before(field); xpMount = field.querySelector('div'); }
    if (xpMount) xpMount.replaceChildren(picker('xp', true, state.xpIds, (ids) => { state.xpIds = ids; }));
    const empty = document.querySelector('#xpEmptyState'); if (empty) empty.textContent = 'No channel overrides. Add one only when a destination should use different XP values.';
    const gamePanel = document.querySelector('[data-panel="games"] .panel'); let controls = document.querySelector('.word-chain-controls');
    if (gamePanel && !controls) { controls = document.createElement('div'); controls.className = 'word-chain-controls'; controls.innerHTML = '<label class="switch-control"><input id="wordChainEnabled" type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span><span>Enabled</span></label><div class="picker-field"><span class="field-label">Game channel</span><div id="wordChainChannelMount"></div></div>'; gamePanel.querySelector('.panel-heading')?.after(controls); }
    const toggle = document.querySelector('#wordChainEnabled'); if (toggle) { toggle.checked = state.gameEnabled; toggle.onchange = (event) => { event.stopPropagation(); state.gameEnabled = toggle.checked; setTimeout(syncDirty, 0); }; }
    const gameMount = document.querySelector('#wordChainChannelMount'); if (gameMount) gameMount.replaceChildren(picker('game', false, [state.gameChannel], (ids) => { state.gameChannel = ids[0] || ''; }));
    document.querySelectorAll('#channelsGrid .picker-field').forEach((field) => { if (/word chain/i.test(field.textContent)) field.hidden = true; }); syncDirty();
  }
  function permissions(scope = document) {
    scope.querySelectorAll('.ticket-modal-head p').forEach((item) => item.remove());
    scope.querySelectorAll('.permission-item:not([data-upgraded])').forEach((item) => { const input = item.querySelector('input[data-permission]'); const title = item.querySelector('span')?.textContent?.trim(); if (!input || !title) return; item.dataset.upgraded = 'true'; const name = document.createElement('span'); name.className = 'permission-name'; name.textContent = title; const buttons = document.createElement('span'); buttons.className = 'permission-state'; buttons.innerHTML = '<button type="button" class="permission-deny" disabled>X</button><button type="button" class="permission-neutral">/</button><button type="button" class="permission-allow">✓</button>'; const refresh = () => { buttons.children[1].classList.toggle('active', !input.checked); buttons.children[2].classList.toggle('active', input.checked); }; buttons.children[1].onclick = () => { input.checked = false; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); }; buttons.children[2].onclick = () => { input.checked = true; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); }; item.replaceChildren(input, name, buttons); refresh(); });
  }
  function emoji(input) {
    if (input.dataset.emojiPicker) return; input.dataset.emojiPicker = 'true';
    const wrap = document.createElement('span'); wrap.className = 'emoji-field'; input.parentNode.insertBefore(wrap,input); wrap.append(input);
    const button = document.createElement('button'); button.type='button'; button.className='emoji-picker-button'; button.textContent='☺'; button.title='Choose emoji';
    const pop = document.createElement('span'); pop.className='emoji-popover'; const side = document.createElement('span'); side.className='emoji-categories';
    const browser = document.createElement('span'); browser.className='emoji-browser'; const search = document.createElement('input'); search.type='search'; search.placeholder='Search emoji'; const grid = document.createElement('span'); grid.className='emoji-grid'; browser.append(search,grid); pop.append(side,browser);
    let active = 'recent';
    function drawCategories() { side.replaceChildren(); Object.entries(EMOJI_CATEGORIES).forEach(([key, category]) => { const item=document.createElement('button'); item.type='button'; item.textContent=category.icon; item.title=category.label; item.classList.toggle('active',key===active); item.onclick=()=>{active=key; search.value=''; drawCategories(); draw();}; side.append(item); }); }
    function draw() { const q=search.value.trim().toLowerCase(); grid.replaceChildren(); const categories=q ? Object.values(EMOJI_CATEGORIES) : [EMOJI_CATEGORIES[active]]; [...new Set(categories.flatMap((category)=>category.emojis))].forEach((value)=>{ if(q && !value.includes(q) && !categories.some((category)=>category.label.toLowerCase().includes(q))) return; const option=document.createElement('button'); option.type='button'; option.textContent=value; option.onclick=()=>{input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); pop.classList.remove('open');}; grid.append(option); }); }
    button.onclick=(event)=>{event.stopPropagation(); document.querySelectorAll('.emoji-popover.open').forEach((node)=>{if(node!==pop)node.classList.remove('open');}); pop.classList.toggle('open'); if(pop.classList.contains('open')){drawCategories();draw();positionEmoji(pop,button);search.focus();}}; search.oninput=draw; wrap.append(button,pop);
  }
  function positionEmoji(pop,button){const rect=button.getBoundingClientRect();const width=Math.min(430,innerWidth-24);const height=Math.min(470,innerHeight-24);pop.style.width=`${width}px`;pop.style.maxHeight=`${height}px`;pop.style.left=`${Math.min(Math.max(12,rect.right-width),innerWidth-width-12)}px`;if(innerHeight-rect.bottom<height&&rect.top>innerHeight-rect.bottom){pop.style.top='auto';pop.style.bottom=`${innerHeight-rect.top+6}px`;}else{pop.style.top=`${rect.bottom+6}px`;pop.style.bottom='auto';}}
  function upgradeDynamic(){permissions();document.querySelectorAll('input[data-ticket-field="emoji"],input[data-control-field="emoji"],input[data-option-field="emoji"]').forEach(emoji);}
  new MutationObserver(upgradeDynamic).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',(event)=>{if(!event.target.closest('.picker')){document.querySelectorAll('.picker-menu.open').forEach((menu)=>menu.classList.remove('open'));document.querySelectorAll('.picker-button.open').forEach((node)=>node.classList.remove('open'));}if(!event.target.closest('.emoji-field'))document.querySelectorAll('.emoji-popover.open').forEach((pop)=>pop.classList.remove('open'));});
  document.addEventListener('scroll',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));},true);
  window.addEventListener('resize',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));});
  document.querySelector('#resetTabButton')?.addEventListener('click',()=>{if(!state.dirty)return;state.xpIds=[...state.savedXpIds];state.gameChannel=state.savedGameChannel;state.gameEnabled=state.savedGameEnabled;state.dirty=false;setTimeout(renderDashboard,0);},true);
  window.addEventListener('beforeunload',(event)=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  const timer=setInterval(()=>{const select=document.querySelector('#guildSelect');if(state.reloaded||!select?.value||select.disabled||document.querySelector('#editor')?.hidden)return;state.reloaded=true;select.dispatchEvent(new Event('change',{bubbles:true}));clearInterval(timer);},250);
  upgradeDynamic(); renderDashboard();
}());
