import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
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
  enablePreview: boolean;
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
  enablePreview: true,
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

  override getControlValue(key: string): unknown {
    return (this.archivePlugin.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.archivePlugin.settings as unknown as Record<string, unknown>;

    if (key === "s3PresignedExpiration") {
      const num = Number(value);
      settings[key] = !isNaN(num) && num > 0 ? num : 3600;
    } else if (typeof value === "string") {
      const trimKeys = new Set([
        "webDavUrl",
        "publicUrl",
        "nextcloudUrl",
        "s3Endpoint",
        "s3Region",
        "s3Bucket",
        "s3AccessKeyId",
        "s3SecretAccessKey",
        "s3RemotePrefix",
      ]);
      settings[key] = trimKeys.has(key) ? value.trim() : value;
    } else {
      settings[key] = value;
    }

    await this.archivePlugin.saveSettings();

    if (key === "storageType") {
      this.refreshDomState();
    } else if (key === "enablePreview") {
      this.archivePlugin.refreshRemoteViews();
    } else if (key === "showGlobeIcon") {
      this.archivePlugin.updateGlobeIconSetting();
    }
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const isS3 = () => this.archivePlugin.settings.storageType === "s3";
    const isNextcloud = () => this.archivePlugin.settings.storageType === "nextcloud";
    const isWebDav = () => this.archivePlugin.settings.storageType === "webdav";
    const isAuthRequired = () => this.archivePlugin.settings.storageType !== "s3";

    return [
      {
        name: t("settings.storageType"),
        desc: t("settings.storageTypeDescription"),
        control: {
          key: "storageType",
          type: "dropdown",
          options: {
            webdav: t("settings.storageTypeGeneric"),
            nextcloud: t("settings.storageTypeNextcloud"),
            s3: t("settings.storageTypeS3"),
          },
        },
      },
      // Generic WebDAV settings
      {
        name: t("settings.webDavUrl"),
        desc: t("settings.webDavUrlDescription"),
        visible: isWebDav,
        control: {
          key: "webDavUrl",
          type: "text",
          placeholder: "https://cloud.example.com/webdav",
        },
      },
      {
        name: t("settings.publicUrl"),
        desc: t("settings.publicUrlDescription"),
        visible: isWebDav,
        control: {
          key: "publicUrl",
          type: "text",
          placeholder: "https://files.example.com",
        },
      },
      // Nextcloud settings
      {
        name: t("settings.nextcloudUrl"),
        desc: t("settings.nextcloudUrlDescription"),
        visible: isNextcloud,
        control: {
          key: "nextcloudUrl",
          type: "text",
          placeholder: "https://cloud.example.com",
        },
      },
      // Common WebDAV / Nextcloud credentials
      {
        name: t("settings.username"),
        visible: isAuthRequired,
        control: {
          key: "username",
          type: "text",
        },
      },
      {
        name: t("settings.password"),
        desc: t("settings.passwordDescription"),
        visible: isAuthRequired,
        render: (setting) => {
          setting.addText((text) => {
            text.inputEl.type = "password";
            text.setValue(this.archivePlugin.settings.password).onChange(async (value) => {
              this.archivePlugin.settings.password = value;
              await this.archivePlugin.saveSettings();
            });
          });
        },
      },
      // S3 settings
      {
        name: t("settings.s3Endpoint"),
        desc: t("settings.s3EndpointDescription"),
        visible: isS3,
        control: {
          key: "s3Endpoint",
          type: "text",
          placeholder: "https://s3.amazonaws.com",
        },
      },
      {
        name: t("settings.s3Region"),
        desc: t("settings.s3RegionDescription"),
        visible: isS3,
        control: {
          key: "s3Region",
          type: "text",
          placeholder: "us-east-1",
        },
      },
      {
        name: t("settings.s3Bucket"),
        desc: t("settings.s3BucketDescription"),
        visible: isS3,
        control: {
          key: "s3Bucket",
          type: "text",
          placeholder: "my-bucket",
        },
      },
      {
        name: t("settings.s3AccessKeyId"),
        visible: isS3,
        control: {
          key: "s3AccessKeyId",
          type: "text",
        },
      },
      {
        name: t("settings.s3SecretAccessKey"),
        visible: isS3,
        render: (setting) => {
          setting.addText((text) => {
            text.inputEl.type = "password";
            text.setValue(this.archivePlugin.settings.s3SecretAccessKey).onChange(async (value) => {
              this.archivePlugin.settings.s3SecretAccessKey = value.trim();
              await this.archivePlugin.saveSettings();
            });
          });
        },
      },
      {
        name: t("settings.s3RemotePrefix"),
        desc: t("settings.s3RemotePrefixDescription"),
        visible: isS3,
        control: {
          key: "s3RemotePrefix",
          type: "text",
          placeholder: "archive",
        },
      },
      {
        name: t("settings.s3ForcePathStyle"),
        desc: t("settings.s3ForcePathStyleDescription"),
        visible: isS3,
        control: {
          key: "s3ForcePathStyle",
          type: "toggle",
        },
      },
      {
        name: t("settings.s3PresignedExpiration"),
        desc: t("settings.s3PresignedExpirationDescription"),
        visible: isS3,
        control: {
          key: "s3PresignedExpiration",
          type: "number",
          placeholder: "3600",
          min: 1,
        },
      },
      // General settings
      {
        name: t("settings.enablePreview"),
        desc: t("settings.enablePreviewDescription"),
        control: {
          key: "enablePreview",
          type: "toggle",
        },
      },
      {
        name: t("settings.showGlobeIcon"),
        desc: t("settings.showGlobeIconDescription"),
        control: {
          key: "showGlobeIcon",
          type: "toggle",
        },
      },
    ];
  }
}
