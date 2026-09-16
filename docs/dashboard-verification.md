# Dashboard verification

## Completed

- Audited baseline `df4ba8d` before deleting the implementation. The audit lists 228 controls and 37 API call patterns. The contract test verifies that every audited ID and all six dashboard views remain available.
- Replaced the document shell, serialized component tree, overlapping stylesheets and monolithic browser entrypoints with readable view templates, one stylesheet, modular controllers and a reproducible checked-in bundle. Existing editor/domain algorithms were migrated to retain their edge cases; the transport, inventory and navigation lifecycle were rebuilt.
- Removed `admin/app.js`, `inventory.js`, `layout.js`, `dashboardTree.json`, `style.css`, `dashboard.css` and `brand-icon.png`. No obsolete dashboard-only dependency was present. Kept the Unicode emoji catalog and seven fonts because the picker and bot/card renderer use them. Added esbuild as a development-only build dependency.
- Backend changes are limited to serving the replacement document and assets. Bot logic, data schemas, databases, authorization, OAuth, CSRF, command registration, API routes and payload contracts are unchanged.
- Current bot images and favicon resolve through the existing `/bot-avatar.png`. Message previews resolve current session/server identities, leaving event-only variables visibly unresolved until the bot receives an event.
- Fixed the authoritative profile preview: decode the authenticated PNG with `createImageBitmap`, avoiding blob image URLs rejected by the existing CSP. Security headers remain unchanged.
- Added pending/error/retry states for guild loads, stale-response protection, unsaved guild-switch confirmation, write guards, explicit session recovery, accessible arrow-key tabs and account-menu Escape handling. Inventory/ticket fetches discard stale responses. Owner polling prevents overlapping samples and reports interrupted updates.

## Automated checks

- `npm ci`: successful.
- `npm run build:dashboard` / `node admin/build.cjs`: successful.
- `node --test --test-concurrency=1`: **266 passed, 0 failed** (baseline: 261 passed).
- `git diff --check`: successful.
- Added a reproducible-bundle check and client transport tests for CSRF, same-origin credentials, pending-write guards, session expiry, retained unsaved edits and network failures.
- Added an isolated integration test using the real HTTP server, signed sessions, authorization, CSRF, persisted configuration, template/folder and role CRUD, owner endpoints, profile/inventory/lottery endpoints, live avatar redirect and logout. The simulated Discord client is confined to `testSupport/dashboardServer.cjs` and never imported by production.
- Existing source-contract assertions now inspect the modular source; all original backend/game/renderer tests continue to run.

## Browser checks

Inspected at 1280px, 1440px and 390px widths using the in-app browser with the isolated test server. No production credentials or production Discord messages were used.

- Sign-in page, desktop navigation and mobile navigation; no page-level horizontal overflow at 390px or 1440px.
- Saved zero-second cooldown, role reward selection, inline announcement editing, and server configuration through the real APIs.
- Created and edited a message template; exercised controls and JSON views, observed the server rejecting an incomplete action, and reset the unsaved draft.
- Created a reaction-role template, added a role button, saved it, selected its channel and completed the publish confirmation against the simulated Discord client.
- Changed a welcome-event destination, saved Counting and Lottery channels, and inspected live owner metrics/console.
- Opened the emoji picker and its lazy catalog.
- Loaded the authoritative profile PNG, added/saved a text layer and inspected the desktop and mobile card studio.
- Loaded empty inventory and lottery history, date/search controls and empty-state pagination on mobile.
- No browser console errors in the inspected routes.

## Remaining environment checks

Real Discord OAuth callback, actual channel delivery, role assignment, and production bot/panel deployment require the deployed bot's credentials and environment. The tests use the real application boundaries with an isolated Discord client; they do not claim a production end-to-end run. Existing tests cover the underlying delivery, permissions, uploads, actions, inventory, lottery and renderer contracts, but every combinatorial editor interaction was not manually repeated in the browser.

Dependency installation reported three pre-existing advisories in the runtime dependency graph (two moderate, one high). Runtime dependencies were intentionally left intact; no unrelated dependency upgrade was included.

The audit checklist marks preserved implementation/contract coverage. Browser verification above lists the interactions actually exercised.
