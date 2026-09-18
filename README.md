# WebDAV Archive

An Obsidian plugin for moving large vault files to WebDAV storage and restoring
them later.

## Current features

- Adds **Archive to WebDAV** to the context menu of every vault file.
- Shows archive and restore progress in a persistent Obsidian notification.
- Uploads the file under a random UUID and verifies the uploaded size.
- Replaces the local file with a JSON marker named `<original name>.remote`.
- Stores the shared relative path, generated public `fileUrl`, original name and path,
  MIME type, byte size, SHA-256 checksum, and archive date in the marker.
- Adds **Restore from WebDAV** to `.remote` files.
- Opens `.remote` files in a built-in information view instead of handing them
  to the operating system.
- Marks `.remote` files with a globe icon in the file explorer and viewer tab.
- Verifies a restored download using its size and SHA-256 checksum.

The source file is deleted only after the upload is verified and the `.remote`
marker has been created. During restore, the local file is created and verified
before the WebDAV object and marker are deleted. Interrupted cleanup can be
retried by choosing **Restore from WebDAV** again.

Public links and remote file viewers are not implemented yet.

## Configuration

Open **Settings → Community plugins → WebDAV Archive** and configure:

- The writable **WebDAV URL**.
- The read-only **Public URL**.
- The WebDAV username and password. Prefer an app password if the provider
  supports one.

Credentials are stored locally in Obsidian's plugin data and are never written
to `.remote` files.

Both URL bases receive exactly the same relative path. For example:

```text
WebDAV URL:  https://cloud.example.com/dav/files/user/obsidian-archive
Public URL:  https://cdn.example.com/files/obsidian-archive
Object path: 550e8400-e29b-41d4-a716-446655440000

Upload: https://cloud.example.com/dav/files/user/obsidian-archive/550e8400-e29b-41d4-a716-446655440000
Public: https://cdn.example.com/files/obsidian-archive/550e8400-e29b-41d4-a716-446655440000
```

New version 2 markers contain both `fileUrl` and the older `publicUrl` alias.
The plugin also reads version 2 markers that contain only either field and can
restore legacy version 1 markers containing a full private WebDAV `url`.

## Development

Install dependencies and create a production build:

```bash
npm install
npm run build
```

The build creates `main.js`. To test the plugin manually, copy `main.js`,
`manifest.json`, and `styles.css` to:

```text
<vault>/.obsidian/plugins/webdav-archive/
```

For automatic development deployment, put the path to your vault in a local
`.dev-vault` file, then run:

```bash
npm run dev
```

You can also set `VAULT_PLUGIN_DIR` to the complete destination plugin folder.
