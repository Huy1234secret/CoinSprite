import { elements, state } from './state.js';

/** Same-origin transport. Authentication and authorization stay on the server. */
export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const mutation = !['GET', 'HEAD'].includes(method);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (mutation && state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
  if (mutation) {
    state.pendingWrites = (state.pendingWrites || 0) + 1;
    elements.guildSelect.disabled = true;
  }
  const connection = document.getElementById('connectionState');
  try {
    const response = await fetch(path, {
      ...options, method, headers, credentials: 'same-origin', cache: 'no-store',
      signal: options.signal || AbortSignal.timeout(45000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}). Try again.`);
      error.status = response.status;
      if (response.status === 401 && state.me) {
        error.message = 'Your session expired. Sign in again to continue.';
        document.getElementById('sessionRecovery').hidden = false;
        connection.textContent = 'Session expired';
        connection.dataset.state = 'error';
      }
      throw error;
    }
    connection.textContent = 'Connected to CoinSprite';
    connection.dataset.state = 'ready';
    return payload;
  } catch (error) {
    if (error.status) throw error;
    connection.textContent = 'Connection interrupted';
    connection.dataset.state = 'error';
    throw new Error(error.name === 'TimeoutError'
      ? 'The request timed out. Check the current state before retrying a send or publish.'
      : 'Unable to reach CoinSprite. Check your connection and try again.');
  } finally {
    if (mutation) {
      state.pendingWrites--;
      elements.guildSelect.disabled = state.pendingWrites > 0 || !state.guilds.length;
    }
  }
}
