'use strict';

const requestedCase = new URLSearchParams(location.search);
const state = {
  me: null,
  csrf: '',
  cases: [],
  selected: null,
  requestedGuildId: requestedCase.get('guild') || '',
  requestedCaseId: requestedCase.get('case') || '',
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const date = (value) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Never';

let toastTimer = null;

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = error ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = ''; }, 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function avatar(user) {
  return user?.avatar
    ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64'
    : '/bot-avatar.png';
}

function statusOf(item) {
  const latest = item.appeals[0];
  if (item.case.status === 'pardoned' || latest?.status === 'accepted') return { label: 'Resolved', className: 'resolved' };
  if (['pending', 'processing'].includes(latest?.status)) return { label: 'Pending', className: 'pending' };
  if (!item.case.appealable) return { label: 'Unappealable', className: 'blocked' };
  if (!item.eligibility.allowed) return { label: String(item.eligibility.code || 'Blocked'), className: 'blocked' };
  return { label: 'Appealable', className: 'appealable' };
}

function renderAccount() {
  const user = state.me;
  if (!user) {
    $('#account').innerHTML = '';
    return;
  }
  $('#account').innerHTML = '<div class="account"><img src="' + esc(avatar(user)) + '" alt=""><span>' + esc(user.globalName || user.username) + '</span><button id="logout">Log out</button></div>';
  $('#logout').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };
}

function selectCase(index, updateUrl = true) {
  state.selected = index;
  const item = state.cases[index];
  if (updateUrl && item) {
    const url = new URL(location.href);
    url.searchParams.set('guild', item.guildId);
    url.searchParams.set('case', item.case.id);
    history.replaceState(null, '', url);
  }
  renderList();
  renderDetail();
}

function renderList() {
  const list = $('#case-list');
  $('#case-count').textContent = state.cases.length + ' moderation case' + (state.cases.length === 1 ? '' : 's');
  if (!state.cases.length) {
    list.innerHTML = '<div class="empty">No moderation cases</div>';
    $('#case-detail').innerHTML = '<div class="empty">No cases available</div>';
    return;
  }
  list.innerHTML = state.cases.map((item, index) => {
    const status = statusOf(item);
    return '<button class="case-card ' + (status.className === 'blocked' ? 'disabled ' : '') + (state.selected === index ? 'active' : '') + '" data-index="' + index + '">'
      + '<div class="case-card-top"><span class="case-id">' + esc(item.case.id) + '</span><span class="badge ' + status.className + '">' + esc(status.label) + '</span></div>'
      + '<div class="guild">' + esc(item.guildName) + '</div>'
      + '<div class="case-meta"><span>' + esc(item.case.type.replace('_', ' ')) + '</span><span>' + esc(date(item.case.createdAt)) + '</span></div></button>';
  }).join('');
  list.querySelectorAll('.case-card').forEach((button) => {
    button.onclick = () => selectCase(Number(button.dataset.index));
  });
}

function info(label, value, wide = false) {
  return '<div class="info ' + (wide ? 'wide' : '') + '"><span class="label">' + esc(label) + '</span><div class="value">' + esc(value || 'None') + '</div></div>';
}

function fieldHtml(field) {
  const id = 'field-' + field.id;
  const required = field.required ? ' required' : '';
  const note = field.description ? '<small>' + esc(field.description) + '</small>' : '';
  const label = esc(field.label) + (field.required ? ' *' : '');
  if (field.type === 'text') {
    const input = field.style === 'paragraph'
      ? '<textarea id="' + id + '" data-field="' + esc(field.id) + '" placeholder="' + esc(field.placeholder || '') + '" minlength="' + field.minLength + '" maxlength="' + field.maxLength + '"' + required + '></textarea>'
      : '<input type="text" id="' + id + '" data-field="' + esc(field.id) + '" placeholder="' + esc(field.placeholder || '') + '" minlength="' + field.minLength + '" maxlength="' + field.maxLength + '"' + required + '>';
    return '<div class="field"><label for="' + id + '">' + label + '</label>' + note + input + '</div>';
  }
  if (field.type === 'number') {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' + note
      + '<input type="number" id="' + id + '" data-field="' + esc(field.id) + '" placeholder="' + esc(field.placeholder || '') + '" step="' + field.step + '" '
      + (field.minimum == null ? '' : 'min="' + field.minimum + '" ') + (field.maximum == null ? '' : 'max="' + field.maximum + '" ') + required + '></div>';
  }
  if (field.type === 'choice') {
    return '<fieldset class="field" data-field="' + esc(field.id) + '"><legend>' + label + '</legend>' + note
      + field.options.map((option) => '<label class="choice"><input type="' + (field.multiple ? 'checkbox' : 'radio') + '" name="' + id + '" value="' + esc(option.id) + '"><span>' + esc(option.label) + '</span></label>').join('') + '</fieldset>';
  }
  if (field.type === 'checkbox') {
    return '<fieldset class="field" data-field="' + esc(field.id) + '"><legend>' + label + '</legend>' + note
      + field.options.map((option) => '<label class="choice"><input type="checkbox" data-exclusive-choice name="' + id + '" value="' + esc(option.id) + '" ' + (field.defaultOptionId === option.id ? 'checked' : '') + '><span>' + esc(option.label) + '</span></label>').join('') + '</fieldset>';
  }
  return '<div class="field"><label for="' + id + '">' + label + '</label>' + note
    + '<input type="file" id="' + id + '" data-field="' + esc(field.id) + '" ' + (field.maxFiles > 1 ? 'multiple ' : '')
    + (field.allowedExtensions?.length ? 'accept="' + field.allowedExtensions.map((extension) => '.' + extension).join(',') + '" ' : '') + required + '>'
    + '<small>Up to ' + field.maxFiles + ' file' + (field.maxFiles === 1 ? '' : 's') + ', ' + field.maxFileSizeMb + ' MB each</small></div>';
}

function mediaGallery(files = []) {
  if (!files.length) return '';
  return '<div class="evidence-gallery">' + files.map((file) => {
    if (/^image\//i.test(String(file.contentType || ''))) {
      return '<a class="evidence-image" href="' + esc(file.url) + '" target="_blank" rel="noopener"><img src="' + esc(file.url) + '" alt="' + esc(file.name) + '"><span>' + esc(file.name) + '</span></a>';
    }
    return '<a class="file" href="' + esc(file.url) + '" target="_blank" rel="noopener">' + esc(file.name) + '</a>';
  }).join('') + '</div>';
}

function blockText(item) {
  const code = item.eligibility.code;
  if (code === 'unappealable') return 'This case is not appealable.';
  if (code === 'pending') return 'An appeal is awaiting review.';
  if (code === 'resolved') return 'This case has been resolved.';
  if (code === 'maximum') return 'The submission limit has been reached.';
  if (code === 'cooldown') return 'Another appeal can be submitted after ' + date(item.eligibility.retryAt) + '.';
  if (code === 'disabled') return 'Appeals are not available for this server.';
  return 'This case cannot receive an appeal.';
}

function historyHtml(item) {
  if (!item.appeals.length) return '';
  return '<section class="history"><div class="section-heading"><div><span class="eyebrow">Previous submissions</span><h3>Appeal history</h3></div></div>'
    + item.appeals.map((appeal) => '<article class="history-item ' + esc(appeal.status) + '"><div><strong>' + esc(appeal.id) + ' · ' + esc(appeal.status.toUpperCase()) + '</strong><span>' + esc(date(appeal.createdAt)) + '</span></div>'
      + (appeal.decisionReason ? '<p>' + esc(appeal.decisionReason) + '</p>' : '') + mediaGallery(appeal.attachments || []) + '</article>').join('') + '</section>';
}

function renderDetail() {
  const item = state.cases[state.selected];
  if (!item) return;
  const moderationCase = item.case;
  const author = moderationCase.author
    ? (moderationCase.author.globalName || moderationCase.author.username) + ' (' + moderationCase.author.id + ')'
    : moderationCase.authorId || 'Unknown';
  const evidence = moderationCase.attachments?.length
    ? mediaGallery(moderationCase.attachments)
    : moderationCase.evidenceUrl
      ? '<a class="file" href="' + esc(moderationCase.evidenceUrl) + '" target="_blank" rel="noopener">Open evidence</a>'
      : '<span class="muted-value">No evidence attached</span>';
  const form = item.eligibility.allowed
    ? '<form id="appeal-form" class="appeal-form"><div class="section-heading"><div><span class="eyebrow">Case ' + esc(moderationCase.id) + '</span><h2>Submit an appeal</h2><p>Explain what staff should reconsider. Your answers and uploads are sent to the review channel.</p></div></div>' + item.form.map(fieldHtml).join('') + '<button class="primary submit-appeal" type="submit">Submit appeal</button></form>'
    : '<div class="appeal-form"><div class="blocked-message">' + esc(blockText(item)) + '</div></div>';
  const status = statusOf(item);
  $('#case-detail').innerHTML = '<div class="detail-head"><div><span class="eyebrow">' + esc(item.guildName) + '</span><h2>' + esc(moderationCase.id) + '</h2><p>' + esc(moderationCase.type.replace('_', ' ')) + ' · issued ' + esc(date(moderationCase.createdAt)) + '</p></div><span class="badge ' + status.className + '">' + esc(status.label) + '</span></div>'
    + '<div class="info-grid">' + info('Author', author) + info('Punishment', moderationCase.type.replace('_', ' ')) + info('Issued', date(moderationCase.createdAt)) + info('Expires', date(moderationCase.expiresAt)) + info('Reason', moderationCase.reason, true) + info('Evidence', '', true) + info('Moderator note', moderationCase.publicNote || 'None', true) + '</div>'
    + form + historyHtml(item);
  const evidenceInfo = [...$('#case-detail').querySelectorAll('.info .label')].find((label) => label.textContent === 'Evidence')?.nextElementSibling;
  if (evidenceInfo) evidenceInfo.innerHTML = evidence;
  const formElement = $('#appeal-form');
  if (formElement) formElement.onsubmit = (event) => submit(event, item);
}

document.addEventListener('change', (event) => {
  if (!event.target.matches?.('[data-exclusive-choice]') || !event.target.checked) return;
  const form = event.target.form || event.target.closest('form');
  form?.querySelectorAll('[name="' + CSS.escape(event.target.name) + '"][data-exclusive-choice]').forEach((input) => {
    if (input !== event.target) input.checked = false;
  });
});

async function submit(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const answers = {};
  const data = new FormData();
  for (const field of item.form) {
    if (field.type === 'choice' || field.type === 'checkbox') {
      answers[field.id] = [...form.querySelectorAll('[name="field-' + CSS.escape(field.id) + '"]:checked')].map((element) => element.value);
      if (field.type === 'checkbox' || !field.multiple) answers[field.id] = answers[field.id][0] || '';
    } else {
      const input = form.querySelector('[data-field="' + CSS.escape(field.id) + '"]');
      if (field.type === 'file') {
        for (const file of input.files) data.append('file:' + field.id, file, file.name);
      } else {
        answers[field.id] = input.value;
      }
    }
  }
  data.append('answers', JSON.stringify(answers));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Submitting...';
  try {
    await api('/api/appeal/guilds/' + item.guildId + '/cases/' + encodeURIComponent(item.case.id) + '/submissions', {
      method: 'POST',
      headers: { 'X-CSRF-Token': state.csrf },
      body: data,
    });
    toast('Appeal submitted.');
    await loadCases();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = 'Submit appeal';
  }
}

async function loadCases() {
  const result = await api('/api/appeal/cases');
  state.cases = result.cases;
  const requestedIndex = state.cases.findIndex((item) => (
    (!state.requestedGuildId || item.guildId === state.requestedGuildId)
    && (!state.requestedCaseId || item.case.id.toLowerCase() === state.requestedCaseId.toLowerCase())
  ));
  state.selected = state.cases.length
    ? requestedIndex >= 0 ? requestedIndex : Math.min(state.selected ?? 0, state.cases.length - 1)
    : null;
  state.requestedGuildId = '';
  state.requestedCaseId = '';
  renderList();
  renderDetail();
}

async function init() {
  try {
    const result = await api('/api/appeal/me');
    state.me = result.user;
    state.csrf = result.csrfToken || '';
    renderAccount();
    if (!state.me) {
      $('#login').hidden = false;
      return;
    }
    $('#app').hidden = false;
    await loadCases();
  } catch (error) {
    toast(error.message, true);
  }
}

init();
