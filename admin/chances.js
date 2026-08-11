(() => {
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    accountWrap: $('#accountWrap'), accountMenu: $('#accountMenu'), userChip: $('#userChip'),
    userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'), logoutButton: $('#logoutButton'),
    loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'), chancesShell: $('#chancesShell'),
    profileAvatar: $('#profileAvatar'), profileName: $('#profileName'), luckTier: $('#luckTier'),
    discoverySummary: $('#discoverySummary'), newPlayerNote: $('#newPlayerNote'),
    loadingState: $('#loadingState'), errorState: $('#errorState'), errorMessage: $('#errorMessage'),
    retryButton: $('#retryButton'), cropGrid: $('#cropGrid'),
  };
  let session = null;

  function avatarUrl(user, size = 128) {
    if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user?.id || 0) >> 22n) % 6}.png?size=${size}`;
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.method && options.method !== 'GET' && session?.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function renderSignedIn(user) {
    const name = user.globalName || user.username;
    elements.loginPanel.hidden = true;
    elements.chancesShell.hidden = false;
    elements.accountWrap.hidden = false;
    elements.logoutButton.hidden = false;
    elements.sessionLabel.textContent = name;
    elements.userAvatar.src = avatarUrl(user, 64);
    elements.userAvatar.alt = `${name} avatar`;
    elements.profileAvatar.src = avatarUrl(user, 256);
    elements.profileAvatar.alt = `${name} avatar`;
    elements.profileName.textContent = name;
  }

  function chanceValue(label, chance) {
    const wrap = document.createElement('div');
    wrap.className = 'chance-value';
    const caption = document.createElement('span');
    caption.textContent = label;
    const oneIn = document.createElement('strong');
    oneIn.textContent = chance?.oneIn || '???';
    const percentage = document.createElement('small');
    percentage.textContent = chance?.percentage || '???';
    wrap.append(caption, oneIn, percentage);
    return wrap;
  }

  function cropCard(crop) {
    const article = document.createElement('article');
    article.className = `crop-chance-card${crop.discovered ? '' : ' unknown'}${crop.rainbowOutline ? ' rainbow' : ''}`;
    article.style.setProperty('--card-outline', crop.discovered ? crop.outlineColor : 'rgba(255,255,255,.2)');
    article.setAttribute('aria-label', crop.discovered ? `${crop.name} crop chance comparison` : 'Unknown crop chance');
    const upper = document.createElement('div');
    upper.className = 'chance-card-upper';
    const stage = document.createElement('div');
    stage.className = 'chance-art-stage';
    const image = document.createElement('img');
    image.src = crop.artworkUrl;
    image.alt = crop.discovered ? crop.name : 'Unknown crop';
    stage.append(image);
    upper.append(stage);
    const info = document.createElement('div');
    info.className = 'chance-card-info';
    const title = document.createElement('div');
    title.className = 'chance-card-title';
    const heading = document.createElement('h2');
    heading.textContent = crop.discovered ? crop.name : '???';
    const rarity = document.createElement('span');
    rarity.textContent = crop.discovered ? crop.rarity : '???';
    title.append(heading, rarity);
    const comparison = document.createElement('div');
    comparison.className = 'chance-comparison';
    const change = document.createElement('span');
    change.className = 'chance-change';
    change.textContent = crop.discovered ? crop.change : '???';
    comparison.append(
      chanceValue('Base chance', crop.discovered ? crop.baseChance : null),
      change,
      chanceValue('Your chance', crop.discovered ? crop.currentChance : null),
    );
    info.append(title, comparison);
    article.append(upper, info);
    return article;
  }

  function renderProfile(profile) {
    elements.luckTier.textContent = `Tier ${profile.luckTier}`;
    elements.discoverySummary.textContent = `Discovered ${profile.discoveredCount}/${profile.visibleTotal}`;
    elements.newPlayerNote.hidden = profile.discoveredCount !== 0;
    elements.cropGrid.replaceChildren(...profile.crops.map(cropCard));
    elements.loadingState.hidden = true;
    elements.errorState.hidden = true;
    elements.cropGrid.hidden = false;
  }

  async function loadChances() {
    elements.loadingState.hidden = false;
    elements.errorState.hidden = true;
    elements.cropGrid.hidden = true;
    try {
      renderProfile(await api('/api/profile/crop-chances'));
    } catch (error) {
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = error.status === 401 ? 'Your session expired. Sign in again.' : error.message;
    }
  }

  async function start() {
    try {
      session = await api('/api/me');
      renderSignedIn(session.user);
      await loadChances();
    } catch (error) {
      session = null;
      elements.loginPanel.hidden = false;
      elements.chancesShell.hidden = true;
      elements.loginStatus.textContent = error.status === 401 ? 'Sign in to see your personal crop chances.' : error.message;
    }
  }

  elements.retryButton.addEventListener('click', loadChances);
  elements.userChip.addEventListener('click', () => {
    const open = elements.accountMenu.hidden;
    elements.accountMenu.hidden = !open;
    elements.userChip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!elements.accountWrap.contains(event.target)) {
      elements.accountMenu.hidden = true;
      elements.userChip.setAttribute('aria-expanded', 'false');
    }
  });
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/chances');
  });
  start();
})();
