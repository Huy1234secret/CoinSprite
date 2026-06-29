const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('../commands/017-moderator-case-style-fix');
require('../commands/021-warning-count-admin-ui');
require('../commands/023-moderation-sanction-case-ui');
require('../commands/024-spam-automod-admin-ui');
require('../commands/025-community-messages-admin');
require('../commands/026-appeal-admin-ui');

test('runtime admin assets include sanctions, Spam AutoMod, rich messages, and appeals', () => {
  const moderator = fs.readFileSync(path.join(__dirname, '..', 'admin', 'moderator.js'), 'utf8');
  assert.match(moderator, /coinSpriteSanctionCaseUiV1/);
  assert.match(moderator, /coinSpriteSpamAutoModAdminV1/);
  assert.match(moderator, /caseLayoutEvidence/);
  assert.match(moderator, /Appealable/);
  assert.match(moderator, /spamMessageCount/);
  assert.match(moderator, /\['auto', 'Link'\], \['text', 'Text'\]/);
  assert.doesNotMatch(moderator, /Link Moderation/);
  const linkRenderer = moderator.match(/function renderAutoPanel\(\) \{[\s\S]*?function renderTextPanel\(\)/)?.[0] || '';
  assert.doesNotMatch(linkRenderer, /renderSpamPanel\(\)/);
  assert.match(moderator, /'mute', 'kick', 'ban'/);

  const index = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  assert.match(index, /\/admin\/rich-message-editor\.js/);
  assert.match(index, /\/admin\/community-messages\.js/);
  assert.match(index, /\/admin\/appeals\.js/);
  assert.match(moderator, /data-moderator-workspace="appeal"/);
  assert.match(moderator, /data-case-field="publicNote"/);
  assert.doesNotMatch(moderator, /warningCreatePoints/);

  const community = fs.readFileSync(path.join(__dirname, '..', 'admin', 'community-messages.js'), 'utf8');
  assert.match(community, /CoinSpriteRichEditor/);
  assert.match(community, /communityCollectPatch/);
  assert.doesNotMatch(community, /communityMessageSave|Save messages/);
  const inlineEditor = fs.readFileSync(path.join(__dirname, '..', 'admin', 'message-inline-editor.js'), 'utf8');
  assert.match(inlineEditor, /root\?\.querySelector\?/);
  assert.match(inlineEditor, /CoinSpriteInlineMessageEditor/);
  const richEditor = fs.readFileSync(path.join(__dirname, '..', 'admin', 'rich-message-editor.js'), 'utf8');
  assert.match(richEditor, /rich-preview-stage/);
  assert.match(richEditor, /\.rich-container-tools\{position:static/);
  assert.doesNotMatch(richEditor, /\.rich-container-tools\{position:absolute/);
  const appeals = fs.readFileSync(path.join(__dirname, '..', 'admin', 'appeals.js'), 'utf8');
  assert.match(appeals, /appeal-settings/);
  assert.match(appeals, /appeal-form/);
  assert.match(appeals, /appeal-message/);
  assert.match(appeals, /appeal-form-designer/);
  assert.match(appeals, /appealCollectPatch/);
  assert.match(appeals, /installMainSaveIntegration/);
  assert.match(appeals, /__coinSpriteModeratorTab/);
  assert.doesNotMatch(appeals, /id="appealSave"|Save appeal settings/);
  assert.match(appeals, /--appeal-surface/);
  assert.match(moderator, /moderationActionLogChannelMount/);

  const userData = fs.readFileSync(path.join(__dirname, '..', 'admin', 'user-data.js'), 'utf8');
  assert.match(index, /id="userModerationAction"/);
  assert.match(index, /id="userModerationCases"/);
  assert.match(userData, /applyModerationAction/);
  assert.match(userData, /loadModerationCases/);

  const adminServer = fs.readFileSync(path.join(__dirname, '..', 'src', 'adminServer.js'), 'utf8');
  assert.match(adminServer, /executeSanction/);
  assert.match(adminServer, /action === 'warn'/);
});
