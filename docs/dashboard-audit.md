# Dashboard replacement audit

Baseline: df4ba8d, inspected before changing or deleting the dashboard implementation.

## Functional preservation checklist

- [x] Entry routes /, /admin, /admin/, /profile and /profile/; Discord sign-in with returnTo; account menu and CSRF-protected sign-out.
- [x] Server selector restricted to accessible guilds, owner-only fleet navigation, owner-controlled Leveling lock, URL guild/view/template/folder links.
- [x] Leveling: enable, XP min/max, zero-second cooldown, base/growth/max level curve, announcements/channel, channel multipliers, colored role selectors, role XP boosts, stack/highest milestone rewards.
- [x] XP drops: enable, global/fallback channels, repeat claim, images, editable drop/claim messages, ranges, chance, claim limits, duration units, despawn, colors, add/remove crates and zero-XP test send.
- [x] Shared Components V2 composer: markdown, inline editing, variables, separators, containers, accent, thumbnail, image galleries, upload, preview, save/use template; custom bot/server and lazily loaded Unicode emoji catalog.
- [x] Welcome: join, leave, boost, separate enable/channel/message/media configuration and reset.
- [x] Templates: search, folders create/rename/delete, CRUD/duplicate, editor/controls/JSON/settings/share tabs, JSON validation, variable references, buttons/dropdowns/options/emoji/actions, role/message/DM/ephemeral targets, save/reset, channel send/edit and share links.
- [x] Reaction roles: CRUD/duplicate, enable, message composer, buttons/dropdowns, role selection, style/emoji, channel/publish and published-message link.
- [x] Games: counting channel and command-specific channel settings, add/remove restrictions.
- [x] Owner: ping, uptime, server/member totals, heap/storage, guild enable/disable with reason/confirmation, per-guild Leveling access, open guild, refresh, bounded console, pause/resume/clear.
- [x] Profile: actual user avatar, card templates, background/image upload, text layers, visibility, layer selection, inspector, fonts/styles/color, position/size/rotation, drag/resize/snap, undo/redo/shortcuts, save/reset and authoritative server preview.
- [x] Inventory: live items, quantity/rarity/type/value/description tooltips, 50-slot paging, refresh, lottery tickets, date/search/page, prize and currency results.
- [x] Loading, empty, permission, saved/unsaved and API error states; keyboard focus, labeled controls and native modal dialogs.

## Architecture and data boundaries

The old admin/layout.js assembled dashboardTree.json. admin/app.js bound the controls and made same-origin requests; inventory.js handled the inventory. style.css and dashboard.css overlapped (dashboard.css was referenced in HTML but absent from PUBLIC_ASSETS). emojiData.js is generated Unicode catalog data, not a UI controller. All seven Fontsource packages also serve exact card rendering and must remain.

Authentication remains in src/adminServer.js: Discord OAuth state validation, server-persisted HttpOnly session cookie, Administrator guild permissions and owner permission gates. GET /api/me returns the session user, accessible guilds, owner flag and CSRF token. Browser mutations send X-CSRF-Token. OAuth credentials, bot token and session secret remain server-only.

Bot connections remain in src/adminServer.js / ownerPanelRoutes.js: configuration APIs persist existing server config, synchronize bot commands, and call the existing template/role/drop services; profile uses the authoritative level-card renderer; inventory and lottery use existing global player services. No new database or synthetic production data is needed. Existing GET /bot-avatar.png redirects to client.user.displayAvatarURL and is the source of current bot identity.

Live updates use HTTP polling, not WebSockets/SSE: owner metrics every 2 seconds and console every 2.2 seconds (after cursor, 250 initial / 100 incremental, maximum 500 visible entries). Polling stops when leaving owner view; profile preview is debounced 350ms. Emoji catalog is lazy loaded in batches of 96, search debounced 120ms; ticket search 200ms.

## Observed API calls

- `/api/guilds/${guildId}/config`
- `/api/guilds/${guildId}/directory`
- `/api/guilds/${guildId}/message-templates`
- `/api/guilds/${guildId}/reaction-roles`
- `/api/guilds/${state.guildId}/config`
- `/api/guilds/${state.guildId}/leveling-media`
- `/api/guilds/${state.guildId}/message-media`
- `/api/guilds/${state.guildId}/message-template-folders`
- `/api/guilds/${state.guildId}/message-template-folders/${folderId}`
- `/api/guilds/${state.guildId}/message-templates`
- `/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}`
- `/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/duplicate`
- `/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/send`
- `/api/guilds/${state.guildId}/reaction-roles`
- `/api/guilds/${state.guildId}/reaction-roles/${draft.id}`
- `/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}`
- `/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/duplicate`
- `/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/publish`
- `/api/guilds/${state.guildId}/xp-drops/test`
- `/api/me`
- `/api/owner/console?after=${state.consoleAfter}&limit=${reset ? 250 : 100}`
- `/api/owner/guilds/${input.dataset.guildId}/features`
- `/api/owner/metrics`
- `/api/owner/overview`
- `/api/profile/card`
- `/api/profile/card/media`
- `/api/profile/card/preview`
- `/api/profile/inventory`
- `/api/profile/lottery?${query}`
- `/auth/logout`
- `folder`
- `guild`
- `tab`
- `template`
- `view`
- `x-coinsprite-design-hash`
- `x-coinsprite-render-source`

All mutation methods and bodies are retained in the feature controllers. /auth/logout uses POST. Configuration/card saves and item updates use PATCH; create/duplicate/publish/send/upload/test actions use POST; deletions use DELETE. Inventory, directory, collections, owner data and session use GET.

## Existing controls and binding contract

IDs are a preservation inventory, not a requirement to retain the old presentation. Dynamic controls also use data attributes in the feature controllers.

| Page | ID | Element | Type / label |
| --- | --- | --- | --- |
| Profile | profileShell | main |  |
| Profile | profileAvatar | img |  |
| Profile | profileName | h1 | Member |
| Profile | profileCardTab | button | button Level card |
| Profile | profileInventoryTab | button | button Inventory |
| Profile | webInventory | section |  |
| Profile | ticketHistoryButton | button | button Lottery tickets &amp; history |
| Profile | inventoryRefresh | button | button Refresh |
| Profile | inventoryStatus | p |  |
| Profile | inventoryGrid | div |  |
| Profile | inventoryPrevious | button | button Previous |
| Profile | inventoryPage | span |  |
| Profile | inventoryNext | button | button Next |
| Profile | inventoryTooltip | div |  |
| Profile | ticketDialog | dialog |  |
| Profile | ticketClose | button | button Close |
| Profile | ticketDate | select |  |
| Profile | ticketSearch | input | search |
| Profile | ticketStatus | p |  |
| Profile | ticketList | div |  |
| Profile | ticketPrevious | button | button Previous |
| Profile | ticketPage | span |  |
| Profile | ticketNext | button | button Next |
| Profile | cardTemplateSelect | select |  |
| Profile | cardTemplateButton | button | button Apply |
| Profile | cardUndoButton | button | button &#8617; |
| Profile | cardRedoButton | button | button &#8618; |
| Profile | cardBackgroundButton | button | button Upload background |
| Profile | cardImageButton | button | button + Image or icon |
| Profile | cardTextButton | button | button + Text |
| Profile | cardBackgroundFile | input | file |
| Profile | cardImageFile | input | file |
| Profile | cardLayerList | div |  |
| Profile | cardCanvasWrap | div |  |
| Profile | levelCardCanvas | canvas |  |
| Profile | levelCardDraftCanvas | canvas |  |
| Profile | cardPreviewLabel | p |  |
| Profile | cardInspectorTitle | h3 | Background |
| Profile | cardInspector | div |  |
| Profile | profileSaveDock | footer |  |
| Profile | cardResetButton | button | button Reset |
| Profile | cardSaveButton | button | button Save level card |
| leveling | levelingView | section |  |
| leveling | levelingEnabled | input | checkbox |
| leveling | levelingXpMin | input | number |
| leveling | levelingXpMax | input | number |
| leveling | levelingCooldown | input | number |
| leveling | levelingBaseXp | input | number |
| leveling | levelingGrowth | input | number |
| leveling | levelingMaxLevel | input | number |
| leveling | levelingCurvePreview | div |  |
| leveling | levelingAnnounceEnabled | input | checkbox |
| leveling | levelingAnnounceChannel | select |  |
| leveling | levelingUseTemplate | button | button Use template |
| leveling | levelingSaveAsTemplate | button | button Save as template |
| leveling | levelingEmojiToggle | button | button Emoji |
| leveling | levelingVariablesToggle | button | button { } Variables |
| leveling | levelingContainerAdd | button | button Container |
| leveling | levelingAdditionalContainerAdd | button | button + Container |
| leveling | levelingThumbnailAdd | button | button Thumbnail |
| leveling | levelingGalleryAdd | button | button Gallery |
| leveling | levelingComposerPanel | div |  |
| leveling | levelingDiscordFrame | div |  |
| leveling | levelingAccentButton | button | button |
| leveling | levelingAccentColor | input | color |
| leveling | levelingMessagePreview | div |  |
| leveling | levelingAdditionalContainers | div |  |
| leveling | xpDropsEnabled | input | checkbox |
| leveling | xpDropChannel | select |  |
| leveling | xpDropAdd | button | button + Add crate |
| leveling | xpDropVariables | div |  |
| leveling | xpDropEmojiToggle | button | button Emoji |
| leveling | xpDropMessagePreview | div |  |
| leveling | xpClaimEmojiToggle | button | button Emoji |
| leveling | xpDropClaimPreview | div |  |
| leveling | xpDropList | div |  |
| leveling | xpDropTestCrate | select |  |
| leveling | xpDropTestChannel | select |  |
| leveling | xpDropTestButton | button | button Send test |
| leveling | levelingChannels | div |  |
| leveling | levelingAddBoost | button | button + Add role boost |
| leveling | levelingBoosts | div |  |
| leveling | levelingAddReward | button | button + Add reward |
| leveling | levelingStackRewards | input | checkbox |
| leveling | levelingRewards | div |  |
| games | gamesView | section |  |
| games | countingChannel | select |  |
| games | lotteryChannel | select |  |
| games | gameCommandSettings | div |  |
| games | gameAddCommandSetting | button | button + Add command setting |
| member-messages | welcomeMessagesView | section |  |
| member-messages | welcomeMessagesEnabled | input | checkbox |
| member-messages | welcomeEventStep | span | 01 |
| member-messages | welcomeEventTitle | h2 | Join message |
| member-messages | welcomeEventReset | button | button Reset join default |
| member-messages | welcomeEventDescription | p | Sent after a new member joins this Discord server. |
| member-messages | welcomeEventToggleCopy | small | Send when a member joins |
| member-messages | welcomeEventEnabled | input | checkbox |
| member-messages | welcomeEventChannel | select |  |
| member-messages | welcomeUseTemplate | button | button Use template |
| member-messages | welcomeSaveAsTemplate | button | button Save as template |
| member-messages | welcomePreviewLabel | span | JOIN PREVIEW |
| member-messages | welcomeEmojiToggle | button | button Emoji |
| member-messages | welcomeVariablesToggle | button | button { } Variables |
| member-messages | welcomeContainerAdd | button | button Container |
| member-messages | welcomeAdditionalContainerAdd | button | button + Container |
| member-messages | welcomeThumbnailAdd | button | button Thumbnail |
| member-messages | welcomeGalleryAdd | button | button Gallery |
| member-messages | welcomeComposerPanel | div |  |
| member-messages | welcomeDiscordFrame | div |  |
| member-messages | welcomeAccentButton | button | button |
| member-messages | welcomeAccentColor | input | color |
| member-messages | welcomeMessagePreview | div |  |
| member-messages | welcomeAdditionalContainers | div |  |
| message-templates | messageTemplatesView | section |  |
| message-templates | templateCreateButton | button | button + New template |
| message-templates | templateManager | div |  |
| message-templates | templateTotalCount | small | 0 templates |
| message-templates | templateFolderCreate | button | button + |
| message-templates | templateFolderList | nav |  |
| message-templates | templateSearch | input | search |
| message-templates | templateListCreate | button | button + |
| message-templates | templateList | div |  |
| message-templates | templateEmptyState | div |  |
| message-templates | templateEmptyCreate | button | button Create template |
| message-templates | templateEditor | div |  |
| message-templates | templateStatusBadge | span | SAVED |
| message-templates | templateEditorTitle | h2 | Untitled template |
| message-templates | templateTimestamps | p |  |
| message-templates | templateDuplicateButton | button | button Duplicate |
| message-templates | templateDeleteButton | button | button Delete |
| message-templates | templateCharacterCount | strong | 0 / 4000 |
| message-templates | templateEmojiToggle | button | button Emoji |
| message-templates | templateVariablesToggle | button | button { } Variables |
| message-templates | templateContainerAdd | button | button Container |
| message-templates | templateAdditionalContainerAdd | button | button + Container |
| message-templates | templateThumbnailAdd | button | button Thumbnail |
| message-templates | templateGalleryAdd | button | button Gallery |
| message-templates | templateComposerPanel | div |  |
| message-templates | templateDiscordFrame | div |  |
| message-templates | templateAccentButton | button | button |
| message-templates | templateAccentColor | input | color |
| message-templates | templateMessagePreview | div |  |
| message-templates | templateAdditionalContainers | div |  |
| message-templates | templateControlPreview | div |  |
| message-templates | templateControls | div |  |
| message-templates | templateAddControl | button | button + Add button |
| message-templates | templateJsonFormat | button | button Format JSON |
| message-templates | templateJsonCopy | button | button Copy JSON |
| message-templates | templateJsonImport | button | button Import / replace |
| message-templates | templateJsonEditor | textarea |  |
| message-templates | templateJsonError | p |  |
| message-templates | templateResolvedPayload | pre |  |
| message-templates | templateName | input | text |
| message-templates | templateFolderSelect | select |  |
| message-templates | templateDescription | textarea |  |
| message-templates | templateChannel | select |  |
| message-templates | templateEnabled | input | checkbox |
| message-templates | templateVariableReference | div |  |
| message-templates | templateSendHint | small | Save changes before sending. |
| message-templates | templateSendChannel | select |  |
| message-templates | templateSendTest | button | button Send test |
| message-templates | templateSendNow | button | button Send now |
| message-templates | templateShareLink | input | text |
| message-templates | templateCopyLink | button | button Copy template link |
| reaction-roles | reactionRolesView | section |  |
| reaction-roles | reactionRoleCreate | button | button + New template |
| reaction-roles | reactionRoleCount | small | 0 saved |
| reaction-roles | reactionRoleList | div |  |
| reaction-roles | reactionRoleEmpty | div |  |
| reaction-roles | reactionRoleEmptyCreate | button | button Create template |
| reaction-roles | reactionRoleEditor | div |  |
| reaction-roles | reactionRoleStatus | span | SAVED |
| reaction-roles | reactionRoleName | input | text |
| reaction-roles | reactionRolePublishedState | p | Not published |
| reaction-roles | reactionRoleEnabled | input | checkbox |
| reaction-roles | reactionRoleDuplicate | button | button Duplicate |
| reaction-roles | reactionRoleDelete | button | button Delete |
| reaction-roles | reactionRoleUseTemplate | button | button Use template |
| reaction-roles | reactionRoleEmojiToggle | button | button Emoji |
| reaction-roles | reactionRoleVariablesToggle | button | button { } Variables |
| reaction-roles | reactionRoleContainerToggle | button | button Container |
| reaction-roles | reactionRoleAdditionalContainer | button | button + Container |
| reaction-roles | reactionRoleThumbnailToggle | button | button Thumbnail |
| reaction-roles | reactionRoleGalleryToggle | button | button Gallery |
| reaction-roles | reactionRoleComposerPanel | div |  |
| reaction-roles | reactionRoleDiscordFrame | div |  |
| reaction-roles | reactionRoleAccentButton | button | button |
| reaction-roles | reactionRoleAccentColor | input | color |
| reaction-roles | reactionRoleMessagePreview | div |  |
| reaction-roles | reactionRoleAdditionalContainers | div |  |
| reaction-roles | reactionRoleControlPreview | div |  |
| reaction-roles | reactionRoleControls | div |  |
| reaction-roles | reactionRoleAddControl | button | button + Add button |
| reaction-roles | reactionRoleChannel | select |  |
| reaction-roles | reactionRolePermissionStatus | div |  |
| reaction-roles | reactionRoleFinalPreview | div |  |
| reaction-roles | reactionRoleSaveDraft | button | button Save draft |
| reaction-roles | reactionRolePublish | button | button Publish / update message |
| owner | ownerView | section |  |
| owner | ownerRefresh | button | button Refresh |
| owner | ownerOverview | div |  |
| owner | consoleClear | button | button Clear |
| owner | consoleToggle | button | button Pause |
| owner | consoleOutput | div |  |
| Dialogs | confirmDialog | dialog |  |
| Dialogs | dialogTitle | h2 | Confirm action |
| Dialogs | dialogCopy | p |  |
| Dialogs | dialogInputWrap | label | Reason |
| Dialogs | dialogInput | textarea |  |
| Dialogs | dialogConfirm | button | Confirm |
| Dialogs | templatePickerDialog | dialog |  |
| Dialogs | templatePickerSearch | input | search |
| Dialogs | templatePickerList | div |  |
| Dialogs | templateActionDialog | dialog |  |
| Dialogs | templateActionTitle | h2 | Configure action |
| Dialogs | templateActionCopy | p | Choose the target used when this control is selected. |
| Dialogs | templateActionTargetLabel | span | Target |
| Dialogs | templateActionTarget | select |  |
| Dialogs | templateActionHelp | small |  |
| Dialogs | templateActionSave | button | button Save action |
| Dialogs | emojiPickerDialog | dialog |  |
| Dialogs | emojiPickerTitle | h2 | Choose an emoji |
| Dialogs | emojiPickerClose | button | button &times; |
| Dialogs | emojiPickerSearch | input | search |
| Dialogs | emojiPickerStatus | div |  |
| Dialogs | emojiPickerCategories | nav |  |
| Dialogs | emojiPickerGrid | div |  |
