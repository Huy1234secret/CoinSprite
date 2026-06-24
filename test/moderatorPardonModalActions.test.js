const assert = require('node:assert/strict');
const test = require('node:test');

const { patchModeratorJs } = require('../commands/022-moderator-pardon-modal-actions');

test('moderator modal action clicks bypass the root-only click guard', () => {
  const source = [
    "document.addEventListener('click', async (event) => {",
    "    const action = event.target.closest('[data-moderator-action]')?.dataset.moderatorAction;",
    "    if (!action) return;",
    "    if (!event.target.closest('#moderatorRoot')) return;",
    "    if (action === 'confirm-pardon') event.preventDefault();",
    '});',
  ].join('\n');

  const patched = patchModeratorJs(source);
  assert.match(patched, /coinSpriteModeratorModalActionPatch/);
  assert.match(patched, /#moderatorModalBackdrop/);
  assert.equal(patchModeratorJs(patched), patched);
});
