import {
  Component,
  FileView,
  MarkdownRenderer,
  Notice,
  Setting,
  TFile,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";
import type { IconName } from "obsidian";
import type WebDavArchivePlugin from "./main";
import { parseRemoteFile } from "./remote-file";
import type { ParsedRemoteFile, RemoteFile } from "./remote-file";
import { t } from "./i18n";

export const VIEW_TYPE_REMOTE_FILE = "webdav-archive-remote-file";

export class RemoteFileView extends FileView {
  private originalName: string | null = null;
  private mediaEl: HTMLMediaElement | null = null;
  private markdownComponent: Component | null = null;
  private renderGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly archivePlugin: WebDavArchivePlugin) {
    super(leaf);
    this.addAction("refresh-cw", t("action.refresh"), () => void this.refreshPreview());
    this.addAction("link", t("action.copyUrl"), () => void this.copyDirectUrl());
    this.addAction("download", t("action.restore"), () => void this.restoreCurrentFile());
  }

  getViewType(): string {
    return VIEW_TYPE_REMOTE_FILE;
  }

  getIcon(): IconName {
    return this.archivePlugin.settings.showGlobeIcon ? "globe-2" : (super.getIcon?.() ?? "document");
  }

  getDisplayText(): string {
    return this.originalName ?? this.file?.basename ?? t("view.remoteFile");
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.resetContent();

    let metadata: ParsedRemoteFile;
    try {
      metadata = parseRemoteFile(await this.app.vault.read(file));
    } catch (error) {
      this.originalName = null;
      this.renderError(error instanceof Error ? error.message : String(error));
      return;
    }

    this.originalName = metadata.originalName;

    if (metadata.version === 1) {
      this.renderInformation(metadata, file);
      return;
    }

    const mimeType = metadata.mimeType.toLowerCase();
    const isMedia = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
    const textType = mimeType.split(";", 1)[0].trim();
    const isText = textType === "text/markdown" || textType === "text/x-markdown" || textType === "text/plain";

    if (!isMedia && !isText) {
      this.renderInformation(metadata, file);
      return;
    }

    const generation = this.renderGeneration;
    const loading = this.contentEl.createDiv({
      cls: "webdav-archive-text-loading",
      text: t("view.loadingPreview"),
    });

    let fileUrl: string;
    try {
      const provider = this.archivePlugin.getStorageProvider(metadata.storage);
      fileUrl = await provider.getFileUrl(metadata.relativePath);
    } catch (error) {
      if (this.file !== file || this.renderGeneration !== generation) {
        return;
      }
      loading.remove();
      this.renderInformation(metadata, file, error instanceof Error ? error.message : String(error));
      return;
    }

    if (this.file !== file || this.renderGeneration !== generation) {
      return;
    }
    loading.remove();

    if (isMedia && this.renderMedia(metadata, file, fileUrl)) {
      return;
    }

    if (isText && (await this.renderText(metadata, file, fileUrl))) {
      return;
    }

    this.renderInformation(metadata, file);
  }

  async onUnloadFile(): Promise<void> {
    this.renderGeneration += 1;
    this.releasePreview();
  }

  async copyDirectUrl(): Promise<void> {
    if (!this.file) return;
    try {
      const metadata = parseRemoteFile(await this.app.vault.read(this.file));
      let url: string;
      if (metadata.version === 1) {
        url = metadata.url;
      } else {
        const provider = this.archivePlugin.getStorageProvider(metadata.storage);
        url = await provider.getFileUrl(metadata.relativePath);
      }
      await navigator.clipboard.writeText(url);
      new Notice(t("view.urlCopied"));
    } catch (error) {
      new Notice(t("view.copyUrlFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  async refreshPreview(): Promise<void> {
    if (!this.file) return;
    try {
      const metadata = parseRemoteFile(await this.app.vault.read(this.file));
      if (metadata.version === 2) {
        const provider = this.archivePlugin.getStorageProvider(metadata.storage);
        await provider.getFileUrl(metadata.relativePath, true);
      }
      await this.onLoadFile(this.file);
      new Notice(t("view.previewRefreshed"));
    } catch (error) {
      await this.onLoadFile(this.file);
    }
  }

  async restoreCurrentFile(): Promise<void> {
    if (!this.file) return;
    await this.archivePlugin.restoreRemoteFile(this.file);
  }

  private renderMedia(metadata: RemoteFile, marker: TFile, fileUrl: string): boolean {
    const mimeType = metadata.mimeType.toLowerCase();
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/") && !mimeType.startsWith("audio/")) {
      return false;
    }

    this.resetContent(true);
    const generation = this.renderGeneration;
    const stage = this.contentEl.createDiv({ cls: "webdav-archive-media-stage" });
    const handleError = (): void => {
      if (this.file !== marker || this.renderGeneration !== generation) {
        return;
      }
      this.resetContent();
      this.renderInformation(metadata, marker, t("view.previewUnavailable"));
    };

    if (mimeType.startsWith("image/")) {
      const image = stage.createEl("img", {
        cls: "webdav-archive-media-image",
        attr: { src: fileUrl, alt: metadata.originalName },
      });
      image.addEventListener("error", handleError, { once: true });
      return true;
    }

    if (mimeType.startsWith("video/")) {
      const video = stage.createEl("video", { cls: "webdav-archive-media-video" });
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.src = fileUrl;
      video.addEventListener("error", handleError, { once: true });
      this.mediaEl = video;
      return true;
    }

    stage.addClass("is-audio");
    const audio = stage.createEl("audio", { cls: "webdav-archive-media-audio" });
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = fileUrl;
    audio.addEventListener("error", handleError, { once: true });
    this.mediaEl = audio;
    return true;
  }

  private async renderText(metadata: RemoteFile, marker: TFile, fileUrl: string): Promise<boolean> {
    const mimeType = metadata.mimeType.toLowerCase().split(";", 1)[0].trim();
    const isMarkdown = mimeType === "text/markdown" || mimeType === "text/x-markdown";
    const isPlainText = mimeType === "text/plain";
    if (!isMarkdown && !isPlainText) {
      return false;
    }

    this.resetContent();
    this.contentEl.addClass("is-text");
    const generation = this.renderGeneration;
    const loading = this.contentEl.createDiv({
      cls: "webdav-archive-text-loading",
      text: t("view.loadingPreview"),
    });

    try {
      const response = await requestUrl({
        url: fileUrl,
        method: "GET",
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (this.file !== marker || this.renderGeneration !== generation) {
        return true;
      }

      loading.remove();
      const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-text-document" });
      if (isMarkdown) {
        documentEl.addClass("markdown-rendered");
        this.markdownComponent = this.addChild(new Component());
        await MarkdownRenderer.render(this.app, response.text, documentEl, marker.path, this.markdownComponent);
      } else {
        documentEl.createEl("pre", {
          cls: "webdav-archive-plain-text",
          text: response.text,
        });
      }
      return true;
    } catch {
      if (this.file === marker && this.renderGeneration === generation) {
        this.resetContent();
        this.renderInformation(metadata, marker, t("view.previewUnavailable"));
      }
      return true;
    }
  }

  private renderInformation(metadata: ParsedRemoteFile, file: TFile, warning?: string): void {
    this.contentEl.removeClass("is-media");

    const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-remote-document" });
    documentEl.createEl("h1", { text: t("view.title") });

    if (warning) {
      documentEl.createEl("p", { cls: "mod-warning webdav-archive-remote-error", text: warning });
    }

    new Setting(documentEl).setName(t("view.originalName")).setDesc(metadata.originalName);
    new Setting(documentEl).setName(t("view.type")).setDesc(metadata.mimeType);

    new Setting(documentEl)
      .setName(t("view.restore"))
      .setDesc(t("view.restoreDescription"))
      .addButton((button) =>
        button
          .setButtonText(t("view.restore"))
          .setCta()
          .onClick(async () => {
            button.setDisabled(true).setButtonText(t("view.restoring"));
            await this.archivePlugin.restoreRemoteFile(file);
            if (this.app.vault.getAbstractFileByPath(file.path)) {
              button.setDisabled(false).setButtonText(t("view.restore"));
            } else {
              button.setButtonText(t("view.restored"));
            }
          }),
      );
  }

  private resetContent(media = false): void {
    this.renderGeneration += 1;
    this.releasePreview();
    this.contentEl.empty();
    this.contentEl.addClass("webdav-archive-remote-view");
    this.contentEl.removeClass("is-text");
    this.contentEl.toggleClass("is-media", media);
  }

  private releasePreview(): void {
    if (this.mediaEl) {
      this.mediaEl.pause();
      this.mediaEl.removeAttribute("src");
      this.mediaEl.load();
      this.mediaEl = null;
    }

    if (this.markdownComponent) {
      this.removeChild(this.markdownComponent);
      this.markdownComponent = null;
    }
  }

  private renderError(message: string): void {
    const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-remote-document" });
    documentEl.createEl("h1", { text: t("view.invalid") });
    documentEl.createEl("p", { cls: "mod-warning webdav-archive-remote-error", text: message });
  }
}
