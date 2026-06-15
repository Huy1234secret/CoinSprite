(() => {
  window.__coinSpritePreviewPolishDisabled = true;

  const style = document.createElement('style');
  style.textContent = `
    .mini-tabs {
      z-index: 90 !important;
      isolation: isolate;
    }
  `;
  document.head.append(style);

  const resetButton = document.querySelector('#resetTabButton');
  const configForm = document.querySelector('#configForm');
  let resetView = null;

  function activeValue(selector) {
    return document.querySelector(selector)?.dataset.value || '';
  }

  function captureResetView() {
    const ticketsActive = document.querySelector('[data-panel="tickets"]')?.classList.contains('active');
    resetView = {
      scrollTop: configForm?.scrollTop || 0,
      ticket: null,
    };
    if (!ticketsActive) return;

    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;
    const heading = root.querySelector('.ticket-editor-head h3')?.textContent.trim() || '';
    const ticketName = root.querySelector('input[data-ticket-field="name"]')?.value.trim() || '';
    resetView.ticket = {
      main: activeValue('#ticketEditorRoot .ticket-main-tabs .mini-tab.active'),
      view: heading === 'Default settings' ? 'defaults' : ticketName ? 'type' : 'list',
      ticketName,
      section: activeValue('#ticketEditorRoot .ticket-type-tabs .mini-tab.active'),
      formPhase: activeValue('#ticketEditorRoot .form-phase-switch button.selected'),
    };
  }

  function clickValue(root, selector, value) {
    if (!value) return;
    const button = [...root.querySelectorAll(selector)].find((item) => item.dataset.value === value);
    button?.click();
  }

  function restoreResetView() {
    const snapshot = resetView;
    resetView = null;
    if (!snapshot) return;

    const root = document.querySelector('#ticketEditorRoot');
    const ticket = snapshot.ticket;
    if (root && ticket) {
      clickValue(root, '.ticket-main-tabs .mini-tab', ticket.main);
      if (ticket.main === 'ticket' && ticket.view === 'defaults') {
        root.querySelector('[data-action="open-defaults"]')?.click();
      } else if (ticket.main === 'ticket' && ticket.view === 'type') {
        const card = [...root.querySelectorAll('.ticket-type-card')].find((item) => (
          item.querySelector('.ticket-type-copy strong')?.textContent.trim() === ticket.ticketName
        ));
        card?.click();
        clickValue(root, '.ticket-type-tabs .mini-tab', ticket.section);
        clickValue(root, '.form-phase-switch button', ticket.formPhase);
      }
    }

    requestAnimationFrame(() => {
      if (configForm) configForm.scrollTop = snapshot.scrollTop;
    });
  }

  resetButton?.addEventListener('pointerdown', captureResetView, true);
  resetButton?.addEventListener('mousedown', () => {
    if (!resetView) captureResetView();
  }, true);
  resetButton?.addEventListener('click', () => setTimeout(restoreResetView, 0));
})();
