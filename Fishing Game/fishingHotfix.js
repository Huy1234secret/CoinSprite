// Compatibility entry point for older imports.
// The fishing hotfix logic has been merged into fishingFeature.js.
// Rewriting and recompiling fishingFeature.js here caused duplicate top-level
// declarations such as FISHING_BITE_TIMEOUT_MS after the merge.

module.exports = require('./fishingFeature');
