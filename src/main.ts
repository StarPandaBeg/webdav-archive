import { Notice, Platform, Plugin, TFile } from "obsidian";
import { RemoteFile, parseRemoteFile, serializeRemoteFile } from "./remote-file";
import { WebDavArchiveSettingTab, WebDavArchiveSettings, DEFAULT_SETTINGS } from "./settings";
import { WebDavClient } from "./webdav";
import { getMimeType } from "./mime";
import { ProgressNotice } from "./progress-notice";
import { RemoteFileView, VIEW_TYPE_REMOTE_FILE } from "./remote-file-view";
import { t } from "./i18n";
import { convertVideoToMp4 } from "./video-converter";

const REMOTE_EXTENSION = "remote";

export default class WebDavArchivePlugin extends Plugin {
  settings: WebDavArchiveSettings = DEFAULT_SETTINGS;
  private readonly activeOperations = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
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
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle(t("menu.archive"))
            .setIcon("archive")
            .onClick(() => void this.archive(file)),
        );

        if (Platform.isDesktopApp && getMimeType(file.extension).startsWith("video/")) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.convertVideo"))
              .setIcon("file-video")
              .onClick(() => void this.convertVideo(file)),
          );
        }
      }),
    );
  }

  onunload(): void {
    try {
      viewRegistry(this.app).unregisterExtensions([REMOTE_EXTENSION]);
    } catch {
      // The extension may already have been released during shutdown.
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as LegacySavedSettings | null;
    const legacyWebDavUrl =
      !saved?.webDavUrl && saved?.serverUrl
        ? appendLegacyFolder(saved.serverUrl, saved.remoteFolder)
        : "";

    this.settings = {
      ...DEFAULT_SETTINGS,
      webDavUrl: saved?.webDavUrl ?? legacyWebDavUrl,
      publicUrl: saved?.publicUrl ?? DEFAULT_SETTINGS.publicUrl,
      username: saved?.username ?? DEFAULT_SETTINGS.username,
      password: saved?.password ?? DEFAULT_SETTINGS.password,
      ffmpegPath: saved?.ffmpegPath ?? DEFAULT_SETTINGS.ffmpegPath,
    };

    if (legacyWebDavUrl) {
      await this.saveSettings();
    }
  }

  private async archive(file: TFile): Promise<void> {
    await this.runExclusive(file.path, t("archive.title", { name: file.name }), async (progress) => {
      progress.update(5, t("archive.checkingConfiguration"));
      const client = this.createClient();
      const markerPath = `${file.path}.${REMOTE_EXTENSION}`;
      if (this.app.vault.getAbstractFileByPath(markerPath)) {
        throw new Error(t("archive.markerExists", { path: markerPath }));
      }

      progress.update(10, t("archive.reading"));
      const data = await this.app.vault.readBinary(file);
      const mimeType = getMimeType(file.extension);
      progress.update(25, t("archive.checksum"));
      const checksum = await sha256(data);
      const uploaded = await client.upload(data, mimeType, (sentBytes, totalBytes) => {
        const expectedBytes = totalBytes ?? data.byteLength;
        progress.update(
          30 + transferFraction(sentBytes, expectedBytes) * 50,
          t("archive.uploadingProgress", {
            transferred: formatBytes(sentBytes),
            total: formatBytes(expectedBytes),
          }),
        );
      });

      progress.update(82, t("archive.creatingMarker"));
      const metadata: RemoteFile = {
        version: 2,
        storage: "webdav",
        relativePath: uploaded.relativePath,
        publicUrl: uploaded.fileUrl,
        fileUrl: uploaded.fileUrl,
        originalName: file.name,
        originalPath: file.path,
        mimeType,
        size: data.byteLength,
        sha256: checksum,
        archivedAt: new Date().toISOString(),
      };

      let marker: TFile | null = null;
      try {
        marker = await this.app.vault.create(markerPath, serializeRemoteFile(metadata));
        progress.update(94, t("archive.removingOriginal"));
        await this.app.vault.delete(file);
      } catch (error) {
        if (marker) {
          await this.app.vault.delete(marker).catch(() => undefined);
        }
        await client.delete(uploaded.relativePath).catch(() => undefined);
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
      const client = this.createClient(false);
      const relativePath =
        metadata.version === 1
          ? client.relativePathFromLegacyUrl(metadata.url)
          : metadata.relativePath;

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
        progress.indeterminate(t("restore.finishingCleanup"));
        await client.delete(relativePath);
        progress.update(95, t("restore.removingMarker"));
        await this.app.vault.delete(marker);
        return t("restore.complete", { name: metadata.originalName });
      }

      progress.indeterminate(t("restore.downloading"));
      const data = await client.download(relativePath, (receivedBytes, totalBytes) => {
        const params = { transferred: formatBytes(receivedBytes), total: formatBytes(totalBytes ?? 0) };
        if (totalBytes === null) {
          progress.indeterminate(t("restore.downloadingUnknownSize", params));
        } else {
          progress.update(
            15 + transferFraction(receivedBytes, totalBytes) * 50,
            t("restore.downloadingProgress", params),
          );
        }
      });
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

      // If either cleanup operation fails, the restored local file and marker are
      // intentionally kept. Running Restore again safely retries the cleanup.
      progress.indeterminate(t("restore.removingRemote"));
      await client.delete(relativePath);
      progress.update(96, t("restore.removingMarker"));
      await this.app.vault.delete(marker);
      return t("restore.complete", { name: metadata.originalName });
    });
  }

  private async convertVideo(file: TFile): Promise<void> {
    await this.runExclusive(
      file.path,
      t("convert.title", { name: file.name }),
      (progress) => convertVideoToMp4(this.app, file, progress, this.settings.ffmpegPath),
    );
  }

  private createClient(requirePublicUrl = true): WebDavClient {
    const client = new WebDavClient(this.settings);
    client.validateConfiguration(requirePublicUrl);
    return client;
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
