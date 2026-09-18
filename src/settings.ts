import { App, PluginSettingTab, Setting } from "obsidian";
import type WebDavArchivePlugin from "./main";

export interface WebDavArchiveSettings {
  webDavUrl: string;
  publicUrl: string;
  username: string;
  password: string;
}

export const DEFAULT_SETTINGS: WebDavArchiveSettings = {
  webDavUrl: "",
  publicUrl: "",
  username: "",
  password: "",
};

export class WebDavArchiveSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly archivePlugin: WebDavArchivePlugin) {
    super(app, archivePlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("WebDAV URL")
      .setDesc("Writable base URL, including the destination folder. The object path is appended to it.")
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
      .setName("Public URL")
      .setDesc("Read-only base URL for the same folder. The same object path is appended to it.")
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
      .setName("Username")
      .addText((text) =>
        text.setValue(this.archivePlugin.settings.username).onChange(async (value) => {
          this.archivePlugin.settings.username = value;
          await this.archivePlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc("Stored locally in Obsidian's plugin data. An app password is recommended when available.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.archivePlugin.settings.password).onChange(async (value) => {
          this.archivePlugin.settings.password = value;
          await this.archivePlugin.saveSettings();
        });
      });
  }
}
