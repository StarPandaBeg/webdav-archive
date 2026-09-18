import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type WebDavArchivePlugin from "./main";
import { t } from "./i18n";

export interface WebDavArchiveSettings {
  webDavUrl: string;
  publicUrl: string;
  username: string;
  password: string;
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: WebDavArchiveSettings = {
  webDavUrl: "",
  publicUrl: "",
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
