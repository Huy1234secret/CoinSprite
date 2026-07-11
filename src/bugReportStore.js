const path = require('path');
const { readJsonFile, writeJsonAtomic } = require('./jsonFileStore');

const STORE_PATH = path.join(__dirname, '..', 'data', 'bug-reports.json');
const MAX_ATTACHMENT_BYTES = 650 * 1024;
const MAX_REPORTS = 500;
const VALID_STATUSES = new Set(['open', 'reviewed', 'closed']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function defaultState() {
  return {
    version: 1,
    reports: [],
  };
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function cleanDiscordId(value) {
  const id = text(value, 24);
  return /^\d{16,20}$/.test(id) ? id : '';
}

function normalizeStatus(value) {
  const status = text(value, 20).toLowerCase();
  return VALID_STATUSES.has(status) ? status : 'open';
}

function normalizeSeverity(value) {
  const severity = text(value, 20).toLowerCase();
  return VALID_SEVERITIES.has(severity) ? severity : 'medium';
}

function normalizeAttachment(value) {
  if (!isPlainObject(value)) return null;
  const name = text(value.name, 120) || 'attachment';
  const type = text(value.type, 120) || 'application/octet-stream';
  const data = String(value.data || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  const size = Math.max(0, Math.floor(Number(value.size) || 0));
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  const estimatedBytes = Math.floor((data.length * 3) / 4);
  const finalSize = size || estimatedBytes;
  if (finalSize > MAX_ATTACHMENT_BYTES || estimatedBytes > MAX_ATTACHMENT_BYTES) {
    const error = new Error(`Attachment must be ${Math.floor(MAX_ATTACHMENT_BYTES / 1024)} KB or smaller.`);
    error.statusCode = 400;
    throw error;
  }
  return {
    name,
    type,
    size: finalSize,
    data,
  };
}

function normalizeReport(value) {
  const report = isPlainObject(value) ? value : {};
  return {
    id: text(report.id, 64),
    status: normalizeStatus(report.status),
    severity: normalizeSeverity(report.severity),
    category: text(report.category, 80) || 'Other',
    title: text(report.title, 140),
    description: text(report.description, 3000),
    expected: text(report.expected, 1500),
    steps: text(report.steps, 2000),
    pageUrl: text(report.pageUrl, 500),
    guildId: cleanDiscordId(report.guildId),
    contact: text(report.contact, 120),
    reporter: isPlainObject(report.reporter) ? {
      id: cleanDiscordId(report.reporter.id),
      username: text(report.reporter.username, 80),
      globalName: text(report.reporter.globalName, 80),
    } : { id: '', username: '', globalName: '' },
    attachment: normalizeAttachment(report.attachment),
    createdAt: text(report.createdAt, 40) || new Date().toISOString(),
    updatedAt: text(report.updatedAt, 40) || text(report.createdAt, 40) || new Date().toISOString(),
  };
}

function normalizeState(raw) {
  const state = isPlainObject(raw) ? raw : {};
  const reports = (Array.isArray(state.reports) ? state.reports : [])
    .map((report) => {
      try {
        return normalizeReport(report);
      } catch {
        return null;
      }
    })
    .filter((report) => report?.id && report.title && report.description)
    .slice(0, MAX_REPORTS);
  return { version: 1, reports };
}

function loadState(filePath = STORE_PATH) {
  const raw = readJsonFile(filePath, { fallback: defaultState, label: 'Bug reports' });
  return normalizeState(raw);
}

function saveState(state, filePath = STORE_PATH) {
  const normalized = normalizeState(state);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

function reportId(now = Date.now()) {
  return `bug-${Number(now).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBugReport(body, session, options = {}) {
  const now = options.now || Date.now();
  const createdAt = new Date(now).toISOString();
  const report = normalizeReport({
    id: reportId(now),
    status: 'open',
    severity: body?.severity,
    category: body?.category,
    title: body?.title,
    description: body?.description,
    expected: body?.expected,
    steps: body?.steps,
    pageUrl: body?.pageUrl,
    guildId: body?.guildId,
    contact: body?.contact,
    reporter: {
      id: session?.user?.id,
      username: session?.user?.username,
      globalName: session?.user?.globalName,
    },
    attachment: body?.attachment,
    createdAt,
    updatedAt: createdAt,
  });
  if (!report.title) {
    const error = new Error('Title is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!report.description) {
    const error = new Error('Bug description is required.');
    error.statusCode = 400;
    throw error;
  }
  const state = loadState(options.filePath);
  state.reports.unshift(report);
  state.reports = state.reports.slice(0, MAX_REPORTS);
  saveState(state, options.filePath);
  return report;
}

function listBugReports(options = {}) {
  const limit = Math.max(1, Math.min(200, Math.round(Number(options.limit) || 100)));
  return loadState(options.filePath).reports.slice(0, limit);
}

function updateBugReportStatus(id, status, options = {}) {
  const reportId = text(id, 64);
  const nextStatus = normalizeStatus(status);
  const state = loadState(options.filePath);
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    const error = new Error('Bug report was not found.');
    error.statusCode = 404;
    throw error;
  }
  report.status = nextStatus;
  report.updatedAt = new Date(options.now || Date.now()).toISOString();
  saveState(state, options.filePath);
  return report;
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  STORE_PATH,
  createBugReport,
  listBugReports,
  updateBugReportStatus,
};
