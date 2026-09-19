import type { WebDavArchiveSettings } from "../settings";
import { GenericWebDavProvider } from "./generic-webdav";
import { NextcloudStorageProvider } from "./nextcloud";
import type { StorageProvider, StorageType } from "./types";

export * from "./types";
export * from "./transfer";
export * from "./base-webdav";
export * from "./generic-webdav";
export * from "./nextcloud";

export function createStorageProvider(
  settings: WebDavArchiveSettings,
  storageType?: StorageType | string,
): StorageProvider {
  const resolvedType = storageType ?? settings.storageType;
  const type: StorageType = resolvedType === "nextcloud" ? "nextcloud" : "webdav";

  if (type === "nextcloud") {
    return new NextcloudStorageProvider({
      nextcloudUrl: settings.nextcloudUrl,
      username: settings.username,
      password: settings.password,
    });
  }

  return new GenericWebDavProvider({
    webDavUrl: settings.webDavUrl,
    publicUrl: settings.publicUrl,
    username: settings.username,
    password: settings.password,
  });
}
