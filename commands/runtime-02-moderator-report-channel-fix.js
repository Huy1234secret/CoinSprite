const fs = require('fs');
const path = require('path');

const ADMIN_MODERATOR_PATH = path.join(__dirname, '..', 'admin', 'moderator.js');
const ADMIN_MODERATOR_CSS_PATH = path.join(__dirname, '..', 'admin', 'moderator.css');
const ADMIN_PATCH_MARKER = '__coinSpriteModeratorReportChannelFix';
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function replaceOnce(text, oldValue, newValue) {
  const index = text.indexOf(oldValue);
  if (index < 0) return text;
  return `${text.slice(0, index)}${newValue}${text.slice(index + oldValue.length)}`;
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(ADMIN_PATCH_MARKER)) return text;

  text = replaceOnce(text,
    "    if (actionType === 'timeout') {\n      next.durationSeconds = clampSeconds(source.durationSeconds, 300);\n    }\n    return next;\n  }",
    "    if (actionType === 'timeout') {\n      next.durationSeconds = clampSeconds(source.durationSeconds, 300);\n    }\n    if (actionType === 'report' || actionType === 'log') {\n      next.reportChannelId = String(source.reportChannelId || source.channelId || '');\n    }\n    return next;\n  }",
  );
  text = replaceOnce(text, '  function actionFields(action) {', '  function actionFields(action, index) {');
  text = replaceOnce(text,
    "    if (action.type === 'timeout') {\n      return `<label class=\"automod-duration-field\">Timeout seconds <input data-link-action-field=\"durationSeconds\" type=\"number\" min=\"1\" max=\"2419200\" step=\"1\" value=\"${Number(action.durationSeconds) || 300}\"></label>`;\n    }\n    return '';\n  }",
    "    if (action.type === 'timeout') {\n      return `<label class=\"automod-duration-field\">Timeout seconds <input data-link-action-field=\"durationSeconds\" type=\"number\" min=\"1\" max=\"2419200\" step=\"1\" value=\"${Number(action.durationSeconds) || 300}\"></label>`;\n    }\n    if (action.type === 'report' || action.type === 'log') {\n      const label = action.type === 'report' ? 'Report channel' : 'Log channel';\n      return `<div class=\"picker-field automod-report-channel\"><span class=\"field-label\">${label}</span><div id=\"linkReportChannelMount-${index}\" data-link-report-channel-mount data-action-index=\"${index}\"></div></div>`;\n    }\n    return '';\n  }",
  );
  text = text.replace('      ${actionFields(normalized)}', '      ${actionFields(normalized, index)}');
  text = replaceOnce(text,
    "    const excludeRoles = root.querySelector('#linkExcludeRolesMount');\n    if (excludeRoles) renderPicker(excludeRoles, roleOptions(), link.excludeRoleIds, {\n      multiple: true, type: 'role', placeholder: 'No excluded roles',\n      onChange: (value) => setAndDirty(() => { link.excludeRoleIds = uniqueIds(value); }),\n    });\n  }",
    "    const excludeRoles = root.querySelector('#linkExcludeRolesMount');\n    if (excludeRoles) renderPicker(excludeRoles, roleOptions(), link.excludeRoleIds, {\n      multiple: true, type: 'role', placeholder: 'No excluded roles',\n      onChange: (value) => setAndDirty(() => { link.excludeRoleIds = uniqueIds(value); }),\n    });\n    root.querySelectorAll('[data-link-report-channel-mount]').forEach((mount) => {\n      const index = Number(mount.dataset.actionIndex);\n      renderPicker(mount, textChannelOptions(), link.actions[index]?.reportChannelId || '', {\n        type: 'channel',\n        placeholder: 'Use default log channel',\n        onChange: (value) => setAndDirty(() => {\n          if (link.actions[index]) link.actions[index].reportChannelId = value;\n        }),\n      });\n    });\n  }",
  );
  return `${text}\n;(() => { window.${ADMIN_PATCH_MARKER} = true; })();\n`;
}

function patchModeratorCss(source) {
  let text = String(source || '');
  if (text.includes(`/* ${ADMIN_PATCH_MARKER} */`)) return text;
  text = replaceOnce(text, '.message-section-tabs {\n  display: grid;', '.message-section-tabs {\n  position: relative;\n  z-index: 2;\n  display: grid;');
  text = replaceOnce(text, '.message-section-tabs button {\n  min-height: 42px;', '.message-section-tabs button {\n  position: relative;\n  z-index: 3;\n  touch-action: manipulation;\n  min-height: 42px;');
  text = replaceOnce(text, '.message-create-menu {\n  position: absolute;\n  z-index: 20;', '.message-create-menu {\n  position: absolute;\n  z-index: 90;');
  text += `\n/* ${ADMIN_PATCH_MARKER} */\n.automod-action-row[data-action-type="report"],\n.automod-action-row[data-action-type="log"] {\n  grid-template-columns: minmax(150px, 0.55fr) minmax(260px, 1fr) auto;\n}\n\n.automod-report-channel {\n  min-width: 0;\n}\n\n@media (max-width: 1100px) {\n  .automod-action-row[data-action-type="report"],\n  .automod-action-row[data-action-type="log"] {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n@media (max-width: 700px) {\n  .automod-action-row[data-action-type="report"],\n  .automod-action-row[data-action-type="log"] {\n    grid-template-columns: 1fr;\n  }\n}\n`;
  return text;
}

function patchAdminFile(filePath, source) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved === path.resolve(ADMIN_MODERATOR_PATH)) return patchModeratorJs(source);
  if (resolved === path.resolve(ADMIN_MODERATOR_CSS_PATH)) return patchModeratorCss(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminFile(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithModeratorReportChannelPatch(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return nativeReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithModeratorReportChannelPatch(filePath, options) {
  const data = nativeReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
