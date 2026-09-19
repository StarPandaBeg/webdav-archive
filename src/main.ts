import { Notice, Plugin, TFile } from "obsidian";
import { ParsedRemoteFile, RemoteFile, parseRemoteFile, serializeRemoteFile } from "./remote-file";
import { WebDavArchiveSettingTab, WebDavArchiveSettings, DEFAULT_SETTINGS } from "./settings";
import { StorageProvider, StorageType, createStorageProvider } from "./storage";
import { getMimeType } from "./mime";
import { ProgressNotice } from "./progress-notice";
import { RemoteFileView, VIEW_TYPE_REMOTE_FILE } from "./remote-file-view";
import { t } from "./i18n";
import { updateLinksForArchive, updateLinksForRestore } from "./link-updater";
import { WebDavArchiveApi } from "./api";
import { confirmAction } from "./confirm-modal";

export type { WebDavArchiveApi };

const REMOTE_EXTENSION = "remote";

export default class WebDavArchivePlugin extends Plugin {
  settings: WebDavArchiveSettings = DEFAULT_SETTINGS;
  public readonly api: WebDavArchiveApi = {
    resolve: (remoteFile: TFile) => this.resolve(remoteFile),
    isPreviewEnabled: () => this.isPreviewEnabled(),
  };
  private readonly activeOperations = new Set<string>();
  private readonly storageProviders = new Map<StorageType, StorageProvider>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.updateGlobeIconSetting();
    this.addSettingTab(new WebDavArchiveSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_REMOTE_FILE, (leaf) => new RemoteFileView(leaf, this));
    this.registerExtensions([REMOTE_EXTENSION], VIEW_TYPE_REMOTE_FILE);

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        if (file.extension.toLowerCase() === REMOTE_EXTENSION) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.restore"))
              .setIcon("download")
              .onClick(() => void this.restoreRemoteFile(file)),
          );
          menu.addItem((item) =>
            item
              .setTitle(t("deleteRemote.title"))
              .setIcon("trash")
              .onClick(() => void this.deleteRemoteFile(file)),
          );
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle(t("menu.archive"))
            .setIcon("archive")
            .onClick(() => void this.archive(file)),
        );
      }),
    );
  }

  onunload(): void {
    document.body.classList.remove("webdav-archive-show-globe");
    try {
      viewRegistry(this.app).unregisterExtensions([REMOTE_EXTENSION]);
    } catch {
      // The extension may already have been released during shutdown.
    }
  }

  updateGlobeIconSetting(): void {
    document.body.classList.toggle("webdav-archive-show-globe", this.settings.showGlobeIcon);
    this.app.workspace.getLeavesOfType(VIEW_TYPE_REMOTE_FILE).forEach((leaf) => {
      const leafAny = leaf as unknown as { updateHeader?: () => void };
      if (typeof leafAny.updateHeader === "function") {
        leafAny.updateHeader();
      }
    });
  }

  refreshRemoteViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_REMOTE_FILE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof RemoteFileView && view.file) {
        void view.onLoadFile(view.file);
      }
    });
  }

  isPreviewEnabled(): boolean {
    return Boolean(this.settings.enablePreview);
  }

  async saveSettings(): Promise<void> {
    this.resetStorageProviders();
    await this.saveData(this.settings);
  }

  getStorageProvider(storageType?: string): StorageProvider {
    const type: StorageType =
      storageType === "nextcloud" || storageType === "webdav" || storageType === "s3"
        ? storageType
        : this.settings.storageType;

    let provider = this.storageProviders.get(type);
    if (!provider) {
      provider = createStorageProvider(this.settings, type);
      this.storageProviders.set(type, provider);
    }
    return provider;
  }

  resetStorageProviders(): void {
    this.storageProviders.clear();
  }

  async resolve(remoteFile: TFile): Promise<{ url: string }> {
    if (!this.isPreviewEnabled()) {
      throw new Error(t("error.previewDisabled"));
    }

    if (!(remoteFile instanceof TFile)) {
      throw new Error("Target file must be an instance of TFile");
    }

    const content = await this.app.vault.read(remoteFile);
    const metadata = parseRemoteFile(content);

    if (metadata.version === 1) {
      return { url: metadata.url };
    }

    const relativePath = metadata.relativePath;
    if (!relativePath) {
      throw new Error(t("error.invalidRemotePath"));
    }

    const provider = this.getStorageProvider(metadata.storage);
    let url: string;
    try {
      url = await provider.getFileUrl(relativePath);
    } catch (error) {
      if ("fileUrl" in metadata && metadata.fileUrl) {
        url = metadata.fileUrl;
      } else if ("publicUrl" in metadata && metadata.publicUrl) {
        url = metadata.publicUrl;
      } else {
        throw error;
      }
    }

    return { url };
  }

  private async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as LegacySavedSettings | null;
    const legacyWebDavUrl =
      !saved?.webDavUrl && saved?.serverUrl
        ? appendLegacyFolder(saved.serverUrl, saved.remoteFolder)
        : "";

    this.settings = {
      ...DEFAULT_SETTINGS,
      storageType:
        saved?.storageType === "nextcloud"
          ? "nextcloud"
          : saved?.storageType === "s3"
            ? "s3"
            : "webdav",
      webDavUrl: saved?.webDavUrl ?? legacyWebDavUrl,
      publicUrl: saved?.publicUrl ?? DEFAULT_SETTINGS.publicUrl,
      nextcloudUrl: saved?.nextcloudUrl ?? DEFAULT_SETTINGS.nextcloudUrl,
      username: saved?.username ?? DEFAULT_SETTINGS.username,
      password: saved?.password ?? DEFAULT_SETTINGS.password,
      showGlobeIcon: saved?.showGlobeIcon ?? DEFAULT_SETTINGS.showGlobeIcon,
      s3Endpoint: saved?.s3Endpoint ?? DEFAULT_SETTINGS.s3Endpoint,
      s3Region: saved?.s3Region ?? DEFAULT_SETTINGS.s3Region,
      s3Bucket: saved?.s3Bucket ?? DEFAULT_SETTINGS.s3Bucket,
      s3AccessKeyId: saved?.s3AccessKeyId ?? DEFAULT_SETTINGS.s3AccessKeyId,
      s3SecretAccessKey: saved?.s3SecretAccessKey ?? DEFAULT_SETTINGS.s3SecretAccessKey,
      s3RemotePrefix: saved?.s3RemotePrefix ?? DEFAULT_SETTINGS.s3RemotePrefix,
      s3ForcePathStyle: saved?.s3ForcePathStyle ?? DEFAULT_SETTINGS.s3ForcePathStyle,
      s3PresignedExpiration: saved?.s3PresignedExpiration ?? DEFAULT_SETTINGS.s3PresignedExpiration,
    };

    this.resetStorageProviders();

    if (legacyWebDavUrl) {
      await this.saveSettings();
    }
  }

  private async archive(file: TFile): Promise<void> {
    await this.runExclusive(file.path, t("archive.title", { name: file.name }), async (progress) => {
      progress.update(5, t("archive.checkingConfiguration"));
      const provider = this.getStorageProvider();
      provider.validateConfiguration({ requirePublicUrl: provider.storageType === "webdav" });
      const markerPath = `${file.path}.${REMOTE_EXTENSION}`;
      if (this.app.vault.getAbstractFileByPath(markerPath)) {
        throw new Error(t("archive.markerExists", { path: markerPath }));
      }

      progress.update(10, t("archive.reading"));
      const data = await this.app.vault.readBinary(file);

      progress.update(25, t("archive.checksum"));
      const checksum = await sha256(data);

      const mimeType = getMimeType(file.extension);
      const expectedBytes = file.stat.size;

      progress.update(30, t("archive.uploading"));
      const uploaded = await provider.upload(
        {
          file,
          data,
          size: expectedBytes,
          mimeType,
          checksum,
        },
        (sentBytes, totalBytes) => {
          const expected = totalBytes ?? expectedBytes;
          progress.update(
            30 + transferFraction(sentBytes, expected) * 50,
            t("archive.uploadingProgress", {
              transferred: formatBytes(sentBytes),
              total: formatBytes(expected),
            }),
          );
        },
      );

      progress.update(82, t("archive.creatingMarker"));
      const metadata: RemoteFile = {
        version: 3,
        storage: provider.storageType,
        relativePath: uploaded.relativePath,
        originalName: file.name,
        originalPath: file.path,
        mimeType,
        size: expectedBytes,
        sha256: checksum,
        archivedAt: new Date().toISOString(),
      };

      let marker: TFile | null = null;
      try {
        marker = await this.app.vault.create(markerPath, serializeRemoteFile(metadata));
        progress.update(88, t("archive.updatingLinks"));
        await updateLinksForArchive(this.app, file);
        progress.update(94, t("archive.removingOriginal"));
        await this.app.fileManager.trashFile(file);
      } catch (error) {
        if (marker) {
          await this.app.fileManager.trashFile(marker).catch(() => undefined);
        }
        await provider.delete(uploaded.relativePath).catch(() => undefined);
        throw error;
      }

      return t("archive.complete", { name: file.name });
    });
  }

  async restoreRemoteFile(marker: TFile): Promise<void> {
    await this.runExclusive(marker.path, t("restore.title", { name: marker.basename }), async (progress) => {
      progress.update(5, t("restore.readingMarker"));
      const metadata = parseRemoteFile(await this.app.vault.read(marker));
      progress.update(10, t("archive.checkingConfiguration"));
      const provider = this.getStorageProvider(metadata.storage);
      provider.validateConfiguration({ requirePublicUrl: false });
      const relativePath =
        metadata.version === 1
          ? (provider.relativePathFromLegacyUrl ? provider.relativePathFromLegacyUrl(metadata.url) : "")
          : metadata.relativePath;

      if (!relativePath) {
        throw new Error(t("error.invalidRemotePath"));
      }

      const targetPath = metadata.originalPath || marker.path.slice(0, -`.${REMOTE_EXTENSION}`.length);
      const existing = this.app.vault.getAbstractFileByPath(targetPath);

      if (existing) {
        if (!(existing instanceof TFile)) {
          throw new Error(t("restore.targetOccupied", { path: targetPath }));
        }

        progress.update(25, t("restore.checkingLocal"));
        const existingData = await this.app.vault.readBinary(existing);
        if (existingData.byteLength !== metadata.size || (await sha256(existingData)) !== metadata.sha256) {
          throw new Error(t("restore.differentFile", { path: targetPath }));
        }

        // A previous restore downloaded the file but could not finish remote cleanup.
        progress.update(88, t("restore.updatingLinks"));
        await updateLinksForRestore(this.app, marker, targetPath);
        progress.indeterminate(t("restore.finishingCleanup"));
        await provider.delete(relativePath);
        progress.update(95, t("restore.removingMarker"));
        await this.app.fileManager.trashFile(marker);
        return t("restore.complete", { name: metadata.originalName });
      }

      progress.indeterminate(t("restore.downloading"));
      const data = await provider.download(
        relativePath,
        (receivedBytes, totalBytes) => {
          const params = { transferred: formatBytes(receivedBytes), total: formatBytes(totalBytes ?? 0) };
          if (totalBytes === null) {
            progress.indeterminate(t("restore.downloadingUnknownSize", params));
          } else {
            progress.update(
              15 + transferFraction(receivedBytes, totalBytes) * 50,
              t("restore.downloadingProgress", params),
            );
          }
        },
        {
          expectedSize: metadata.size,
          expectedSha256: metadata.sha256,
        },
      );

      progress.update(68, t("restore.checkingSize"));
      if (data.byteLength !== metadata.size) {
        throw new Error(t("restore.sizeMismatch", { expected: metadata.size, actual: data.byteLength }));
      }
      progress.update(74, t("restore.verifyingChecksum"));
      if ((await sha256(data)) !== metadata.sha256) {
        throw new Error(t("restore.integrityFailed"));
      }
      progress.update(84, t("restore.writing"));
      await this.app.vault.createBinary(targetPath, data);

      progress.update(90, t("restore.updatingLinks"));
      await updateLinksForRestore(this.app, marker, targetPath);

      // If either cleanup operation fails, the restored local file and marker are
      // intentionally kept. Running Restore again safely retries the cleanup.
      progress.indeterminate(t("restore.removingRemote"));
      await provider.delete(relativePath);
      progress.update(96, t("restore.removingMarker"));
      await this.app.fileManager.trashFile(marker);
      return t("restore.complete", { name: metadata.originalName });
    });
  }

  private async deleteRemoteFile(marker: TFile): Promise<void> {
    if (this.activeOperations.has(marker.path)) {
      new Notice(t("operation.running"));
      return;
    }

    let metadata: ParsedRemoteFile;
    try {
      const content = await this.app.vault.read(marker);
      metadata = parseRemoteFile(content);
    } catch {
      new Notice(t("error.invalidRemoteFile"));
      return;
    }

    const originalName = metadata.originalName || marker.name.replace(/\.remote$/, "");
    const provider = this.getStorageProvider(metadata.storage);
    const relativePath =
      metadata.version === 1
        ? (provider.relativePathFromLegacyUrl ? provider.relativePathFromLegacyUrl(metadata.url) : "")
        : metadata.relativePath;

    if (!relativePath) {
      new Notice(t("error.invalidRemotePath"));
      return;
    }

    const confirmed = await confirmAction(this.app, {
      title: t("deleteRemote.title"),
      message: t("deleteRemote.confirm", { name: originalName }),
      warning: t("deleteRemote.warning"),
      confirmText: t("deleteRemote.button"),
    });

    if (!confirmed) {
      return;
    }

    if (this.activeOperations.has(marker.path)) {
      new Notice(t("operation.running"));
      return;
    }

    this.activeOperations.add(marker.path);
    const notice = new Notice(t("deleteRemote.deleting"), 0);

    try {
      const exists = await provider.exists(relativePath);

      if (!exists) {
        notice.hide();
        const removeMarker = await confirmAction(this.app, {
          title: t("deleteRemote.alreadyMissingTitle"),
          message: t("deleteRemote.alreadyMissing", { name: originalName }),
          confirmText: t("deleteRemote.removeMarkerButton"),
        });
        if (removeMarker) {
          await this.app.fileManager.trashFile(marker);
          new Notice(t("deleteRemote.markerTrashed", { name: originalName }));
        }
        return;
      }

      await provider.delete(relativePath);
      await this.app.fileManager.trashFile(marker);
      notice.hide();
      new Notice(t("deleteRemote.complete", { name: originalName }));
    } catch (error) {
      notice.hide();
      console.error("WebDAV Archive: deleteRemoteFile failed:", error);
      new Notice(t("deleteRemote.failed", { message: errorMessage(error) }), 8000);
    } finally {
      this.activeOperations.delete(marker.path);
    }
  }

  private async runExclusive(
    path: string,
    title: string,
    operation: (progress: ProgressNotice) => Promise<string>,
  ): Promise<void> {
    if (this.activeOperations.has(path)) {
      new Notice(t("operation.running"));
      return;
    }

    this.activeOperations.add(path);
    const progress = new ProgressNotice(title);
    try {
      const successMessage = await operation(progress);
      progress.succeed(successMessage);
    } catch (error) {
      console.error("WebDAV Archive:", error);
      progress.fail(errorMessage(error));
    } finally {
      this.activeOperations.delete(path);
    }
  }
}

interface ViewRegistry {
  unregisterExtensions(extensions: string[]): void;
}

interface LegacySavedSettings extends Partial<WebDavArchiveSettings> {
  serverUrl?: string;
  remoteFolder?: string;
}

function viewRegistry(app: WebDavArchivePlugin["app"]): ViewRegistry {
  return (app as unknown as { viewRegistry: ViewRegistry }).viewRegistry;
}

function appendLegacyFolder(serverUrl: string, remoteFolder?: string): string {
  const folder = (remoteFolder ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return folder ? `${serverUrl.replace(/\/+$/, "")}/${folder}` : serverUrl;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transferFraction(transferredBytes: number, totalBytes: number): number {
  if (totalBytes === 0) return 1;
  return Math.max(0, Math.min(1, transferredBytes / totalBytes));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024) break;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}
