const tokenFromUrl = new URLSearchParams(window.location.search).get('token');
if (tokenFromUrl) {
  localStorage.setItem('coinsprite_click_simulator_token', tokenFromUrl);
  window.history.replaceState({}, document.title, '/click-simulator');
}

const token = tokenFromUrl || localStorage.getItem('coinsprite_click_simulator_token') || '';
const clickCount = document.getElementById('clickCount');
const popupLayer = document.getElementById('popupLayer');
const statusText = document.getElementById('statusText');
const numberFormatter = new Intl.NumberFormat();

let latestClicks = 0;
let clickingEnabled = false;

function setStatus(message) {
  statusText.textContent = message || '';
}

function setClicks(value) {
  latestClicks = Math.max(0, Math.floor(Number(value) || 0));
  clickCount.textContent = numberFormatter.format(latestClicks);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function showRipple(x, y) {
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.setProperty('--x', `${x}px`);
  ripple.style.setProperty('--y', `${y}px`);
  popupLayer.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 480);
}

function showPopup(x, y, award, critical) {
  const popup = document.createElement('span');
  popup.className = `click-popup${critical ? ' critical' : ''}`;
  popup.textContent = critical ? `CRIT +${award}` : `+${award}`;
  popup.style.setProperty('--x', `${x}px`);
  popup.style.setProperty('--y', `${y}px`);
  popup.style.setProperty('--rotate', `${randomBetween(-18, 18).toFixed(2)}deg`);
  popup.style.setProperty('--drift', `${randomBetween(-34, 34).toFixed(2)}px`);
  popupLayer.appendChild(popup);
  window.setTimeout(() => popup.remove(), critical ? 1200 : 900);
}

async function loadStats() {
  if (!token) {
    clickingEnabled = false;
    setStatus('Open this game from the /click-simulator Discord command.');
    return;
  }
  try {
    const payload = await api('/api/click-simulator/me');
    setClicks(payload.stats?.clicks);
    clickingEnabled = true;
    setStatus('Ready.');
  } catch (error) {
    clickingEnabled = false;
    setStatus(error.message || 'Could not load your clicks.');
  }
}

async function handleClick(event) {
  if (!clickingEnabled) return;
  if (event.target.closest('a, button, input, textarea, select')) return;
  const x = event.clientX;
  const y = event.clientY;
  showRipple(x, y);
  try {
    const payload = await api('/api/click-simulator/click', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const stats = payload.stats || {};
    setClicks(stats.clicks);
    showPopup(x, y, stats.award || 1, Boolean(stats.critical));
    setStatus(stats.critical ? 'Critical click!' : '');
  } catch (error) {
    setStatus(error.message || 'Click failed.');
  }
}

document.addEventListener('pointerdown', handleClick, { passive: true });
loadStats();
