# WebDAV Archive

An empty Obsidian plugin scaffold for a future workflow that will archive vault
files in WebDAV storage.

The plugin does not provide any user-facing features yet.

## Development

Install dependencies and create a production build:

```bash
npm install
npm run build
```

The build creates `main.js`. To test the plugin manually, copy `main.js` and
`manifest.json` to:

```text
<vault>/.obsidian/plugins/webdav-archive/
```

For automatic development deployment, put the path to your vault in a local
`.dev-vault` file, then run:

```bash
npm run dev
```

You can also set `VAULT_PLUGIN_DIR` to the complete destination plugin folder.

## Planned direction

In a future version, the plugin will let a user explicitly move a selected file
to WebDAV storage to free local vault space.

