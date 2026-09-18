import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import type WebDavArchivePlugin from "./main";
import { parseRemoteFile } from "./remote-file";

export const VIEW_TYPE_REMOTE_FILE = "webdav-archive-remote-file";

export class RemoteFileView extends FileView {
  private originalName: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly archivePlugin: WebDavArchivePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_REMOTE_FILE;
  }

  getDisplayText(): string {
    return this.originalName ?? this.file?.basename ?? "Remote file";
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("webdav-archive-remote-view");

    let metadata;
    try {
      metadata = parseRemoteFile(await this.app.vault.read(file));
    } catch (error) {
      this.originalName = null;
      this.renderError(error instanceof Error ? error.message : String(error));
      return;
    }

    this.originalName = metadata.originalName;

    const card = this.contentEl.createDiv({ cls: "webdav-archive-remote-card" });
    card.createDiv({ cls: "webdav-archive-remote-card__eyebrow", text: "WEB­DAV ARCHIVE" });
    card.createEl("h2", { text: metadata.originalName });

    const details = card.createDiv({ cls: "webdav-archive-remote-card__details" });
    this.addDetail(details, "Original name", metadata.originalName);
    this.addDetail(details, "Type", metadata.mimeType);

    const restoreButton = card.createEl("button", {
      cls: "mod-cta webdav-archive-remote-card__restore",
      text: "Restore from WebDAV",
    });
    restoreButton.addEventListener("click", async () => {
      restoreButton.disabled = true;
      restoreButton.textContent = "Restoring…";
      try {
        await this.archivePlugin.restoreRemoteFile(file);
      } finally {
        if (this.app.vault.getAbstractFileByPath(file.path)) {
          restoreButton.disabled = false;
          restoreButton.textContent = "Restore from WebDAV";
        } else {
          restoreButton.textContent = "Restored";
        }
      }
    });
  }

  private addDetail(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: "webdav-archive-remote-card__detail" });
    row.createDiv({ cls: "webdav-archive-remote-card__label", text: label });
    row.createDiv({ cls: "webdav-archive-remote-card__value", text: value });
  }

  private renderError(message: string): void {
    const card = this.contentEl.createDiv({ cls: "webdav-archive-remote-card" });
    card.createEl("h2", { text: "Invalid remote file" });
    card.createEl("p", { cls: "webdav-archive-remote-card__error", text: message });
  }
}
