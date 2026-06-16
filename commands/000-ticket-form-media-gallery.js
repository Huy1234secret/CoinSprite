const ticketConfig = require('../src/ticketConfig');

const MEDIA_FILE_EXTENSIONS = new Set([
  '.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp',
  '.mp4', '.mov', '.m4v', '.webm', '.mpeg', '.mpg', '.ogg', '.ogv', '.avi', '.mkv',
]);

const mediaByFormAnswerText = new Map();

function uploadFileExtension(filename) {
  const clean = String(filename || '').toLowerCase().split('?')[0];
  const dotIndex = clean.lastIndexOf('.');
  return dotIndex === -1 ? '' : clean.slice(dotIndex);
}

function isValidUploadUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function isMediaUpload(item) {
  const contentType = String(item?.contentType || '').toLowerCase();
  if (contentType.startsWith('image/') || contentType.startsWith('video/')) return true;
  return MEDIA_FILE_EXTENSIONS.has(uploadFileExtension(item?.filename || item?.url));
}

function sanitizeAttachmentName(filename, fallbackIndex = 0) {
  const base = String(filename || `upload-${fallbackIndex + 1}`).trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || `upload-${fallbackIndex + 1}`;
}

function collectMediaUploads(questionAnswerPairs) {
  return (Array.isArray(questionAnswerPairs) ? questionAnswerPairs : [])
    .flatMap((entry) => Array.isArray(entry?.uploadedFiles) ? entry.uploadedFiles : [])
    .filter((item) => isValidUploadUrl(item?.url) && isMediaUpload(item))
    .slice(0, 10);
}

function buildMediaFiles(mediaUploads) {
  return mediaUploads.map((item, index) => ({
    attachment: item.url,
    name: sanitizeAttachmentName(item.filename, index),
  }));
}

function buildMediaGallery(mediaUploads) {
  const items = mediaUploads.map((item, index) => {
    const filename = sanitizeAttachmentName(item.filename, index);
    return {
      media: { url: `attachment://${filename}` },
      description: filename,
    };
  });
  return items.length ? { type: 12, items } : null;
}

function rememberMediaForAnswer(answerText, mediaUploads) {
  if (!answerText || mediaUploads.length === 0) return;
  if (mediaByFormAnswerText.size > 100) mediaByFormAnswerText.clear();
  mediaByFormAnswerText.set(answerText, mediaUploads);
}

function attachMediaGallery(payload, mediaUploads) {
  const gallery = buildMediaGallery(mediaUploads);
  if (!gallery) return payload;
  const container = payload?.components?.find((component) => component?.type === 17 && Array.isArray(component.components));
  if (!container || container.components.length > 38) return payload;
  container.components.push({ type: 14, divider: true, spacing: 1 }, gallery);
  payload.files = [...(Array.isArray(payload.files) ? payload.files : []), ...buildMediaFiles(mediaUploads)];
  return payload;
}

if (!ticketConfig.__coinSpriteTicketFormMediaGalleryPatch) {
  const originalFormatFormAnswers = ticketConfig.formatFormAnswers;
  const originalBuildTicketMessagePayload = ticketConfig.buildTicketMessagePayload;

  ticketConfig.formatFormAnswers = function patchedFormatFormAnswers(questionAnswerPairs) {
    const answerText = originalFormatFormAnswers(questionAnswerPairs);
    rememberMediaForAnswer(answerText, collectMediaUploads(questionAnswerPairs));
    return answerText;
  };

  ticketConfig.buildTicketMessagePayload = function patchedBuildTicketMessagePayload(messageValue, context = {}, extraComponents = []) {
    const payload = originalBuildTicketMessagePayload(messageValue, context, extraComponents);
    const mediaUploads = mediaByFormAnswerText.get(context.formAnswers) || [];
    mediaByFormAnswerText.delete(context.formAnswers);
    return attachMediaGallery(payload, mediaUploads);
  };

  Object.defineProperty(ticketConfig, '__coinSpriteTicketFormMediaGalleryPatch', {
    value: true,
    enumerable: false,
  });
}

module.exports = {};
