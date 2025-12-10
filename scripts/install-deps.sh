#!/usr/bin/env bash
set -euo pipefail

TARGET_NPM_VERSION="11.7.0"
UPGRADE_NPM=false

if [[ "${1:-}" == "--upgrade-npm" ]]; then
  UPGRADE_NPM=true
elif [[ "${UPGRADE_NPM:-false}" == "1" || "${UPGRADE_NPM:-false}" == "true" ]]; then
  UPGRADE_NPM=true
fi

version_lt() {
  # Returns 0 (true) if $1 < $2
  local ver1="$1" ver2="$2"
  [[ "$(printf '%s\n%s\n' "$ver1" "$ver2" | sort -V | head -n1)" != "$ver2" ]]
}

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed. Please install Node.js and npm first." >&2
  exit 1
fi

current_npm_version=$(npm -v)
echo "Detected npm ${current_npm_version}."

if version_lt "$current_npm_version" "$TARGET_NPM_VERSION"; then
  echo "A newer npm version is available: ${TARGET_NPM_VERSION}."
  if $UPGRADE_NPM; then
    echo "Upgrading npm to ${TARGET_NPM_VERSION}..."
    npm install -g "npm@${TARGET_NPM_VERSION}"
  else
    cat <<EON
To upgrade automatically, rerun with --upgrade-npm or set UPGRADE_NPM=1.
You can also upgrade manually with: npm install -g npm@${TARGET_NPM_VERSION}
EON
  fi
else
  echo "npm is up to date."
fi

echo "Installing project dependencies..."
npm install
