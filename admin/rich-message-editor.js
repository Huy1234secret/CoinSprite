(() => {
  if (window.CoinSpriteRichEditor?.version >= 6) return;

  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
  const ALL_PLACEHOLDERS = Object.freeze([
    '<@mention>', '<mention>', '<username>', '<display_name>', '<display-name>', '<displayname>',
    '<user-id>', '<user_id>', '<userid>', '<avatar_url>', '<avatar-url>', '<server>', '<server-name>',
    '<guild-name>', '<server-id>', '<guild-id>', '<member-count>', '<channel>', '<channel-name>',
    '<channel-id>', '<channel_id>', '<level>', '<previous-level>', '<previous_level>', '<previouslevel>',
    '<currenlevel>', '<currentlevel>', '<current_level>', '<message-link>', '<message-content>',
    '<moderation-case>', '<moderation-reason>', '<moderation-action>', '<moderation-action-label>',
    '<moderation-categories>', '<moderation-source>', '<severity>', '<severity-tier>', '<broken-rules>',
    '<matched-terms>', '<original-language>', '<english-translation>', '<translation-section>',
    '<blocked-domain>', '<blocked-url>', '<invite-code>', '<case-id>', '<case-type>', '<case-status>',
    '<case-source>', '<case-reason>', '<case-audit-events>', '<warning-count>', '<active-warnings>',
    '<warning-case-list>', '<threshold>', '<expires>', '<duration>', '<evidence>', '<appealable>',
    '<appealable-status>', '<appeal-id>', '<appeal-url>', '<reviewer>', '<reviewer-note>', '<ticket_name>',
    '<ticket_id>', '<form-answer>', '<form_answer>', '<form-answers>', '<punishment>', '<public-note>',
    '<reason>', '<status>', '<status-note>', '<uploaded-file-list>', '<roblox-username>', '<game>',
    '<giveaway-prize>', '<winner-count>', '<winner-list>', '<claim-time>', '<claimed-count>',
    '<claimed-users>', '<unclaimed-count>', '<reroll-time>', '<giveaway-host>', '<host-id>',
    '<giveaway-description>', '<giveaway-requirement>', '<giveaway-ends>', '<giveaway-list>',
    '<notice-delivery>', '<notification-message-id>', '<staff-log-message-id>', '<moderator>',
    '<moderator-id>', '<channel-rule>', '<separator>',
  ]);

  function syntaxMarkup() {
    return '<section class="message-syntax-reference" aria-label="Available message placeholders">'
      + '<div class="message-syntax-token-row">'
      + ALL_PLACEHOLDERS.map((token) => '<button class="message-syntax-token" type="button" data-message-syntax-token="' + escapeHtml(token) + '">' + escapeHtml(token) + '</button>').join('')
      + '</div><div class="message-syntax-usage"><strong>Condition format:</strong> <code>&lt;if&lt;level&gt;==10,&quot;shown&quot;,&quot;hidden&quot;&gt;</code>. Supported operators: <code>==</code>, <code>!=</code>, <code>&gt;</code>, <code>&gt;=</code>, <code>&lt;</code>, <code>&lt;=</code>.</div></section>';
  }

  function insertSyntaxToken(token, scope = document) {
    if (!token) return false;
    if (window.CoinSpriteInlineMessageEditor?.insertToken?.(token, scope)) return true;
    const active = document.activeElement;
    const activeField = active?.matches?.('textarea,input[type="text"],[contenteditable="true"]') && scope.contains?.(active)
      ? active
      : null;
    const field = activeField || scope.querySelector?.('textarea,[contenteditable="true"]');
    if (!field) return false;
    if (field.isContentEditable) {
      field.focus();
      document.execCommand('insertText', false, token);
    } else {
      const start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length;
      const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
      field.setRangeText(token, start, end, 'end');
      field.focus({ preventScroll: true });
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function normalize(value = {}) {
    return {
      ...clone(value),
      content: String(value.content || '').slice(0, 2000),
      containers: (Array.isArray(value.containers) ? value.containers : []).slice(0, 8).map((item, index) => ({
        id: String(item.id || 'container-' + (index + 1)),
        text: String(item.text || '').slice(0, 4000),
        accentColor: /^#[0-9a-f]{6}$/i.test(item.accentColor) ? item.accentColor.toUpperCase() : '#5865F2',
        thumbnailUrl: String(item.thumbnailUrl || '').slice(0, 2000),
        imageUrl: String(item.imageUrl || '').slice(0, 2000),
      })),
      componentRows: [],
    };
  }

  function previewValue(value, replacements = {}) {
    const copy = clone(value);
    const replace = (text) => String(text || '').replace(/<([@a-z0-9_-]+)>/gi, (match, key) => replacements[key.toLowerCase()] ?? match);
    copy.content = replace(copy.content);
    copy.containers = (copy.containers || []).map((item) => ({
      ...item,
      text: replace(item.text),
      thumbnailUrl: replace(item.thumbnailUrl),
      imageUrl: replace(item.imageUrl),
    }));
    return copy;
  }

  function styles() {
    if (document.querySelector('#richTemplateEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'richTemplateEditorStyles';
    style.textContent = [
      '.rich-template-editor{display:block;min-width:0}',
      '.rich-live-panel{border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:10px;padding:16px;min-width:0}',
      '.rich-live-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.rich-live-head h3{margin:0;font-size:16px}.rich-live-head span{color:var(--muted,#93a4bc);font-size:12px}',
      '.rich-preview-stage{border:1px solid var(--border,#30394a);border-radius:10px;background:#25272d;padding:20px;overflow:auto}',
      '.rich-preview-stage .message-discord-preview{min-height:220px;padding:20px}.rich-preview-stage .message-discord-body{width:100%;max-width:920px}.rich-source-fields{display:none!important}',
      '.rich-container-frame{width:min(100%,840px);margin:8px 0 0}.rich-container-frame>.message-preview-container{width:100%;max-width:none;margin:0}',
      '.rich-container-remove{position:absolute;z-index:8;top:0;right:-40px;display:grid;width:30px;height:30px;min-height:30px;place-items:center;padding:0;border:1px solid var(--border,#465166);border-radius:7px;background:transparent;color:#b8c2d1;font-size:19px;line-height:1;cursor:pointer;box-shadow:none}.rich-container-remove:hover{border-color:var(--danger,#fb7185);background:transparent;color:var(--danger,#fb7185)}',
      '.rich-template-editor .preview-media-edit.image:not(.has-value){width:auto;min-width:150px;min-height:42px;padding:0 12px}.rich-template-editor .preview-media-edit.image:not(.has-value) .preview-media-empty{flex-direction:row;gap:7px;padding:0}.rich-template-editor .preview-media-edit.image:not(.has-value) .preview-media-empty span:last-child{display:none}',
      '.rich-add-container{width:100%;min-height:52px;border-style:dashed;margin-top:12px;background:transparent}',
      '.rich-template-editor .message-preview-container{position:relative;overflow:visible!important}.rich-template-editor .message-root-content,.rich-template-editor .message-preview-text{cursor:text}.rich-template-editor .message-root-content.message-root-empty{display:block!important;min-height:20px!important;margin:0 0 8px!important;padding:0!important}',
      '.message-syntax-reference{display:grid;gap:7px;width:100%;margin-top:10px;padding:8px 10px;border:1px solid rgba(148,163,184,.18);border-radius:9px;background:rgba(7,11,19,.42)}',
      '.message-syntax-token-row{display:flex;gap:5px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}.message-syntax-token{flex:0 0 auto;min-height:24px;padding:3px 7px;border:1px solid rgba(124,131,255,.3);border-radius:6px;background:transparent;color:#b9c9e3;font:700 11px/1.15 ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer}.message-syntax-token:hover{border-color:var(--primary,#7c83ff);color:#fff}.message-syntax-usage{color:var(--muted,#93a4bc);font-size:11px;line-height:1.4}.message-syntax-usage code{color:#dce4ff}',
      '@media(max-width:700px){.rich-live-head{align-items:flex-start;flex-direction:column}.rich-preview-stage{padding:10px 46px 10px 10px}.rich-preview-stage .message-discord-preview{min-height:0;padding:14px}.rich-container-frame{width:100%}.rich-container-remove{right:-36px}}',
    ].join('\n');
    document.head.append(style);
  }

  function mount(root, options = {}) {
    styles();
    let value = normalize(options.value);
    const notify = () => options.onChange?.(clone(value));

    root.classList.add('rich-template-editor');
    root.innerHTML = '<section class="rich-live-panel"><div class="rich-live-head"><h3>Live preview</h3><span>Click the message, color, thumbnail, or image to edit.</span></div><div class="rich-preview-stage" data-rich-preview></div>'
      + '<button class="rich-add-container" type="button" data-rich-action="add">Add Container</button>'
      + syntaxMarkup() + '</section><div class="rich-source-fields" data-rich-sources></div>';

    function sourceMarkup() {
      return '<textarea data-template-field="content" maxlength="2000">' + escapeHtml(value.content) + '</textarea>'
        + value.containers.map((item, index) => '<div data-container-index="' + index + '"><textarea data-container-field="text" maxlength="4000">' + escapeHtml(item.text) + '</textarea><input data-container-field="accentColor" type="color" value="' + escapeHtml(item.accentColor) + '"><input data-container-field="thumbnailUrl" value="' + escapeHtml(item.thumbnailUrl) + '"><input data-container-field="imageUrl" value="' + escapeHtml(item.imageUrl) + '"></div>').join('');
    }

    function syncSources() {
      const sources = root.querySelector('[data-rich-sources]');
      sources.innerHTML = sourceMarkup();
    }

    function syncValue() {
      value.content = root.querySelector('[data-template-field="content"]')?.value || '';
      root.querySelectorAll('[data-container-index]').forEach((group) => {
        const item = value.containers[Number(group.dataset.containerIndex)];
        if (!item) return;
        for (const key of ['text', 'accentColor', 'thumbnailUrl', 'imageUrl']) {
          const field = group.querySelector('[data-container-field="' + key + '"]');
          if (field) item[key] = field.value;
        }
      });
    }

    function decorateContainers() {
      root.querySelectorAll('[data-rich-preview] .message-preview-container').forEach((container, index) => {
        const frame = document.createElement('div');
        frame.className = 'rich-container-frame';
        const remove = document.createElement('button');
        remove.className = 'rich-container-remove';
        remove.type = 'button';
        remove.dataset.richAction = 'remove';
        remove.dataset.index = String(index);
        remove.title = 'Remove container';
        remove.setAttribute('aria-label', 'Remove container');
        remove.textContent = '×';
        container.before(frame);
        frame.append(container);
        container.append(remove);
      });
    }

    function refreshPreview() {
      const preview = root.querySelector('[data-rich-preview]');
      const rendered = previewValue(value, options.previewTokens || {});
      preview.innerHTML = window.CoinSpriteMessageEditor?.renderPreview
        ? window.CoinSpriteMessageEditor.renderPreview(rendered, { hideEmptyRoot: false, showContainerControls: false })
        : '<pre>' + escapeHtml(JSON.stringify(rendered, null, 2)) + '</pre>';
      decorateContainers();
      root.querySelector('[data-rich-action="add"]').disabled = value.containers.length >= 8;
    }

    root.addEventListener('input', (event) => {
      if (!event.target.closest('[data-rich-sources]')) return;
      syncValue();
      notify();
      refreshPreview();
    });
    root.addEventListener('change', (event) => {
      if (!event.target.closest('[data-rich-sources]')) return;
      syncValue();
      notify();
      refreshPreview();
    });
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-rich-action]')?.dataset.richAction;
      if (!action) return;
      const index = Number(event.target.closest('[data-index]')?.dataset.index);
      if (action === 'add' && value.containers.length < 8) value.containers.push({ id: 'container-' + Date.now(), text: '', accentColor: '#5865F2', thumbnailUrl: '', imageUrl: '' });
      else if (action === 'remove' && Number.isInteger(index)) value.containers.splice(index, 1);
      else return;
      syncSources();
      notify();
      refreshPreview();
    });

    syncSources();
    refreshPreview();
    return {
      getValue: () => clone(value),
      setValue(next) {
        value = normalize(next);
        syncSources();
        refreshPreview();
      },
    };
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-message-syntax-token]');
    if (!button) return;
    event.preventDefault();
    const scope = button.closest('.rich-template-editor,.message-edit-layout,.message-builder,.ticket-message-builder,.panel,.tab-panel') || document;
    insertSyntaxToken(button.dataset.messageSyntaxToken, scope);
  });

  window.CoinSpriteMessageSyntax = Object.freeze({ tokens: ALL_PLACEHOLDERS, markup: syntaxMarkup, insertToken: insertSyntaxToken });
  window.CoinSpriteRichEditor = Object.freeze({ version: 6, mount, normalize });
  window.dispatchEvent(new Event('coinsprite:rich-editor-ready'));
})();
