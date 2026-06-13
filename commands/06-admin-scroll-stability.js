'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const ADMIN_INDEX_PATH = path.join(__dirname, '..', 'admin', 'index.html');

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function stabilityScript() {
  return String.raw`
(() => {
  const ROOT_SELECTOR = '#ticketEditorRoot';
  const SCROLLER_SELECTOR = '#configForm';
  let saved = null;
  let scheduled = false;

  function scroller() {
    return document.querySelector(SCROLLER_SELECTOR) || document.scrollingElement || document.documentElement;
  }

  function scrollRect(element) {
    return element === document.scrollingElement || element === document.documentElement
      ? { top: 0 }
      : element.getBoundingClientRect();
  }

  function locate(root, info) {
    if (!info) return root;
    if (info.kind === 'control') return root.querySelectorAll('.ticket-control-card')[info.index] || root;
    if (info.kind === 'question') return root.querySelectorAll('.form-question-card')[info.index] || root;
    if (info.kind === 'panel') return root.querySelectorAll('.ticket-type-section > .panel, .ticket-main-content > .panel')[info.index] || root;
    return root;
  }

  function capture(target) {
    const root = target.closest(ROOT_SELECTOR);
    const scrollElement = scroller();
    if (!root || !scrollElement) return null;
    const control = target.closest('.ticket-control-card');
    const question = target.closest('.form-question-card');
    const panel = target.closest('.ticket-type-section > .panel, .ticket-main-content > .panel');
    let anchor = { kind: 'root', index: 0 };
    if (control) anchor = { kind: 'control', index: [...root.querySelectorAll('.ticket-control-card')].indexOf(control) };
    else if (question) anchor = { kind: 'question', index: [...root.querySelectorAll('.form-question-card')].indexOf(question) };
    else if (panel) anchor = { kind: 'panel', index: [...root.querySelectorAll('.ticket-type-section > .panel, .ticket-main-content > .panel')].indexOf(panel) };
    const node = locate(root, anchor);
    return {
      scrollTop: scrollElement.scrollTop,
      top: node.getBoundingClientRect().top - scrollRect(scrollElement).top,
      anchor,
    };
  }

  function restore() {
    scheduled = false;
    if (!saved) return;
    const root = document.querySelector(ROOT_SELECTOR);
    const scrollElement = scroller();
    if (!root || !scrollElement) return;
    const node = locate(root, saved.anchor);
    if (node) {
      const nextTop = node.getBoundingClientRect().top - scrollRect(scrollElement).top;
      scrollElement.scrollTop += nextTop - saved.top;
    } else {
      scrollElement.scrollTop = saved.scrollTop;
    }
  }

  function schedule(event) {
    const target = event.target;
    if (!target?.closest?.(ROOT_SELECTOR)) return;
    if (event.type === 'input' && !target.matches('input[type="checkbox"], input[type="number"], select')) return;
    saved = capture(target) || saved;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(restore);
    setTimeout(restore, 0);
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }

  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
})();
`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/admin/admin-stability.js') {
    send(res, 200, stabilityScript(), 'application/javascript; charset=utf-8');
    return true;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/index.html')) {
    fs.readFile(ADMIN_INDEX_PATH, 'utf8', (error, source) => {
      if (error) {
        send(res, 404, 'Not found');
        return;
      }
      const tag = '  <script src="/admin/admin-stability.js" defer></script>\n';
      send(res, 200, source.includes('/admin/admin-stability.js') ? source : source.replace('</body>', `${tag}</body>`), 'text/html; charset=utf-8');
    });
    return true;
  }
  return false;
}

http.createServer = function adminScrollStabilityServer(listener) {
  return previousCreateServer((req, res) => {
    handle(req, res)
      .then((handled) => { if (!handled) listener(req, res); })
      .catch((error) => send(res, error?.statusCode || 500, JSON.stringify({ error: error?.message || 'Internal server error.' }), 'application/json; charset=utf-8'));
  });
};

module.exports = {};
