import { FileView, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type { IconName } from "obsidian";
import type WebDavArchivePlugin from "./main";
import { parseRemoteFile } from "./remote-file";
import { t } from "./i18n";

export const VIEW_TYPE_REMOTE_FILE = "webdav-archive-remote-file";

export class RemoteFileView extends FileView {
  private originalName: string | null = null;

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

    const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-remote-document" });
    documentEl.createEl("h1", { text: t("view.title") });

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

  private renderError(message: string): void {
    const documentEl = this.contentEl.createDiv({ cls: "webdav-archive-remote-document" });
    documentEl.createEl("h1", { text: t("view.invalid") });
    documentEl.createEl("p", { cls: "mod-warning webdav-archive-remote-error", text: message });
  }
}
