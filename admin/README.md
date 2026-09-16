# Community workspace

The dashboard uses a white and warm grey design with ochre accents. `document.cjs` composes the application shell and readable feature templates in `views/`. `workspace.css` is the single presentation stylesheet. All bot avatars and the favicon use the existing `/bot-avatar.png` endpoint.

Client source lives in `client/`: session and navigation, the shared HTTP transport, guild settings, message composers, templates, reaction roles, emoji selection, owner polling, card studio, and inventory. The existing domain rules, configuration normalization, message validation, and exact card-rendering algorithms were migrated into the feature controllers to preserve behavior. The old monolithic controller, DOM tree, two overlapping stylesheets, inventory script, and static brand icon are no longer served or required.

Run `npm ci`, then `npm run build:dashboard` after client changes. Commit the generated `workspace.js` so production can continue installing runtime dependencies only. `npm test` includes the audited control contract, asset versioning, font checks, and an isolated test of the real server/auth/configuration APIs. No production credentials are needed for these checks.

For interactive verification, run `node testSupport/dashboardServer.cjs` and open `http://127.0.0.1:4173/test-login`. This helper uses temporary storage, a test-only session and a simulated Discord client. It is not imported by any production entrypoint. The real dashboard contains no demo API or test data.

See `docs/dashboard-audit.md` for the pre-replacement feature/control/API inventory and `docs/dashboard-verification.md` for verification and remaining live-environment checks. The generated Unicode emoji catalog and all Fontsource packages remain: they support the emoji picker and the shared bot/card renderer, respectively.
