// Small, code-native building blocks for the dashboard. There are no HTML templates.
const VOID = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source']);

function el(tag, attrs = {}, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) };
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function render(entry) {
  if (typeof entry === 'string' || typeof entry === 'number') return escape(entry);
  const attrs = Object.entries(entry.attrs || {}).map(([key, value]) => {
    if (value === false || value === null || value === undefined) return '';
    return value === true ? ` ${key}` : ` ${key}="${escape(value)}"`;
  }).join('');
  const opening = `<${entry.tag}${attrs}>`;
  return VOID.has(entry.tag) ? opening : `${opening}${(entry.children || []).map(render).join('')}</${entry.tag}>`;
}

function action(id, label, kind = 'quiet', extra = {}) {
  return el('button', { id, type: 'button', class: `action ${kind}`, ...extra }, label);
}

function control(label, id, type = 'text', note = '', attrs = {}) {
  const input = type === 'select' ? el('select', { id, ...attrs })
    : type === 'textarea' ? el('textarea', { id, ...attrs })
      : el('input', { id, type, ...attrs });
  return el('label', { class: 'control' },
    el('span', { class: 'control-label' }, label, note ? el('small', {}, note) : null), input);
}

function toggle(label, id, note = '') {
  return el('label', { class: 'toggle' },
    el('span', {}, el('strong', {}, label), note ? el('small', {}, note) : null),
    el('input', { id, type: 'checkbox' }));
}

function section(title, note, ...body) {
  return el('section', { class: 'section-block' },
    el('header', { class: 'section-heading' }, el('h2', {}, title), note ? el('p', {}, note) : null),
    el('div', { class: 'section-body' }, body));
}

function pageTitle(kicker, title, note, ...actions) {
  return el('header', { class: 'workspace-head' },
    el('div', {}, el('span', { class: 'eyebrow' }, kicker), el('h1', {}, title), el('p', {}, note)),
    actions.length ? el('div', { class: 'head-actions' }, actions) : null);
}

function tabs(className, dataName, items) {
  return el('div', { class: className, role: 'tablist', 'aria-label': className.replace(/-/g, ' ') },
    items.map(([value, emoji, label], index) => el('button', {
      type: 'button', role: 'tab', class: index === 0 ? 'active' : '',
      'aria-selected': index === 0 ? 'true' : 'false', [dataName]: value,
    }, el('span', { 'aria-hidden': 'true' }, emoji), label)));
}

function composer(name, ids, options = {}) {
  const tools = (options.tools || []).map(([id, label]) => action(id, label, 'tool'));
  return el('section', { class: 'message-composer' },
    el('header', { class: 'composer-toolbar' },
      el('div', {}, el('strong', {}, options.title || 'Message preview'), el('small', {}, options.note || 'Select text in the preview to edit.')),
      options.actions ? el('div', { class: 'composer-template-actions' }, options.actions) : null),
    el('div', { class: 'discord-preview', 'aria-label': `${name} Discord preview` },
      el('div', { class: 'discord-preview-head' },
        el('span', { id: options.previewLabelId || undefined }, 'DISCORD PREVIEW'),
        el('div', { class: 'preview-tool-buttons' }, tools)),
      el('div', { class: 'preview-tool-panel', id: ids.panel, hidden: true }),
      el('div', { class: 'discord-message-row' },
        el('div', { class: 'discord-avatar', 'aria-hidden': 'true' }, 'C'),
        el('div', { class: 'discord-message-body' },
          el('div', { class: 'discord-author' }, el('strong', {}, 'CoinSprite'), el('small', {}, 'APP')),
          el('div', { class: 'discord-frame', id: ids.frame },
            el('button', { class: 'discord-accent-button', id: ids.accentButton, type: 'button', 'aria-label': 'Change container color' }, '◉'),
            el('input', { id: ids.accentColor, type: 'color', value: options.accent || '#b18b20', 'aria-label': 'Container color' }),
            el('div', { id: ids.preview })),
          el('div', { class: 'additional-container-list', id: ids.additional }),
          ids.controls ? el('div', { class: 'rr-control-preview', id: ids.controls }) : null))));
}

module.exports = { el, render, action, control, toggle, section, pageTitle, tabs, composer };
