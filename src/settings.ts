import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type WebDavArchivePlugin from "./main";
import type { StorageType } from "./storage/types";
import { t } from "./i18n";

export type { StorageType };

export interface WebDavArchiveSettings {
  storageType: StorageType;
  webDavUrl: string;
  publicUrl: string;
  nextcloudUrl: string;
  username: string;
  password: string;
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: WebDavArchiveSettings = {
  storageType: "webdav",
  webDavUrl: "",
  publicUrl: "",
  nextcloudUrl: "",
  username: "",
  password: "",
  ffmpegPath: "",
};

export class WebDavArchiveSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly archivePlugin: WebDavArchivePlugin) {
    super(app, archivePlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("settings.storageType"))
      .setDesc(t("settings.storageTypeDescription"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("webdav", t("settings.storageTypeGeneric"))
          .addOption("nextcloud", t("settings.storageTypeNextcloud"))
          .setValue(this.archivePlugin.settings.storageType)
          .onChange(async (value) => {
            this.archivePlugin.settings.storageType = value as StorageType;
            await this.archivePlugin.saveSettings();
            this.display();
          }),
      );

    if (this.archivePlugin.settings.storageType === "nextcloud") {
      new Setting(containerEl)
        .setName(t("settings.nextcloudUrl"))
        .setDesc(t("settings.nextcloudUrlDescription"))
        .addText((text) =>
          text
            .setPlaceholder("https://cloud.example.com")
            .setValue(this.archivePlugin.settings.nextcloudUrl)
            .onChange(async (value) => {
              this.archivePlugin.settings.nextcloudUrl = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );
    } else {
      new Setting(containerEl)
        .setName(t("settings.webDavUrl"))
        .setDesc(t("settings.webDavUrlDescription"))
        .addText((text) =>
          text
            .setPlaceholder("https://cloud.example.com/webdav")
            .setValue(this.archivePlugin.settings.webDavUrl)
            .onChange(async (value) => {
              this.archivePlugin.settings.webDavUrl = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.publicUrl"))
        .setDesc(t("settings.publicUrlDescription"))
        .addText((text) =>
          text
            .setPlaceholder("https://files.example.com")
            .setValue(this.archivePlugin.settings.publicUrl)
            .onChange(async (value) => {
              this.archivePlugin.settings.publicUrl = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName(t("settings.username"))
      .addText((text) =>
        text.setValue(this.archivePlugin.settings.username).onChange(async (value) => {
          this.archivePlugin.settings.username = value;
          await this.archivePlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.password"))
      .setDesc(t("settings.passwordDescription"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.archivePlugin.settings.password).onChange(async (value) => {
          this.archivePlugin.settings.password = value;
          await this.archivePlugin.saveSettings();
        });
      });

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName(t("settings.ffmpegPath"))
        .setDesc(t("settings.ffmpegPathDescription"))
        .addText((text) =>
          text
            .setPlaceholder("/opt/homebrew/bin/ffmpeg")
            .setValue(this.archivePlugin.settings.ffmpegPath)
            .onChange(async (value) => {
              this.archivePlugin.settings.ffmpegPath = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );
    }
  }
}
