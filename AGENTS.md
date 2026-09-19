# AGENTS.md — Developer & AI Agent Guide for Remote Archive

This document provides essential architectural context, invariants, data formats, and workflow conventions for AI coding agents and developers working on the `remote-archive` (`StarPandaBeg/webdav-archive`) Obsidian plugin.

---

## 1. Project Overview & Philosophy

**Remote Archive** (`id: remote-archive`) is an Obsidian desktop & mobile plugin designed to move large vault files (videos, audio, images, PDFs, archives) to external storage backends while preserving lightweight JSON marker files (`<filename>.remote`) inside the vault.

### Supported Storage Backends
1. **Generic WebDAV** — standard WebDAV server (HTTP PUT/GET/HEAD/DELETE/PROPFIND) with optional read-only public CDN base URL.
2. **Nextcloud** — Nextcloud WebDAV API with OCS public link generation for direct streaming/preview URLs.
3. **S3-compatible** — AWS S3, Cloudflare R2, Backblaze B2, MinIO, Ceph, etc. Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with streaming multipart uploads/downloads and presigned GET URLs supporting HTTP Range requests.

---

## 2. Core Invariants & Safety Principles

Data loss prevention is the highest priority of this plugin. Adhere to these invariants strictly:

### A. Archiving Invariant
The local file is **ONLY** deleted if every preceding step succeeds:
1. Validate storage provider configuration.
2. Read local file & calculate SHA-256 hash and exact size.
3. Upload to storage (multipart if S3 > 5MB; streamed if desktop/Node fs).
4. Verify upload (size check via HEAD/Content-Length or ETag verification).
5. Create `<filename>.remote` marker file with metadata (format v3).
6. Update all internal Obsidian links and frontmatter from `[[file]]` to `[[file.remote]]` via `updateLinksForArchive`.
7. **Only now** delete the original local file from the vault.

### B. Restoring Invariant
The remote object and `.remote` marker are **ONLY** deleted after local restoration is verified:
1. Check destination path in vault. If occupied by a different file, abort immediately.
2. Download object from storage to temp file (desktop) or buffer (mobile).
3. Verify downloaded file size and SHA-256 integrity against the marker metadata.
4. Atomically write/rename restored file into the vault.
5. Update all internal Obsidian links and frontmatter from `[[file.remote]]` to `[[file]]` via `updateLinksForRestore`.
6. Delete the remote object from storage (`provider.delete(relativePath)`).
7. Delete the `.remote` marker file.
*Note:* If steps 6 or 7 fail, the restored local file is preserved. Running "Restore" again will safely detect the existing valid local file and retry the cleanup idempotently.

### C. Remote Deletion Invariant ("Удалить из удалённого хранилища")
1. Available **only** via context menu on `.remote` files (`menu.deleteRemote`).
2. **Never** intercept standard Obsidian deletion. **Do NOT** hook `vault.on("delete")` or monkey-patch `delete` commands. Normal deletion of a `.remote` file must simply remove the local marker without touching remote storage.
3. Flow when triggered:
   - Parse descriptor from `.remote`.
   - Present confirmation modal with original filename. If canceled -> do nothing.
   - Check if object exists in storage via `provider.exists(relativePath)`.
   - If object is already missing remotely: notify user and offer/allow moving the orphan `.remote` marker to trash via `app.fileManager.trashFile(marker)`.
   - If object exists: call `await provider.delete(relativePath)`.
   - Only upon successful remote deletion, call `await this.app.fileManager.trashFile(marker)`.
   - If remote deletion fails: keep `.remote` marker intact, show clear error Notice, allow user to retry.

### D. Concurrency Locking
Every file path operation is guarded by `activeOperations: Set<string>` in `WebDavArchivePlugin`. Simultaneous operations on the same path are rejected.

---

## 3. Marker File Specification (`.remote`)

Files are saved as `<originalName>.remote` containing formatted JSON.

### Version 3 (Current Standard)
Runtime URLs (`fileUrl`, `publicUrl`) are **never** persisted in version 3 because URLs can change or expire (presigned S3 URLs, tokenized Nextcloud links).
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

### Backward Compatibility
- **Version 2**: Contains `version: 2`, `relativePath`, and optional cached `publicUrl` / `fileUrl`.
- **Version 1 (Legacy)**: Contains `version: 1`, `storage: "webdav"`, and absolute `url: string`. Restorable by deriving `relativePath` via `provider.relativePathFromLegacyUrl`.

### Parsing & Serialization
Use `parseRemoteFile(json)` and `serializeRemoteFile(metadata)` from `src/remote-file.ts`.

---

## 4. Architecture & Module Structure

```text
src/
├── api.ts              # Public API definition (WebDavArchiveApi)
├── confirm-modal.ts    # Reusable confirmation modal (confirmAction)
├── i18n.ts             # Internationalization (ru + en)
├── link-updater.ts     # Internal wikilinks & frontmatter updater
├── main.ts             # Plugin lifecycle, commands, menu items, operations
├── mime.ts             # MIME type detection
├── progress-notice.ts  # Obsidian notice with progress bar & status
├── remote-file.ts      # .remote descriptor types, parsers, serializers
├── remote-file-view.ts # Custom viewer leaf for .remote files (audio/video/image/markdown/text)
├── settings.ts         # Setting tab and configuration data model
└── storage/
    ├── types.ts           # StorageProvider interface, transfer contracts
    ├── base-webdav.ts     # Abstract WebDAV class (HEAD/GET/PUT/DELETE/PROPFIND)
    ├── generic-webdav.ts  # Generic WebDAV provider with public URL support
    ├── nextcloud.ts       # Nextcloud provider (OCS share creation for direct links)
    ├── s3.ts              # S3 provider (AWS SDK v3, presigned URLs, streaming)
    ├── transfer.ts        # Progress-aware HTTP transfer utility
    └── index.ts           # StorageProvider factory (createStorageProvider)
```

### StorageProvider Contract (`src/storage/types.ts`)
All storage backends must implement:
- `readonly storageType: StorageType`
- `validateConfiguration(options?: { requirePublicUrl?: boolean }): void`
- `upload(source: ArrayBuffer | UploadSource, ...): Promise<UploadedObject>`
- `download(relativePath: string, onProgress?, context?: DownloadContext): Promise<ArrayBuffer | DownloadResult>`
- `exists(relativePath: string): Promise<boolean>`
- `delete(relativePath: string): Promise<void>`
- `getFileUrl(relativePath: string, forceRefresh?: boolean): Promise<string>`
- `verify?(relativePath: string, expectedSize?: number): Promise<boolean>`
- `relativePathFromLegacyUrl?(remoteUrl: string): string`

---

## 5. Public Plugin API

Exposed on `app.plugins.plugins["remote-archive"].api`:
```ts
export interface WebDavArchiveApi {
  resolve(remoteFile: TFile): Promise<{ url: string }>;
}
```
`resolve(remoteFile)` parses the `.remote` file and dynamically retrieves the active streaming/download URL using the configured storage provider.

---

## 6. UI & Internationalization Guidelines

1. **Dual Language**: Every user-facing string must be declared in `src/i18n.ts` under both `en` and `ru`.
2. **Icons**:
   - Globe icon styling on `.remote` files toggled via `.webdav-archive-show-globe` on `document.body`.
   - Viewer header actions: `Refresh preview`, `Copy direct URL`, `Restore file`.
3. **Modals & Notices**:
   - Use `confirmAction(this.app, { title, message, warning?, confirmText? })` for destructive confirmations.
   - Long running tasks must use `ProgressNotice`.

---

## 7. Build, Typecheck & Verification

Run these commands to verify changes:

```bash
# Typecheck & build production bundle (main.js)
npm run build

# Fast typecheck only
npm run typecheck
```

- Always run `npm run build` before committing.
- Do not check in broken TypeScript types (`tsc --noEmit --skipLibCheck` must exit with 0).
- External libraries: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are bundled by esbuild; `obsidian` is treated as external.

### CI/CD Release Workflow (`.github/workflows/release.yml`)
- Triggered on push to `main`, tags, and manual `workflow_dispatch`.
- Builds plugin (`npm run build`) and verifies required Obsidian assets: `main.js`, `manifest.json`, `styles.css`.
- Publishes or updates GitHub release matching `manifest.json` version, attaching all assets.

---

## 8. Git Commit Guidelines

The user requires autonomous git commits upon finishing tasks.
- Keep commits focused and atomic.
- Commit message format: descriptive title in imperative mood, followed by bulleted summary of changes.
- Always include modified source files and rebuild `main.js`.
