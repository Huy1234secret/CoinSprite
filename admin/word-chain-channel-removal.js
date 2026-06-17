(() => {
  if (window.__coinSpriteWordChainChannelRemoval) return;
  window.__coinSpriteWordChainChannelRemoval = true;

  function removeWordChainChannelPicker() {
    document.querySelectorAll('.word-chain-tools .picker-field').forEach((field) => {
      const label = field.querySelector('.field-label')?.textContent?.trim().toLowerCase() || '';
      if (label === 'word chain game channel') field.remove();
    });
  }

  new MutationObserver(removeWordChainChannelPicker).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', removeWordChainChannelPicker);
  removeWordChainChannelPicker();
})();
