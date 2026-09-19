import type { WebDavArchiveSettings } from "../settings";
import { GenericWebDavProvider } from "./generic-webdav";
import { NextcloudStorageProvider } from "./nextcloud";
import { S3StorageProvider } from "./s3";
import type { StorageProvider, StorageType } from "./types";

export * from "./types";
export * from "./transfer";
export * from "./base-webdav";
export * from "./generic-webdav";
export * from "./nextcloud";
export * from "./s3";

export function createStorageProvider(
  settings: WebDavArchiveSettings,
  storageType?: string,
): StorageProvider {
  const resolvedType = storageType ?? settings.storageType;
  const type: StorageType =
    resolvedType === "nextcloud" ? "nextcloud" : resolvedType === "s3" ? "s3" : "webdav";

  if (type === "s3") {
    return new S3StorageProvider({
      endpoint: settings.s3Endpoint,
      region: settings.s3Region,
      bucket: settings.s3Bucket,
      accessKeyId: settings.s3AccessKeyId,
      secretAccessKey: settings.s3SecretAccessKey,
      remotePrefix: settings.s3RemotePrefix,
      forcePathStyle: settings.s3ForcePathStyle,
      presignedExpiration: settings.s3PresignedExpiration,
    });
  }

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
