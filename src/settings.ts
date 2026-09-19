import { App, PluginSettingTab, Setting } from "obsidian";
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
  showGlobeIcon: boolean;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3RemotePrefix: string;
  s3ForcePathStyle: boolean;
  s3PresignedExpiration: number;
}

export const DEFAULT_SETTINGS: WebDavArchiveSettings = {
  storageType: "webdav",
  webDavUrl: "",
  publicUrl: "",
  nextcloudUrl: "",
  username: "",
  password: "",
  showGlobeIcon: true,
  s3Endpoint: "",
  s3Region: "us-east-1",
  s3Bucket: "",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
  s3RemotePrefix: "",
  s3ForcePathStyle: false,
  s3PresignedExpiration: 3600,
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
          .addOption("s3", t("settings.storageTypeS3"))
          .setValue(this.archivePlugin.settings.storageType)
          .onChange(async (value) => {
            this.archivePlugin.settings.storageType = value as StorageType;
            await this.archivePlugin.saveSettings();
            this.display();
          }),
      );

    if (this.archivePlugin.settings.storageType === "s3") {
      new Setting(containerEl)
        .setName(t("settings.s3Endpoint"))
        .setDesc(t("settings.s3EndpointDescription"))
        .addText((text) =>
          text
            .setPlaceholder("https://s3.amazonaws.com")
            .setValue(this.archivePlugin.settings.s3Endpoint)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3Endpoint = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3Region"))
        .setDesc(t("settings.s3RegionDescription"))
        .addText((text) =>
          text
            .setPlaceholder("us-east-1")
            .setValue(this.archivePlugin.settings.s3Region)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3Region = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3Bucket"))
        .setDesc(t("settings.s3BucketDescription"))
        .addText((text) =>
          text
            .setPlaceholder("my-bucket")
            .setValue(this.archivePlugin.settings.s3Bucket)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3Bucket = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3AccessKeyId"))
        .addText((text) =>
          text
            .setValue(this.archivePlugin.settings.s3AccessKeyId)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3AccessKeyId = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3SecretAccessKey"))
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setValue(this.archivePlugin.settings.s3SecretAccessKey)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3SecretAccessKey = value.trim();
              await this.archivePlugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName(t("settings.s3RemotePrefix"))
        .setDesc(t("settings.s3RemotePrefixDescription"))
        .addText((text) =>
          text
            .setPlaceholder("archive")
            .setValue(this.archivePlugin.settings.s3RemotePrefix)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3RemotePrefix = value.trim();
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3ForcePathStyle"))
        .setDesc(t("settings.s3ForcePathStyleDescription"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.archivePlugin.settings.s3ForcePathStyle)
            .onChange(async (value) => {
              this.archivePlugin.settings.s3ForcePathStyle = value;
              await this.archivePlugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.s3PresignedExpiration"))
        .setDesc(t("settings.s3PresignedExpirationDescription"))
        .addText((text) =>
          text
            .setPlaceholder("3600")
            .setValue(String(this.archivePlugin.settings.s3PresignedExpiration || 3600))
            .onChange(async (value) => {
              const parsed = Number(value.trim());
              this.archivePlugin.settings.s3PresignedExpiration =
                !isNaN(parsed) && parsed > 0 ? parsed : 3600;
              await this.archivePlugin.saveSettings();
            }),
        );
    } else if (this.archivePlugin.settings.storageType === "nextcloud") {
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
    }

    new Setting(containerEl)
      .setName(t("settings.showGlobeIcon"))
      .setDesc(t("settings.showGlobeIconDescription"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.archivePlugin.settings.showGlobeIcon)
          .onChange(async (value) => {
            this.archivePlugin.settings.showGlobeIcon = value;
            await this.archivePlugin.saveSettings();
            this.archivePlugin.updateGlobeIconSetting();
          }),
      );
  }
}
