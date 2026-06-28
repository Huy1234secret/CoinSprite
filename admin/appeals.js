(() => {
  if (window.CoinSpriteAppealAdmin) return;
  const TYPES = ['text', 'number', 'choice', 'checkbox', 'file'];
  const TOKENS = ['<appeal-id>', '<case-id>', '<@mention>', '<user-id>', '<punishment>', '<case-reason>', '<form-answers>', '<evidence>', '<public-note>', '<avatar_url>'];
  const PREVIEW = { 'appeal-id': 'A-000001', 'case-id': 'W-000001', '@mention': '@someone', mention: '@someone', 'user-id': '123456789012345678', punishment: 'warning', 'case-reason': 'Example case reason', 'form-answers': 'Why reconsider: Example response', evidence: 'evidence.png', 'public-note': 'No public note', avatar_url: '/bot-avatar.png' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  let data = defaults(), directory = {}, guildId = '', loaded = '', busy = false, dirty = false, root = null, view = 'appeal-settings';

  function logTemplate() {
    return { id: 'appeal-log-message', name: 'Appeal log message', content: '', containers: [{ id: 'appeal-summary', accentColor: '#FEE75C', text: '## Appeal <appeal-id>\n**User:** <@mention> (<user-id>)\n**Case:** <case-id>\n**Punishment:** <punishment>\n**Reason:** <case-reason>\n<separator>\n**Appeal answers**\n<form-answers>', thumbnailUrl: '<avatar_url>', imageUrl: '' }], componentRows: [] };
  }
  function question(index) {
    return { id: 'question-' + (index + 1), order: index + 1, type: 'text', label: index ? 'Question ' + (index + 1) : 'Why should this case be reconsidered?', description: '', required: index === 0, style: 'paragraph', placeholder: '', minLength: 0, maxLength: 4000 };
  }
  function defaults() {
    return { enabled: false, cooldownSeconds: 0, maxSubmissionsPerCase: null, logChannelId: '', questions: [question(0)], logMessage: logTemplate() };
  }
  function normalize(value) {
    const source = value || {};
    const next = { ...defaults(), ...copy(source) };
    next.questions = (Array.isArray(source.questions) && source.questions.length ? source.questions : [question(0)]).slice(0, 10).map((field, index) => ({ ...field, id: String(field.id || 'question-' + (index + 1)), order: index + 1, type: TYPES.includes(field.type) ? field.type : 'text', label: String(field.label || 'Question ' + (index + 1)), description: String(field.description || ''), required: Boolean(field.required) }));
    next.logMessage = window.CoinSpriteRichEditor?.normalize(source.logMessage || logTemplate()) || source.logMessage || logTemplate();
    return next;
  }
  function channels() { return (directory.channels || []).filter((channel) => !['category', 'voice'].includes(channel.kind)); }
  function channelOptions(selected) {
    const rows = channels().map((channel) => '<option value="' + esc(channel.id) + '" ' + (selected === channel.id ? 'selected' : '') + '>' + esc((channel.parentName ? channel.parentName + ' / ' : '') + '#' + channel.name) + '</option>');
    if (selected && !channels().some((channel) => channel.id === selected)) rows.unshift('<option selected value="' + esc(selected) + '">Unavailable channel</option>');
    return '<option value="">Select channel</option>' + rows.join('');
  }
  function mark() { dirty = true; const node = root?.querySelector('#appealAdminStatus'); if (node) node.textContent = 'Unsaved changes'; }
  function unit() { const s = Number(data.cooldownSeconds) || 0; return s && s % 86400 === 0 ? 86400 : s && s % 3600 === 0 ? 3600 : s && s % 60 === 0 ? 60 : 1; }
  function commonFields(field) {
    return '<div class="appeal-field-grid"><label>Label<input data-field-key="label" maxlength="80" value="' + esc(field.label) + '"></label><label>Type<select data-field-key="type">' + TYPES.map((type) => '<option value="' + type + '" ' + (field.type === type ? 'selected' : '') + '>' + type + '</option>').join('') + '</select></label><label class="wide">Description<input data-field-key="description" maxlength="200" value="' + esc(field.description) + '"></label><label class="checkline"><input data-field-key="required" type="checkbox" ' + (field.required ? 'checked' : '') + '> Required</label></div>';
  }
  function specificFields(field) {
    if (field.type === 'text') return '<div class="appeal-field-grid"><label>Style<select data-field-key="style"><option value="short" ' + (field.style === 'short' ? 'selected' : '') + '>Short</option><option value="paragraph" ' + (field.style !== 'short' ? 'selected' : '') + '>Paragraph</option></select></label><label>Placeholder<input data-field-key="placeholder" value="' + esc(field.placeholder || '') + '"></label><label>Min length<input data-field-key="minLength" type="number" min="0" max="4000" value="' + Number(field.minLength || 0) + '"></label><label>Max length<input data-field-key="maxLength" type="number" min="1" max="4000" value="' + Number(field.maxLength || 4000) + '"></label></div>';
    if (field.type === 'number') return '<div class="appeal-field-grid"><label>Minimum<input data-field-key="minimum" type="number" value="' + esc(field.minimum ?? '') + '"></label><label>Maximum<input data-field-key="maximum" type="number" value="' + esc(field.maximum ?? '') + '"></label><label>Step<input data-field-key="step" type="number" min="0.000001" value="' + Number(field.step || 1) + '"></label><label>Placeholder<input data-field-key="placeholder" value="' + esc(field.placeholder || '') + '"></label></div>';
    if (field.type === 'choice') return '<div class="appeal-field-grid"><label class="wide">Options<textarea data-field-key="optionsText" rows="4">' + esc((field.options || [{ label: 'Option 1' }, { label: 'Option 2' }]).map((option) => option.label).join('\n')) + '</textarea></label><label class="checkline"><input data-field-key="multiple" type="checkbox" ' + (field.multiple ? 'checked' : '') + '> Multiple selection</label><label>Min selections<input data-field-key="minSelections" type="number" min="0" max="25" value="' + Number(field.minSelections || (field.required ? 1 : 0)) + '"></label><label>Max selections<input data-field-key="maxSelections" type="number" min="1" max="25" value="' + Number(field.maxSelections || 1) + '"></label></div>';
    if (field.type === 'checkbox') return '<label class="checkline"><input data-field-key="default" type="checkbox" ' + (field.default ? 'checked' : '') + '> Checked by default</label>';
    return '<div class="appeal-field-grid"><label>Maximum files<input data-field-key="maxFiles" type="number" min="1" max="5" value="' + Number(field.maxFiles || 1) + '"></label><label>Per-file limit (MB)<input data-field-key="maxFileSizeMb" type="number" min="1" max="10" value="' + Number(field.maxFileSizeMb || 10) + '"></label><label class="wide">Allowed extensions<input data-field-key="extensionsText" value="' + esc((field.allowedExtensions || []).join(', ')) + '" placeholder="png, jpg, pdf"></label></div>';
  }
  function fieldCard(field, index) {
    return '<article class="appeal-field-card" data-field-index="' + index + '"><header><strong>Field ' + (index + 1) + '</strong><div><button type="button" data-field-action="up" title="Move up">↑</button><button type="button" data-field-action="down" title="Move down">↓</button><button type="button" data-field-action="remove" title="Remove">×</button></div></header>' + commonFields(field) + specificFields(field) + '</article>';
  }
  function previewField(field) {
    const label = esc(field.label + (field.required ? ' *' : ''));
    if (field.type === 'text') return '<label>' + label + '<textarea rows="' + (field.style === 'short' ? 1 : 4) + '" placeholder="' + esc(field.placeholder || '') + '"></textarea></label>';
    if (field.type === 'number') return '<label>' + label + '<input type="number" placeholder="' + esc(field.placeholder || '') + '"></label>';
    if (field.type === 'choice') return '<fieldset><legend>' + label + '</legend>' + (field.options || []).map((option) => '<label class="checkline"><input disabled type="' + (field.multiple ? 'checkbox' : 'radio') + '"> ' + esc(option.label) + '</label>').join('') + '</fieldset>';
    if (field.type === 'checkbox') return '<label class="checkline"><input disabled type="checkbox" ' + (field.default ? 'checked' : '') + '> ' + label + '</label>';
    return '<label>' + label + '<input disabled type="file"></label>';
  }
  function settingsHtml() {
    const currentUnit = unit();
    return '<section class="panel appeal-settings-grid"><label class="checkline"><input id="appealEnabled" type="checkbox" ' + (data.enabled ? 'checked' : '') + '> Enabled</label><label>Appeal log channel<select id="appealLogChannel">' + channelOptions(data.logChannelId) + '</select></label><label>Cooldown<input id="appealCooldownValue" type="number" min="0" value="' + ((Number(data.cooldownSeconds) || 0) / currentUnit) + '"></label><label>Cooldown unit<select id="appealCooldownUnit">' + [['Seconds',1],['Minutes',60],['Hours',3600],['Days',86400]].map((item) => '<option value="' + item[1] + '" ' + (item[1] === currentUnit ? 'selected' : '') + '>' + item[0] + '</option>').join('') + '</select></label><label>Maximum submissions per case<input id="appealMaximum" type="number" min="1" max="100" value="' + esc(data.maxSubmissionsPerCase ?? '') + '" placeholder="Unlimited"></label></section>';
  }
  function formHtml() {
    return '<div class="appeal-form-layout"><section><div class="appeal-form-head"><strong>Form fields</strong><button type="button" id="appealAddField" ' + (data.questions.length >= 10 ? 'disabled' : '') + '>+ Add field</button></div>' + data.questions.map(fieldCard).join('') + '</section><aside class="panel appeal-public-preview"><h3>Public form preview</h3>' + data.questions.map(previewField).join('') + '<button class="button primary" disabled>Submit appeal</button></aside></div>';
  }
  function render() {
    if (!root) return;
    root.innerHTML = '<div class="appeal-admin">' + (view === 'appeal-settings' ? settingsHtml() : view === 'appeal-form' ? formHtml() : '<div id="appealMessageEditor"></div><div class="appeal-fixed-actions"><button class="button success" disabled>Accept</button><button class="button danger" disabled>Deny</button></div>') + '<div class="appeal-save"><span id="appealAdminStatus">' + (dirty ? 'Unsaved changes' : 'All changes saved') + '</span><button id="appealSave" class="button success" type="button">Save appeal settings</button></div></div>';
    if (view === 'appeal-message') window.CoinSpriteRichEditor?.mount(root.querySelector('#appealMessageEditor'), { value: data.logMessage, tokens: TOKENS, previewTokens: PREVIEW, onChange(value) { data.logMessage = value; mark(); } });
  }
  async function load() {
    if (!guildId || busy || loaded === guildId) return;
    busy = true;
    try {
      const responses = await Promise.all([fetch('/api/guilds/' + guildId + '/config'), fetch('/api/guilds/' + guildId + '/directory')]);
      const config = await responses[0].json(), listing = await responses[1].json();
      if (!responses[0].ok) throw new Error(config.error || 'Could not load appeal settings.');
      if (!responses[1].ok) throw new Error(listing.error || 'Could not load channels.');
      data = normalize(config.config?.moderation?.appeals);
      directory = listing.directory || {};
      loaded = guildId; dirty = false; render();
    } catch (error) { if (root) root.innerHTML = '<div class="panel">' + esc(error.message) + '</div>'; }
    finally { busy = false; }
  }
  async function save() {
    const status = root?.querySelector('#appealAdminStatus'); if (status) status.textContent = 'Saving...';
    try {
      const response = await fetch('/api/guilds/' + guildId + '/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moderation: { appeals: data } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save appeal settings.');
      data = normalize(payload.config?.moderation?.appeals); dirty = false; render();
    } catch (error) { if (status) status.textContent = error.message; }
  }
  function updateField(target) {
    const card = target.closest('[data-field-index]'); if (!card || !target.dataset.fieldKey) return false;
    const field = data.questions[Number(card.dataset.fieldIndex)], key = target.dataset.fieldKey;
    if (key === 'optionsText') field.options = target.value.split('\n').map((label, index) => ({ id: 'option-' + (index + 1), label: label.trim() })).filter((item) => item.label).slice(0, 25);
    else if (key === 'extensionsText') field.allowedExtensions = target.value.split(/[\s,]+/).filter(Boolean);
    else if (target.type === 'checkbox') field[key] = target.checked;
    else if (target.type === 'number') field[key] = target.value === '' ? null : Number(target.value);
    else field[key] = target.value;
    return true;
  }
  function styles() {
    if (document.querySelector('#appealAdminStyles')) return;
    const style = document.createElement('style'); style.id = 'appealAdminStyles';
    style.textContent = '.appeal-admin{display:grid;gap:14px}.appeal-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.appeal-settings-grid label,.appeal-field-grid label,.appeal-public-preview>label{display:grid;gap:6px}.appeal-form-layout{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:14px;align-items:start}.appeal-form-head,.appeal-field-card header,.appeal-save,.appeal-fixed-actions{display:flex;justify-content:space-between;align-items:center;gap:10px}.appeal-field-card{border:1px solid var(--border,#30394a);border-radius:8px;padding:14px;margin-bottom:12px}.appeal-field-card header{margin-bottom:12px}.appeal-field-card header div{display:flex;gap:6px}.appeal-field-card header button{min-width:34px;padding:6px}.appeal-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.appeal-field-grid .wide{grid-column:1/-1}.appeal-public-preview{position:sticky;top:18px;display:grid;gap:13px}.appeal-public-preview fieldset{display:grid;gap:7px;border:1px solid var(--border,#30394a);border-radius:6px}.appeal-save{border-top:1px solid var(--border,#30394a);padding-top:14px}.appeal-save span{color:var(--muted,#aeb7c5)}.appeal-fixed-actions{justify-content:flex-end;padding:12px 16px;border:1px solid var(--border,#30394a);border-top:0}.moderator-workspace-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}@media(max-width:850px){.appeal-settings-grid,.appeal-form-layout,.appeal-field-grid{grid-template-columns:1fr}.appeal-field-grid .wide{grid-column:auto}.appeal-public-preview{position:static}.moderator-workspace-tabs{grid-template-columns:1fr!important}}';
    document.head.append(style);
  }
  document.addEventListener('input', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    if (updateField(event.target)) { mark(); return; }
    if (event.target.id === 'appealMaximum') data.maxSubmissionsPerCase = event.target.value === '' ? null : Number(event.target.value);
    if (event.target.id === 'appealCooldownValue') data.cooldownSeconds = Math.max(0, Number(event.target.value) || 0) * Number(root.querySelector('#appealCooldownUnit')?.value || 1);
    mark();
  });
  document.addEventListener('change', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    if (updateField(event.target)) { mark(); if (event.target.dataset.fieldKey === 'type') render(); return; }
    if (event.target.id === 'appealEnabled') data.enabled = event.target.checked;
    if (event.target.id === 'appealLogChannel') data.logChannelId = event.target.value;
    if (event.target.id === 'appealCooldownUnit') data.cooldownSeconds = Math.max(0, Number(root.querySelector('#appealCooldownValue')?.value) || 0) * Number(event.target.value);
    mark();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#appealAdminRoot')) return;
    if (event.target.id === 'appealSave') { save(); return; }
    if (event.target.id === 'appealAddField') { if (data.questions.length < 10) data.questions.push(question(data.questions.length)); mark(); render(); return; }
    const action = event.target.closest('[data-field-action]')?.dataset.fieldAction, card = event.target.closest('[data-field-index]');
    if (!action || !card) return;
    const index = Number(card.dataset.fieldIndex);
    if (action === 'remove') data.questions.splice(index, 1);
    if (action === 'up' && index > 0) [data.questions[index - 1], data.questions[index]] = [data.questions[index], data.questions[index - 1]];
    if (action === 'down' && index < data.questions.length - 1) [data.questions[index + 1], data.questions[index]] = [data.questions[index], data.questions[index + 1]];
    mark(); render();
  });
  function mount(nextRoot, nextGuild, nextView) {
    styles(); root = nextRoot; guildId = String(nextGuild || ''); view = ['appeal-settings','appeal-form','appeal-message'].includes(nextView) ? nextView : 'appeal-settings';
    if (loaded !== guildId) { root.innerHTML = '<div class="panel">Loading...</div>'; load(); } else render();
  }
  window.CoinSpriteAppealAdmin = { mount };
})();
