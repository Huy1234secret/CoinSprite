'use strict';

const messageTemplates = require('../src/messageTemplates');

const UPDATED_AT = new Date(0).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeDefaultTemplate({ id, name, accentColor, lines, thumbnailUrl = '', imageUrl = '' }) {
  return Object.freeze({
    id,
    type: 'template',
    folderId: '',
    name,
    content: '',
    containers: [{
      id: id.replace(/^default-/, '').slice(0, 40),
      accentColor,
      text: lines.join('\n'),
      thumbnailUrl,
      imageUrl,
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: UPDATED_AT,
  });
}

const EXTRA_DEFAULT_BOT_TEMPLATES = Object.freeze([
  makeDefaultTemplate({
    id: 'default-level-up-message',
    name: 'Default: Level-up message',
    accentColor: '#57F287',
    thumbnailUrl: '<avatar_url>',
    lines: [
      '## Level up!',
      '<@mention> reached **Level <level>** in **<server>**.',
      '<separator>',
      '<if<level>==5,"Bro discovered the chat button.","">',
      '<if<level>==10,"Double digits. The grind begins.","">',
      '<if<level>==25,"Quarter century of yapping.","">',
      '<if<level>==50,"Halfway to the big 100. Respect.","">',
      '<if<level>==100,"Someone give them grass... or a trophy.","">',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-ticket-launcher-message',
    name: 'Default: Ticket launcher',
    accentColor: '#FFFFFF',
    lines: [
      '## Support Ticket',
      'Choose the ticket type that best matches your request.',
      '<separator>',
      '-# Please do not open joke, false, or duplicate tickets.',
      '-# Staff will respond as soon as they are available.',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-ticket-open-message',
    name: 'Default: Ticket opened message',
    accentColor: '#FFFFFF',
    thumbnailUrl: '<avatar_url>',
    lines: [
      '<@mention> Welcome!',
      '## <ticket_name> ticket',
      'Our staff will be with you soon. Please provide the information needed to help us resolve your request.',
      '<separator>',
      '<form-answer>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-ticket-transcript-saving',
    name: 'Default: Ticket transcript saving',
    accentColor: '#FFF200',
    lines: ['Transcript saving!...'],
  }),
  makeDefaultTemplate({
    id: 'default-ticket-transcript-saved',
    name: 'Default: Ticket transcript saved',
    accentColor: '#00FF00',
    lines: ['Transcript saved!'],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-transcript-proof-saved',
    name: 'Default: Giveaway transcript proof saved',
    accentColor: '#00FF00',
    lines: ['Transcript saved with winner claim evidence attached to the transcript message!'],
  }),
  makeDefaultTemplate({
    id: 'default-ticket-deleting',
    name: 'Default: Ticket deleting',
    accentColor: '#FF0000',
    lines: ['Deleting ticket...'],
  }),
  makeDefaultTemplate({
    id: 'default-auto-moderator-user-warning',
    name: 'Default: Auto-Moderator user warning',
    accentColor: '#ED4245',
    lines: [
      '## Message blocked',
      '<@mention>, your message was blocked by Auto-Moderator.',
      '**Reason:** <moderation-reason>',
      '-# If this was a mistake, please contact staff.',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-warning-notice',
    name: 'Default: Warning notice',
    accentColor: '#FEE75C',
    thumbnailUrl: '<avatar_url>',
    lines: [
      '## Warning notice',
      '<@mention>',
      'You received a warning in **<server-name>**.',
      '**Case:** <case-id>',
      '**Reason:** <moderation-reason>',
      '**Points:** +<points> (<active-points> active total)',
      '**Expires:** <expires>',
      '**Evidence:** <evidence>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-warning-history',
    name: 'Default: Warning history',
    accentColor: '#FEE75C',
    lines: [
      '## Warning history for <username>',
      '**Active points:** <active-points>',
      '<separator>',
      '<warning-case-list>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-warning-case-detail',
    name: 'Default: Warning case detail',
    accentColor: '#FEE75C',
    thumbnailUrl: '<avatar_url>',
    lines: [
      '## Case <case-id>',
      '**Target:** <@mention>',
      '**Type:** <case-type>',
      '**Status:** <case-status>',
      '**Points:** <points>',
      '**Source:** <case-source>',
      '**Reason:** <moderation-reason>',
      '**Expires:** <expires>',
      '**Notice delivery:** <notice-delivery>',
      '**Notification message:** <notification-message-id>',
      '**Staff log message:** <staff-log-message-id>',
      '<separator>',
      '**Recent audit events**',
      '<case-audit-events>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-role-request-review',
    name: 'Default: Role request review',
    accentColor: '#F1C40F',
    lines: [
      "### <@<user-id>> role request.",
      '* userID: <user-id>',
      '* Roblox username: <roblox-username>',
      '-# Game user player: <game>',
      '**Status:** <status>',
      '-# <status-note>',
      '<separator>',
      '**Uploaded files / media**',
      '<uploaded-file-list>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-request-review',
    name: 'Default: Giveaway request review',
    accentColor: '#F1C40F',
    lines: [
      '### <@<user-id>> giveaway request.',
      '* userID: <user-id>',
      '* Prize: <giveaway-prize>',
      '* Winners: <winner-count>',
      '* Claim time: <claim-time>',
      '**Status:** <status>',
      '-# <status-note>',
      '<separator>',
      '**Uploaded files / media**',
      '<uploaded-file-list>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-setup-panel',
    name: 'Default: Giveaway setup panel',
    accentColor: '#5865F2',
    lines: [
      '## <giveaway-prize>',
      '-# **Ends after Start is pressed**',
      '-# **Hoster: <giveaway-host>**',
      '<giveaway-description>',
      '<separator>',
      '-# * Claim time: <claim-time>',
      '-# * Winners: <winner-count>',
      '-# * Requirements: <giveaway-requirement>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-live-message',
    name: 'Default: Giveaway live message',
    accentColor: '#5865F2',
    lines: [
      '## <giveaway-prize>',
      '-# **Ends <giveaway-ends>**',
      '-# **Hoster: <@<host-id>>**',
      '<giveaway-description>',
      '<separator>',
      '-# * Claim time: <claim-time>',
      '-# * Winners: <winner-count>',
      '-# * Requirements: <giveaway-requirement>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-claim-round',
    name: 'Default: Giveaway claim round',
    accentColor: '#F1C40F',
    lines: [
      '### <giveaway-prize>',
      '-# Winners: <winner-list>',
      '<separator>',
      'Claimed: <claimed-count> / <winner-count> - <claimed-users>',
      'Reroll <reroll-time>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-all-claimed',
    name: 'Default: Giveaway all claimed',
    accentColor: '#57F287',
    lines: ['All winners have claimed their prizes.'],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-claim-closed',
    name: 'Default: Giveaway claim closed',
    accentColor: '#ED4245',
    lines: [
      'Claimed: <claimed-users>',
      'Unclaimed: <unclaimed-count>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-no-more-users',
    name: 'Default: Giveaway no more users',
    accentColor: '#ED4245',
    lines: [
      'Unclaimed: <unclaimed-count>',
      'There are no more users left to roll.',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-final-message',
    name: 'Default: Giveaway final message',
    accentColor: '#57F287',
    lines: [
      '## <giveaway-prize>',
      '-# Final winner: <winner-list>',
      '<giveaway-description>',
      '<separator>',
      '-# * Claim time: <claim-time>',
      '-# * Requirements: <giveaway-requirement>',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-hoster-dm',
    name: 'Default: Giveaway host DM',
    accentColor: '#5865F2',
    lines: [
      '<@mention> has claimed <giveaway-prize>.',
      '-# Be sure to give them the prizes and provide evidence after the giveaway ends.',
    ],
  }),
  makeDefaultTemplate({
    id: 'default-giveaway-list',
    name: 'Default: Giveaway list',
    accentColor: '#5865F2',
    lines: [
      'Giveaway list:',
      '<giveaway-list>',
    ],
  }),
]);

const EXTRA_DEFAULTS_BY_ID = new Map(EXTRA_DEFAULT_BOT_TEMPLATES.map((template) => [template.id, template]));

function mergeDefaultTemplate(baseDefault, saved) {
  const merged = {
    ...clone(baseDefault),
    ...(saved || {}),
    id: baseDefault.id,
    type: 'template',
    folderId: '',
    name: baseDefault.name,
    botDefault: true,
    defaultLocked: true,
  };
  const rootContent = String(merged.content || '').trim();
  merged.content = '';
  if (rootContent) {
    const containers = Array.isArray(merged.containers) && merged.containers.length
      ? merged.containers
      : clone(baseDefault.containers);
    containers[0] = {
      ...clone(baseDefault.containers[0]),
      ...(containers[0] || {}),
      text: String(containers[0]?.text || '').trim() || rootContent,
    };
    merged.containers = containers;
  }
  return merged;
}

function withExtraDefaults(templates) {
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((item) => item?.id).map((item) => [item.id, item]));
  for (const base of EXTRA_DEFAULT_BOT_TEMPLATES) {
    byId.set(base.id, mergeDefaultTemplate(base, byId.get(base.id)));
  }
  return [...byId.values()];
}

function patchMessageTemplateExports(exportsObject) {
  if (!exportsObject || exportsObject.__coinSpriteExtraBotDefaultsPatched) return exportsObject;

  const nativeDefaults = Array.isArray(exportsObject.DEFAULT_BOT_TEMPLATES) ? exportsObject.DEFAULT_BOT_TEMPLATES : [];
  const nativeListTemplates = exportsObject.listTemplates.bind(exportsObject);
  const nativeFindTemplate = exportsObject.findTemplate.bind(exportsObject);
  const nativeSaveTemplate = exportsObject.saveTemplate.bind(exportsObject);
  const nativeDeleteTemplate = exportsObject.deleteTemplate.bind(exportsObject);
  const combinedDefaults = new Map(nativeDefaults.filter((item) => item?.id).map((item) => [item.id, item]));

  for (const base of EXTRA_DEFAULT_BOT_TEMPLATES) combinedDefaults.set(base.id, base);

  exportsObject.DEFAULT_BOT_TEMPLATES = Object.freeze([...combinedDefaults.values()].map(clone));
  exportsObject.listTemplates = (guildId) => withExtraDefaults(nativeListTemplates(guildId));
  exportsObject.findTemplate = (guildId, templateId) => {
    if (EXTRA_DEFAULTS_BY_ID.has(templateId)) {
      return exportsObject.listTemplates(guildId).find((template) => template.id === templateId && template.type !== 'folder') || null;
    }
    return nativeFindTemplate(guildId, templateId);
  };
  exportsObject.saveTemplate = (guildId, value) => {
    const baseDefault = EXTRA_DEFAULTS_BY_ID.get(value?.id);
    if (!baseDefault) return nativeSaveTemplate(guildId, value);
    return mergeDefaultTemplate(baseDefault, nativeSaveTemplate(guildId, mergeDefaultTemplate(baseDefault, value)));
  };
  exportsObject.deleteTemplate = (guildId, templateId) => EXTRA_DEFAULTS_BY_ID.has(templateId) ? false : nativeDeleteTemplate(guildId, templateId);
  Object.defineProperty(exportsObject, '__coinSpriteExtraBotDefaultsPatched', { value: true });
  return exportsObject;
}

patchMessageTemplateExports(messageTemplates);

module.exports = { EXTRA_DEFAULT_BOT_TEMPLATES, patchMessageTemplateExports };
