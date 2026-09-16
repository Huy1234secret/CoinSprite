# Dashboard layout

The admin panel has no `.html` source files. `layout.js` assembles the compact sign-in page, server navigation, and workspace document from JavaScript nodes. `dashboardTree.json` retains the feature controls and dialogs that `app.js` binds to by ID. The browser still receives an HTML response, as required for a web page, but there is no editable HTML template.

`style.css` continues to provide styles for the feature editors and Discord previews. `dashboard.css` supplies the new charcoal/ochre palette, spacing, navigation, tabs, and responsive layout. Keep functional IDs and `data-*` attributes stable when editing the tree or app bindings.
