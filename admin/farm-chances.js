(() => {
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    accountWrap: $('#accountWrap'), accountMenu: $('#accountMenu'), userChip: $('#userChip'),
    userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'), logoutButton: $('#logoutButton'),
    loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'), chancesShell: $('#chancesShell'),
    profileAvatar: $('#profileAvatar'), profileName: $('#profileName'), realLuck: $('#realLuck'),
    discoverySummary: $('#discoverySummary'), newPlayerNote: $('#newPlayerNote'),
    loadingState: $('#loadingState'), errorState: $('#errorState'), errorMessage: $('#errorMessage'),
    retryButton: $('#retryButton'), cropGrid: $('#cropGrid'), luckInput: $('#luckInput'),
    decreaseLuck: $('#decreaseLuck'), increaseLuck: $('#increaseLuck'), useMyLuck: $('#useMyLuck'),
    previewValue: $('#previewValue'), luckError: $('#luckError'),
  };
  let session = null;
  let currentMultiplier = '1';
  let latestRequest = 0;
  let controller = null;
  let debounceTimer = null;

  function avatarUrl(user, size = 128) {
    if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user?.id || 0) >> 22n) % 6}.png?size=${size}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function validMultiplier(value) {
    const source = String(value || '').trim();
    if (!/^[1-9]\d*$/.test(source)) return { error: 'Enter a positive whole number without signs, decimals, or exponents.' };
    if (source.length > 1_000) return { error: 'Preview Luck can contain at most 1,000 digits.' };
    return { value: source };
  }

  function renderSignedIn(user) {
    const name = user.globalName || user.username;
    elements.loginPanel.hidden = true; elements.chancesShell.hidden = false;
    elements.accountWrap.hidden = false; elements.logoutButton.hidden = false;
    elements.sessionLabel.textContent = name; elements.profileName.textContent = name;
    elements.userAvatar.src = avatarUrl(user, 64); elements.userAvatar.alt = `${name} avatar`;
    elements.profileAvatar.src = avatarUrl(user, 256); elements.profileAvatar.alt = `${name} avatar`;
  }

  function chanceValue(label, chance) {
    const wrapper = document.createElement('div'); wrapper.className = 'farm-chance-value';
    const caption = document.createElement('span'); caption.textContent = label;
    const ratio = document.createElement('strong'); ratio.textContent = chance?.oneIn || '???';
    const percentage = document.createElement('small'); percentage.textContent = chance?.percentage || '???';
    wrapper.append(caption, ratio, percentage); return wrapper;
  }

  function cropCard(crop) {
    const article = document.createElement('article');
    article.className = `farm-chance-card${crop.discovered ? '' : ' unknown'}${crop.rainbowOutline ? ' rainbow' : ''}`;
    article.style.setProperty('--card-outline', crop.discovered ? crop.outlineColor : 'rgba(255,255,255,.2)');
    article.setAttribute('aria-label', crop.discovered ? `${crop.name} Farming chance comparison` : 'Unknown crop chance');
    const art = document.createElement('div'); art.className = 'farm-card-art';
    const stage = document.createElement('div'); stage.className = 'farm-art-stage';
    const image = document.createElement('img'); image.src = crop.artworkUrl; image.alt = crop.discovered ? crop.name : 'Unknown crop';
    stage.append(image); art.append(stage);
    const details = document.createElement('div'); details.className = 'farm-card-details';
    const title = document.createElement('div'); title.className = 'farm-card-title';
    const heading = document.createElement('h2'); heading.textContent = crop.discovered ? crop.name : '???';
    const rarity = document.createElement('span'); rarity.textContent = crop.discovered ? crop.rarity : '???'; title.append(heading, rarity);
    const comparison = document.createElement('div'); comparison.className = 'farm-card-comparison';
    const change = document.createElement('span'); change.className = 'farm-change'; change.textContent = crop.discovered ? crop.change : '???';
    comparison.append(chanceValue('Base chance', crop.discovered ? crop.baseChance : null), change, chanceValue('Preview chance', crop.discovered ? crop.previewChance : null));
    details.append(title, comparison);
    if (crop.secretNotice) { const notice = document.createElement('small'); notice.className = 'secret-notice'; notice.textContent = crop.secretNotice; details.append(notice); }
    article.append(art, details); return article;
  }

  function renderProfile(profile) {
    currentMultiplier = profile.currentMultiplier;
    elements.realLuck.textContent = `×${profile.currentMultiplier}`;
    elements.previewValue.textContent = `×${profile.previewMultiplier}`;
    elements.discoverySummary.textContent = `Discovered ${profile.discoveredCount}/${profile.visibleTotal}`;
    elements.newPlayerNote.hidden = profile.discoveredCount !== 0;
    elements.cropGrid.replaceChildren(...profile.crops.map(cropCard));
    elements.loadingState.hidden = true; elements.errorState.hidden = true; elements.cropGrid.hidden = false;
  }

  async function loadChances(multiplier, showLoading = false) {
    const request = ++latestRequest;
    controller?.abort(); controller = new AbortController();
    if (showLoading) { elements.loadingState.hidden = false; elements.cropGrid.hidden = true; }
    elements.errorState.hidden = true;
    try {
      const suffix = multiplier ? `?luck=${encodeURIComponent(multiplier)}` : '';
      const profile = await api(`/api/profile/farming-crop-chances${suffix}`, { signal: controller.signal });
      if (request !== latestRequest) return;
      elements.luckInput.value = profile.previewMultiplier;
      elements.luckError.textContent = '';
      renderProfile(profile);
    } catch (error) {
      if (error.name === 'AbortError' || request !== latestRequest) return;
      elements.loadingState.hidden = true; elements.errorState.hidden = false;
      elements.errorMessage.textContent = error.status === 401 ? 'Your session expired. Sign in again.' : error.message;
    }
  }

  function schedulePreview(value, immediate = false) {
    clearTimeout(debounceTimer);
    const parsed = validMultiplier(value);
    if (parsed.error) { elements.luckError.textContent = parsed.error; return; }
    elements.luckError.textContent = ''; elements.previewValue.textContent = `×${parsed.value}`;
    debounceTimer = setTimeout(() => loadChances(parsed.value), immediate ? 0 : 220);
  }

  async function start() {
    try { session = await api('/api/me'); renderSignedIn(session.user); await loadChances('', true); }
    catch (error) { session = null; elements.loginPanel.hidden = false; elements.chancesShell.hidden = true; elements.loginStatus.textContent = error.status === 401 ? 'Sign in to preview your Farming crop chances.' : error.message; }
  }

  elements.luckInput.addEventListener('input', () => schedulePreview(elements.luckInput.value));
  elements.decreaseLuck.addEventListener('click', () => { const parsed = validMultiplier(elements.luckInput.value); if (parsed.error) return schedulePreview(elements.luckInput.value); const next = BigInt(parsed.value) > 1n ? BigInt(parsed.value) - 1n : 1n; elements.luckInput.value = String(next); schedulePreview(next, true); });
  elements.increaseLuck.addEventListener('click', () => { const parsed = validMultiplier(elements.luckInput.value); if (parsed.error) return schedulePreview(elements.luckInput.value); const next = BigInt(parsed.value) + 1n; elements.luckInput.value = String(next); schedulePreview(next, true); });
  elements.useMyLuck.addEventListener('click', () => { elements.luckInput.value = currentMultiplier; schedulePreview(currentMultiplier, true); });
  elements.retryButton.addEventListener('click', () => schedulePreview(elements.luckInput.value, true));
  elements.userChip.addEventListener('click', () => { const open = elements.accountMenu.hidden; elements.accountMenu.hidden = !open; elements.userChip.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', (event) => { if (!elements.accountWrap.contains(event.target)) { elements.accountMenu.hidden = true; elements.userChip.setAttribute('aria-expanded', 'false'); } });
  elements.logoutButton.addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null); location.assign('/farm-chances'); });
  start();
})();
