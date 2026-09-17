# CoinSprite Discord control center

The admin panel has no `.html` source files. `layout.js` assembles the sign-in experience, server rail, channel-style navigation, and overview from JavaScript nodes. `dashboardTree.json` retains the feature controls and dialogs that `app.js` binds to by ID. The browser still receives an HTML response, but there is no editable HTML template.

`style.css` contains the functional editor foundations and Discord-specific previews. `dashboard.css` is the visual system: deep black surfaces, high-contrast yellow actions, a Discord-familiar three-column shell, compact cards, visible focus states, and responsive behavior. Keep functional IDs and `data-*` attributes stable when editing the tree or app bindings.

