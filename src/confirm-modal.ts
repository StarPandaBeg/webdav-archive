import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n";

export interface ConfirmOptions {
  title: string;
  message: string;
  warning?: string;
  confirmText?: string;
}

export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = new Modal(app);
    modal.titleEl.setText(options.title);
    modal.contentEl.createEl("p", { text: options.message });
    if (options.warning) {
      modal.contentEl.createEl("p", {
        cls: "mod-warning webdav-archive-remote-error",
        text: options.warning,
      });
    }

    new Setting(modal.contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("action.cancel")).onClick(() => {
          modal.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(options.confirmText ?? t("action.delete"))
          .setDestructive()
          .onClick(() => {
            confirmed = true;
            modal.close();
          }),
      );

    modal.onClose = () => {
      resolve(confirmed);
    };

    modal.open();
  });
}
