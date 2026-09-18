import { Notice, Plugin, TFile } from "obsidian";
import { RemoteFile, parseRemoteFile, serializeRemoteFile } from "./remote-file";
import { WebDavArchiveSettingTab, WebDavArchiveSettings, DEFAULT_SETTINGS } from "./settings";
import { WebDavClient } from "./webdav";
import { getMimeType } from "./mime";
import { ProgressNotice } from "./progress-notice";
import { RemoteFileView, VIEW_TYPE_REMOTE_FILE } from "./remote-file-view";

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
              .setTitle("Restore from WebDAV")
              .setIcon("download")
              .onClick(() => void this.restoreRemoteFile(file)),
          );
          return;
        }

        menu.addItem((item) =>
          item
            .setTitle("Archive to WebDAV")
            .setIcon("archive")
            .onClick(() => void this.archive(file)),
        );
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
    };

    if (legacyWebDavUrl) {
      await this.saveSettings();
    }
  }

  private async archive(file: TFile): Promise<void> {
    await this.runExclusive(file.path, `Archiving ${file.name}`, async (progress) => {
      progress.update(5, "Checking configuration…");
      const client = this.createClient();
      const markerPath = `${file.path}.${REMOTE_EXTENSION}`;
      if (this.app.vault.getAbstractFileByPath(markerPath)) {
        throw new Error(`A marker already exists: ${markerPath}`);
      }

      progress.update(10, "Reading local file…");
      const data = await this.app.vault.readBinary(file);
      const mimeType = getMimeType(file.extension);
      progress.update(25, "Calculating checksum…");
      const checksum = await sha256(data);
      progress.indeterminate("Uploading to WebDAV…");
      const uploaded = await client.upload(data, mimeType);

      progress.update(82, "Creating remote marker…");
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
        progress.update(94, "Removing local original…");
        await this.app.vault.delete(file);
      } catch (error) {
        if (marker) {
          await this.app.vault.delete(marker).catch(() => undefined);
        }
        await client.delete(uploaded.relativePath).catch(() => undefined);
        throw error;
      }

      return `Archived ${file.name}`;
    });
  }

  async restoreRemoteFile(marker: TFile): Promise<void> {
    await this.runExclusive(marker.path, `Restoring ${marker.basename}`, async (progress) => {
      progress.update(5, "Reading remote marker…");
      const metadata = parseRemoteFile(await this.app.vault.read(marker));
      progress.update(10, "Checking configuration…");
      const client = this.createClient(false);
      const relativePath =
        metadata.version === 1
          ? client.relativePathFromLegacyUrl(metadata.url)
          : metadata.relativePath;

      const targetPath = metadata.originalPath || marker.path.slice(0, -`.${REMOTE_EXTENSION}`.length);
      const existing = this.app.vault.getAbstractFileByPath(targetPath);

      if (existing) {
        if (!(existing instanceof TFile)) {
          throw new Error(`Cannot restore because the target path is occupied: ${targetPath}`);
        }

        progress.update(25, "Checking restored local file…");
        const existingData = await this.app.vault.readBinary(existing);
        if (existingData.byteLength !== metadata.size || (await sha256(existingData)) !== metadata.sha256) {
          throw new Error(`A different file already exists at ${targetPath}`);
        }

        // A previous restore downloaded the file but could not finish remote cleanup.
        progress.indeterminate("Finishing WebDAV cleanup…");
        await client.delete(relativePath);
        progress.update(95, "Removing remote marker…");
        await this.app.vault.delete(marker);
        return `Restored ${metadata.originalName}`;
      }

      progress.indeterminate("Downloading from WebDAV…");
      const data = await client.download(relativePath);
      progress.update(68, "Checking downloaded size…");
      if (data.byteLength !== metadata.size) {
        throw new Error(`Downloaded size does not match: expected ${metadata.size}, got ${data.byteLength}`);
      }
      progress.update(74, "Verifying checksum…");
      if ((await sha256(data)) !== metadata.sha256) {
        throw new Error("Downloaded file failed its integrity check");
      }

      progress.update(84, "Writing local file…");
      await this.app.vault.createBinary(targetPath, data);

      // If either cleanup operation fails, the restored local file and marker are
      // intentionally kept. Running Restore again safely retries the cleanup.
      progress.indeterminate("Removing WebDAV object…");
      await client.delete(relativePath);
      progress.update(96, "Removing remote marker…");
      await this.app.vault.delete(marker);
      return `Restored ${metadata.originalName}`;
    });
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
      new Notice("An archive operation is already running for this file");
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
