import { t } from "./i18n";
import type { StorageType } from "./storage/types";

export interface RemoteFileMetadata {
  storage: StorageType | string;
  originalName: string;
  originalPath: string;
  mimeType: string;
  size: number;
  sha256: string;
  archivedAt: string;
}

export interface RemoteFileV3 extends RemoteFileMetadata {
  version: 3;
  storage: StorageType | string;
  relativePath: string;
  publicUrl?: never;
  fileUrl?: never;
}

export interface RemoteFileV2 extends RemoteFileMetadata {
  version: 2;
  storage: StorageType | string;
  relativePath: string;
  /** Kept for compatibility with existing version 2 readers. */
  publicUrl?: string;
  /** Canonical full public URL for viewers and integrations. */
  fileUrl?: string;
}

export type RemoteFile = RemoteFileV3 | RemoteFileV2;

export interface LegacyRemoteFile extends RemoteFileMetadata {
  version: 1;
  storage: "webdav";
  /** Full private WebDAV URL used by the original marker format. */
  url: string;
}

export type ParsedRemoteFile = RemoteFile | LegacyRemoteFile;

export function serializeRemoteFile(file: RemoteFile): string {
  if (file.version === 3) {
    const { publicUrl, fileUrl, ...v3Data } = file as unknown as Record<string, unknown>;
    return `${JSON.stringify(v3Data, null, 2)}\n`;
  }
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseRemoteFile(value: string): ParsedRemoteFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(t("error.invalidJson"));
  }

  if (isVersionThreeRemoteFile(parsed)) {
    return parsed;
  }

  if (isVersionTwoRemoteFile(parsed)) {
    const publicUrl =
      typeof parsed.publicUrl === "string"
        ? parsed.publicUrl
        : typeof parsed.fileUrl === "string"
          ? parsed.fileUrl
          : "";
    const fileUrl = typeof parsed.fileUrl === "string" ? parsed.fileUrl : publicUrl;
    if (parsed.storage === "webdav" && !publicUrl) {
      throw new Error(t("error.missingPublicUrl"));
    }
    return { ...parsed, publicUrl, fileUrl };
  }

  if (isLegacyRemoteFile(parsed)) {
    return parsed;
  }

  throw new Error(t("error.invalidRemoteFile"));
}

function isVersionThreeRemoteFile(value: unknown): value is RemoteFileV3 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  const isWebDav = file.storage === "webdav";
  const isNextcloud = file.storage === "nextcloud";
  const isS3 = file.storage === "s3";

  if (!isWebDav && !isNextcloud && !isS3 && (typeof file.storage !== "string" || !file.storage)) {
    return false;
  }

  return (
    file.version === 3 &&
    typeof file.relativePath === "string" &&
    file.relativePath.length > 0 &&
    hasCommonFields(file)
  );
}

function isVersionTwoRemoteFile(value: unknown): value is Omit<RemoteFileV2, "publicUrl" | "fileUrl"> & {
  publicUrl?: string;
  fileUrl?: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  const publicUrl = typeof file.publicUrl === "string" ? file.publicUrl : file.fileUrl;
  const isWebDav = file.storage === "webdav";
  const isNextcloud = file.storage === "nextcloud";
  const isS3 = file.storage === "s3";

  if (!isWebDav && !isNextcloud && !isS3 && (typeof file.storage !== "string" || !file.storage)) {
    return false;
  }

  if (isWebDav) {
    if (typeof publicUrl !== "string" || !isHttpUrl(publicUrl)) {
      return false;
    }
  } else if (publicUrl !== undefined && publicUrl !== "") {
    if (typeof publicUrl !== "string" || !isHttpUrl(publicUrl)) {
      return false;
    }
  }

  return (
    file.version === 2 &&
    typeof file.relativePath === "string" &&
    file.relativePath.length > 0 &&
    hasCommonFields(file)
  );
}

function isLegacyRemoteFile(value: unknown): value is LegacyRemoteFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  return (
    file.version === 1 &&
    file.storage === "webdav" &&
    typeof file.url === "string" &&
    isHttpUrl(file.url) &&
    hasCommonFields(file)
  );
}

function hasCommonFields(file: Record<string, unknown>): boolean {
  return (
    typeof file.originalName === "string" &&
    typeof file.originalPath === "string" &&
    typeof file.mimeType === "string" &&
    typeof file.size === "number" &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(file.sha256) &&
    typeof file.archivedAt === "string"
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
