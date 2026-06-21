(function ticketEditorModule() {
  const PERMISSIONS = [
    ['CreateInstantInvite', 'Create invite'],
    ['KickMembers', 'Kick members'],
    ['BanMembers', 'Ban members'],
    ['Administrator', 'Administrator'],
    ['ManageChannels', 'Manage channels'],
    ['ManageGuild', 'Manage server'],
    ['AddReactions', 'Add reactions'],
    ['ViewAuditLog', 'View audit log'],
    ['PrioritySpeaker', 'Priority speaker'],
    ['Stream', 'Video'],
    ['ViewChannel', 'View channel'],
    ['SendMessages', 'Send messages'],
    ['SendTTSMessages', 'Send text-to-speech messages'],
    ['ManageMessages', 'Manage messages'],
    ['EmbedLinks', 'Embed links'],
    ['AttachFiles', 'Attach files'],
    ['ReadMessageHistory', 'Read message history'],
    ['MentionEveryone', 'Mention everyone'],
    ['UseExternalEmojis', 'Use external emoji'],
    ['ViewGuildInsights', 'View server insights'],
    ['Connect', 'Connect to voice'],
    ['Speak', 'Speak'],
    ['MuteMembers', 'Mute members'],
    ['DeafenMembers', 'Deafen members'],
    ['MoveMembers', 'Move members'],
    ['UseVAD', 'Use voice activity'],
    ['ChangeNickname', 'Change nickname'],
    ['ManageNicknames', 'Manage nicknames'],
    ['ManageRoles', 'Manage roles'],
    ['ManageWebhooks', 'Manage webhooks'],
    ['ManageEmojisAndStickers', 'Manage emoji and stickers'],
    ['ManageGuildExpressions', 'Manage expressions'],
    ['UseApplicationCommands', 'Use application commands'],
    ['RequestToSpeak', 'Request to speak'],
    ['ManageEvents', 'Manage events'],
    ['ManageThreads', 'Manage threads'],
    ['CreatePublicThreads', 'Create public threads'],
    ['CreatePrivateThreads', 'Create private threads'],
    ['UseExternalStickers', 'Use external stickers'],
    ['SendMessagesInThreads', 'Send messages in threads'],
    ['UseEmbeddedActivities', 'Use activities'],
    ['ModerateMembers', 'Timeout members'],
    ['ViewCreatorMonetizationAnalytics', 'View monetization analytics'],
    ['UseSoundboard', 'Use soundboard'],
    ['CreateGuildExpressions', 'Create expressions'],
    ['CreateEvents', 'Create events'],
    ['UseExternalSounds', 'Use external sounds'],
    ['SendVoiceMessages', 'Send voice messages'],
    ['SendPolls', 'Create polls'],
    ['UseExternalApps', 'Use external apps'],
    ['PinMessages', 'Pin messages'],
    ['BypassSlowmode', 'Bypass slowmode'],
  ];
  const FORM_TYPES = [
    ['string_select', 'String Select'],
    ['text_input', 'Text Input'],
    ['user_select', 'User Select'],
    ['role_select', 'Role Select'],
    ['channel_select', 'Channel Select'],
    ['file_upload', 'File Upload'],
    ['radio_group', 'Radio Group'],
    ['checkbox_group', 'Checkbox Group'],
    ['checkbox', 'Checkbox'],
    ['text_display', 'Text Display'],
  ];
  const ACTIONS = [
    ['close', 'Close ticket'],
    ['transcript', 'Save transcript'],
    ['delete', 'Delete channel'],
    ['blacklist', 'Blacklist author'],
    ['move_to', 'Move to ticket type'],
  ];
  const DEFAULT_MESSAGE = {
    content: '<@mention> Welcome!\n## <ticket_name> ticket\nOur staff will be with you soon.\n<separator>\n<form-answer>',
    accentColor: '#FFFFFF',
    thumbnailUrl: '<avatar_url>',
    imageUrl: '',
  };
  const DEFAULT_ADMIN_CONTROLS = [
    {
      id: 'close',
      name: 'Close Ticket',
      emoji: '⛔',
      description: 'Close, transcript, and delete this ticket.',
      buttonStyle: 'danger',
      url: '',
      actions: ['close', 'transcript', 'delete'],
      moveToTicketTypeId: '',
    },
  ];
  const DEFAULT_STAFF_PERMISSIONS = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'AttachFiles', 'EmbedLinks'];
  const DEFAULT_AUTHOR_PERMISSIONS = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderDiscordMarkdown(value) {
    const inline = (text) => escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    let inCode = false;
    const lines = [];
    for (const line of String(value).split('\n')) {
      if (line.trim().startsWith('```')) {
        lines.push(inCode ? '</code></pre>' : '<pre class="preview-code"><code>');
        inCode = !inCode;
      } else if (inCode) {
        lines.push(`${escapeHtml(line)}\n`);
      } else if (line.startsWith('## ')) {
        lines.push(`<strong class="preview-heading">${inline(line.slice(3))}</strong>`);
      } else if (line.startsWith('-# ')) {
        lines.push(`<span class="preview-subtext">${inline(line.slice(3))}</span>`);
      } else if (line.startsWith('> ')) {
        lines.push(`<span class="preview-quote">${inline(line.slice(2))}</span>`);
      } else {
        lines.push(`<span class="preview-line">${inline(line) || '&nbsp;'}</span>`);
      }
    }
    if (inCode) lines.push('</code></pre>');
    return lines.join('');
  }

  function slug(value) {
    return String(value || 'ticket')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'ticket';
  }

  function createMessage(value, fallback = DEFAULT_MESSAGE) {
    return {
      content: value?.content || fallback.content,
      accentColor: value?.accentColor || fallback.accentColor,
      thumbnailUrl: value?.thumbnailUrl || '',
      imageUrl: value?.imageUrl || '',
    };
  }

  function createTicketType(index) {
    return {
      id: `ticket-${Date.now().toString(36)}-${index}`,
      workflow: 'generic',
      name: `Ticket ${index}`,
      emoji: '🎫',
      description: 'Open this ticket to contact staff.',
      buttonStyle: 'primary',
      staffRoleIds: [],
      blacklistRoleId: '',
      staffPermissions: [...DEFAULT_STAFF_PERMISSIONS],
      authorPermissions: [...DEFAULT_AUTHOR_PERMISSIONS],
      transcriptEnabled: true,
      transcriptChannelId: '',
      categoryChannelId: '',
      message: createMessage(),
      adminPanel: {
        enabled: true,
        style: 'select',
        controls: clone(DEFAULT_ADMIN_CONTROLS),
      },
      forms: {
        enabled: false,
        create: [],
        close: [],
      },
    };
  }

  function createQuestion(type, order) {
    const base = {
      id: `question-${Date.now().toString(36)}-${order}`,
      order,
      type,
      question: type === 'text_display' ? 'Information shown before the questions.' : `Question ${order}`,
      required: !['text_display', 'checkbox'].includes(type),
    };
    if (type === 'text_input') Object.assign(base, { placeholder: '', textStyle: 'paragraph', minLength: 0, maxLength: 4000 });
    if (['string_select', 'radio_group', 'checkbox_group'].includes(type)) {
      base.options = [1, 2, 3].map((number) => ({ name: `Option ${number}`, emoji: '', description: '' }));
    }
    if (['string_select', 'user_select', 'role_select', 'channel_select', 'checkbox_group'].includes(type)) {
      Object.assign(base, { placeholder: '', minValues: base.required ? 1 : 0, maxValues: 1 });
    }
    if (type === 'file_upload') base.maxFiles = 1;
    if (type === 'checkbox') base.default = false;
    return base;
  }

  function normalizeConfig(config) {
    const source = config || {};
    return {
      enabled: source.enabled !== false,
      launcherStyle: source.launcherStyle === 'buttons' ? 'buttons' : 'select',
      launcherMessage: createMessage(source.launcherMessage, {
        content: '## Support Ticket\nChoose the ticket type that best matches your request.\n<separator>\n-# Staff will respond as soon as possible.',
        accentColor: '#FFFFFF',
        thumbnailUrl: '',
        imageUrl: '',
      }),
      types: Array.isArray(source.types) ? clone(source.types) : [],
    };
  }

  function buttonStyleControl(value, scope, index = '') {
    return `
      <div class="ticket-color-options" role="group" aria-label="Button color">
        ${[
          ['primary', 'Blurple'],
          ['secondary', 'Gray'],
          ['success', 'Green'],
          ['danger', 'Red'],
        ].map(([style, label]) => `
          <button class="ticket-color ${style}${value === style ? ' selected' : ''}" type="button"
            data-action="set-button-style" data-scope="${scope}" data-index="${index}" data-value="${style}"
            title="${label}" aria-label="${label}"></button>
        `).join('')}
      </div>
    `;
  }

  function segmented(value, scope, options) {
    return `<div class="segmented-control ticket-segmented">
      ${options.map(([option, label]) => `
        <button class="${value === option ? 'selected' : ''}" type="button"
          data-action="set-segment" data-scope="${scope}" data-value="${option}">${escapeHtml(label)}</button>
      `).join('')}
    </div>`;
  }

  function messageEditor(message, scope, title, description, placeholders, ticketType = null) {
    return `
      <div class="message-builder ticket-message-builder">
        <div class="panel message-editor">
          <div class="panel-heading">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="template-tokens">
            ${placeholders.map((token) => `<button type="button" data-action="insert-token" data-scope="${scope}" data-token="${escapeHtml(token)}">${escapeHtml(token)}</button>`).join('')}
          </div>
          <label>Message
            <textarea rows="10" maxlength="4000" data-message-scope="${scope}" data-message-field="content">${escapeHtml(message.content)}</textarea>
          </label>
          <div class="grid">
            <label>Container color <input type="color" value="${escapeHtml(message.accentColor)}" data-message-scope="${scope}" data-message-field="accentColor"></label>
            <label>Thumbnail URL <input type="text" maxlength="1000" value="${escapeHtml(message.thumbnailUrl)}" data-message-scope="${scope}" data-message-field="thumbnailUrl"></label>
            <label>Image URL <input type="url" maxlength="1000" value="${escapeHtml(message.imageUrl)}" data-message-scope="${scope}" data-message-field="imageUrl"></label>
          </div>
          <p class="condition-help">Discord Markdown is supported. Use <code>&lt;separator&gt;</code> when you want a divider between sections.</p>
        </div>
        ${messagePreview(message, scope, ticketType)}
      </div>
    `;
  }

  function previewFormAnswers(ticketType) {
    const questions = (ticketType?.forms?.create || [])
      .filter((question) => question?.type !== 'text_display');
    return questions.map((question, index) => {
      let answer = 'Example answer';
      if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
        answer = question.options?.[0]?.name || 'Example option';
      } else if (question.type === 'checkbox') {
        answer = 'Checked';
      } else if (question.type === 'file_upload') {
        answer = 'example-file.png';
      } else if (question.type === 'user_select') {
        answer = '@Member';
      } else if (question.type === 'role_select') {
        answer = '@Role';
      } else if (question.type === 'channel_select') {
        answer = '#channel';
      }
      return `**${index + 1}# ${question.question || `Question ${index + 1}`}**\n${String(answer).split('\n').map((line) => `-# ${line}`).join('\n')}`;
    }).join('\n\n');
  }

  function messagePreview(message, scope, ticketType = null) {
    const ticketName = String(ticketType?.name || 'Support');
    const channelName = `#${slug(ticketName)}-42`;
    const replacements = {
      '<@mention>': '@Member',
      '<username>': 'member',
      '<display_name>': 'Member',
      '<user_id>': '123456789012345678',
      '<ticket_name>': ticketName,
      '<ticket_id>': '42',
      '<channel>': channelName,
      '<server>': 'CoinSprite',
      '<avatar_url>': '',
      '<form-answer>': previewFormAnswers(ticketType),
    };
    let content = message.content || '';
    for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value);
    const sections = content.split(/<separator>/gi).map((part) => part.trim()).filter(Boolean);
    const sharedPreview = window.CoinSpriteMessageEditor?.renderPreview({
      content: '',
      containers: [{
        accentColor: message.accentColor,
        text: content,
        thumbnailUrl: message.thumbnailUrl,
        imageUrl: message.imageUrl,
      }],
    }, { hideEmptyRoot: true, containerClass: 'ticket-preview' });
    return `
      <aside class="message-sticky-preview external-message-sticky-preview">
        <div class="panel-heading">
          <h3>Live preview</h3>
          <p>Preview updates as you type. Click a message box, color bar, thumbnail, or image area to edit.</p>
        </div>
        ${sharedPreview || `<div class="message-discord-preview"><div class="preview-container ticket-preview" style="--preview-accent:${escapeHtml(message.accentColor)}">${sections.map((section, index) => `${index ? '<div class="preview-separator"></div>' : ''}<div class="ticket-preview-text">${renderDiscordMarkdown(section)}</div>`).join('')}</div></div>`}
      </aside>
    `;
  }

  window.createTicketEditor = function createTicketEditor(options) {
    const {
      root,
      renderPicker,
      channelOptions,
      roleOptions,
      onChange,
    } = options;
    const editorState = {
      config: normalizeConfig(),
      channels: { ticketPanel: '', ticketCategory: '', transcript: '' },
      activeMini: 'channel',
      view: 'list',
      selectedTypeId: '',
      activeTypeSection: 'settings',
      activeFormPhase: 'create',
      permissionTarget: '',
    };

    function currentType() {
      return editorState.config.types.find((type) => type.id === editorState.selectedTypeId) || null;
    }

    function changed(render = false) {
      onChange();
      if (render) renderEditor();
    }

    function renderChannelTab() {
      return `
        <div class="panel">
          <div class="panel-heading">
            <h3>Ticket channels</h3>
            <p>Choose where the public ticket launcher is sent, where new ticket channels are created, and where transcripts are archived.</p>
          </div>
          <div class="settings-grid ticket-channel-grid">
            <div class="picker-field"><span class="field-label">Ticket launcher channel</span><div id="ticketPanelChannelPicker"></div></div>
            <div class="picker-field"><span class="field-label">Default ticket category</span><div id="ticketCategoryPicker"></div></div>
            <div class="picker-field"><span class="field-label">Default transcript channel</span><div id="ticketTranscriptPicker"></div></div>
          </div>
        </div>
      `;
    }

    function refreshMessagePreview(scope) {
      const ticketType = currentType();
      const message = scope === 'launcher' ? editorState.config.launcherMessage : ticketType?.message;
      const textarea = root.querySelector(`textarea[data-message-scope="${scope}"]`);
      const preview = textarea?.closest('.ticket-message-builder')?.querySelector('.message-sticky-preview, .preview-panel');
      if (message && preview) preview.outerHTML = messagePreview(message, scope, scope === 'ticket' ? ticketType : null);
    }

    function renderTypeList() {
      const types = editorState.config.types;
      return `
        <div class="ticket-list-head">
          <div>
            <h3>Ticket types</h3>
            <p>Each type can use its own permissions, forms, messages, transcripts, and staff actions.</p>
          </div>
          <div class="ticket-list-actions">
            <button class="button subtle" type="button" data-action="open-defaults">Default settings</button>
            <button class="button primary" type="button" data-action="add-ticket" ${types.length >= 25 ? 'disabled' : ''}>Add ticket</button>
          </div>
        </div>
        ${types.length ? `<div class="ticket-card-grid">
          ${types.map((ticketType) => `
            <button class="ticket-type-card" type="button" data-action="edit-ticket" data-ticket-id="${escapeHtml(ticketType.id)}">
              <span class="ticket-type-icon">${escapeHtml(ticketType.emoji || '🎫')}</span>
              <span class="ticket-type-copy">
                <strong>${escapeHtml(ticketType.name)}</strong>
                <span>${escapeHtml(ticketType.description || 'No description')}</span>
              </span>
              <span class="ticket-card-arrow">›</span>
            </button>
          `).join('')}
        </div>` : '<div class="empty-state ticket-empty">No ticket types configured. Add one to publish it in the launcher.</div>'}
      `;
    }

    function renderDefaults() {
      const config = editorState.config;
      return `
        <div class="ticket-editor-head">
          <button class="icon-button" type="button" data-action="back-list" aria-label="Back to ticket types" title="Back">←</button>
          <div><h3>Default settings</h3><p>Controls the public message members use to choose a ticket type.</p></div>
        </div>
        <div class="panel">
          <div class="panel-heading"><h3>Launcher</h3><p>Selection panels show descriptions. Buttons use each ticket type's selected Discord button color.</p></div>
          <label class="checkline"><input type="checkbox" data-default-field="enabled" ${config.enabled ? 'checked' : ''}> Enable the public ticket launcher</label>
          <div class="mode-setting">
            <div><span class="field-label">Create ticket style</span></div>
            ${segmented(config.launcherStyle, 'launcher-style', [['select', 'Selection panel'], ['buttons', 'Buttons']])}
          </div>
        </div>
        ${messageEditor(
          config.launcherMessage,
          'launcher',
          'Ticket launcher message',
          'This is the public message containing the ticket selection panel or buttons. It is separate from the message sent inside a newly created ticket.',
          ['<server>', '<separator>'],
        )}
      `;
    }

    function renderSettings(ticketType) {
      const launcherStyle = editorState.config.launcherStyle;
      return `
        <div class="panel">
          <div class="panel-heading"><h3>Ticket settings</h3><p>Presentation, access, destination, and transcript behavior for this ticket type.</p></div>
          <div class="grid">
            <label>Ticket name <input type="text" maxlength="80" value="${escapeHtml(ticketType.name)}" data-ticket-field="name"></label>
            <label>Ticket emoji <input type="text" maxlength="100" value="${escapeHtml(ticketType.emoji)}" data-ticket-field="emoji" placeholder="🎫 or custom emoji"></label>
            ${launcherStyle === 'select' ? `<label class="span-two">Description <input type="text" maxlength="100" value="${escapeHtml(ticketType.description)}" data-ticket-field="description"></label>` : `
              <div><span class="field-label">Button color</span>${buttonStyleControl(ticketType.buttonStyle, 'ticket')}</div>
            `}
          </div>
          <div class="settings-grid ticket-settings-pickers">
            <div class="picker-field"><span class="field-label">Ticket staff roles</span><div id="ticketStaffRolesPicker"></div></div>
            <div class="picker-field"><span class="field-label">Ticket blacklist role</span><div id="ticketBlacklistRolePicker"></div></div>
            <div class="picker-field"><span class="field-label">Category override</span><div id="ticketCategoryOverridePicker"></div></div>
          </div>
          <div class="permission-buttons">
            <button class="button subtle" type="button" data-action="open-permissions" data-target="staffPermissions">Staff permissions <span>${ticketType.staffPermissions.length}</span></button>
            <button class="button subtle" type="button" data-action="open-permissions" data-target="authorPermissions">Ticket author permissions <span>${ticketType.authorPermissions.length}</span></button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-heading"><h3>Transcript</h3><p>When enabled, transcript actions save a copy and send it to the selected channel.</p></div>
          <label class="checkline"><input type="checkbox" data-ticket-field="transcriptEnabled" ${ticketType.transcriptEnabled ? 'checked' : ''}> Enable transcripts for this ticket</label>
          ${ticketType.transcriptEnabled ? '<div class="picker-field"><span class="field-label">Transcript channel override</span><div id="ticketTranscriptOverridePicker"></div></div>' : ''}
        </div>
        <div class="danger-zone">
          <div><strong>Delete ticket type</strong><span>Open tickets will keep their current settings.</span></div>
          <button class="button danger" type="button" data-action="delete-ticket">Delete</button>
        </div>
      `;
    }

    function renderAdminControl(control, index, ticketType) {
      const hasLink = Boolean(control.url);
      return `
        <article class="ticket-control-card">
          <div class="ticket-card-toolbar">
            <strong>Control ${index + 1}</strong>
            <button class="icon-button danger-text" type="button" data-action="remove-control" data-index="${index}" aria-label="Remove control" title="Remove">×</button>
          </div>
          <div class="grid">
            <label>Name <input type="text" maxlength="80" value="${escapeHtml(control.name)}" data-control-index="${index}" data-control-field="name"></label>
            ${ticketType.adminPanel.style === 'select' ? `
              <label>Emoji <input type="text" maxlength="100" value="${escapeHtml(control.emoji)}" data-control-index="${index}" data-control-field="emoji"></label>
              <label class="span-two">Description <input type="text" maxlength="100" value="${escapeHtml(control.description)}" data-control-index="${index}" data-control-field="description"></label>
            ` : `
              <label>Link URL <input type="url" maxlength="512" value="${escapeHtml(control.url)}" data-control-index="${index}" data-control-field="url" placeholder="Optional link button"></label>
              ${hasLink ? '<p class="inline-note span-two">Link buttons do not run ticket actions and do not use an emoji.</p>' : `
                <label>Emoji <input type="text" maxlength="100" value="${escapeHtml(control.emoji)}" data-control-index="${index}" data-control-field="emoji"></label>
                <div><span class="field-label">Button color</span>${buttonStyleControl(control.buttonStyle, 'control', index)}</div>
              `}
            `}
          </div>
          ${hasLink ? '' : renderActionSequence(control, index, ticketType)}
        </article>
      `;
    }

    function renderActionSequence(control, controlIndex, ticketType) {
      return `
        <div class="action-sequence">
          <div class="sequence-head"><span class="field-label">Actions when pressed</span><span>Close, transcript, and delete always execute in that order.</span></div>
          <div class="sequence-list">
            ${(control.actions || []).map((action, actionIndex) => `
              <div class="sequence-item">
                <span class="sequence-number">${actionIndex + 1}</span>
                <strong>${escapeHtml(ACTIONS.find(([value]) => value === action)?.[1] || action)}</strong>
                <div>
                  <button class="icon-button" type="button" data-action="move-action-up" data-control-index="${controlIndex}" data-action-index="${actionIndex}" title="Move up">↑</button>
                  <button class="icon-button" type="button" data-action="move-action-down" data-control-index="${controlIndex}" data-action-index="${actionIndex}" title="Move down">↓</button>
                  <button class="icon-button danger-text" type="button" data-action="remove-action" data-control-index="${controlIndex}" data-action-index="${actionIndex}" title="Remove" ${control.actions.length === 1 ? 'disabled' : ''}>×</button>
                </div>
              </div>
            `).join('') || '<div class="empty-state compact">No actions configured.</div>'}
          </div>
          <div class="sequence-add">
            <select data-action-select="${controlIndex}">
              ${ACTIONS.filter(([value]) => !(control.actions || []).includes(value)).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
            </select>
            <button class="button small" type="button" data-action="add-action" data-index="${controlIndex}">Add action</button>
          </div>
          ${(control.actions || []).includes('move_to') ? `
            <label>Move-to ticket type
              <select data-control-index="${controlIndex}" data-control-field="moveToTicketTypeId">
                <option value="">Select a destination</option>
                ${editorState.config.types.filter((type) => type.id !== ticketType.id).map((type) => `<option value="${escapeHtml(type.id)}" ${control.moveToTicketTypeId === type.id ? 'selected' : ''}>${escapeHtml(type.name)}</option>`).join('')}
              </select>
            </label>
          ` : ''}
        </div>
      `;
    }

    function renderAdminPanel(ticketType) {
      return `
        <div class="panel">
          <div class="panel-heading"><h3>Admin panel</h3><p>The panel is attached below the ticket message. Disable it when staff should manage this ticket only through commands.</p></div>
          <label class="checkline"><input type="checkbox" data-admin-field="enabled" ${ticketType.adminPanel.enabled ? 'checked' : ''}> Attach admin panel to the ticket message</label>
          ${ticketType.adminPanel.enabled ? `
            <div class="mode-setting">
              <div><span class="field-label">Panel type</span></div>
              ${segmented(ticketType.adminPanel.style, 'admin-style', [['select', 'Selection panel'], ['buttons', 'Buttons']])}
            </div>
          ` : ''}
        </div>
        ${ticketType.adminPanel.enabled ? `
          <div class="ticket-control-list">
            ${ticketType.adminPanel.controls.map((control, index) => renderAdminControl(control, index, ticketType)).join('')}
          </div>
          <button class="button small" type="button" data-action="add-control" ${ticketType.adminPanel.controls.length >= 25 ? 'disabled' : ''}>Add control</button>
        ` : ''}
      `;
    }

    function renderQuestion(question, index) {
      const optionLimit = question.type === 'string_select' ? 25 : 10;
      return `
        <article class="form-question-card">
          <div class="ticket-card-toolbar">
            <div><span class="question-order">${index + 1}</span><strong>${escapeHtml(FORM_TYPES.find(([value]) => value === question.type)?.[1] || question.type)}</strong></div>
            <div>
              <button class="icon-button" type="button" data-action="move-question-up" data-index="${index}" title="Move up">↑</button>
              <button class="icon-button" type="button" data-action="move-question-down" data-index="${index}" title="Move down">↓</button>
              <button class="icon-button danger-text" type="button" data-action="remove-question" data-index="${index}" title="Remove">×</button>
            </div>
          </div>
          <label class="question-order-field">Order
            <input type="number" min="1" max="5" value="${question.order}" data-question-index="${index}" data-question-field="order">
          </label>
          ${question.type === 'text_display' ? `
            <label>Text
              <textarea rows="5" maxlength="4000" data-question-index="${index}" data-question-field="question">${escapeHtml(question.question)}</textarea>
            </label>
          ` : `
            <div class="grid">
              <label class="span-two">Question <input type="text" maxlength="45" value="${escapeHtml(question.question)}" data-question-index="${index}" data-question-field="question"></label>
              ${question.type === 'checkbox' ? '' : `<label class="checkline"><input type="checkbox" data-question-index="${index}" data-question-field="required" ${question.required ? 'checked' : ''}> Required</label>`}
              ${['text_input', 'string_select', 'user_select', 'role_select', 'channel_select'].includes(question.type) ? `<label>Placeholder <input type="text" maxlength="${question.type === 'text_input' ? 100 : 150}" value="${escapeHtml(question.placeholder || '')}" data-question-index="${index}" data-question-field="placeholder"></label>` : ''}
              ${question.type === 'text_input' ? `
                <label>Input style
                  <select data-question-index="${index}" data-question-field="textStyle">
                    <option value="short" ${question.textStyle === 'short' ? 'selected' : ''}>Short</option>
                    <option value="paragraph" ${question.textStyle === 'paragraph' ? 'selected' : ''}>Paragraph</option>
                  </select>
                </label>
                <label>Minimum length <input type="number" min="0" max="4000" value="${question.minLength ?? 0}" data-question-index="${index}" data-question-field="minLength"></label>
                <label>Maximum length <input type="number" min="1" max="4000" value="${question.maxLength ?? 4000}" data-question-index="${index}" data-question-field="maxLength"></label>
              ` : ''}
              ${['string_select', 'user_select', 'role_select', 'channel_select', 'checkbox_group'].includes(question.type) ? `
                <label>Minimum choices <input type="number" min="0" max="25" value="${question.minValues ?? 0}" data-question-index="${index}" data-question-field="minValues"></label>
                <label>Maximum choices <input type="number" min="1" max="25" value="${question.maxValues ?? 1}" data-question-index="${index}" data-question-field="maxValues"></label>
              ` : ''}
              ${question.type === 'file_upload' ? `<label>Maximum files <input type="number" min="1" max="10" value="${question.maxFiles ?? 1}" data-question-index="${index}" data-question-field="maxFiles"></label>` : ''}
              ${question.type === 'checkbox' ? `<label class="checkline"><input type="checkbox" data-question-index="${index}" data-question-field="default" ${question.default ? 'checked' : ''}> Checked by default</label>` : ''}
            </div>
          `}
          ${['string_select', 'radio_group', 'checkbox_group'].includes(question.type) ? `
            <div class="form-options">
              <div class="sequence-head"><span class="field-label">Options</span><span>${question.options.length}/${optionLimit}</span></div>
              ${question.options.map((option, optionIndex) => `
                <div class="form-option-row ${question.type === 'string_select' ? 'string-option' : 'short-option'}">
                  <input type="text" maxlength="100" value="${escapeHtml(option.name)}" data-question-index="${index}" data-option-index="${optionIndex}" data-option-field="name" aria-label="Option name">
                  ${question.type === 'string_select' ? `<input class="emoji-input" type="text" maxlength="100" value="${escapeHtml(option.emoji || '')}" data-question-index="${index}" data-option-index="${optionIndex}" data-option-field="emoji" aria-label="Option emoji" placeholder="Emoji">` : ''}
                  <input type="text" maxlength="100" value="${escapeHtml(option.description || '')}" data-question-index="${index}" data-option-index="${optionIndex}" data-option-field="description" aria-label="Option description" placeholder="Description">
                  <button class="icon-button danger-text" type="button" data-action="remove-option" data-question-index="${index}" data-option-index="${optionIndex}" title="Remove">×</button>
                </div>
              `).join('')}
              <button class="button small" type="button" data-action="add-option" data-index="${index}" ${question.options.length >= optionLimit ? 'disabled' : ''}>Add option</button>
            </div>
          ` : ''}
        </article>
      `;
    }

    function renderForms(ticketType) {
      const phase = editorState.activeFormPhase;
      const questions = ticketType.forms[phase] || [];
      return `
        <div class="panel">
          <div class="panel-heading"><h3>Forms</h3><p>Creating forms collect details from the ticket author. Closing forms are completed by staff and included in the transcript.</p></div>
          <label class="checkline"><input type="checkbox" data-forms-field="enabled" ${ticketType.forms.enabled ? 'checked' : ''}> Enable ticket forms</label>
        </div>
        ${ticketType.forms.enabled ? `
          <div class="form-phase-switch">
            ${segmented(phase, 'form-phase', [['create', 'Creating ticket form'], ['close', 'Closing ticket form']])}
            <p>${phase === 'create' ? 'Sent to the ticket author before the channel is created.' : 'Completed by ticket staff before a close action runs.'}</p>
          </div>
          <div class="form-create-bar">
            <select id="newQuestionType">
              ${FORM_TYPES.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
            </select>
            <button class="button primary" type="button" data-action="add-question" ${questions.length >= 5 ? 'disabled' : ''}>Create</button>
            <span>${questions.length}/5 components</span>
          </div>
          <div class="form-question-list">
            ${questions.map(renderQuestion).join('') || '<div class="empty-state">No form components added.</div>'}
          </div>
        ` : ''}
      `;
    }

    function renderTypeEditor(ticketType) {
      const section = editorState.activeTypeSection;
      return `
        <div class="ticket-editor-head">
          <button class="icon-button" type="button" data-action="back-list" aria-label="Back to ticket types" title="Back">←</button>
          <div><h3>${escapeHtml(ticketType.emoji || '🎫')} ${escapeHtml(ticketType.name)}</h3><p>Edit this ticket type without affecting other ticket types.</p></div>
        </div>
        <nav class="mini-tabs ticket-type-tabs" aria-label="Ticket type settings">
          ${[
            ['settings', 'Ticket settings'],
            ['message', 'Ticket message'],
            ['admin', 'Admin panel'],
            ['forms', 'Forms'],
          ].map(([value, label]) => `<button class="mini-tab ${section === value ? 'active' : ''}" type="button" data-action="type-section" data-value="${value}">${label}</button>`).join('')}
        </nav>
        <div class="ticket-type-section">
          ${section === 'settings' ? renderSettings(ticketType) : ''}
          ${section === 'message' ? messageEditor(
            ticketType.message,
            'ticket',
            'Message inside the ticket',
            'Sent when the channel is created. Form answers are rendered in numbered Discord Markdown sections; uploaded files appear as links.',
            ['<@mention>', '<username>', '<display_name>', '<user_id>', '<ticket_name>', '<ticket_id>', '<channel>', '<server>', '<avatar_url>', '<form-answer>', '<separator>'],
            ticketType,
          ) : ''}
          ${section === 'admin' ? renderAdminPanel(ticketType) : ''}
          ${section === 'forms' ? renderForms(ticketType) : ''}
        </div>
      `;
    }

    function renderPermissionModal(ticketType) {
      if (!editorState.permissionTarget) return '';
      const selected = ticketType[editorState.permissionTarget] || [];
      const title = editorState.permissionTarget === 'staffPermissions' ? 'Ticket staff permissions' : 'Ticket author permissions';
      return `
        <div class="ticket-modal-backdrop" data-action="close-permissions">
          <section class="ticket-modal" role="dialog" aria-modal="true" aria-label="${title}" data-modal-content>
            <div class="ticket-modal-head"><div><h3>${title}</h3><p>These channel permissions are applied when a new ticket is created.</p></div><button class="icon-button" type="button" data-action="close-permissions">×</button></div>
            <div class="permission-grid">
              ${PERMISSIONS.map(([value, label]) => `<label class="permission-item"><input type="checkbox" data-permission="${value}" ${selected.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}
            </div>
            <div class="ticket-modal-actions"><button class="button primary" type="button" data-action="close-permissions">Done</button></div>
          </section>
        </div>
      `;
    }

    function mountPickers(ticketType) {
      const channels = channelOptions();
      const roles = roleOptions();
      const mountPicker = (id, list, selected, settings) => {
        const mount = root.querySelector(`#${id}`);
        if (mount) renderPicker(mount, list, selected, settings);
      };
      if (editorState.activeMini === 'channel') {
        mountPicker('ticketPanelChannelPicker', channels.filter((item) => item.optionType !== 'category'), editorState.channels.ticketPanel, {
          type: 'channel',
          placeholder: 'Select ticket launcher channel',
          onChange: (value) => { editorState.channels.ticketPanel = value; changed(true); },
        });
        mountPicker('ticketCategoryPicker', channels.filter((item) => item.optionType === 'category'), editorState.channels.ticketCategory, {
          type: 'channel',
          placeholder: 'Select category',
          onChange: (value) => { editorState.channels.ticketCategory = value; changed(true); },
        });
        mountPicker('ticketTranscriptPicker', channels.filter((item) => item.optionType !== 'category'), editorState.channels.transcript, {
          type: 'channel',
          placeholder: 'Select transcript channel',
          onChange: (value) => { editorState.channels.transcript = value; changed(true); },
        });
      }
      if (!ticketType || editorState.activeTypeSection !== 'settings') return;
      mountPicker('ticketStaffRolesPicker', roles, ticketType.staffRoleIds, {
        type: 'role',
        multiple: true,
        placeholder: 'Use the global staff role',
        onChange: (value) => { ticketType.staffRoleIds = value; changed(true); },
      });
      mountPicker('ticketBlacklistRolePicker', roles, ticketType.blacklistRoleId, {
        type: 'role',
        placeholder: 'Select blacklist role',
        onChange: (value) => { ticketType.blacklistRoleId = value; changed(true); },
      });
      mountPicker('ticketCategoryOverridePicker', channels.filter((item) => item.optionType === 'category'), ticketType.categoryChannelId, {
        type: 'channel',
        placeholder: 'Use default ticket category',
        onChange: (value) => { ticketType.categoryChannelId = value; changed(true); },
      });
      if (ticketType.transcriptEnabled) {
        mountPicker('ticketTranscriptOverridePicker', channels.filter((item) => item.optionType !== 'category'), ticketType.transcriptChannelId, {
          type: 'channel',
          placeholder: 'Use default transcript channel',
          onChange: (value) => { ticketType.transcriptChannelId = value; changed(true); },
        });
      }
    }

    function renderEditor() {
      const ticketType = currentType();
      root.innerHTML = `
        <nav class="mini-tabs ticket-main-tabs" aria-label="Ticket settings">
          <button class="mini-tab ${editorState.activeMini === 'channel' ? 'active' : ''}" type="button" data-action="main-mini" data-value="channel">Channel</button>
          <button class="mini-tab ${editorState.activeMini === 'ticket' ? 'active' : ''}" type="button" data-action="main-mini" data-value="ticket">Ticket</button>
        </nav>
        <div class="ticket-main-content">
          ${editorState.activeMini === 'channel' ? renderChannelTab() : `
            ${editorState.view === 'list' ? renderTypeList() : ''}
            ${editorState.view === 'defaults' ? renderDefaults() : ''}
            ${editorState.view === 'type' && ticketType ? renderTypeEditor(ticketType) : ''}
          `}
        </div>
        ${ticketType ? renderPermissionModal(ticketType) : ''}
      `;
      mountPickers(ticketType);
    }

    function updateBoundField(target) {
      const value = target.type === 'checkbox' ? target.checked
        : target.type === 'number' ? Number(target.value)
          : target.value;
      const ticketType = currentType();
      if (target.dataset.defaultField) editorState.config[target.dataset.defaultField] = value;
      if (target.dataset.ticketField && ticketType) ticketType[target.dataset.ticketField] = value;
      if (target.dataset.adminField && ticketType) ticketType.adminPanel[target.dataset.adminField] = value;
      if (target.dataset.formsField && ticketType) ticketType.forms[target.dataset.formsField] = value;
      if (target.dataset.messageScope) {
        const message = target.dataset.messageScope === 'launcher' ? editorState.config.launcherMessage : ticketType?.message;
        if (message) message[target.dataset.messageField] = value;
      }
      if (target.dataset.controlField && ticketType) {
        ticketType.adminPanel.controls[Number(target.dataset.controlIndex)][target.dataset.controlField] = value;
      }
      if (target.dataset.questionField && ticketType) {
        const question = ticketType.forms[editorState.activeFormPhase][Number(target.dataset.questionIndex)];
        if (question) question[target.dataset.questionField] = value;
      }
      if (target.dataset.optionField && ticketType) {
        const question = ticketType.forms[editorState.activeFormPhase][Number(target.dataset.questionIndex)];
        const option = question?.options?.[Number(target.dataset.optionIndex)];
        if (option) option[target.dataset.optionField] = value;
      }
      if (target.dataset.permission && ticketType && editorState.permissionTarget) {
        const permissions = new Set(ticketType[editorState.permissionTarget] || []);
        if (target.checked) permissions.add(target.dataset.permission);
        else permissions.delete(target.dataset.permission);
        ticketType[editorState.permissionTarget] = [...permissions];
      }
      changed();
    }

    root.addEventListener('input', (event) => {
      const target = event.target;
      if (
        target.dataset.defaultField || target.dataset.ticketField || target.dataset.adminField
        || target.dataset.formsField || target.dataset.messageScope || target.dataset.controlField
        || target.dataset.questionField || target.dataset.optionField || target.dataset.permission
      ) updateBoundField(target);
      if (target.dataset.messageScope) refreshMessagePreview(target.dataset.messageScope);
    });

    root.addEventListener('change', (event) => {
      const target = event.target;
      if (
        target.matches('input[type="checkbox"], select[data-control-field], select[data-question-field]')
        || target.dataset.controlField === 'url'
        || target.dataset.questionField === 'order'
      ) {
        updateBoundField(target);
        if (target.dataset.questionField === 'order') {
          const ticketType = currentType();
          const list = ticketType?.forms?.[editorState.activeFormPhase] || [];
          list.sort((a, b) => Number(a.order) - Number(b.order));
          list.forEach((question, index) => { question.order = index + 1; });
        }
        if (
          target.dataset.adminField === 'enabled' || target.dataset.formsField === 'enabled'
          || target.dataset.ticketField === 'transcriptEnabled' || target.dataset.controlField === 'url'
          || target.dataset.questionField === 'order'
        ) renderEditor();
      }
    });

    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      if (button.classList.contains('ticket-modal-backdrop') && event.target !== button) return;
      const action = button.dataset.action;
      const ticketType = currentType();
      if (action === 'main-mini') {
        editorState.activeMini = button.dataset.value;
        editorState.view = 'list';
        editorState.selectedTypeId = '';
        renderEditor();
      } else if (action === 'open-defaults') {
        editorState.view = 'defaults';
        renderEditor();
      } else if (action === 'back-list') {
        editorState.view = 'list';
        editorState.selectedTypeId = '';
        editorState.permissionTarget = '';
        renderEditor();
      } else if (action === 'add-ticket') {
        const next = createTicketType(editorState.config.types.length + 1);
        editorState.config.types.push(next);
        editorState.selectedTypeId = next.id;
        editorState.view = 'type';
        changed(true);
      } else if (action === 'edit-ticket') {
        editorState.selectedTypeId = button.dataset.ticketId;
        editorState.view = 'type';
        editorState.activeTypeSection = 'settings';
        renderEditor();
      } else if (action === 'delete-ticket' && ticketType) {
        if (!await window.coinSpriteUi.confirm(`Delete the "${ticketType.name}" ticket type?`, 'Delete ticket type?')) return;
        editorState.config.types = editorState.config.types.filter((type) => type.id !== ticketType.id);
        editorState.selectedTypeId = '';
        editorState.view = 'list';
        changed(true);
      } else if (action === 'type-section') {
        editorState.activeTypeSection = button.dataset.value;
        renderEditor();
      } else if (action === 'set-segment') {
        if (button.dataset.scope === 'launcher-style') editorState.config.launcherStyle = button.dataset.value;
        if (button.dataset.scope === 'admin-style' && ticketType) {
          ticketType.adminPanel.style = button.dataset.value;
          if (button.dataset.value === 'select') {
            ticketType.adminPanel.controls.forEach((control) => {
              control.url = '';
              if (!control.actions.length) control.actions = ['close'];
            });
          }
        }
        if (button.dataset.scope === 'form-phase') editorState.activeFormPhase = button.dataset.value;
        changed(true);
      } else if (action === 'set-button-style') {
        if (button.dataset.scope === 'ticket' && ticketType) ticketType.buttonStyle = button.dataset.value;
        if (button.dataset.scope === 'control' && ticketType) ticketType.adminPanel.controls[Number(button.dataset.index)].buttonStyle = button.dataset.value;
        changed(true);
      } else if (action === 'insert-token') {
        const textarea = root.querySelector(`textarea[data-message-scope="${button.dataset.scope}"]`);
        if (!textarea) return;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        textarea.setRangeText(button.dataset.token, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
      } else if (action === 'open-permissions') {
        editorState.permissionTarget = button.dataset.target;
        renderEditor();
      } else if (action === 'close-permissions') {
        editorState.permissionTarget = '';
        renderEditor();
      } else if (action === 'add-control' && ticketType) {
        const index = ticketType.adminPanel.controls.length + 1;
        ticketType.adminPanel.controls.push({
          id: `control-${Date.now().toString(36)}-${index}`,
          name: `Action ${index}`,
          emoji: '',
          description: '',
          buttonStyle: 'secondary',
          url: '',
          actions: ['close'],
          moveToTicketTypeId: '',
        });
        changed(true);
      } else if (action === 'remove-control' && ticketType) {
        ticketType.adminPanel.controls.splice(Number(button.dataset.index), 1);
        changed(true);
      } else if (action === 'add-action' && ticketType) {
        const index = Number(button.dataset.index);
        const select = root.querySelector(`[data-action-select="${index}"]`);
        if (select?.value) ticketType.adminPanel.controls[index].actions.push(select.value);
        changed(true);
      } else if (['remove-action', 'move-action-up', 'move-action-down'].includes(action) && ticketType) {
        const control = ticketType.adminPanel.controls[Number(button.dataset.controlIndex)];
        const index = Number(button.dataset.actionIndex);
        if (action === 'remove-action' && control.actions.length > 1) control.actions.splice(index, 1);
        if (action === 'move-action-up' && index > 0) [control.actions[index - 1], control.actions[index]] = [control.actions[index], control.actions[index - 1]];
        if (action === 'move-action-down' && index < control.actions.length - 1) [control.actions[index + 1], control.actions[index]] = [control.actions[index], control.actions[index + 1]];
        changed(true);
      } else if (action === 'add-question' && ticketType) {
        const list = ticketType.forms[editorState.activeFormPhase];
        if (list.length >= 5) return;
        const type = root.querySelector('#newQuestionType')?.value || 'text_input';
        list.push(createQuestion(type, list.length + 1));
        changed(true);
      } else if (['remove-question', 'move-question-up', 'move-question-down'].includes(action) && ticketType) {
        const list = ticketType.forms[editorState.activeFormPhase];
        const index = Number(button.dataset.index);
        if (action === 'remove-question') list.splice(index, 1);
        if (action === 'move-question-up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
        if (action === 'move-question-down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
        list.forEach((question, questionIndex) => { question.order = questionIndex + 1; });
        changed(true);
      } else if (action === 'add-option' && ticketType) {
        const question = ticketType.forms[editorState.activeFormPhase][Number(button.dataset.index)];
        const limit = question.type === 'string_select' ? 25 : 10;
        if (question.options.length < limit) question.options.push({ name: `Option ${question.options.length + 1}`, emoji: '', description: '' });
        changed(true);
      } else if (action === 'remove-option' && ticketType) {
        const question = ticketType.forms[editorState.activeFormPhase][Number(button.dataset.questionIndex)];
        if (question.options.length > 1) question.options.splice(Number(button.dataset.optionIndex), 1);
        changed(true);
      }
    });

    return {
      load(config, channels) {
        editorState.config = normalizeConfig(config);
        editorState.channels = {
          ticketPanel: channels?.ticketPanel || '',
          ticketCategory: channels?.ticketCategory || '',
          transcript: channels?.transcript || '',
        };
        editorState.activeMini = 'channel';
        editorState.view = 'list';
        editorState.selectedTypeId = '';
        editorState.permissionTarget = '';
        renderEditor();
      },
      getValue() {
        const value = clone(editorState.config);
        value.types.forEach((ticketType) => {
          ticketType.id = slug(ticketType.id || ticketType.name);
        });
        return {
          tickets: value,
          channels: clone(editorState.channels),
        };
      },
      render: renderEditor,
    };
  };
}());
