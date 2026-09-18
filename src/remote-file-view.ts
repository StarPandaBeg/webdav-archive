import { FileView, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type { IconName } from "obsidian";
import type WebDavArchivePlugin from "./main";
import { parseRemoteFile } from "./remote-file";
import type { ParsedRemoteFile, RemoteFile } from "./remote-file";
import { t } from "./i18n";

export const VIEW_TYPE_REMOTE_FILE = "webdav-archive-remote-file";

export class RemoteFileView extends FileView {
  private originalName: string | null = null;
  private mediaEl: HTMLMediaElement | null = null;
  private renderGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly archivePlugin: WebDavArchivePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_REMOTE_FILE;
  }

  getIcon(): IconName {
    return "globe-2";
  }

  getDisplayText(): string {
    return this.originalName ?? this.file?.basename ?? t("view.remoteFile");
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.resetContent();

    let metadata;
    try {
      metadata = parseRemoteFile(await this.app.vault.read(file));
    } catch (error) {
      this.originalName = null;
      this.renderError(error instanceof Error ? error.message : String(error));
      return;
    }

    this.originalName = metadata.originalName;

    if (metadata.version === 2 && this.renderMedia(metadata, file)) {
      return;
    }

    this.renderInformation(metadata, file);
  }

  async onUnloadFile(): Promise<void> {
    this.renderGeneration += 1;
    this.releaseMedia();
  }

  private renderMedia(metadata: RemoteFile, marker: TFile): boolean {
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
        attr: { src: metadata.fileUrl, alt: metadata.originalName },
      });
      image.addEventListener("error", handleError, { once: true });
      return true;
    }

    if (mimeType.startsWith("video/")) {
      const video = stage.createEl("video", { cls: "webdav-archive-media-video" });
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.src = metadata.fileUrl;
      video.addEventListener("error", handleError, { once: true });
      this.mediaEl = video;
      return true;
    }

    stage.addClass("is-audio");
    const audio = stage.createEl("audio", { cls: "webdav-archive-media-audio" });
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = metadata.fileUrl;
    audio.addEventListener("error", handleError, { once: true });
    this.mediaEl = audio;
    return true;
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
    this.releaseMedia();
    this.contentEl.empty();
    this.contentEl.addClass("webdav-archive-remote-view");
    this.contentEl.toggleClass("is-media", media);
  }

  private releaseMedia(): void {
    if (!this.mediaEl) {
      return;
    }
    this.mediaEl.pause();
    this.mediaEl.removeAttribute("src");
    this.mediaEl.load();
    this.mediaEl = null;
  }

  private renderError(message: string): void {
    const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-remote-document" });
    documentEl.createEl("h1", { text: t("view.invalid") });
    documentEl.createEl("p", { cls: "mod-warning webdav-archive-remote-error", text: message });
  }
}
