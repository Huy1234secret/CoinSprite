(() => {
  if (window.__coinSpriteSitePages) return;
  window.__coinSpriteSitePages = true;

  const MAX_ATTACHMENT_BYTES = 650 * 1024;

  function pageRoot() {
    return document.querySelector('#siteInfoPage');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isLoggedIn() {
    return document.querySelector('#loginButton')?.hidden === true;
  }

  function hideMainViews() {
    document.querySelector('#loginPanel')?.setAttribute('hidden', '');
    document.querySelector('#appShell')?.setAttribute('hidden', '');
    document.querySelector('#ownerPanel')?.setAttribute('hidden', '');
  }

  function restoreMainView() {
    const root = pageRoot();
    if (root) root.hidden = true;
    if (isLoggedIn()) document.querySelector('#appShell')?.removeAttribute('hidden');
    else document.querySelector('#loginPanel')?.removeAttribute('hidden');
  }

  function shell(title, subtitle, body) {
    return `<section class="site-info-shell">
      <div class="site-info-head">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
        <button class="button subtle" type="button" data-site-action="close">Back</button>
      </div>
      ${body}
    </section>`;
  }

  function termsOfService() {
    return shell('Terms of Service', 'Rules for using CoinSprite services and dashboards.', `<section class="site-info-card">
      <h3>Service access</h3>
      <ul>
        <li>CoinSprite is provided for Discord server administration, notifications, and related community tools.</li>
        <li>Server administrators are responsible for how they configure bot features, channels, roles, and permissions.</li>
        <li>Access can be limited, suspended, or removed for abuse, spam, unauthorized automation, or unsafe behavior.</li>
      </ul>
      <h3>Data and content</h3>
      <ul>
        <li>The bot stores configuration, role IDs, dashboard settings, moderation records, and submitted bug reports when needed to operate.</li>
        <li>Do not submit secrets, passwords, payment data, or private personal information through dashboard forms.</li>
        <li>Bug-report attachments should only include information needed to reproduce or understand the issue.</li>
      </ul>
      <h3>Availability</h3>
      <ul>
        <li>GAG2 stock data and third-party integrations are best-effort and may be delayed, unavailable, or inaccurate.</li>
        <li>Features may change as the bot is improved or Discord platform requirements change.</li>
      </ul>
    </section>`);
  }

  function termsOfUse() {
    return shell('Terms of Use', 'Practical usage rules for admins and users interacting with CoinSprite.', `<section class="site-info-card">
      <h3>Allowed use</h3>
      <ol>
        <li>Use the dashboard only for servers where you have permission to manage bot settings.</li>
        <li>Keep notification roles, channels, and messages appropriate for your community.</li>
        <li>Report bugs with clear reproduction steps and avoid uploading unrelated private content.</li>
      </ol>
      <h3>Not allowed</h3>
      <ul>
        <li>Do not use the bot to harass, spam, impersonate, evade moderation, or disrupt Discord communities.</li>
        <li>Do not attempt to bypass owner-gated features or access another server's dashboard without permission.</li>
        <li>Do not upload malicious files or intentionally malformed content through report forms.</li>
      </ul>
      <h3>Admin responsibility</h3>
      <p>Admins should review role permissions, dashboard access, notification pings, and moderation settings before enabling features for a server.</p>
    </section>`);
  }

  function reportBugForm() {
    return shell('Report bugs', 'Send a bug report to the CoinSprite owner panel.', `<form class="site-info-card" id="bugReportForm">
      <div class="bug-report-grid">
        <label>Issue title <input name="title" maxlength="140" placeholder="Short summary" required></label>
        <label>Severity <select name="severity">
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select></label>
        <label>Category <select name="category">
          <option>Dashboard</option>
          <option>GAG2 stock</option>
          <option>Role assignment</option>
          <option>Command</option>
          <option>Moderation</option>
          <option>Other</option>
        </select></label>
        <label>Server ID <input name="guildId" inputmode="numeric" maxlength="20" placeholder="Optional Discord server ID"></label>
        <label class="wide">What happened? <textarea name="description" rows="5" maxlength="3000" required placeholder="Describe the bug clearly."></textarea></label>
        <label class="wide">What did you expect? <textarea name="expected" rows="3" maxlength="1500" placeholder="What should have happened instead?"></textarea></label>
        <label class="wide">Steps to reproduce <textarea name="steps" rows="4" maxlength="2000" placeholder="1. Open...\n2. Click...\n3. See..."></textarea></label>
        <label>Contact <input name="contact" maxlength="120" placeholder="Discord name or other contact"></label>
        <label>Attachment <input name="attachment" type="file" accept="image/*,video/*,.txt,.log,.json"></label>
      </div>
      <p>-# Maximum attachment size: ${Math.floor(MAX_ATTACHMENT_BYTES / 1024)} KB. Log in with Discord before submitting.</p>
      <div class="owner-form-actions"><button class="button primary" type="submit">Submit report</button><a class="button subtle" href="/auth/discord">Log in</a></div>
      <div class="bug-report-status" id="bugReportStatus" role="status"></div>
    </form>`);
  }

  function readAttachment(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (file.size > MAX_ATTACHMENT_BYTES) return reject(new Error(`Attachment must be ${Math.floor(MAX_ATTACHMENT_BYTES / 1024)} KB or smaller.`));
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const dataUrl = String(reader.result || '');
        resolve({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data: dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl,
        });
      }, { once: true });
      reader.addEventListener('error', () => reject(new Error('Could not read attachment.')), { once: true });
      reader.readAsDataURL(file);
    });
  }

  async function submitBugReport(form) {
    const status = form.querySelector('#bugReportStatus');
    status.textContent = 'Submitting report...';
    status.className = 'bug-report-status';
    try {
      const formData = new FormData(form);
      const attachment = await readAttachment(form.elements.attachment.files?.[0] || null);
      const body = {
        title: formData.get('title'),
        severity: formData.get('severity'),
        category: formData.get('category'),
        guildId: formData.get('guildId'),
        description: formData.get('description'),
        expected: formData.get('expected'),
        steps: formData.get('steps'),
        contact: formData.get('contact'),
        pageUrl: window.location.href,
        attachment,
      };
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
      form.reset();
      status.textContent = `Report submitted: ${payload.report?.id || 'saved'}`;
      status.className = 'bug-report-status ok';
    } catch (error) {
      status.textContent = error.message === 'Not logged in.' ? 'Log in with Discord before submitting a bug report.' : error.message;
      status.className = 'bug-report-status error';
    }
  }

  function showPage(page) {
    const root = pageRoot();
    if (!root) return;
    hideMainViews();
    root.hidden = false;
    if (page === 'terms-service') root.innerHTML = termsOfService();
    else if (page === 'terms-use') root.innerHTML = termsOfUse();
    else root.innerHTML = reportBugForm();
    root.scrollTop = 0;
  }

  document.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-site-page]');
    if (pageButton) {
      event.preventDefault();
      showPage(pageButton.dataset.sitePage);
      return;
    }
    if (event.target.closest('[data-site-action="close"]')) {
      event.preventDefault();
      restoreMainView();
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'bugReportForm') return;
    event.preventDefault();
    submitBugReport(event.target);
  });
})();
