(function dashboardUpgrade() {
  const nativeFetch = window.fetch.bind(window);
  const state = {
    directory: { channels: [], categories: [] },
    xpIds: [], savedXpIds: [], xpOverrides: [], gameChannel: '', savedGameChannel: '',
    gameEnabled: false, savedGameEnabled: false, dirty: false, reloaded: false,
    configUrl: '', patchStarted: 0, customSaving: false,
  };
  const EMOJI_CATEGORIES = {
    recent: { icon: '☺', label: 'Frequently used', emojis: ['✅','❌','⚠️','🎫','🎟️','🔒','📩','📢','🔔','🎁','🏆','🔥','✨','👍','❤️'] },
    faces: { icon: '😀', label: 'Smileys and emotion', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫡','🤭','🫢','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🤢','🤮','🤧','😷','🤒','🤕','😈','👿','💀','☠️','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
    people: { icon: '👋', label: 'People and body', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🫀','🫁','🦷','👀','👁️','👅','👄','🫦','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','👷','💂','🕵️','👩‍⚕️','👩‍🎓','👩‍🏫','👩‍⚖️','👩‍🌾','👩‍🍳','👩‍🔧','👩‍💻','👩‍🎤','👩‍🎨','👩‍✈️','👩‍🚀','👩‍🚒','🥷','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟'] },
    nature: { icon: '🌿', label: 'Animals and nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🕷️','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐠','🐟','🐡','🐬','🐳','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐐','🦌','🐕','🐈','🪶','🌵','🎄','🌲','🌳','🌴','🪴','🌱','🌿','☘️','🍀','🎍','🪹','🍄','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','☀️','🌤️','⛅','🌧️','⛈️','🌈','❄️','☃️','💨','💧','🌊'] },
    food: { icon: '🍜', label: 'Food and drink', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🍸','🍹'] },
    activities: { icon: '🎮', label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🧩'] },
    travel: { icon: '🚲', label: 'Travel and places', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🛟','⛽','🚧','🚦','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️'] },
    objects: { icon: '🛠️', label: 'Objects', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','🛡️','🔮','📿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🚪','🪞','🪟','🛏️','🪑','🚿','🛁','🧹','🧺','🧻','🪠','🧼','🪥','🧽','🧯','🛒','🎁','🎈','🎀','🪄','🪅','🎊','🎉','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'] },
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
    if (configRequest) state.configUrl = url;
    let options = init;
    if (configRequest && method === 'PATCH' && init.body) {
      state.patchStarted += 1;
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
      state.xpIds = split.ids; state.savedXpIds = [...split.ids]; state.xpOverrides = split.overrides;
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
    button.onclick = (event) => { event.stopPropagation(); const open = !menu.classList.contains('open'); document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open')); document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open')); menu.classList.toggle('open', open); button.classList.toggle('open', open); if (open) { drawList(); search.focus(); positionPicker(menu); } };
    search.onclick = (event) => event.stopPropagation(); search.oninput = drawList; drawButton(); return root;
  }
  function installTabIcon(tabName, filename, label) {
    const tab = document.querySelector(`[data-tab="${tabName}"]`); if (!tab || tab.querySelector('.tab-image-icon')) return;
    tab.querySelector('.tab-icon')?.remove(); const image = document.createElement('img'); image.className = 'tab-image-icon'; image.src = `/images/${filename}`; image.alt = ''; image.title = label; tab.prepend(image);
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
  function permissions() {
    if (!document.querySelector('#ticketEditorRoot .permission-trigger')) return;
    document.querySelectorAll('#ticketEditorRoot .permission-trigger').forEach((button) => { const label = button.closest('label'); if (!label) return; button.textContent = label.textContent.replace(button.textContent, '').trim() || 'Permissions'; label.classList.add('permission-field'); });
  }
  function addEmojiPicker(input) {
    if (!input || input.dataset.enhancedEmoji) return; input.dataset.enhancedEmoji = '1';
    const wrapper = document.createElement('div'); wrapper.className = 'emoji-field'; input.parentNode.insertBefore(wrapper, input); wrapper.append(input);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'emoji-picker-button'; button.textContent = input.value || '☺'; button.title = 'Choose emoji'; wrapper.append(button);
    const popup = document.createElement('div'); popup.className = 'emoji-popover'; popup.innerHTML = '<input class="emoji-search" type="search" placeholder="Search emoji"><div class="emoji-category-tabs"></div><div class="emoji-grid"></div>'; wrapper.append(popup);
    let category = 'recent'; const tabs = popup.querySelector('.emoji-category-tabs'); const grid = popup.querySelector('.emoji-grid'); const search = popup.querySelector('.emoji-search');
    function draw() { const query = search.value.trim().toLowerCase(); grid.replaceChildren(); const entries = query ? Object.values(EMOJI_CATEGORIES).flatMap((item) => item.emojis) : EMOJI_CATEGORIES[category].emojis; [...new Set(entries)].forEach((emoji) => { const option = document.createElement('button'); option.type = 'button'; option.className = 'emoji-option'; option.textContent = emoji; option.onclick = (event) => { event.stopPropagation(); input.value = emoji; button.textContent = emoji; input.dispatchEvent(new Event('input', { bubbles: true })); popup.classList.remove('open'); }; grid.append(option); }); }
    Object.entries(EMOJI_CATEGORIES).forEach(([key, value]) => { const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = value.icon; tab.title = value.label; tab.onclick = (event) => { event.stopPropagation(); category = key; search.value = ''; draw(); }; tabs.append(tab); });
    button.onclick = (event) => { event.stopPropagation(); popup.classList.toggle('open'); if (popup.classList.contains('open')) { draw(); search.focus(); positionEmoji(popup, button); } };
    search.onclick = (event) => event.stopPropagation(); search.oninput = draw;
  }
  function upgradeDynamic() { permissions(); document.querySelectorAll('#ticketEditorRoot input[data-control-field="emoji"],#ticketEditorRoot input[data-ticket-field="emoji"]').forEach(addEmojiPicker); }
  const style = document.createElement('style'); style.textContent = '.default-xp-destinations{margin:16px 0}.tab-image-icon{width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 0 8px currentColor)}.word-chain-controls{display:grid;gap:14px;margin:14px 0}.switch-control{display:flex;align-items:center;gap:10px}.switch-track{width:42px;height:24px;border-radius:99px;background:#2b303b;padding:3px;transition:.2s}.switch-thumb{display:block;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}.switch-control input{display:none}.switch-control input:checked+.switch-track{background:#5865f2}.switch-control input:checked+.switch-track .switch-thumb{transform:translateX(18px)}.emoji-field{position:relative;display:flex;gap:8px}.emoji-field>input{flex:1}.emoji-picker-button{width:44px;border:1px solid #303441;background:#171a21;color:#fff;border-radius:8px;font-size:20px}.emoji-popover{display:none;position:fixed;width:360px;height:390px;background:#111318;border:1px solid #303441;border-radius:10px;padding:10px;z-index:10000;box-shadow:0 18px 50px #0008}.emoji-popover.open{display:flex;flex-direction:column;gap:8px}.emoji-search{width:100%}.emoji-category-tabs{display:flex;overflow-x:auto;gap:3px}.emoji-category-tabs button,.emoji-option{border:0;background:transparent;color:#fff;border-radius:6px;cursor:pointer}.emoji-category-tabs button{font-size:17px;padding:5px}.emoji-category-tabs button:hover,.emoji-option:hover{background:#292d38}.emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;overflow:auto}.emoji-option{font-size:23px;padding:5px}.permission-field .permission-trigger{margin-top:7px;width:100%;text-align:left}@media(max-width:600px){.emoji-popover{width:min(350px,calc(100vw - 20px));height:360px}}'; document.head.append(style);
  document.addEventListener('click', (event) => { if (!event.target.closest('.picker')) document.querySelectorAll('.picker-menu.open,.picker-button.open').forEach((node) => node.classList.remove('open')); if (!event.target.closest('.emoji-field')) document.querySelectorAll('.emoji-popover.open').forEach((node) => node.classList.remove('open')); });
  new MutationObserver(() => { upgradeDynamic(); renderDashboard(); }).observe(document.body, { childList: true, subtree: true });
  function positionFloating(element,anchor,gap=8){const rect=anchor.getBoundingClientRect();const width=element.offsetWidth||360;const height=element.offsetHeight||390;let left=Math.min(Math.max(10,rect.right-width),window.innerWidth-width-10);let top=rect.bottom+gap;if(top+height>window.innerHeight-10&&rect.top-height-gap>=10)top=rect.top-height-gap;top=Math.min(Math.max(10,top),Math.max(10,window.innerHeight-height-10));element.style.left=`${left}px`;element.style.top=`${top}px`;}
  function positionPicker(menu){positionFloating(menu,menu.parentElement.querySelector('.picker-button'),6);}
  function positionEmoji(pop,button){positionFloating(pop,button,8);}
  window.addEventListener('scroll',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));},true);
  window.addEventListener('resize',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));});
  async function saveUpgradeState() {
    if (!state.dirty || state.customSaving || !state.configUrl) return;
    state.customSaving = true;
    const save = document.querySelector('#saveButton');
    const status = document.querySelector('#statusBox');
    if (save) { save.disabled = true; save.textContent = 'Saving...'; }
    if (status) { status.textContent = 'Saving changes...'; status.className = 'status'; }
    try {
      const xpChanged = JSON.stringify([...state.xpIds].sort()) !== JSON.stringify([...state.savedXpIds].sort());
      const gameChanged = state.gameEnabled !== state.savedGameEnabled || state.gameChannel !== state.savedGameChannel;
      const body = {};
      if (xpChanged) body.xp = { channels: [...state.xpIds, ...state.xpOverrides.filter((rule) => rule?.channelId && !state.xpIds.includes(String(rule.channelId)))] };
      if (gameChanged) {
        body.channels = { wordChain: state.gameEnabled ? state.gameChannel : '' };
        body.wordChain = { enabled: state.gameEnabled };
      }
      const response = await nativeFetch(state.configUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
      const split = splitXp(payload.config);
      state.xpIds = split.ids; state.savedXpIds = [...split.ids]; state.xpOverrides = split.overrides;
      state.gameChannel = String(payload.config?.channels?.wordChain || ''); state.savedGameChannel = state.gameChannel;
      state.gameEnabled = Boolean(payload.config?.wordChain?.enabled ?? state.gameChannel); state.savedGameEnabled = state.gameEnabled;
      state.dirty = false;
      const bar = document.querySelector('#unsavedBar');
      const label = document.querySelector('#savedState');
      if (bar) bar.hidden = true;
      if (label) label.textContent = 'Saved';
      if (status) { status.textContent = 'Changes saved.'; status.className = 'status ok'; }
      renderDashboard();
    } catch (error) {
      if (status) { status.textContent = error.message; status.className = 'status error'; }
    } finally {
      state.customSaving = false;
      if (save) { save.disabled = !state.dirty; save.textContent = 'Save changes'; }
    }
  }
  document.querySelector('#saveButton')?.addEventListener('click', () => {
    if (!state.dirty) return;
    const patchStarted = state.patchStarted;
    setTimeout(() => {
      if (state.dirty && state.patchStarted === patchStarted) saveUpgradeState();
    }, 0);
  });
  document.querySelector('#resetTabButton')?.addEventListener('click',()=>{if(!state.dirty)return;state.xpIds=[...state.savedXpIds];state.gameChannel=state.savedGameChannel;state.gameEnabled=state.savedGameEnabled;state.dirty=false;setTimeout(renderDashboard,0);},true);
  window.addEventListener('beforeunload',(event)=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  const timer=setInterval(()=>{const select=document.querySelector('#guildSelect');if(state.reloaded||!select?.value||select.disabled||document.querySelector('#editor')?.hidden)return;state.reloaded=true;select.dispatchEvent(new Event('change',{bubbles:true}));clearInterval(timer);},250);
  upgradeDynamic(); renderDashboard();
}());
