# Remote Archive

> **Important**: This is not a backup plugin. It is designed to free up local disk space by moving large files out of your Obsidian vault to external storage while keeping them seamlessly accessible inside your vault.

**Remote Archive** is an Obsidian desktop and mobile plugin that moves large vault files (videos, audio recordings, images, PDFs, archives) to external cloud storage backends while preserving lightweight JSON marker files (`<filename>.remote`) inside your vault.

---

## Key Features

- **Multi-Storage Support**:
  - **S3-compatible**: AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Ceph, and others. Supports multipart uploads and presigned GET URLs with HTTP Range streaming.
  - **Nextcloud**: Native Nextcloud WebDAV API with OCS public share link generation for direct streaming and previews.
  - **Generic WebDAV**: Standard WebDAV servers with optional read-only public CDN base URL.
- **Data Safety & Integrity**:
  - The local file is deleted only after successful upload and size/checksum verification.
  - The remote object and marker are deleted only after the restored file is verified against its original SHA-256 hash and byte size.
  - Operations on the same file path are concurrency-locked to prevent race conditions.
- **Link Updating (Wikilinks & Frontmatter)**:
  - Archiving automatically updates all internal links from `[[file]]` to `[[file.remote]]` across your vault (both Markdown body and YAML frontmatter).
  - Restoring reverts `[[file.remote]]` back to `[[file]]`.
- **Integrated `.remote` Viewer**:
  - Streaming audio and video playback with seek support.
  - Image previews.
  - Rendered Markdown and plain text inspection.
  - Quick action buttons in the view header: **Refresh preview**, **Copy direct URL**, and **Restore file**.
- **Safe Remote Deletion**:
  - Context menu item: **Delete from remote storage** (*"Удалить из удалённого хранилища"*).
  - Explicit confirmation modal displaying the original file name.
  - Standard Obsidian deletion of `.remote` markers does **not** delete remote storage files.
- **Visual Indicators & UX**:
  - Optional globe icon styling for `.remote` files in the file explorer.
  - Byte-accurate progress notifications for uploads and downloads.
  - Dual language support: Russian (`ru`) and English (`en`).

---

## How It Works

### 1. Archiving (`Archive to Remote`)
1. You select **Archive to Remote** from the context menu of any file in your vault.
2. The file is read via Obsidian's Vault API and its SHA-256 hash is calculated using the native Web Crypto API.
3. The file is uploaded to your configured storage backend (multipart upload for S3 objects > 8 MB).
4. The uploaded object is verified for existence and byte size.
5. A lightweight metadata marker file (`<filename>.remote`, format version 3) is created in place of the original file.
6. Vault-wide internal links and YAML frontmatter referencing `[[filename]]` are updated to `[[filename.remote]]`.
7. The local file is safely moved to trash.

### 2. Viewing & Streaming
- Opening a `<filename>.remote` file opens the plugin's custom viewer tab.
- The plugin resolves an active direct or presigned URL for media streaming or downloading on demand.
- Video and audio files stream directly from the remote backend with HTTP Range support (enabling smooth seeking).

### 3. Restoring (`Restore from Remote`)
1. You select **Restore from Remote** from the context menu or click the restore icon in the viewer header.
2. The remote object is downloaded and its SHA-256 checksum and size are verified against the marker's metadata.
3. The restored file is written back to the vault at its original path.
4. Internal links and frontmatter are reverted from `[[filename.remote]]` back to `[[filename]]`.
5. The remote object is deleted from cloud storage.
6. The local `.remote` marker file is cleanly removed.

---

## Configuration

Open **Settings → Community plugins → Remote Archive** and choose your storage provider:

### S3-compatible Storage
- **Endpoint URL**: Custom S3 endpoint (e.g., `https://<account-id>.r2.cloudflarestorage.com` for Cloudflare R2, or `https://s3.us-east-1.amazonaws.com`).
- **Region**: Storage region (e.g., `auto` for Cloudflare R2, `us-east-1`).
- **Bucket**: Target bucket name.
- **Access Key ID & Secret Access Key**: S3 credentials.
- **Remote Folder Prefix**: Optional subfolder inside the bucket (e.g., `obsidian-vault/`).
- **Force Path Style**: Enable for MinIO or self-hosted Ceph instances.
- **Presigned URL Expiration**: Lifetime of generated streaming URLs in seconds (default: 3600).

### Nextcloud
- **Nextcloud Base URL**: URL of your Nextcloud server (e.g., `https://cloud.example.com`).
- **Username & App Password**: Credentials with WebDAV and OCS sharing permissions.

### Generic WebDAV
- **WebDAV URL**: Full writable WebDAV collection URL.
- **Public URL**: Optional read-only public CDN base URL corresponding to the WebDAV folder.
- **Username & Password**: WebDAV credentials.

> All credentials are stored locally in Obsidian's plugin settings (`data.json`) and are never written to `.remote` files.

---

## Marker File Format (`.remote`)

Marker files are stored as formatted JSON (`<original-name>.remote`):

```json
{
  "version": 3,
  "storage": "s3",
  "relativePath": "490e9582-806d-4f8a-8927-357d9df293ca",
  "originalName": "Lecture.mp4",
  "originalPath": "Media/Lectures/Lecture.mp4",
  "mimeType": "video/mp4",
  "size": 773413055,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "archivedAt": "2026-09-19T14:00:00.000Z"
}
```

*Note: Runtime URLs are not persisted in version 3 because presigned and shared links expire or change dynamically.*

---

## Public Plugin API

Other plugins and Dataview scripts can resolve active playback/download URLs through the exposed plugin API:

```ts
import { TFile } from "obsidian";

const plugin = app.plugins.plugins["remote-archive"];
if (plugin?.api) {
  const remoteFile = app.vault.getAbstractFileByPath("Media/Lectures/Lecture.mp4.remote");
  if (remoteFile instanceof TFile) {
    const { url } = await plugin.api.resolve(remoteFile);
    console.log("Direct streaming URL:", url);
  }
}
```

---

## Development

```bash
# Install dependencies
npm install

# Typecheck and build production bundle (main.js)
npm run build

# Run fast typecheck
npm run typecheck

# Continuous build during development
npm run dev
```

To test locally, copy `main.js`, `manifest.json`, and `styles.css` into your vault:
```text
<vault>/.obsidian/plugins/remote-archive/
```
