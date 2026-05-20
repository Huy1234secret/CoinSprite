const fs = require('fs');
const path = require('path');

const TRANSCRIPT_DIR = path.join(__dirname, '..', 'transcripts');
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function sanitizeBaseName(value) {
  const safe = String(value || 'Transcript')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || 'Transcript';
}

function getMonthlyTranscriptPath(baseName, date = new Date()) {
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const month = MONTH_NAMES[date.getMonth()] || 'Unknown';
  return path.join(TRANSCRIPT_DIR, `${sanitizeBaseName(baseName)} - month ${month}.txt`);
}

function appendTranscriptSection(baseName, headerLines, transcriptLines, date = new Date()) {
  const filePath = getMonthlyTranscriptPath(baseName, date);
  const sectionParts = [
    `Transcript saved at: ${date.toISOString()}`,
    ...headerLines,
    '',
    ...transcriptLines,
  ];
  const prefix = fs.existsSync(filePath) ? '\n\n---\n\n' : '';
  fs.appendFileSync(filePath, `${prefix}${sectionParts.join('\n')}\n`, 'utf8');
  return filePath;
}

module.exports = {
  appendTranscriptSection,
  getMonthlyTranscriptPath,
};
